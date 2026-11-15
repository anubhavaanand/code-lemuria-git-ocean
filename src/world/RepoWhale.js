/**
 * Git Ocean — Repo whale
 *
 * One whale = one repository. Every anatomical feature is a mapped data point,
 * per the constitution's Scientific Accuracy rule:
 *
 *   body length     ← codebase size        (bigger codebase, longer animal)
 *   body build      ← commit frequency     (sleek = frequent, blocky = bursty)
 *   species         ← assignWhaleSpecies() (behaviour-derived, deterministic)
 *   skin pattern    ← repo identity         (counter-shading + mottling + scars)
 *   dorsal colour   ← dominant language
 *   song            ← language dialect      (audible in the Whale zoom level)
 *   flukes          ← fork count            (more forks, broader tail)
 *   flippers        ← open PRs              (work in progress, out to the side)
 *   pleats          ← closed issues         (resolved work, ventral grooves)
 *   barnacles       ← open issues           (unresolved work clinging on)
 *   remoras         ← watchers              (followers riding along)
 *   exhalation      ← release activity      (a blow every time you ship)
 *   scars           ← repo age              (old repos are marked)
 *
 * Geometry is built procedurally: a lathed body for the torso, a custom
 * flukes mesh, and instanced attachments. No external assets.
 */

import * as THREE from "three";
import {
  COLORS,
  whaleLength,
  languageStyleColor,
  WHALE_SPECIES,
} from "./constants";
import { makeRng, hashString } from "./worldData";
import { whaleSkinVertex, whaleSkinFragment } from "./shaders";

// ---------------------------------------------------------------------------
// Deterministic per-repo jitter
// ---------------------------------------------------------------------------

/**
 * The whale's incidental placements — where the barnacles settled, where the
 * remoras ride — are seeded, not random.
 *
 * Each barnacle's position is read as a settlement pattern ("real barnacles are
 * hitchhikers"), and each remora's station along the flank is read as where a
 * watcher has latched on. Both are presented as properties of the animal, so
 * both must be the same animal on every load. `Math.random()` reshuffles them,
 * which turns a repo's identifiable skin into a fresh random crust each visit.
 *
 * Two separate streams, one for the shells and one for the passengers, so that
 * the number of barnacles does not move the remoras — the same reasoning as the
 * per-group seed in CreatureGeometry: a shared stream makes every later feature
 * a function of what an earlier one consumed.
 */
function repoStreams(repo) {
  const base = hashString(`${repo.owner || "?"}/${repo.name || "?"}`);
  return {
    barnacle: makeRng((base ^ 0x1b873593) >>> 0),
    remora: makeRng((base ^ 0x27d4eb2f) >>> 0),
  };
}

// ---------------------------------------------------------------------------
// Build profile per species — proportion differences, not just colour.
// ---------------------------------------------------------------------------

const BUILD = {
  sleek: { lengthMul: 1.18, girthMul: 0.82, headMul: 0.9, flukeSpan: 1.0, dorsalFin: 0.28 },
  robust: { lengthMul: 1.0, girthMul: 1.05, headMul: 1.12, flukeSpan: 1.25, dorsalFin: 0.12 },
  massive: { lengthMul: 1.05, girthMul: 1.28, headMul: 1.3, flukeSpan: 1.1, dorsalFin: 0.0 },
  blocky: { lengthMul: 0.95, girthMul: 1.1, headMul: 1.45, flukeSpan: 1.18, dorsalFin: 0.16 },
  streamlined: { lengthMul: 1.1, girthMul: 0.88, headMul: 0.85, flukeSpan: 0.95, dorsalFin: 0.34 },
};

