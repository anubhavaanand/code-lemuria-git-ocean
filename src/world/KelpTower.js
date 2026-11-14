/**
 * Git Ocean — Kelp tower
 *
 * One tower = one repository. Every measurement on the tower is real data:
 *
 *   height        ← total commit history  (the older and more worked-on, the taller)
 *   girth         ← lifetime contributors (more hands, thicker holdfast and stipe)
 *   sway          ← commit frequency      (active repos move; abandoned ones are rigid)
 *   blade density ← open + closed issues (work in flight)
 *   holdfast ring ← repo age             (one growth ring per year of history)
 *   frond glow    ← stars                (social reach, visible from across the city)
 *   stipe rings   ← releases             (growth spurts mark each cut)
 *   canopy polyps ← contributors         (the people living at the top of the tree)
 *   mantle        ← dominant language     (tinted by the repo's primary language)
 *
 * Structural note: giant kelp grows straight up to the surface from a holdfast
 * and bends as a cantilever in the current. The bend is why the height reads
 * as a living thing rather than a bar chart.
 */

import * as THREE from "three";
import { COLORS, towerHeight, towerGirth, languageStyleColor } from "./constants";
import { kelpVertex, kelpFragment } from "./shaders";

// A growth ring per year of history, capped so an ancient repo stays sane
// A growth ring per year of history, capped so an ancient repo stays sane
function ringCount(ageDays) {
  return THREE.MathUtils.clamp(Math.floor((ageDays || 0) / 365), 0, 9);
}

// Growth rings are decorative and static, so they are one InstancedMesh rather
// than one Mesh per ring. The old code created up to nine TorusGeometry
// instances per tower purely for bands — across 23 towers that is a visible
// slice of the 728 draw calls measured at city zoom, for geometry that never
// moves.
const RING_SEGMENTS = 12;
const RING_TUBE = 0.018;

// The small props are authored deterministically, then posed with a tower's own
// seeded RNG. Randomness at construction is why they could not be batched before:
// an InstancedMesh holds one geometry, and two towers' rings differed by a
// fraction of a unit — indistinguishable, but enough to make each its own draw.
// Below this spread the shapes are identical, so they share one instance buffer
// and one material and cost one draw call across every tower.
const SMALL_FEATURE_EPSILON = 0.05;

/**
 * Whether a tower's small static props may be batched with every other tower's.
 *
 * The rings are a radius and a height up the stipe; the tendrils are lengths and
 * angles around the holdfast; the tube worms are heights and lean. None of them
 * is a silhouette — they are bands, hairs and lamps a few pixels wide at the city
 * zoom where they are actually visible. A tower whose rings vary by less than a
 * twentieth of a unit is not a different shape.
 */
export function smallFeatureKey(tower) {
  const g = Math.round(tower.girth / SMALL_FEATURE_EPSILON);
  const h = Math.round(tower.height / SMALL_FEATURE_EPSILON);
  return `${g}:${h}:${tower.rings}:${tower.ciStatus || "none"}:${tower.tubeWormCount || 0}`;
}

/**
 * The shared geometry for each batched prop.
 *
 * Authored once, unit-sized, and scaled per instance. `rotateX` is applied to
 * the geometry rather than to each instance's matrix, so the instance matrix
 * carries only a scale and the two are interchangeable.
 */
