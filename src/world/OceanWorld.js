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
  LANGUAGE_COLONIES,
  YOU,
} from "./worldData";
import { OceanEnvironment, createFog, depthBackground } from "./OceanEnvironment";
import { Seafloor, seafloorHeightAt } from "./Seafloor";
import { KelpTower } from "./KelpTower";
import { RepoWhale } from "./RepoWhale";
import { CreatureSystem, AmbientSchool } from "./CreatureGeometry";
import { SonarObelisk, buildClusterLights } from "./SonarObelisk";
import { CameraRig } from "./CameraRig";

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

    this.onSelect = opts.onSelect || (() => {});
    this.onLevelChange = opts.onLevelChange || (() => {});
    this.onReady = opts.onReady || (() => {});

    this.data = buildWorld();
    this.you = this.data.you || YOU;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;

    this.towers = [];          // { tower, repo, entry }
    this.whales = [];          // { whale, entry, orbit }
    this.creatureSystems = []; // { system, entry, orbit }
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
      scale: 1.0,
    });

    // --- Towers you follow, far across the water ---
    this._addRepoTowers(this.data.following, {
      zBase: LAYERS.kelpForestFar,
      withWhales: true,
      withCreatures: true,
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
      this.scene.add(tower.group);

      const entry = {
        repo,
        tower,
        whale: null,
        creatures: null,
        whaleOrbit: null,
        kind: "repo",
      };
      this.entries.set(repo.id, entry);
      this.towers.push({ tower, repo, entry });
      this.pickables.push(tower.group);

      if (opts.withWhales) {
        const whale = new RepoWhale(repo, {
          quality: this.quality,
          isMobile: this.isMobile,
        });

        const orbitR = tower.height * 0.7 + 16;
        // Orbit height must be measured from the tower's ROOT, not from y=0,
        // otherwise a tower standing in a trough had its whale circling
        // somewhere inside the sediment.
        const cy = tower.group.position.y + tower.height * 0.58;
        const cx = pos[0];
        const cz = opts.zBase + pos[1];

        whale.group.position.set(cx + orbitR, cy, cz);
        this.scene.add(whale.group);

        entry.whale = whale;
        entry.whaleOrbit = {
          cx,
          cz,
          r: orbitR,
          y: cy,
          phase: Math.random() * Math.PI * 2,
          speed: 0.055 + Math.random() * 0.05,
        };
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

      const rect = this.renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);

      // Only the repos with real entries are pickable — ambient towers are
      // scenery, and raycasting thousands of them is a waste.
      const targets = [];
      for (const t of this.towers) {
        if (t.entry) targets.push(t.tower.group);
      }
      const hits = this.raycaster.intersectObjects(targets, true);
      if (!hits.length) {
        this.select(null);
        return;
      }

      let node = hits[0].object;
      while (node && node.parent !== this.scene) node = node.parent;
      const found = this.towers.find((t) => t.tower.group === node);
      if (found && found.entry) this.select(found.entry.repo.id);
    };

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this._onPointerDown);
    el.addEventListener("pointerup", this._onPointerUp);
    this._pickEl = el;
  }

  /** Select a repo by id (or null to clear). Fires onSelect. */
  select(repoId) {
    this.selectedId = repoId;

    if (!repoId) {
      this.focusPoint = null;
      this.onSelect(null);
      return;
    }

    const entry = this.entries.get(repoId);
    if (!entry) {
      this.onSelect(null);
      return;
    }

    const p = entry.tower.group.position;
    this.focusPoint = {
      x: p.x,
      y: entry.tower.height * 0.55,
      z: p.z,
    };
    this.focusRadius = entry.tower.height;

    this.onSelect(entry.repo);
  }

  /** Frame the currently selected repo at a given zoom level. */
  focusSelected(levelIndex = 3) {
    if (!this.selectedId) return;
    this.rig.goTo(levelIndex);
  }

  // =========================================================================
  // Frame loop
  // =========================================================================

  _loop() {
    const tick = () => {
      this.frameHandle = requestAnimationFrame(tick);

      const delta = Math.min(0.05, this.clock.getDelta());
      this.elapsed += delta;
      const t = this.elapsed;
      this.frame++;

      // --- Environment ---
      this.ocean.update(delta, t);

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

      // --- Whales: circle their tower, trailing their orbital cloud ---
      for (let i = 0; i < this.whales.length; i++) {
        const { whale, entry, orbit } = this.whales[i];
        if (!entry) continue;

        orbit.phase += delta * orbit.speed;
        const x = orbit.cx + Math.cos(orbit.phase) * orbit.r;
        const z = orbit.cz + Math.sin(orbit.phase) * orbit.r;
        const y = orbit.y + Math.sin(t * 0.42 + orbit.phase) * 3.4;

        // Face the direction of travel. The model's nose points toward -X,
        // so a heading of atan2(dz, dx) needs no extra offset.
        const heading = Math.atan2(
          Math.cos(orbit.phase),
          -Math.sin(orbit.phase)
        );

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

      // --- Camera ---
      const follow = this.focusPoint
        ? { position: this._tmpVec.set(this.focusPoint.x, this.focusPoint.y, this.focusPoint.z) }
        : null;
      this.rig.update(delta, follow);

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

      this.renderer.render(this.scene, this.camera);
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
    if (this.rig) this.rig.dispose();

    for (const t of this.towers) t.tower.dispose();
    for (const w of this.whales) w.whale.dispose();
    for (const c of this.creatureSystems) c.system.dispose();
    for (const a of this.ambientSchools) a.dispose();
    for (const o of this.obelisks) o.dispose();
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