export class RepoWhale {
  /**
   * Re-read the repository's numbers into an existing whale.
   *
   * The API's second pass changes codebase size, commit frequency and language
   * *after* the animal is already swimming. Rebuilding the whale to match would
   * dispose and re-create geometry while the user is looking at it, which is a
   * visible hitch; and the profile arrives once, so a rebuilt whale would be
   * rebuilt again for no gain.
   *
   * So the fields that drive a silhouette are recomputed in place and the
   * difference is recorded rather than redrawn. `drifted` is the honest answer:
   * the HUD can say the body is being updated rather than pretend the animal
   * changed shape on screen.
   */
  applyRepo(repo) {
    if (!repo) return false;

    const wasLength = this.length;
    const wasGirth = this.girth;
    const wasSpecies = this.species;
    const wasColor = this.languageColor;

    this.repo = repo;
    this.species = repo.whaleSpecies || this.species;
    this.build = BUILD[this.species.build] || this.build;
    this.length = whaleLength(repo) * this.build.lengthMul;
    this.girth = this.length * 0.19 * this.build.girthMul;
    this.languageColor = languageStyleColor(repo.language);

    // A scale, not a rebuild: the geometry is authored once and the body is
    // scaled along its length, which is how the same sculpt reads as a calf and
    // as a bull without two sets of vertex data.
    // Scaling the group would multiply whatever the sculpt already set on the
    // wrapper, and an imported body is normalized at load time — a second scale
    // on top of it makes the animal the wrong size by a factor nobody can see in
    // any single node's own numbers. So a length change is recorded and left to
    // whoever owns the scale: the lathe applies it, the wrapper's sculpt keeps
    // its own and reports the drift.
    if (this.length !== wasLength || this.girth !== wasGirth) {
      this.drifted = true;
      const s = this.length / (wasLength || this.length);
      if (!this.sculpt && this.group) this.group.scale.multiplyScalar(s);
    }

    // A species change is a different animal, not a different size. It only
    // happens when the repo's primary language moved, which is rare enough that
    // drawing attention to it is correct.
    if (this.species !== wasSpecies) this.resleve = true;

    // The language colour rides on the belly highlight, not on the skin: the
    // skin's dorsal and lateral colours belong to the species, which is a fact
    // about the animal, and overwriting them with a GitHub language colour would
    // make every whale the same grey whatever it is.
    if (this.languageColor !== wasColor) {
      if (this.belly && this.belly.material) this.belly.material.color.setHex(this.languageColor);
    }

    // Scars are age. If the repository is older than the animal was built for,
    // the scar amount is already on the skin uniform and needs no rebuild.
    if (this.skinUniforms && this.skinUniforms.uScarAmount) {
      this.skinUniforms.uScarAmount.value = THREE.MathUtils.clamp(
        (repo.ageDays || 0) / 2200,
        0.05,
        0.85
      );
    }

    return true;
  }

  constructor(repo, opts = {}) {
    this.repo = repo;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;
    this.drifted = false;
    this.resleve = false;

    this.species = repo.whaleSpecies || WHALE_SPECIES.BLUE;
    this.build = BUILD[this.species.build] || BUILD.sleek;

    this.length = whaleLength(repo) * this.build.lengthMul;
    this.girth = this.length * 0.19 * this.build.girthMul;

    this.languageColor = languageStyleColor(repo.language);
    this.time = Math.random() * 100;

    // Seeded per repo, consumed by buildBarnacles and buildRemoras in a fixed
    // order. Created once here so the two builders cannot draw from each other.
    this.rng = repoStreams(repo);

    this.group = new THREE.Group();
    this.group.name = `whale:${repo.owner}/${repo.name}`;

    this.buildBody();
    this.buildHead();
    this.buildFins();
    this.buildFlukes();
    this.buildDorsalFin();
    this.buildBarnacles();
    this.buildRemoras();
    this.buildBlowhole();
    this.buildPleats();

    // Everything that encodes a repository lives on `parts`, so a wrapper can
    // adopt this whale's meaning while supplying its own silhouette.
    this.parts = {
      flippers: this.flippers,
      flukePivot: this.flukePivot,
      barnacles: this.barnacleMesh || null,
      remoras: this.remoraMesh || null,
      blowhole: this.blowhole,
      spout: this.spout,
      spoutBaseY: this.spoutBaseY,
      // The skin's uniforms are shared with the wrapper that adopts this whale's
      // parts, so anything that needs to recolour the animal reaches them
      // through here rather than by knowing where the mesh ended up.
      skinUniforms: this.skinUniforms,
    };
  }

