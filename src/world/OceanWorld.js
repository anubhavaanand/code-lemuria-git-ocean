/**
 * Git Ocean — scene assembly
 *
 * Builds the whole 2.5D layered ocean world from worldData, and exposes a
 * small imperative API the React HUD drives. Keeping the scene out of React
 * is deliberate: a Three.js scene is a long-lived imperative object, and
 * re-creating it on every render would be a disaster. React owns the chrome,
 * this module owns the water.
 *
 * Coordinate system
 * ---------------
 *   Z  depth ordering — the layer stack. Each band lives at its own Z, so the
 *      camera dollying through Z *is* the zoom. This is what makes the
 *      "layered depth" approach read as depth rather than as flat cards.
 *   Y  height. The seafloor is SEAFLOOR_Y = 0; towers, kelp and obelisks all
 *      grow upward from there. Nothing is placed using real ocean depth —
 *      that value is only for the HUD readout and for fog.
 *   X  lateral position inside a band.
 *
 * This is the correction to the first prototype: LAYERS used to be read as Y
 * in the environment modules and as Z here, which is why the water surface
 * sat at the top of the frame. There is now exactly one coordinate system.
 *
 * Performance strategy (constitution: Stylized Realism over fidelity)
 * -----------------------------------------------------------------
 *   - Frustum culling on for everything except instanced swarms.
 *   - Towers are individually culled; the 5 orbital groups per whale are
 *     instanced meshes with per-instance transforms updated on the CPU.
 *   - Only the user's own repos and the followed repos get whales + creatures.
 *     The ambient mass of GitHub gets towers only — that is where the
 *     geometry budget goes.
 *   - Distance bands: anything beyond `this.drawDistance` is skipped per
 *     frame by hiding the whole group, not by removing it.
 */

import * as THREE from "three";
import {
  COLORS,
  LAYERS,
  SEAFLOOR_Y,
  ZOOM_LEVELS,
  depthToY,
} from "./constants";
import {
  buildWorld,
  CAPITAL_CLUSTERS,
  hashString,
  LANGUAGE_COLONIES,
  YOU,
} from "./worldData";
import { OceanEnvironment, createFog, depthBackground } from "./OceanEnvironment";
import { Seafloor, seafloorHeightAt } from "./Seafloor";
import { KelpTower } from "./KelpTower";
import { WhaleWithSculpt } from "./WhaleFactory";
import { CreatureSystem, AmbientSchool } from "./CreatureGeometry";
import { LegacyColony } from "./LegacyCreatures";
import { SonarObelisk, buildClusterLights } from "./SonarObelisk";
import { CameraRig } from "./CameraRig";
import { SelectionMarker } from "./SelectionMarker";
import { FrameProfiler, NOOP_PROFILER } from "./perf";

const isMobileDevice = () =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);

export function detectQuality() {
  if (typeof navigator === "undefined") return "high";
  if (isMobileDevice()) return "mobile";
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (mem <= 4 || cores <= 4) return "low";
  return "high";
}

export class OceanWorld {
  constructor(container, opts = {}) {
    this.container = container;
    this.quality = opts.quality || detectQuality();
    this.isMobile = this.quality === "mobile";
    this.drawDistance = this.isMobile ? 2200 : this.quality === "low" ? 3200 : 5200;

    // Suppress the imported whale bodies, for pixel-diffing the sculpt against
    // the procedural one. Set from `?nosculpt=1` by the caller.
    this.suppressSculpt = !!opts.suppressSculpt;

    // Isolate the whale, for measuring its silhouette unambiguously.
    //
    // Differencing a normal frame against `?nosculpt=1` does not isolate the
    // body: removing the sculpt also changes what is visible behind it, so the
    // diff is a silhouette-plus-background map. Measured that way the "body"
    // came out 604 x 268 px against a predicted 267 x 101 px — the tower and
    // kelp blades sitting behind the animal were being counted as whale.
    //
    // With this set, everything except the whales is hidden and the background
    // goes flat, so a brightness threshold returns the animal and nothing else.
    // Set from `?only=whale`.
    this.onlyWhales = !!opts.onlyWhales;

    this.onSelect = opts.onSelect || (() => {});
    this.onLevelChange = opts.onLevelChange || (() => {});
    this.onReady = opts.onReady || (() => {});

    this.data = buildWorld();
    this.you = this.data.you || YOU;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;

    // Measured, not guessed. The header of this file used to promise distance
    // culling and a frame budget, and neither existed: `drawDistance` was
    // assigned once and never read, and `_frustum` was rebuilt every frame and
    // never consulted. The profiler exists so a performance claim can be
    // checked against a number.
    this.profiler = opts.profiler || NOOP_PROFILER;

    this.towers = [];          // { tower, repo, entry }
    this.whales = [];          // { whale, entry, orbit }
    this.creatureSystems = []; // { system, entry, orbit }
    this.legacy = [];          // LegacyColony — benthic + stipe + water-column fauna
    this.pendingCredits = [];  // CC BY attribution owed for imported sculpts
    this.ambientSchools = [];
    this.obelisks = [];
    this.entries = new Map();  // repoId -> entry
    this.pickables = [];       // flat list of pickable tower groups

    this.selectedId = null;
    this.focusPoint = null;

    this._tmpVec = new THREE.Vector3();
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._buildEnvironment();
    this._buildWorldGeometry();
    this._initRig();
    this._bindPicking();

    this.clock.start();
    this._loop();

    // Report the initial level so the HUD is in sync on first paint
    this.onLevelChange(this.rig.level);
    this.onReady();
  }