export const SHARED = {
  ring: (() => {
    const g = new THREE.TorusGeometry(1, RING_TUBE, 4, RING_SEGMENTS);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
  tendril: new THREE.CylinderGeometry(0.02, 0.09, 1, 5),
  worm: new THREE.CylinderGeometry(0.05, 0.09, 1, 5),
};

/**
 * A deterministic per-tower RNG.
 *
 * The props are decorative and static, so the only thing that matters is that
 * the same repository looks the same on every load — a tower that reshuffles its
 * rings between visits reads as a different repo. Seeded from the repository, not
 * from Math.random().
 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(repo) {
  const s = `${repo.owner}/${repo.name}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class KelpTower {
  constructor(repo, opts = {}) {
    this.repo = repo;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;

    this.height = towerHeight(repo);
    this.girth = towerGirth(repo);
    this.sway = THREE.MathUtils.clamp((repo.commitFrequency || 0) / 30, 0.02, 1);
    this.rings = ringCount(repo.ageDays);
    this.languageColor = languageStyleColor(repo.language);

    this.group = new THREE.Group();
    this.group.name = `tower:${repo.owner}/${repo.name}`;

    // A seeded RNG for the small props, so a repository's rings and tendrils are
    // the same on every load. `time` stays random: it is a phase offset, and two
    // towers that sway in lockstep look mechanical.
    this.rng = seeded(seedOf(repo));
    this.time = Math.random() * 100;

    // When batching, the holdfast tendrils and the growth rings are posed into
    // matrices and handed to the KelpBatch instead of becoming meshes here. The
    // batch owns one buffer and one draw call for every tower.
    this.batchProps = opts.batchProps === true;

    this.build();
  }

  build() {
    this.buildHoldfast();
    this.buildStipe();
    this.buildBlades();
    this.buildCanopyPolyps();
    this.buildRingBands();
    this.buildStarGlow();
    this.buildActivityLights();
  }

  // -------------------------------------------------------------------------
  // Holdfast — the root structure gripping the seafloor
  // -------------------------------------------------------------------------
  buildHoldfast() {
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.holdfast,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });

    this.holdfast = new THREE.Mesh(geo, mat);
    // Girth maps to how many people have touched the repo
    this.holdfast.scale.set(this.girth * 1.5, this.girth * 0.55, this.girth * 1.5);
    this.group.add(this.holdfast);

    // Root tendrils spreading across the sediment — more contributors, more spread.
    //
    // Posed, not built, when batching: the matrices are recorded so the batch can
    // read them, and the tower keeps no mesh of its own. The batch is one draw call
    // for every tower instead of one per tower.
    const tendrilCount = THREE.MathUtils.clamp(
      Math.floor((this.repo.contributors || 1) * 1.4),
      2,
      this.isMobile ? 5 : 12
    );
    this.tendrilCount = tendrilCount;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const matrices = [];

    for (let i = 0; i < tendrilCount; i++) {
      const a = (i / tendrilCount) * Math.PI * 2 + this.rng() * 0.6;
      const len = this.girth * (1.1 + this.rng() * 1.9);
      p.set(Math.cos(a) * len * 0.55, len * 0.1, Math.sin(a) * len * 0.55);
      e.set(Math.PI / 2.4, a, 0);
      q.setFromEuler(e);
      s.set(1, len, 1);
      m.compose(p, q, s);
      matrices.push(m.clone());
    }

    this.tendrilMatrices = matrices;
    if (!this.batchProps) {
      const tMat = new THREE.MeshStandardMaterial({
        color: COLORS.holdfast,
        roughness: 0.95,
      });
      const tendrils = new THREE.InstancedMesh(SHARED.tendril, tMat, tendrilCount);
      for (let i = 0; i < tendrilCount; i++) tendrils.setMatrixAt(i, matrices[i]);
      tendrils.instanceMatrix.needsUpdate = true;
      this.group.add(tendrils);
    }
  }

  // -------------------------------------------------------------------------
  // Stipe — the main stem, custom vertex shader for cantilever sway
  // -------------------------------------------------------------------------
  buildStipe() {
    // Tapered tube: wide at the holdfast, thin at the canopy
    const radialSegs = this.quality === "low" ? 5 : 7;
    const heightSegs = this.quality === "low" ? 16 : 30;

    const geo = new THREE.CylinderGeometry(
      this.girth * 0.16,
      this.girth * 0.34,
      this.height,
      radialSegs,
      heightSegs,
      true
    );

    // Re-origin so y=0 is the holdfast (the shader assumes this)
    geo.translate(0, this.height / 2, 0);

    this.stipeUniforms = {
      uTime: { value: 0 },
      uSwayAmount: { value: 0.28 + this.sway * 1.5 },
      uSwaySpeed: { value: 0.28 + this.sway * 0.75 },
      uHeight: { value: this.height },
      uPhase: { value: Math.random() * Math.PI * 2 },
      uColorBase: { value: new THREE.Color(COLORS.kelpStipeDark) },
      uColorTip: { value: new THREE.Color(COLORS.kelpBlade) },
      uColorGlow: { value: new THREE.Color(this.languageColor) },
      uGlowStrength: { value: 0.12 + this.sway * 0.2 },
      uOpacity: { value: 0.94 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.stipeUniforms,
      vertexShader: kelpVertex,
      fragmentShader: kelpFragment,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.stipe = new THREE.Mesh(geo, mat);
    this.group.add(this.stipe);
  }

  // -------------------------------------------------------------------------
  // Blades — the photosynthetic canopy.
  // Blade count = work in flight (open issues + open PRs), a direct mapping
  // from the issues list to visible foliage.
  // -------------------------------------------------------------------------
  buildBlades() {
    const workInFlight = (this.repo.openIssues || 0) + (this.repo.openPRs || 0);
    const bladeCount = THREE.MathUtils.clamp(
      Math.floor(2 + workInFlight * 0.55),
      2,
      this.isMobile ? 12 : 26
    );

    this.bladeCount = bladeCount;
    this.blades = [];

    // A blade is a small plane with a bend, instanced for cheapness
    const geo = new THREE.PlaneGeometry(1, 1, 1, 4);
    geo.translate(0, 0.5, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.kelpBlade,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, bladeCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < bladeCount; i++) {
      // Distribute along the upper 60% of the stipe — real kelp blades cluster
      // toward the canopy where light reaches
      const t = 0.4 + Math.random() * 0.6;
      const y = this.height * t;
      const a = Math.random() * Math.PI * 2;
      const len = this.girth * (1.4 + Math.random() * 2.6) * (0.5 + t * 0.8);

      p.set(0, y, 0);
      q.setFromEuler(new THREE.Euler(0, a, Math.PI * 0.34 + Math.random() * 0.4));
      s.set(len * 0.5, len, 1);

      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);

      this.blades.push({ t, a, len, phase: Math.random() * Math.PI * 2 });
    }

    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    this.bladeMesh = mesh;
    this._bm = new THREE.Matrix4();
    this._bq = new THREE.Quaternion();
    this._bs = new THREE.Vector3();
    this._bp = new THREE.Vector3();
    this._be = new THREE.Euler();

    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Canopy polyps — one light per contributor, clustered at the top.
  // The people actually working on the repo.
  // -------------------------------------------------------------------------
  buildCanopyPolyps() {
    const contributors = this.repo.contributors || 1;
    const count = THREE.MathUtils.clamp(contributors, 1, this.isMobile ? 8 : 24);

    const geo = new THREE.SphereGeometry(1, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: this.languageColor,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    this.polyps = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.girth * (0.3 + Math.random() * 0.9);
      const y = this.height * (0.82 + Math.random() * 0.18);
      const size = 0.06 + Math.random() * 0.08;
      p.set(Math.cos(a) * r, y, Math.sin(a) * r);
      s.setScalar(size);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      this.polyps.push({ base: p.clone(), size, phase: Math.random() * Math.PI * 2 });
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.polyps.mesh = mesh;
    this._pm = new THREE.Matrix4();
    this._ps = new THREE.Vector3();
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Growth rings — one band per year of history
  // -------------------------------------------------------------------------
  buildRingBands() {
    if (this.rings <= 0) return;

    // A ring's radius differs by only ~0.1 between adjacent years, so one unit
    // torus scaled in X and Z is indistinguishable from nine separate geometries.
    // With batching on, the same reasoning extends across towers: the rings of two
    // towers whose girth agrees to a twentieth of a unit are the same shape, so
    // they share one instance buffer and one draw call.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const matrices = [];

    for (let i = 0; i < this.rings; i++) {
      // Rings are evenly spaced up the lower 70% of the stipe
      const t = (i + 1) / (this.rings + 1);
      const y = this.height * t * 0.72;
      const r = this.girth * (0.34 - t * 0.12);

      p.set(0, y, 0);
      s.set(r, 1, r);
      m.compose(p, q, s);
      matrices.push(m.clone());
    }

    this.ringMatrices = matrices;
    if (this.batchProps) return;

    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.kelpBladeLit,
      transparent: true,
      opacity: 0.4,
    });

    const mesh = new THREE.InstancedMesh(SHARED.ring, mat, this.rings);
    for (let i = 0; i < this.rings; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.ringMesh = mesh;
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  // Star glow — social reach. Drawn as a soft additive halo near the canopy.
  // A repo with many stars is visible from across the city.
  // -------------------------------------------------------------------------
  buildStarGlow() {
    const stars = this.repo.stars || 0;
    if (stars <= 0) return;

    // Log scale: 100 stars and 100k stars must both read on the same screen
    const strength = THREE.MathUtils.clamp(Math.log10(stars + 1) / 5, 0, 1);
    this.starStrength = strength;

    const geo = new THREE.SphereGeometry(1, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: this.languageColor,
      transparent: true,
      opacity: 0.06 + strength * 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.starGlow = new THREE.Mesh(geo, mat);
    const r = this.girth * (2.4 + strength * 4.5);
    this.starGlow.scale.setScalar(r);
    this.starGlow.position.y = this.height * 0.86;
    this.group.add(this.starGlow);

    this.starGlowBase = 1;
  }

  // -------------------------------------------------------------------------
  // Activity lights — the CI/CD status reads as tube worms at the base.
  // Green = passing, red = failing, gold = running.
  // -------------------------------------------------------------------------
  buildActivityLights() {
    const status = this.repo.ciStatus || "none";
    if (status === "none") return;

    const color =
      status === "success" ? COLORS.success :
      status === "failure" ? COLORS.failure :
      COLORS.running;

    const count = this.isMobile ? 3 : 6;
    this.tubeWormCount = count;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const matrices = [];

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.3;
      const r = this.girth * (1.4 + this.rng() * 0.7);
      const h = 0.5 + this.rng() * 0.8;
      p.set(Math.cos(a) * r, h * 0.5, Math.sin(a) * r);
      e.set((this.rng() - 0.5) * 0.4, a, (this.rng() - 0.5) * 0.4);
      q.setFromEuler(e);
      s.set(1, h, 1);
      m.compose(p, q, s);
      matrices.push(m.clone());
    }

    this._wormPhases = [];
    for (let i = 0; i < count; i++) this._wormPhases.push(this.rng() * 6.28);
    // The last `count` RNG draws are the worm lean; the matrices themselves are
    // not kept, because the update loop rewrites them every frame anyway.

    // Not batched: these pulse, and their animation lives in this tower's update
    // loop. Batching them would mean a shared buffer written from twenty-three
    // places per frame, which trades a draw call for a dependency.
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });

    const mesh = new THREE.InstancedMesh(SHARED.worm, mat, count);
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.tubeWorms = mesh;
  }

  // -------------------------------------------------------------------------
  // Update — sway, blade flutter, polyp pulse
  // -------------------------------------------------------------------------
  update(delta) {
    this.time += delta;

    if (this.stipeUniforms) {
      this.stipeUniforms.uTime.value = this.time;
    }

    // Blades flutter — but follow the stipe's bend at their height
    if (this.bladeMesh) {
      const sway = this.stipeUniforms.uSwayAmount.value;
      const speed = this.stipeUniforms.uSwaySpeed.value;
      const phase = this.stipeUniforms.uPhase.value;

      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i];
        // Cantilever bend matching the stipe vertex shader
        const bend = b.t * b.t;
        const s1 = Math.sin(this.time * speed + phase);
        const s2 = Math.sin(this.time * speed * 0.53 + phase * 1.7);

        const xOff = s1 * sway * bend;
        const zOff = s2 * sway * bend * 0.65;
        const flutter = Math.sin(this.time * 1.9 + b.phase) * 0.14;

        this._bp.set(xOff, this.height * b.t, zOff);
        this._be.set(0, b.a + flutter * 0.4, Math.PI * 0.34 + flutter);
        this._bq.setFromEuler(this._be);
        this._bs.set(b.len * 0.5, b.len, 1);
        this._bm.compose(this._bp, this._bq, this._bs);
        this.bladeMesh.setMatrixAt(i, this._bm);
      }
      this.bladeMesh.instanceMatrix.needsUpdate = true;
    }

    // Polyps pulse with the current
    if (this.polyps.mesh) {
      for (let i = 0; i < this.polyps.length; i++) {
        const p = this.polyps[i];
        const pulse = 0.85 + Math.sin(this.time * 1.3 + p.phase) * 0.15;
        this._ps.setScalar(p.size * pulse);
        this._pm.compose(p.base, new THREE.Quaternion(), this._ps);
        this.polyps.mesh.setMatrixAt(i, this._pm);
      }
      this.polyps.mesh.instanceMatrix.needsUpdate = true;
    }

    // Star halo breathes
    if (this.starGlow) {
      const breathe = 1 + Math.sin(this.time * 0.7) * 0.06;
      const base = this.girth * (2.4 + (this.starStrength || 0) * 4.5);
      this.starGlow.scale.setScalar(base * breathe);
    }

    // Activity lights shimmer in time with the current
    // (This is the tube-worm cluster for CI/CD status.)
    if (this.tubeWorms) {
      const n = this.tubeWorms.count || 0;
      if (!this._wormBase) {
        this._wormBase = [];
        const m = new THREE.Matrix4();
        for (let i = 0; i < n; i++) {
          this.tubeWorms.getMatrixAt(i, m);
          this._wormBase.push(m.elements.slice());
        }
      }
      const pulse = 0.82 + Math.sin(this.time * 1.7) * 0.18;
      for (let i = 0; i < n; i++) {
        const ph = this._wormPhases[i];
        this._bm.fromArray(this._wormBase[i]);
        this._bm.decompose(this._bp, this._bq, this._bs);
        const baseY = this._bp.y;
        this._bp.y = baseY + Math.sin(this.time * 1.3 + ph) * 0.22;
        const breathe = pulse * 0.7 + Math.sin(this.time * 2.1 + ph) * 0.3;
        this._bs.set(
          this._bs.x * (0.9 + breathe * 0.15),
          this._bs.y * (0.96 + breathe * 0.08),
          this._bs.z * (0.9 + breathe * 0.15)
        );
        this._bm.compose(this._bp, this._bq, this._bs);
        this.tubeWorms.setMatrixAt(i, this._bm);
      }
      this.tubeWorms.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Build the mesh for one shape the batch declined to take.
   *
   * The batch poses every prop and only draws a shape when the group holds
   * enough instances to be worth a shared buffer. Below that, the tower builds
   * its own InstancedMesh from the SAME unit geometry the batch would have used —
   * so the shape is identical, and only the buffer's owner differs.
   *
   * The matrix array is the batch's, not a copy: if the batch ever takes over
   * later, it reads the same matrices the tower would have.
   */
  buildProp(kind, matrices, material) {
    const geometry = kind === "ring" ? SHARED.ring : SHARED.tendril;
    if (!matrices || !matrices.length) return null;

    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    if (kind === "ring") this.ringMesh = mesh;
    return mesh;
  }

  dispose() {
    // The unit geometries in SHARED belong to the module, not to this tower, and
    // are referenced by every other tower and by the batch. Disposing one here
    // would delete the buffers the rest of the forest is still drawing from — a
    // tower that unmounts must not take the others' rings with it.
    const shared = new Set(Object.values(SHARED));

    this.group.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}