  /** Detach every child mesh without disposing it (ownership passes to `to` ). */
  takeParts() {
    const parts = this.parts;
    if (!parts) return;
    const adopt = (obj) => {
      if (!obj) return null;
      this.group.remove(obj);
      return obj;
    };
    for (const key of ["flippers"]) {
      if (Array.isArray(parts[key])) {
        for (const f of parts[key]) adopt(f.mesh);
      }
    }
    adopt(parts.flukePivot);
    adopt(parts.barnacles);
    adopt(parts.remoras);
    adopt(parts.blowhole);
    adopt(parts.spout);
  }

  // -------------------------------------------------------------------------
  // Body — a lathed profile gives the fusiform shape of a real cetacean.
  // The profile is asymmetric (thick forward, tapering aft) because real
  // whales are not ellipsoids.
  // -------------------------------------------------------------------------
  buildBody() {
    const segs = this.isMobile ? 9 : 14;
    const points = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs; // 0 = snout, 1 = tail stock
      // Fusiform profile: swells quickly, holds, tapers to a narrow peduncle
      let r;
      if (t < 0.28) {
        r = 0.18 + Math.sin((t / 0.28) * Math.PI * 0.5) * 0.82;
      } else if (t < 0.62) {
        r = 1.0 - (t - 0.28) * 0.22;
      } else {
        const k = (t - 0.62) / 0.38;
        r = 0.93 * (1 - k * k * 0.94);
      }
      points.push(new THREE.Vector2(Math.max(0.02, r), t));
    }

    const geo = new THREE.LatheGeometry(points, this.isMobile ? 12 : 20);

    // Lathe runs along Y; rotate so the body runs along X (nose at +X)
    geo.rotateZ(-Math.PI / 2);

    // Scale first, THEN centre — and the order is not interchangeable.
    //
    // Every BufferGeometry transform post-multiplies: `geo.scale(L, G, G)` then
    // `geo.translate(-L/2, 0, 0)` means "scale the unit body, then shift it by
    // half a body". The reverse order means "shift it by half a *unit* body,
    // then scale that shift too", which moves the body by L/2 * L. For a 48.8
    // unit animal that is -1,166 units: the geometry ends up centred at
    // x = -1,166 instead of x = 0, and the group's bounding box measures
    // 1,236 x 50.2 x 19.4 against a body that is 48.8 x 19.4 x 19.4.
    //
    // The camera framing is solved from that box, so the bug did not merely
    // displace a mesh — it made `focusLength` 25x too large and the whale zoom
    // framed empty water while the animal swam off-screen.
    geo.scale(this.length, this.girth, this.girth);
    geo.translate(-this.length * 0.5, 0, 0);

