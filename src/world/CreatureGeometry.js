/**
 * Git Ocean — Bioluminescent creatures
 *
 * The 7 orbital groups, rendered as instanced glowing bodies. Real deep-sea
 * bioluminescence is point-source light from photophores — so each creature
 * is a small emissive core with a soft fresnel halo, not a solid mesh.
 *
 * Groups and their orbital planes are defined in world/constants.js.
 * Motion is Keplerian: elliptical, inclined, faster at perihelion.
 */

import * as THREE from "three";
import { COLORS, ORBITAL_PLANES, LAYERS } from "./constants";
import { biolumVertex, biolumFragment } from "./shaders";

// ---------------------------------------------------------------------------
// Deterministic per-repo jitter
// ---------------------------------------------------------------------------

/**
 * A seeded RNG, so one repository's creatures are the same on every load.
 *
 * Every group is built from `Math.random()` in `build()`, which means a repo's
 * population reshuffles on each visit: the same 26 Builders arrive at a
 * different phase, radius, speed and tint, and the whole system shears from a
 * different starting point. That defeats three things at once — a screenshot
 * cannot be diffed against a second run, a repo cannot acquire a visual
 * signature, and any future "creature count per repo" readout cannot be
 * verified against the pixels.
 *
 * Seeded per repo AND per group, not per repo alone. A shared stream across
 * all five groups would make the populations correlated: the group built
 * second would be a function of what the first consumed, so adding a creature
 * to one group would move all the others. Salting the seed per group name
 * keeps each population independent while leaving both fully reproducible.
 */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function repoSeed(repo, groupName) {
  return (hashString(`${repo.id || repo.owner || "?"}/${repo.name || "?"}`) ^
    hashString(groupName)) >>> 0;
}

// ---------------------------------------------------------------------------
// Per-group palette and behaviour
// ---------------------------------------------------------------------------

export const GROUP_STYLE = {
  BUILDERS: {
    color: COLORS.biolumCyan,
    core: 0xd8ffff,
    size: [0.16, 0.34],
    intensity: 1.35,
    bobbing: 0.22,
  },
  ADMIRERS: {
    color: COLORS.biolumGold,
    core: 0xfff0c0,
    size: [0.08, 0.18],
    intensity: 1.0,
    bobbing: 0.5,
  },
  OFFSPRING: {
    color: 0x6ad0ff,
    core: 0xe0f6ff,
    size: [0.14, 0.3],
    intensity: 1.1,
    bobbing: 0.3,
  },
  PROBLEMS: {
    color: COLORS.biolumRed,
    core: 0xffc0b0,
    size: [0.12, 0.26],
    intensity: 1.5,
    bobbing: 0.65,
  },
  RESOLUTIONS: {
    color: COLORS.biolumGreen,
    core: 0xd0ffe0,
    size: [0.12, 0.24],
    intensity: 1.05,
    bobbing: 0.24,
  },
};

/**
 * One orbital group: a set of instanced bodies orbiting a whale.
 * Count is driven by repo data so density carries meaning.
 */
export class OrbitalGroup {
  constructor(whale, groupName, repo, opts = {}) {
    this.whale = whale;
    this.groupName = groupName;
    this.repo = repo;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || false;

    const plane = ORBITAL_PLANES[groupName];
    const style = GROUP_STYLE[groupName] || GROUP_STYLE.BUILDERS;

    this.plane = plane;
    this.style = style;
    this.count = this.computeCount();
    this.instances = [];

    // Seeded per repo and per group, so the population is reproducible without
    // the groups sharing a stream.
    this.rng = mulberry(repoSeed(repo, groupName));

    this.group = new THREE.Group();
    this.group.name = `orbital-${groupName}`;
    this.build();
  }

  /** Creature count per group, derived from repo data. */
  computeCount() {
    const r = this.repo;
    let n = 0;

    switch (this.groupName) {
      case "BUILDERS":
        // contributors + bot ratio + commit streak marker
        n = (r.contributors || 1) * 3 + Math.min(8, Math.floor((r.commitFrequency || 0) / 3));
        break;
      case "ADMIRERS":
        // stars dominate; capped hard so a famous repo doesn't kill the GPU
        n = Math.min(46, Math.floor(Math.sqrt(r.stars || 0) * 2.1) + (r.watchers || 0) * 0.4);
        break;
      case "OFFSPRING":
        n = Math.min(28, (r.forks || 0) * 1.4 + Math.floor((r.stars || 0) / 220));
        break;
      case "PROBLEMS":
        n = (r.openIssues || 0) * 1.2 + (r.openPRs || 0) * 1.8;
        break;
      case "RESOLUTIONS":
        n = Math.floor((r.closedIssues || 0) / 5) + (r.mergedPRs || 0) * 1.1;
        break;
      default:
        n = 4;
    }

    n = Math.floor(n);
    const min = this.isMobile ? 1 : 2;
    const cap = this.isMobile ? 20 : this.quality === "low" ? 26 : 46;
    return THREE.MathUtils.clamp(n, min, cap);
  }

