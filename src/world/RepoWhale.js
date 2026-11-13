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
import { whaleSkinVertex, whaleSkinFragment } from "./shaders";

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
  constructor(repo, opts = {}) {
    this.repo = repo;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;

    this.species = repo.whaleSpecies || WHALE_SPECIES.BLUE;
    this.build = BUILD[this.species.build] || BUILD.sleek;

    this.length = whaleLength(repo) * this.build.lengthMul;
    this.girth = this.length * 0.19 * this.build.girthMul;

    this.languageColor = languageStyleColor(repo.language);
    this.time = Math.random() * 100;

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
    geo.translate(-this.length * 0.5, 0, 0);

    // Scale: length along X, girth on Y/Z
    geo.scale(this.length, this.girth, this.girth);

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
    const jawGeo = new THREE.BoxGeometry(headLen, this.girth * 0.16, this.girth * 1.1);
    const jawMat = new THREE.MeshStandardMaterial({
      color: COLORS.whaleVentral,
      roughness: 0.85,
      metalness: 0.02,
    });
    this.jaw = new THREE.Mesh(jawGeo, jawMat);
    this.jaw.position.set(
      -this.length * 0.5 + headLen * 0.45,
      -this.girth * 0.42,
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
      eye.position.set(
        -this.length * 0.5 + headLen * 0.62,
        -this.girth * 0.12,
        side * this.girth * 0.78
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
      fin.position.set(
        -this.length * 0.16,
        -this.girth * 0.42,
        side * this.girth * 0.7
      );
      fin.rotation.set(side * 0.5, 0, side * -0.35);
      this.group.add(fin);
      this.flippers.push({ mesh: fin, side, phase: Math.random() * Math.PI * 2 });
    }
  }

  // -------------------------------------------------------------------------
  // Flukes — the tail. Fork count maps to span: many forks, wide tail.
    // -------------------------------------------------------------------------
  buildFlukes() {
    const forkRatio = THREE.MathUtils.clamp((this.repo.forks || 0) / 120, 0.05, 1);
    const span = this.girth * (2.2 + forkRatio * 3.4) * this.build.flukeSpan;

    // Two mirrored lobes with a central notch
    const geo = new THREE.BufferGeometry();
    const w = span * 0.5;
    const l = this.length * 0.16;
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
    this.flukePivot.position.x = this.length * 0.5;
    this.group.add(this.flukePivot);
  }

  // -------------------------------------------------------------------------
  // Dorsal fin — small, hooked, far back. Absent on some species.
  // -------------------------------------------------------------------------
  buildDorsalFin() {
    if (this.build.dorsalFin <= 0) return;

    const h = this.girth * this.build.dorsalFin * 2.4;
    const geo = new THREE.ConeGeometry(this.girth * 0.22, h, 4);
    geo.scale(1.5, 1, 0.34);

    const mat = new THREE.MeshStandardMaterial({
      color: this.species.color,
      roughness: 0.9,
      flatShading: true,
    });

    this.dorsal = new THREE.Mesh(geo, mat);
    this.dorsal.position.set(this.length * 0.24, this.girth * 0.86, 0);
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
      const t = Math.random() < 0.55 ? Math.random() * 0.3 : Math.random() * 0.85;
      const a = Math.random() * Math.PI * 2;
      const bodyR = this.girth * (0.55 + Math.sin(t * Math.PI) * 0.45);

      p.set(
        -this.length * 0.5 + t * this.length,
        Math.cos(a) * bodyR * 0.85,
        Math.sin(a) * bodyR
      );
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, -a));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
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
      const t = 0.2 + Math.random() * 0.55;
      const a = Math.random() * Math.PI * 2;
      this.remoras.push({ t, a, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.7 });
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
    this.group.add(mesh);
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
    this.blowhole.position.set(-this.length * 0.34, this.girth * 0.95, 0);
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
      this.spout.position.set(-this.length * 0.34, this.girth * 1.4, 0);
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
      const bodyR = this.girth * (0.55 + Math.sin(t * Math.PI) * 0.45);
      pleat.position.set(-this.length * 0.5 + t * this.length, -bodyR * 0.55, 0);
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

    // Whole-body vertical oscillation, like a real swimming cetacean
    const bodyY = Math.sin(t * beatSpeed) * this.girth * 0.1;
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
        const bodyR = this.girth * (0.55 + Math.sin(tt * Math.PI) * 0.45);
        this._rp.set(
          -this.length * 0.5 + tt * this.length,
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
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}