    this.skinUniforms = {
      uColorDorsal: { value: new THREE.Color(this.species.color) },
      uColorLateral: { value: new THREE.Color(COLORS.whaleLateral) },
      uColorVentral: { value: new THREE.Color(COLORS.whaleVentral) },
      uColorScar: { value: new THREE.Color(COLORS.whaleScar) },
      // Scars accumulate with age — an old repo is a marked animal
      uScarAmount: { value: THREE.MathUtils.clamp((this.repo.ageDays || 0) / 2200, 0.05, 0.85) },
      uTime: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.skinUniforms,
      vertexShader: whaleSkinVertex,
      fragmentShader: whaleSkinFragment,
    });

    this.body = new THREE.Mesh(geo, mat);
    this.group.add(this.body);

    // Belly highlight — a subtle secondary light so the ventral side reads
    const bellyGeo = geo.clone();
    const bellyMat = new THREE.MeshBasicMaterial({
      color: this.languageColor,
      transparent: true,
      opacity: 0.045,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.belly = new THREE.Mesh(bellyGeo, bellyMat);
    this.belly.scale.set(0.985, 0.9, 0.9);
    this.belly.position.y = -this.girth * 0.16;
    this.group.add(this.belly);
  }

  // -------------------------------------------------------------------------
  // Head — jaw line, eye, and the species-defining melon/forehead
  // -------------------------------------------------------------------------
  buildHead() {
    const headLen = this.length * 0.26 * this.build.headMul;

    // Lower jaw — a flattened wedge under the snout
    // Width (x) and girth (y/z) come from the body so a sculpt's head keeps its
    // own proportions; only the length along the snout is derived here.
    const jawGeo = new THREE.BoxGeometry(headLen, this.girth * 0.16, this.girth * 1.1);
    const jawMat = new THREE.MeshStandardMaterial({
      color: COLORS.whaleVentral,
      roughness: 0.85,
      metalness: 0.02,
    });
    this.jaw = new THREE.Mesh(jawGeo, jawMat);
    this.jaw.position.set(
      this.xAt(0.14),
      -this.surfaceRadius(0.14) * 0.74,
      0
    );
    this.group.add(this.jaw);

    // Eye — small, dark, set back and low, as in real cetaceans
    const eyeGeo = new THREE.SphereGeometry(this.girth * 0.09, 8, 6);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      // Eye sits just above and behind the jaw line, set wide on the head.
      eye.position.set(
        this.xAt(0.2),
        -this.surfaceRadius(0.2) * 0.18,
        side * this.surfaceRadius(0.2) * 0.94
      );
      this.group.add(eye);
      this.eyes.push(eye);
    }

    // Melon (sperm whale) or forehead mass (bowhead) — the species silhouette
    if (this.species.id === "sperm" || this.species.id === "bowhead") {
      const melonGeo = new THREE.SphereGeometry(this.girth * 0.95, 10, 8);
      const melonMat = new THREE.MeshStandardMaterial({
        color: this.species.color,
        roughness: 0.9,
      });
      const melon = new THREE.Mesh(melonGeo, melonMat);
      melon.scale.set(1.25, 0.9, 0.95);
      melon.position.set(
        -this.length * 0.5 + headLen * 0.3,
        this.girth * 0.3,
        0
      );
      this.group.add(melon);
    }
  }

  // -------------------------------------------------------------------------
  // Flippers — pectoral fins. Open PRs map to flipper size: work reaching out.
  // -------------------------------------------------------------------------
  buildFins() {
    const prRatio = THREE.MathUtils.clamp((this.repo.openPRs || 0) / 20, 0.1, 1);
    const span = this.girth * (0.85 + prRatio * 1.1);

    const geo = new THREE.ConeGeometry(this.girth * 0.3, span, 4);
    // Flatten into a blade and point it outward/downward
    geo.scale(1, 1, 0.28);
    geo.translate(0, -span * 0.5, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: this.species.color,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    this.flippers = [];
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(geo, mat);
      // Pectoral fins sit just behind and below the head — about 22% back on a
      // humpback, which is the fraction the sculpt's own flippers use.
      fin.position.set(
        this.xAt(0.26),
        -this.surfaceRadius(0.26) * 0.72,
        side * this.surfaceRadius(0.26) * 0.86
      );
      fin.rotation.set(side * 0.5, 0, side * -0.35);
      this.group.add(fin);
      // The stroke phase is per repo, not per load. It is a gait offset — two
      // flippers out of phase would flap asymmetrically — but it must still be
      // the same gait on every visit, because the flipper stroke is part of how
      // the animal is recognised at the whale zoom.
      this.flippers.push({
        mesh: fin,
        side,
        phase: this.rng.remora() * Math.PI * 2,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Flukes — the tail. Fork count maps to span: many forks, wide tail.
    // -------------------------------------------------------------------------
  buildFlukes() {
    const forkRatio = THREE.MathUtils.clamp((this.repo.forks || 0) / 120, 0.05, 1);
    // Fluke span is a fraction of the tail stock's width, not of body girth —
    // measured on a humpback the flukes are ~1.6x the peduncle's width.
    const stock = this.surfaceRadius(0.94);
    const span = stock * (2.2 + forkRatio * 3.4) * this.build.flukeSpan;

    // Two mirrored lobes with a central notch
    const geo = new THREE.BufferGeometry();
    const w = span * 0.5;
    const l = this.sculptSize ? this.sculptSize.x * 0.09 : this.length * 0.16;
    const verts = new Float32Array([
      // Left lobe
      0, 0, 0,
      -w, 0, -l * 0.55,
      -w * 0.35, 0, -l,
      // Right lobe
      0, 0, 0,
      w * 0.35, 0, -l,
      w, 0, -l * 0.55,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: this.species.color,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    this.flukePivot = new THREE.Group();
    const flukes = new THREE.Mesh(geo, mat);
    this.flukePivot.add(flukes);
    // Seat the pivot on the tail stock, not at a guessed x: the last 16% of the
    // body is where a cetacean's peduncle is, and a sculpt's tail may sit
    // anywhere within that band.
    this.flukePivot.position.x = this.tailX();
    this.group.add(this.flukePivot);
  }

  // -------------------------------------------------------------------------
  // Dorsal fin — small, hooked, far back. Absent on some species.
  // -------------------------------------------------------------------------
  buildDorsalFin() {
    if (this.build.dorsalFin <= 0) return;

    const h = this.surfaceRadius(0.68) * this.build.dorsalFin * 2.4;
    const geo = new THREE.ConeGeometry(this.surfaceRadius(0.68) * 0.22, h, 4);
    geo.scale(1.5, 1, 0.34);

    const mat = new THREE.MeshStandardMaterial({
      color: this.species.color,
      roughness: 0.9,
      flatShading: true,
    });

    this.dorsal = new THREE.Mesh(geo, mat);
    // Dorsal fin sits far back — roughly two-thirds along the body on a humpback.
    this.dorsal.position.set(this.xAt(0.68), this.surfaceRadius(0.68) * 0.94, 0);
    this.dorsal.rotation.z = -0.32;
    this.group.add(this.dorsal);
  }

  // -------------------------------------------------------------------------
  // Barnacles — open issues. Each one is a small hard shell on the skin.
  // Real barnacles are hitchhikers: unresolved work clings to the repo.
  // -------------------------------------------------------------------------
  buildBarnacles() {
    const open = this.repo.openIssues || 0;
    if (open <= 0) return;

    const count = THREE.MathUtils.clamp(
      Math.ceil(open * 0.6),
      1,
      this.isMobile ? 10 : 28
    );

    const geo = new THREE.ConeGeometry(this.girth * 0.055, this.girth * 0.05, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc8d4dc,
      roughness: 0.95,
      flatShading: true,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      // Barnacles cluster on the head and back — real settlement pattern
      const t = this.rng.barnacle() < 0.55
        ? this.rng.barnacle() * 0.3
        : this.rng.barnacle() * 0.85;
      const a = this.rng.barnacle() * Math.PI * 2;
      // Seat on the skin. A sculpt's radius at a given fraction is not the lathe
      // sine, so this goes through surfaceRadius() like everything else.
      const bodyR = this.surfaceRadius(t);

      p.set(
        this.xAt(t),
        Math.cos(a) * bodyR * 0.85,
        Math.sin(a) * bodyR
      );
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, -a));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.barnacleMesh = mesh;
  }

  // -------------------------------------------------------------------------
  // Remoras — watchers. Small fish riding the whale, real commensal behaviour.
  // -------------------------------------------------------------------------
  buildRemoras() {
    const watchers = this.repo.watchers || 0;
    if (watchers <= 0) return;

    const count = THREE.MathUtils.clamp(
      Math.ceil(Math.sqrt(watchers) * 0.6),
      1,
      this.isMobile ? 5 : 14
    );

    const geo = new THREE.SphereGeometry(this.girth * 0.07, 6, 4);
    geo.scale(2.4, 0.8, 0.7);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a3742,
      roughness: 0.8,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    this.remoras = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const t = 0.2 + this.rng.remora() * 0.55;
      const a = this.rng.remora() * Math.PI * 2;
      this.remoras.push({
        t,
        a,
        phase: this.rng.remora() * Math.PI * 2,
        speed: 0.6 + this.rng.remora() * 0.7,
      });
      p.set(0, 0, 0);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    this.remoraMesh = mesh;
    this._rm = new THREE.Matrix4();
    this._rq = new THREE.Quaternion();
    this._rs = new THREE.Vector3(1, 1, 1);
    this._rp = new THREE.Vector3();
  }

  /** Local x of the nose. Lathe body: -length/2. */
  noseX() {
    return this.sculptSize ? -this.sculptSize.x * 0.5 : -this.length * 0.5;
  }

  /** Local x of the tail stock. */
  tailX() {
    return this.sculptSize ? this.sculptSize.x * 0.44 : this.length * 0.5;
  }

  /** Local x at body fraction t (0 = nose, 1 = tail). */
  xAt(t) {
    const nose = this.noseX();
    const tail = this.tailX();
    return nose + (tail - nose) * THREE.MathUtils.clamp(t, 0, 1);
  }

  /**
   * Skin radius at body fraction t (0 = nose, 1 = tail).
   *
   * The default is the lathe profile used to build the body. An imported sculpt
   * overrides it with its measured profile so remoras and barnacles sit on the
   * real skin instead of floating beside it.
   */
  surfaceRadius(t) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    return this.girth * (0.55 + Math.sin(k * Math.PI) * 0.45);
  }


  // -------------------------------------------------------------------------
  // Blowhole + exhalation. Releases map to blows: each release is a spout.
  // -------------------------------------------------------------------------
  buildBlowhole() {
    const geo = new THREE.SphereGeometry(this.girth * 0.1, 6, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a1219,
      roughness: 0.7,
    });
    this.blowhole = new THREE.Mesh(geo, mat);
    // Blowhole sits on the dorsal surface above the eyes — about 22% back.
    this.blowhole.position.set(this.xAt(0.22), this.surfaceRadius(0.22) * 1.02, 0);
    this.group.add(this.blowhole);

    // Exhalation — a soft additive plume. Only repos with releases have one.
    const releases = this.repo.releases || 0;
    if (releases > 0) {
      const strength = THREE.MathUtils.clamp(Math.log10(releases + 1) / 2, 0, 1);
      const sGeo = new THREE.ConeGeometry(this.girth * 0.34, this.girth * (1.2 + strength * 2.2), 8, 1, true);
      const sMat = new THREE.MeshBasicMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.05 + strength * 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.spout = new THREE.Mesh(sGeo, sMat);
      this.spout.position.set(this.xAt(0.22), this.surfaceRadius(0.22) * 1.3, 0);
      this.spout.rotation.x = Math.PI;
      this.spoutBaseY = this.spout.position.y;
      this.group.add(this.spout);
      this.spoutStrength = strength;
    }
  }

  // -------------------------------------------------------------------------
  // Ventral pleats — closed issues. Grooves along the throat that expand when
  // feeding; here they record work already resolved.
  // -------------------------------------------------------------------------
  buildPleats() {
    const closed = this.repo.closedIssues || 0;
    if (closed <= 0) return;

    const count = THREE.MathUtils.clamp(
      Math.ceil(Math.sqrt(closed) * 0.8),
      1,
      this.isMobile ? 5 : 14
    );

    const geo = new THREE.TorusGeometry(this.girth * 0.55, this.girth * 0.012, 3, 10, Math.PI);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.whaleVentral,
      roughness: 0.9,
      transparent: true,
      opacity: 0.35,
    });

    for (let i = 0; i < count; i++) {
      const t = 0.05 + (i / count) * 0.32;
      const pleat = new THREE.Mesh(geo, mat);
      const bodyR = this.surfaceRadius(t);
      pleat.position.set(this.xAt(t), -bodyR * 0.55, 0);
      pleat.rotation.x = Math.PI / 2;
      pleat.rotation.z = Math.PI;
      pleat.scale.setScalar(1 - t * 0.4);
      this.group.add(pleat);
    }
  }

  // -------------------------------------------------------------------------
  // Update — body roll, fluke beat, flipper scull, remora orbit, spout pulse.
  // The swim cycle is driven by commit frequency: active repos beat faster.
  // -------------------------------------------------------------------------
  update(delta, elapsed) {
    this.time += delta;
    const t = elapsed != null ? elapsed : this.time;

    // Beat frequency from activity. 0 = motionless, 30+ = fast cruising.
    const activity = THREE.MathUtils.clamp((this.repo.commitFrequency || 0) / 20, 0, 1);
    const beatSpeed = 0.7 + activity * 1.9;

    if (this.skinUniforms) {
      this.skinUniforms.uTime.value = t;
    }

    // Whole-body vertical oscillation, like a real swimming cetacean.
    // Stored on the instance (not a local) so a wrapper with its own body mesh
    // can still drive the same swim cycle.
    const bodyY = Math.sin(t * beatSpeed) * this.girth * 0.1;
    this.bodyY = bodyY;
    this.beatSpeed = beatSpeed;
    this.group.position.y = bodyY;

    // Gentle roll
    this.group.rotation.x = Math.sin(t * beatSpeed * 0.5) * 0.045;

    // Fluke beat — the tail drives everything
    if (this.flukePivot) {
      this.flukePivot.rotation.z = Math.sin(t * beatSpeed) * 0.34;
      this.flukePivot.rotation.y = Math.sin(t * beatSpeed - 0.5) * 0.12;
    }

    // Flippers scull slowly, out of phase with each other
    if (this.flippers) {
      for (const f of this.flippers) {
        f.mesh.rotation.z =
          f.side * -0.35 + Math.sin(t * beatSpeed * 0.6 + f.phase) * 0.16;
      }
    }

    // Remoras hold station just off the body, sliding along it
    if (this.remoraMesh) {
      for (let i = 0; i < this.remoras.length; i++) {
        const r = this.remoras[i];
        const a = r.a + t * 0.12 * r.speed;
        const tt = r.t + Math.sin(t * 0.3 + r.phase) * 0.03;
        const bodyR = this.surfaceRadius(tt);
        this._rp.set(
          this.xAt(tt),
          Math.cos(a) * bodyR * 1.05 + bodyY * 0.6,
          Math.sin(a) * bodyR * 1.25
        );
        this._rq.setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, Math.sin(t * 2 + r.phase) * 0.2));
        this._rm.compose(this._rp, this._rq, this._rs);
        this.remoraMesh.setMatrixAt(i, this._rm);
      }
      this.remoraMesh.instanceMatrix.needsUpdate = true;
    }

    // Spout: a slow pulse rather than a hard blast, so it reads as breathing
    if (this.spout) {
      const p = (Math.sin(t * 0.42) * 0.5 + 0.5) ** 3;
      this.spout.scale.set(0.7 + p * 0.7, 0.6 + p * 1.1, 0.7 + p * 0.7);
      this.spout.position.y = this.spoutBaseY + p * this.girth * 0.4;
      this.spout.material.opacity = (0.04 + this.spoutStrength * 0.1) * (0.4 + p * 0.9);
    }
  }

  dispose() {
    // A disposed animal must not answer a second teardown.
    //
    // three does not throw on a double dispose — it re-dispatches the event and
    // the renderer no-ops — which is exactly why this needs saying: measured on
    // a live whale, three calls to dispose() fired 22, then 44, then 66 events
    // on the same eighteen resources. Nothing failed, and the only evidence was
    // a counter. Any listener keeping state (the shared-geometry accounting, a
    // QA probe) reads events for objects that were released two calls ago, and
    // a teardown that is called twice — StrictMode, a hot reload, a rebuild
    // path — pays for the whole graph again.
    if (this._disposed) return;
    this._disposed = true;

    // Release each resource once, even where several meshes share it.
    //
    // A whale is built from parts that legitimately share geometry: the two eyes
    // are one SphereGeometry, and every remora is one InstancedMesh. A naive
    // traverse disposes each of those twice — measured on a 420-issue / 6,100-
    // watcher whale: 9 unique geometries and 9 unique materials across 11 mesh
    // references, 18 dispose events fired, 4 of them on objects that had already
    // been released.
    //
    // The guard here is what makes the teardown honest about which object owns
    // the resource, instead of letting the number of disposals fall out of the
    // shape of the node graph.
    const disposed = new Set();
    const free = (res) => {
      if (!res || disposed.has(res)) return;
      disposed.add(res);
      res.dispose();
    };

    this.group.traverse((o) => {
      if (o.geometry) free(o.geometry);
      if (o.material) {
        if (Array.isArray(o.material)) {
          for (const m of o.material) free(m);
        } else {
          free(o.material);
        }
      }
    });
  }
}