  build() {
    const { style, count } = this;

    // Shared geometry: an icosahedron reads as an organic blob at this size
    // and costs far less than a sphere at the same silhouette.
    const geo = new THREE.IcosahedronGeometry(1, 1);

    // Per-instance attributes
    const phases = new Float32Array(count);
    const radii = new Float32Array(count);
    const speeds = new Float32Array(count);
    const yOffsets = new Float32Array(count);
    const sizes = new Float32Array(count);
    const tints = new Float32Array(count * 3);

    const cA = new THREE.Color(style.color);
    const cB = new THREE.Color(style.core);
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Even angular distribution with jitter so they don't look gridded
      phases[i] = (i / count) * Math.PI * 2 + this.rng() * 0.4;

      // Radius varies inside the plane — a band, not a single ring
      radii[i] = this.plane.radius * (0.78 + this.rng() * 0.34);

      // Slight speed spread within the group, so it shears over time
      speeds[i] = 0.82 + this.rng() * 0.42;

      // Vertical spread gives the group volume
      const spread = this.plane.inclination * this.plane.radius * 0.6 + 1.1;
      yOffsets[i] = (this.rng() - 0.5) * spread;

      // Size distribution: many small, a few large
      const sr = this.rng();
      sizes[i] = style.size[0] + (style.size[1] - style.size[0]) * (sr > 0.86 ? 1 : sr * 0.7);

      // Tint varies per individual — real populations aren't uniform
      tmp.copy(cA).lerp(cB, this.rng() * 0.55);
      tints[i * 3] = tmp.r;
      tints[i * 3 + 1] = tmp.g;
      tints[i * 3 + 2] = tmp.b;

      this.instances.push({
        phase: phases[i],
        radius: radii[i],
        speed: speeds[i],
        yOffset: yOffsets[i],
        size: sizes[i],
      });
    }

    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tints, 3));

    // We drive position/scale on the CPU for a few dozen instances per group —
    // cheap, and it keeps the orbit math readable and correct.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(style.color) },
        uCoreColor: { value: new THREE.Color(style.core) },
        uIntensity: { value: style.intensity },
        uOpacity: { value: 0.95 },
      },
      vertexShader: biolumVertex,
      fragmentShader: biolumFragment,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;

    this.group.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /**
   * Update orbits. Keplerian approximation:
   *  - angular position advances non-uniformly (faster near perihelion)
   *  - the orbit is inclined, so Y = sin(θ) · r · sin(inclination)
   *  - individuals shear over time from their speed spread
   */
  update(delta, elapsed) {
    const { plane } = this;
    this.mesh.material.uniforms.uTime.value = elapsed;

    const inc = plane.inclination;
    const ecc = plane.eccentricity;
    const a = plane.radius; // semi-major
    const b = a * Math.sqrt(1 - ecc * ecc); // semi-minor

    for (let i = 0; i < this.count; i++) {
      const inst = this.instances[i];

      // Mean anomaly advances at a constant rate; true anomaly is
      // approximated with a first-order equation-of-centre correction.
      const mean = elapsed * plane.speed * inst.speed + inst.phase;
      const trueAnomaly = mean + 2 * ecc * Math.sin(mean);

      const r = (a * (1 - ecc * ecc)) / (1 + ecc * Math.cos(trueAnomaly));

      const x = Math.cos(trueAnomaly) * r;
      const z = Math.sin(trueAnomaly) * b;

      // Inclination tilts the orbital plane about the X axis
      const y = Math.sin(trueAnomaly) * r * Math.sin(inc) + inst.yOffset;

      // Gentle independent bobbing so the group breathes
      const bob = Math.sin(elapsed * 1.1 + inst.phase * 2.3) * this.style.bobbing * 0.35;

      this._p.set(x, y + bob, z);
      this._s.setScalar(inst.size);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
  }
}

/**
 * All five orbital groups for one whale, parented to a shared group so the
 * whole system can be positioned and culled as a unit.
 */
export class CreatureSystem {
  constructor(repo, opts = {}) {
    this.repo = repo;
    this.group = new THREE.Group();
    this.group.name = `creatures:${repo.name}`;
    this.groups = {};
    this.elapsed = 0;

    const names = ["BUILDERS", "ADMIRERS", "OFFSPRING", "PROBLEMS", "RESOLUTIONS"];
    for (const name of names) {
      const g = new OrbitalGroup(this, name, repo, opts);
      this.groups[name] = g;
      this.group.add(g.group);
    }
  }

  update(delta) {
    this.elapsed += delta;
    for (const key in this.groups) {
      this.groups[key].update(delta, this.elapsed);
    }
  }

  get totalCreatures() {
    return Object.values(this.groups).reduce((s, g) => s + g.count, 0);
  }

  dispose() {
    for (const key in this.groups) {
      this.groups[key].dispose();
    }
  }
}

/**
 * Ambient creatures — no data attached, purely to make the water feel alive.
 * Small fish schools drifting laterally through the scene.
 */
export class AmbientSchool {
  constructor(opts = {}) {
    this.count = opts.count || 60;
    this.quality = opts.quality || "high";
    this.group = new THREE.Group();
    this.group.name = "ambient-school";
    this.build();
    this.elapsed = Math.random() * 100;
  }

  build() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fd8e8,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.fish = [];
    for (let i = 0; i < this.count; i++) {
      this.fish.push({
        x: (Math.random() - 0.5) * 1600,
        y: (Math.random() - 0.5) * 300,
        z: (Math.random() - 0.5) * 400,
        speed: 6 + Math.random() * 14,
        size: 0.1 + Math.random() * 0.26,
        phase: Math.random() * Math.PI * 2,
        dir: Math.random() < 0.5 ? 1 : -1,
      });
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  update(delta) {
    this.elapsed += delta;
    const t = this.elapsed;

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.x += f.speed * f.dir * delta;

      // Wrap around the field
      if (f.x > 800) f.x = -800;
      if (f.x < -800) f.x = 800;

      const y = f.y + Math.sin(t * 0.6 + f.phase) * 9;
      const z = f.z + Math.cos(t * 0.42 + f.phase) * 12;

      this._p.set(f.x, y, z);
      this._s.set(f.size * 1.8, f.size * 0.7, f.size);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}