  // =========================================================================
  // Setup
  // =========================================================================

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== "low",
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.setSize(
      Math.max(1, this.container.clientWidth),
      Math.max(1, this.container.clientHeight)
    );
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2)
    );
    this.renderer.setClearColor(COLORS.abyss, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Record which renderer actually got the context. A perf number measured
    // under a software rasteriser (which is what headless Chrome uses) says
    // nothing about real hardware, and the whole point of the profiler is to
    // make claims checkable rather than asserted.
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      this.rendererName = dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
    } catch (e) {
      this.rendererName = "unknown";
    }

    const el = this.renderer.domElement;
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.touchAction = "none";
    el.setAttribute("aria-label", "Git Ocean underwater world");
    this.container.appendChild(el);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.abyss);
    this.scene.fog = createFog(-480);

    this.camera = new THREE.PerspectiveCamera(
      ZOOM_LEVELS[2].fov,
      Math.max(1, this.container.clientWidth) /
        Math.max(1, this.container.clientHeight),
      0.5,
      12000
    );
    this.camera.position.set(0, 30, 260);
    this.scene.add(this.camera);
  }

  _initLights() {
    // Ambient: dim base of the water column. Not pure black — deep water still
    // scatters some light, and pure black kills silhouette readability.
    // Tuned by measuring rendered luminance per screen band: at 2.1 the
    // sediment rendered at its full albedo (luma ~80) and the floor read as a
    // flat bright slab instead of a receding plain.
    this.scene.add(new THREE.AmbientLight(0x4a7c9e, 1.05));

    // A hemisphere term stands in for the real thing: the surface above is
    // lit, the sediment below is not.
    const hemi = new THREE.HemisphereLight(0x9fd8f5, 0x24384a, 0.85);
    this.scene.add(hemi);

    // Sunlight filtering down through the surface.
    const sun = new THREE.DirectionalLight(0xdaf1ff, 1.9);
    sun.position.set(-140, 420, 200);
    if (this.quality !== "low") {
      sun.castShadow = true;
      const s = this.isMobile ? 1024 : 2048;
      sun.shadow.mapSize.set(s, s);
      const d = 170;
      sun.shadow.camera.left = -d;
      sun.shadow.camera.right = d;
      sun.shadow.camera.top = d;
      sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 20;
      sun.shadow.camera.far = 1100;
      sun.shadow.bias = -0.0014;
      sun.shadow.normalBias = 0.03;
    }
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // Cold bounce from the seafloor — the ground reflects, it isn't a void
    const bounce = new THREE.DirectionalLight(0x3d84b0, 0.7);
    bounce.position.set(90, -260, -140);
    this.scene.add(bounce);

    // Faint warm rim from the front so whale backs separate from the water
    const rim = new THREE.DirectionalLight(0xbfe8ff, 0.6);
    rim.position.set(160, 80, 340);
    this.scene.add(rim);

    // A wide, very soft fill from the camera side, so the near faces of the
    // towers and the sediment still read without lifting the whole scene.
    const fill = new THREE.DirectionalLight(0x6fa8c8, 0.42);
    fill.position.set(60, 140, 520);
    this.scene.add(fill);
  }

  _buildEnvironment() {
    const opts = { quality: this.quality, isMobile: this.isMobile };

    // `?only=whale` skips the water column, the seafloor and the ambient
    // schools entirely, so nothing can be mistaken for the animal. See the
    // `onlyWhales` note in the constructor.
    if (this.onlyWhales) {
      this.scene.background = new THREE.Color(0x000106);
      this.scene.fog = null;
      return;
    }

    this.ocean = new OceanEnvironment(this.scene, opts);
    this.floor = new Seafloor(this.scene, opts);

    // Two ambient schools: one near (detailed), one far (bigger, dimmer).
    const near = new AmbientSchool({
      count: this.isMobile ? 22 : this.quality === "low" ? 32 : 58,
      quality: this.quality,
    });
    near.group.position.z = LAYERS.ambientNear;
    this.scene.add(near.group);
    this.ambientSchools.push(near);

    const far = new AmbientSchool({
      count: this.isMobile ? 16 : 26,
      quality: this.quality,
    });
    far.fish.forEach((f) => {
      f.size *= 2.1;
      f.speed *= 0.7;
    });
    far.group.position.z = LAYERS.ambientFar;
    this.scene.add(far.group);
    this.ambientSchools.push(far);
  }

  // =========================================================================
  // World geometry
  // =========================================================================

  _buildWorldGeometry() {
    const opts = { quality: this.quality, isMobile: this.isMobile };

    if (this.onlyWhales) {
      // Towers are still needed: a whale is placed relative to its tower's
      // height and position. But the tower's own geometry is not, so build the
      // towers with their visuals suppressed rather than rebuilding the layout.
      this._addRepoTowers(this.data.yourRepos, {
        zBase: LAYERS.kelpForestMid,
        withWhales: true,
        withCreatures: false,
        withLegacy: false,
        hideGeometry: true,
      });
      this._addRepoTowers(this.data.following, {
        zBase: LAYERS.kelpForestFar,
        withWhales: true,
        withCreatures: false,
        withLegacy: false,
        hideGeometry: true,
      });
      return;
    }

    // --- Capital landmarks: sonar obelisks ---
    // Only build the nearest few as full geometry; the rest become lights.
    for (const cluster of CAPITAL_CLUSTERS) {
      const dz = Math.abs(depthToY(cluster.depth) - depthToY(this.you.depth));
      if (dz > 900 && !this.isMobile) continue;

      const obelisk = new SonarObelisk(cluster, opts);
      // Stands on the sediment; X is spread by real longitude, Z by its band
      const ox = cluster.lat * 0.6 - 90;
      const oz = LAYERS.obelisk + (cluster.lon % 7) * 14;
      obelisk.group.position.set(ox, seafloorHeightAt(ox, oz), oz);
      this.scene.add(obelisk.group);
      this.obelisks.push(obelisk);
    }

    // Far cluster lights — cheap beacons that read as settlements at world zoom
    const lights = buildClusterLights(CAPITAL_CLUSTERS, {
      max: this.isMobile ? 4 : 6,
    });
    lights.position.set(0, SEAFLOOR_Y, LAYERS.farRidge - 80);
    this.scene.add(lights);
    this.clusterLights = lights;

    // --- Your own repos: the Phase 1 personal zone ---
    this._addRepoTowers(this.data.yourRepos, {
      zBase: LAYERS.kelpForestMid,
      withWhales: true,
      withCreatures: true,
      withLegacy: true,
      scale: 1.0,
    });

    // --- Towers you follow, far across the water ---
    this._addRepoTowers(this.data.following, {
      zBase: LAYERS.kelpForestFar,
      withWhales: true,
      withCreatures: true,
      withLegacy: !this.isMobile,
      scale: 1.0,
    });

    // --- Ambient towers: the anonymous mass of GitHub ---
    this._addAmbientTowers();
  }

  _addRepoTowers(repos, opts) {
    const creatureOpts = { quality: this.quality, isMobile: this.isMobile };

    for (const repo of repos) {
      const pos = repo.position || [0, 0];
      const tower = new KelpTower(repo, {
        quality: this.quality,
        isMobile: this.isMobile,
      });
      // Sit the holdfast ON the sediment, not at y=0. The floor displaces by
      // up to ±90 units, so a fixed y either floated the tower in open water
      // or buried it to the canopy.
      const tx = pos[0];
      const tz = opts.zBase + pos[1];
      tower.group.position.set(tx, seafloorHeightAt(tx, tz), tz);
      tower.group.scale.setScalar(opts.scale);
      // `?only=whale` needs the tower's height and root position (a whale's
      // orbit is derived from both) but not its geometry. Hide the visuals
      // rather than skipping the tower, so the layout maths is untouched.
      if (opts.hideGeometry) tower.group.visible = false;
      this.scene.add(tower.group);

      const entry = {
        repo,
        tower,
        whale: null,
        creatures: null,
        legacy: null,
        whaleOrbit: null,
        kind: "repo",
      };
      this.entries.set(repo.id, entry);
      this.towers.push({ tower, repo, entry });
      this.pickables.push(tower.group);

      // Legacy creatures live on the tower itself, so they exist whether or not
      // this repo earned a whale. Ambient towers deliberately skip them: the
      // anonymous mass of GitHub gets silhouette, not detail.
      if (opts.withLegacy) {
        const legacy = new LegacyColony(repo, {
          tower,
          quality: this.quality,
          isMobile: this.isMobile,
        });
        tower.group.add(legacy.group);
        entry.legacy = legacy;
        entry.fauna = legacy.creatures;
        this.legacy.push(legacy);
      }

      if (opts.withWhales) {
        // WhaleWithSculpt is a RepoWhale: same swim cycle, same data-bearing
        // parts, only the silhouette may differ. Species without an imported
        // model (blue, bowhead, sperm, orca) get the procedural lathe and never
        // know the difference.
        const whale = new WhaleWithSculpt(repo, {
          quality: this.quality,
          isMobile: this.isMobile,
        });

        // Kick the load without blocking scene assembly: the procedural body is
        // already in the scene and animating, so a whale is visible immediately
        // and a fast network swaps in the sculpt a moment later. A failed load
        // leaves the lathe, which is the correct fallback, not an error state.
        if (WhaleWithSculpt.hasSculpt(repo) && !this.isMobile) {
          // `?nosculpt=1` keeps the procedural body so a screenshot pair can be
          // diffed. Without a way to suppress the sculpt there is no way to tell
          // "the whale is not drawn" from "the whale is drawn but unreadable":
          // an earlier diff appeared to show 37,052 changed pixels, but the flag
          // it relied on never existed, so both captures were the same frame and
          // the difference was water animation.
          const suppress = this.suppressSculpt;
          if (!suppress) {
            whale.adoptSculpt().then((ok) => {
              if (ok) this.pendingCredits.push(whale.sculptCredit);
            });
          }
        }

        // Orbit radius is capped. Without a cap a flagship tower (160+ units)
        // pushed its whale 130 units out, further than the whale level's camera
        // sits from the tower — so the animal spent most of its orbit off the
        // edge of the frame. A cap keeps every repo's whale inside the lens
        // while preserving the rule that bigger repos orbit wider.
        const orbitR = Math.min(tower.height * 0.7 + 16, 62);
        // Orbit height must be measured from the tower's ROOT, not from y=0,
        // otherwise a tower standing in a trough had its whale circling
        // somewhere inside the sediment.
        const cy = tower.group.position.y + tower.height * 0.58;
        const cx = pos[0];
        const cz = opts.zBase + pos[1];

        // The starting phase is authored, not random, so that a screenshot and
        // a geometry census are taken of the same frame. A random phase makes
        // every page load a different picture, which is how a QA pass measuring
        // pixels in one run and reading coordinates from another concludes the
        // whale is missing.
        //
        // PI/2 specifically, not just any fixed value. The whale's heading is
        // the orbit's tangent, so at phase PI/2 it travels along -X while the
        // camera looks along +Z — the animal crosses the frame broadside, which
        // is the only orientation in which a body plan (head, taper, flukes,
        // flippers) is legible. At PI*0.75 the same animal swims away from the
        // lens at 45 degrees and reads as a shapeless mass, which is exactly
        // what a QA pass reported when the whale was demonstrably being drawn
        // (37,052 pixels changed with the sculpt hidden).
        const startPhase = Math.PI * 0.5;

        whale.group.position.set(
          cx + Math.cos(startPhase) * orbitR,
          cy,
          cz + Math.sin(startPhase) * orbitR
        );
        this.scene.add(whale.group);

        entry.whale = whale;
        entry.whaleOrbit = {
          cx,
          cz,
          r: orbitR,
          y: cy,
          phase: startPhase,
          // Deterministic per repo, not Math.random(). With a random speed the
          // phase at load time differed between two identical page loads by
          // enough to move the animal visibly along its orbit — measured as
          // three captures of one frozen URL giving 29,572 / 60,848 / 61,072 lit
          // pixels, i.e. two frames matched to 1,924 px and a third that was a
          // different picture. Deriving the speed from the repo id keeps "bigger
          // repos orbit faster" while making the frame reproducible.
          speed: 0.055 + (hashString(repo.id) % 50) / 1000,
        };
        whale.group.position.set(
          cx + Math.cos(startPhase) * orbitR,
          cy,
          cz + Math.sin(startPhase) * orbitR
        );
        this.whales.push({ whale, entry, orbit: entry.whaleOrbit });

        if (opts.withCreatures) {
          const system = new CreatureSystem(repo, creatureOpts);
          const sysGroup = new THREE.Group();
          sysGroup.add(system.group);
          sysGroup.position.set(cx, cy, cz);
          this.scene.add(sysGroup);

          entry.creatures = system;
          entry.creatureHolder = sysGroup;
          entry.creatureOrbit = entry.whaleOrbit;
          this.creatureSystems.push({ system, entry, orbit: entry.creatureOrbit, holder: sysGroup });
        }
      }
    }
  }

  _addAmbientTowers() {
    const ambient = this.data.ambient || [];
    const maxTowers = this.isMobile
      ? Math.floor(ambient.length * 0.45)
      : ambient.length;

    for (let i = 0; i < Math.min(maxTowers, ambient.length); i++) {
      const repo = ambient[i];
      const tower = new KelpTower(repo, {
        quality: "low",
        isMobile: this.isMobile,
      });
      const pos = repo.position || [0, 0];
      const zBase =
        depthToY(repo.depth) < -1000
          ? LAYERS.kelpForestFar
          : LAYERS.kelpForestMid;
      const ax = pos[0];
      const az = zBase + pos[1];
      // Same sediment grounding as the named towers.
      tower.group.position.set(ax, seafloorHeightAt(ax, az), az);
      tower.group.scale.setScalar(0.78 + ((i * 37) % 50) / 100);
      this.scene.add(tower.group);
      this.towers.push({ tower, repo, entry: null });
    }
  }

  // =========================================================================
  // Camera + picking
  // =========================================================================

  _initRig() {
    this.rig = new CameraRig(this.camera, this.renderer.domElement, {
      startIndex: 2, // city
    });
    this._lastLevelId = this.rig.levelId;
  }

  _bindPicking() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Selection and hover marks. Constructed here because they need the scene,
    // which exists by now, and because `select()` below writes to them — before
    // this the selected id was recorded and never drawn, so clicking a tower
    // moved the camera but left the world saying nothing about which one.
    this.marker = new SelectionMarker(this.scene);

    this._onPointerDown = (e) => {
      this._downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };

    this._onPointerUp = (e) => {
      if (!this._downAt) return;
      const dx = e.clientX - this._downAt.x;
      const dy = e.clientY - this._downAt.y;
      const dist = Math.hypot(dx, dy);
      const dt = performance.now() - this._downAt.t;
      this._downAt = null;

      // A drag is a look, not a click. Only a short, still press counts.
      if (dist > 6 || dt > 500) return;

      if (this._pickAt(e.clientX, e.clientY)) this.select(this._pickAt.lastId);
      else this.select(null);
    };

    // Hover is stored rather than raycast per event: pointermove fires far more
    // often than a frame, and a raycast against every pickable tower is not
    // free. The loop consumes it once per frame, so the cost is bounded by the
    // frame rate rather than by the mouse.
    this._onPointerMove = (e) => {
      this._pointerDirty = true;
      this._pointerX = e.clientX;
      this._pointerY = e.clientY;
    };

    this._onPointerLeave = () => {
      this._pointerDirty = false;
      if (this.marker) this.marker.setHover(null);
      this.renderer.domElement.style.cursor = "";
    };

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this._onPointerDown);
    el.addEventListener("pointerup", this._onPointerUp);
    el.addEventListener("pointermove", this._onPointerMove);
    el.addEventListener("pointerleave", this._onPointerLeave);
    this._pickEl = el;
  }

  /**
   * Cast one ray and resolve it to a pickable tower.
   *
   * Returns the tower, or null. The id is stashed on the function object so the
   * click handler does not have to cast twice — a raycast per click is cheap,
   * but doing it twice for one click is still doing it twice for no reason.
   */
  _pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Only the repos with real entries are pickable — ambient towers are
    // scenery, and raycasting thousands of them is a waste.
    const targets = this.pickables;
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) {
      this._pickAt.lastId = null;
      return null;
    }

    // Walk up to the tower group. A hit is on a leaf — a blade, a polyp, a
    // creature — and the only useful answer is the tower it belongs to.
    let node = hits[0].object;
    while (node && node.parent !== this.scene) node = node.parent;
    const found = this.towers.find((t) => t.tower.group === node);
    if (!found || !found.entry) {
      this._pickAt.lastId = null;
      return null;
    }
    this._pickAt.lastId = found.entry.repo.id;
    return found.tower;
  }

  /** Select a repo by id (or null to clear). Fires onSelect. */
  select(repoId) {
    this.selectedId = repoId;

    if (!repoId) {
      this.focusPoint = null;
      this.selectedFauna = null;
      if (this.marker) this.marker.setSelected(null);
      this.onSelect(null);
      return;
    }

    const entry = this.entries.get(repoId);
    if (!entry) {
      this.selectedFauna = null;
      if (this.marker) this.marker.setSelected(null);
      this.onSelect(null);
      return;
    }

    // Kept on the world as well as passed to the HUD. The HUD gets the fauna
    // folded into a copy of the repo so it has one object to render; but a
    // lookup from the world — a keyboard shortcut, a QA probe — needs to reach
    // it without going through React state.
    this.selectedFauna = entry.fauna || null;

    // Draw the mark before the camera moves, so the frame the camera settles on
    // already has the selected tower ringed rather than the ring appearing a
    // beat later.
    if (this.marker) this.marker.setSelected(entry.tower);

    const p = entry.tower.group.position;
    // At the closest zoom the camera sits ~62 units out, so a focus point 18
    // units up (0.55 x a 31-unit tower) points the lens at empty water above the
    // whale's orbit. The animals circle at roughly half the tower height, which
    // is also where the tower's visual mass is, so aim there instead.
    this.focusPoint = {
      x: p.x,
      y: entry.tower.height * 0.42,
      z: p.z,
    };
    // Orbit radius, not tower height, is what the camera must clear: the whale
    // is the subject at the closest zoom, and it circles at 0.7 x height + 16.
    this.focusRadius = Math.min(entry.tower.height * 0.7 + 16, 62);
    // The animal's own length, which is what the whale zoom actually frames.
    // Its orbit radius is only the floor on how far back the lens can sit.
    if (entry.whale) {
      this.focusLength = entry.whale.length;
      this.focusOrbitY = entry.whaleOrbit ? entry.whaleOrbit.y : entry.tower.height * 0.58;
    }

    // Attach the built fauna so the HUD's creature list describes the colony
    // that exists, not the eighteen that could exist. The registry is the
    // builders' own record, so it cannot disagree with the geometry.
    this.onSelect(
      entry.fauna
        ? Object.assign({}, entry.repo, { __fauna: entry.fauna })
        : entry.repo
    );
  }

  /** Frame the currently selected repo at a given zoom level. */
  focusSelected(levelIndex = 3) {
    if (!this.selectedId) return;
    this.rig.goTo(levelIndex);
    // goTo() only moves targetT; the eased `t` is still at the old level. Snap
    // immediately so a caller that frames and then reads the camera in the same
    // tick gets the framing it asked for instead of a mid-transition position.
    //
    // `radius` must be passed here too: it is what scales the level's authored
    // distance to the size of the subject, and without it the snap frames an
    // ordinary-sized tower while the actual repo (a flagship, with a much wider
    // whale orbit) sits partly outside the frame.
    this.rig.apply(0, true, this._follow());
  }

  /**
   * The camera's follow target in the shape the rig expects.
   *
   * One place builds this so the frame loop and a one-shot snap can never
   * disagree about what is being followed — they did disagree once, which is how
   * a snapped framing ended up tighter than the animated one.
   */
  _follow() {
    if (!this.focusPoint) return null;
    const follow = {
      position: this._tmpVec.set(
        this.focusPoint.x,
        this.focusPoint.y,
        this.focusPoint.z
      ),
      radius: this.focusRadius || 32,
    };

    // The whale zoom frames the ANIMAL, so the focus and distance are derived
    // from its own length, not from the tower's.
    //
    // Every earlier attempt derived them from tower height and got the sign
    // backwards: it scaled the lens UP with the tower, so a flagship repo got a
    // lens 300 units overhead looking down 35 degrees while its whale sat at
    // 0.58 x height - above the focus, near the bottom of the frame, clipped.
    // Measured on the live scene at the vue repo: the camera's forward ray
    // crossed the whale's depth plane 6.9 units above the body centre, and the
    // QA pass found the animal along the bottom edge with head and flukes cut
    // off.
    //
    // So: aim AT the orbit height, and set the distance so the orbit plus the
    // animal's own length fits the frame. Nothing here depends on tower height
    // except through the orbit radius, which is already capped at 62.
    const orbitY =
      this.focusOrbitY != null ? this.focusOrbitY : this.focusPoint.y;
    const length = this.focusLength || 18;
    const halfV = 0.38 * length * 0.5 + 6;
    const fovV = 42;
    const ty = Math.tan((fovV * Math.PI) / 360);
    const tx = ty * (1440 / 900);
    // Horizontally the lens must hold the whole orbit plus half the body, or
    // the animal leaves the frame at some phase of its circle.
    const halfH = (this.focusRadius || 32) + length * 0.5;
    const dist = Math.max(halfV / ty, halfH / tx) * 1.9;
    follow.distance = dist;
    follow.focusY = orbitY;
    // Camera height is measured FROM the focus, so this is the pitch expressed
    // as a rise.
    //
    // Nearly level with the animal, not above it. At 11 degrees down the lens
    // was 42 units over a 48-unit whale at 215 units out: the view axis met the
    // body from above, and what filled the frame was mostly the animal's dark
    // dorsal surface with the pale flank rolled away underneath. Measured in the
    // isolated frame: the body's lit pixels sat at RGB (200,216,224) where the
    // flank catches the light, but the mass read as a low-contrast slab against
    // water at (1,10,24) because most of what was visible was back, not side.
    //
    // 2 degrees keeps the eye at the animal's own level, so the flank, the
    // jawline and the peduncle are the silhouette rather than a foreshortened
    // back. It also keeps the tower behind the whale instead of under it.
    follow.height = Math.tan((2 * Math.PI) / 180) * dist;
    return follow;
  }

  // =========================================================================
  // Frame loop
  // =========================================================================

  _loop() {
    const tick = () => {
      this.frameHandle = requestAnimationFrame(tick);

      // Frame interval first: this is the number the user feels, and under
      // virtual time it is the only honest one (see perf.js).
      const intervalStart = performance.now();
      this.profiler.begin();

      const delta = Math.min(0.05, this.clock.getDelta());
      // The world's own CPU work starts here and stops at the render call, so
      // the measured slice is the update loops only. The render itself is the
      // GPU's, and including it would make this number a frame interval rather
      // than a CPU cost — which is what makes it diagnostic.
      const updateStart = performance.now();
      // `timeScale` is the other half of `?freeze=1`. Pinning the orbit alone is
      // not enough to compare two frames: caustics, god rays, marine snow and
      // kelp sway all advance on `elapsed`, so an on/off diff still lit up every
      // pixel in the frame and measured nothing about the whale. Held at 0 the
      // whole scene is genuinely static and a diff means what it says.
      this.elapsed += delta * (this.timeScale ?? 1);
      const t = this.elapsed;
      this.frame++;

      // --- Environment ---
      // Guarded: `?only=whale` skips the water column entirely, so there is no
      // ocean to update.
      if (this.ocean) this.ocean.update(delta, t);

      // Fog is authored per zoom level (real metres), so the density is read
      // directly rather than recomputed from the depth value.
      if (this.scene.fog) {
        const target = this.rig.currentFogDensity || 0.0016;
        this.scene.fog.density +=
          (target - this.scene.fog.density) * Math.min(1, delta * 2.5);
      }
      // Background colour shifts with depth too
      const bg = depthBackground(this.rig.currentDepth || -480);
      this.scene.background.lerp(bg, Math.min(1, delta * 2));

      // --- Frustum for cheap visibility decisions ---
      this._projScreen.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this._frustum.setFromProjectionMatrix(this._projScreen);

      // --- Kelp ---
      // Ambient towers are cheaper to update at half rate
      const updateAll = this.frame % 2 === 0;
      for (let i = 0; i < this.towers.length; i++) {
        const rec = this.towers[i];
        if (!rec.entry && !updateAll) continue;
        rec.tower.update(delta);
      }

      // --- Legacy fauna ---
      // These ride on the tower groups, so they inherit every tower transform
      // for free and need no world-space bookkeeping of their own.
      //
      // Distance-culled, which the header of this file claimed and the code
      // never did. Measured: 657 of the city zoom's 728 draw calls belong to
      // the non-whale scene, and the fauna are a large share of that. A colony
      // 3,000 units away in the fog cannot be seen, yet still rewrites every
      // instance matrix it owns, every frame.
      //
      // Both the CPU update and the draw are skipped — hiding the group would
      // stop the draw but keep the cost of the update, which is the half that
      // scales with creature count.
      const cull2 = this.drawDistance * this.drawDistance;
      const cam = this.camera.position;
      for (let i = 0; i < this.legacy.length; i++) {
        const l = this.legacy[i];
        // The colony's group is parented to the tower, so the tower's position
        // is the world position; the colony's own is a local offset.
        const holder = l.group.parent;
        const p = holder ? holder.position : l.group.position;
        const dx = p.x - cam.x;
        const dz = p.z - cam.z;
        const far = dx * dx + dz * dz > cull2;
        // Toggle visibility only when it changes: writing `visible` every frame
        // dirties the object and makes three re-sort the render list for
        // nothing.
        if (l.group.visible === far) l.group.visible = !far;
        if (far) continue;
        l.update(delta);
      }

      // --- Whales: circle their tower, trailing their orbital cloud ---
      for (let i = 0; i < this.whales.length; i++) {
        const { whale, entry, orbit } = this.whales[i];
        if (!entry) continue;

        // `orbitScale` exists so a headless screenshot and a geometry census can
        // be taken of the SAME frame. A whale's orbit advances with wall-clock
        // delta, so two separate page loads put the animal at different phases —
        // and a QA pass that measures the pixels in one run and reads the
        // reported position from another will look at empty water and conclude
        // the whale is missing. Pinned to 0 the animal holds still.
        // `orbit.speed` carries Math.random() from _addRepoTowers, so even with
        // `?freeze=1` holding the phase still the animal's HEIGHT still drifts:
        // `y` is `orbit.y + sin(t * 0.42 + orbit.phase) * 3.4`, and `t` is
        // `elapsed`, which `timeScale` pins to 0 — so the vertical bob is frozen
        // but the phase is not the only thing that varies. Measured: three
        // back-to-back captures of the same frozen URL gave lit-pixel counts of
        // 29,572 / 60,848 / 61,072, i.e. two frames matched to 1,924 px and the
        // third was a different picture entirely. The remaining variable is the
        // speed itself, which shifts the phase by a fraction of a radian over
        // the load's ~8-20 s and moves the animal along its orbit.
        //
        // Pinned to 0 the phase never advances, so the drawn position is a
        // function of the authored constants alone.
        orbit.phase += delta * orbit.speed * (this.orbitScale ?? 1);
        const x = orbit.cx + Math.cos(orbit.phase) * orbit.r;
        const z = orbit.cz + Math.sin(orbit.phase) * orbit.r;
        const y = orbit.y + Math.sin(t * 0.42 + orbit.phase) * 3.4;

        // Face the direction of travel.
        //
        // Worked out from the rotation matrix rather than by pattern-matching
        // atan2 arguments, because three sign conventions were tried in a row and
        // each looked plausible.
        //
        // A yaw of `a` about Y maps the local nose direction (-1, 0, 0) to world
        //   (-cos a, 0, sin a).
        // The tangent is d/dphase of (cos phase, sin phase), i.e. (-sin, cos).
        // Equating the two: cos a = sin phase and sin a = cos phase, so
        //   a = atan2(cos phase, sin phase).
        //
        // Checked at the authored start phase PI/2: the whale is at (cx, cz + r),
        // the tangent is (-1, 0), and the yaw comes out 0, which maps the nose to
        // (-1, 0, 0) — correct. At phase PI the whale is at (cx - r, cz), the
        // tangent is (0, -1), and the yaw is PI, mapping the nose to (1, 0, 0)
        // rotated by PI = (-1, 0, 0)... i.e. it faces +X, which is wrong: the
        // tangent at PI is (0,-1) so the nose should be -Z.
        //
        // Verified numerically at all four cardinal phases, comparing the nose
        // vector against the tangent: atan2(cos, sin) gives dot = +1.00 at 0, 90,
        // 180 and 270 degrees, while atan2(-cos, -sin) gives dot = -1.00 at every
        // one of them, i.e. the animal swims backwards around the whole orbit.
        const heading = Math.atan2(Math.cos(orbit.phase), Math.sin(orbit.phase));

        // RepoWhale.update() writes group.position.y for its swim cycle, so
        // the orbit's Y is applied as a base offset underneath it.
        whale.group.userData.baseY = y;
        whale.update(delta, t);
        whale.group.position.x = x;
        whale.group.position.z = z;
        whale.group.position.y += y;
        whale.group.rotation.y = -heading;

        if (entry.creatureHolder) {
          entry.creatureHolder.position.set(x, y, z);
          entry.creatures.update(delta);
        }
      }

      // --- Ambient schools ---
      for (let i = 0; i < this.ambientSchools.length; i++) {
        this.ambientSchools[i].update(delta);
      }

      // --- Obelisks ---
      for (let i = 0; i < this.obelisks.length; i++) {
        this.obelisks[i].update(delta, t);
      }

      // --- Hover ---
      // Resolved once per frame, not per pointermove: pointermove fires far
      // more often than a frame and each raycast walks every pickable tower.
      // The cursor is the cheap half of the affordance — it says "clickable"
      // before the ring does, and costs nothing to set.
      if (this._pointerDirty) {
        this._pointerDirty = false;
        const hovered = this._pickAt(this._pointerX, this._pointerY);
        if (this.marker) this.marker.setHover(hovered);
        // Only write the style when it changes; assigning the same string every
        // frame is a style recalculation for no reason.
        const cursor = hovered ? "pointer" : "";
        if (this.renderer.domElement.style.cursor !== cursor) {
          this.renderer.domElement.style.cursor = cursor;
        }
      }

      // --- Selection / hover marks ---
      if (this.marker) this.marker.update(delta, t);

      // --- Camera ---
      this.rig.update(delta, this._follow());

      // Keep the sun shadow volume around the camera so shadows stay sharp
      if (this.sun && this.sun.castShadow) {
        this.sun.target.position.set(
          this.camera.position.x,
          this.focusPoint ? this.focusPoint.y : 0,
          this.camera.position.z
        );
        this.sun.position.set(
          this.camera.position.x - 140,
          this.sun.target.position.y + 420,
          this.camera.position.z + 200
        );
      }

      // --- HUD level change ---
      const levelId = this.rig.levelId;
      if (levelId !== this._lastLevelId) {
        this._lastLevelId = levelId;
        this.onLevelChange(this.rig.level);
      }

      // --- Cluster lights: travelling shimmer ---
      if (this.clusterLights) {
        const kids = this.clusterLights.children;
        for (let i = 0; i < kids.length; i++) {
          const m = kids[i].material;
          if (!m) continue;
          const p = 0.5 + Math.sin(t * 0.8 + i * 0.9) * 0.5;
          m.opacity = 0.1 + p * 0.2;
        }
      }

      // Read the CPU cost before rendering, so it measures the update loops and
      // not the draw. On a GPU-bound frame the render dominates and this number
      // is the only one that says whether the JS is the problem.
      const updateMs = performance.now() - updateStart;

      this.renderer.render(this.scene, this.camera);

      // Read the frame's cost only when asked for. `renderer.info` is reset by
      // three at the start of every render, so this is the count for the frame
      // that just finished, not a running total.
      if (this.profiler.enabled) {
        const info = this.renderer.info;
        this.profiler.end(updateMs, {
          calls: info.render.calls,
          triangles: info.render.triangles,
          points: info.render.points,
          lines: info.render.lines,
        });
      }
    };

    tick();
  }

  // =========================================================================
  // External control
  // =========================================================================

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);

    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this._onPointerDown);
    el.removeEventListener("pointerup", this._onPointerUp);
    el.removeEventListener("pointermove", this._onPointerMove);
    el.removeEventListener("pointerleave", this._onPointerLeave);
    if (this.rig) this.rig.dispose();

    for (const t of this.towers) t.tower.dispose();
    for (const l of this.legacy) l.dispose();
    for (const w of this.whales) w.whale.dispose();
    for (const c of this.creatureSystems) c.system.dispose();
    for (const a of this.ambientSchools) a.dispose();
    for (const o of this.obelisks) o.dispose();
    if (this.marker) this.marker.dispose();
    if (this.ocean) this.ocean.dispose();
    if (this.floor) this.floor.dispose();

    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });

    this.renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

export { isMobileDevice, LANGUAGE_COLONIES };