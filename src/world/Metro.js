/**
 * Git Ocean — the metro
 *
 * A pressure vessel, not a subway. Six capital stations sit on the seafloor and
 * the metro is the network of magnetohydrodynamic tubes that connects them:
 * superconducting bore, no moving parts, a conducting fluid pushed by a
 * magnetic field. That is a real propulsion principle, and it is why the tubes
 * are drawn as smooth sealed vessels with a pulse running inside them rather
 * than as carriages on rails.
 *
 * Why the tubes are buried
 * -----------------------
 * A tube laid on the sediment is a pipe lying in a field. A tube bored *through*
 * it is infrastructure. So the curve follows the terrain at a depth that ramps
 * from zero at each station mouth to `TUBE_BURY` in between: the vessel dives
 * under the seabed just outside each portal and surfaces at the next one, which
 * is exactly how a real immersed-tube tunnel meets its shaft.
 *
 * The depth is measured against the terrain at each sample, not against a
 * constant Y. `terrainNoise` displaces the seafloor by up to ±90 units, so a
 * straight chord between two stations would saw through ridges and float over
 * troughs — the same class of bug as the towers that floated or were buried
 * before `seafloorHeightAt` existed.
 *
 * The flow
 * --------
 * `uFlow` advances along the tube's own arc length, so a pulse takes the same
 * time to cross a short hop as a long one only if the speed is scaled by
 * length. `metroCurve` returns the length and the shader is told it, so the
 * pulse speed is in world units per second and reads as the same vehicle
 * slowing on a longer run.
 */

import * as THREE from "three";
import { COLORS } from "./constants";
import { seafloorHeightAt } from "./Seafloor";

/** Bore radius of the pressure vessel, in scene units. */
export const TUBE_RADIUS = 2.4;

/**
 * How deep the vessel runs below the sediment at mid-span.
 *
 * Deep enough that the tube is unambiguously underground from the side, shallow
 * enough that it still reads from the city zoom, where the whole point is that
 * you can see the line of the network between stations.
 */
export const TUBE_BURY = 14;

/** Samples along a curve used to follow the terrain. */
const TERRAIN_SAMPLES = 64;

/**
 * Chord distance between two stations.
 *
 * Exported because the network's edge selection and the tube geometry both
 * need it and a second copy would be a second place for them to disagree.
 */
export function stationDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The centreline of one tube.
 *
 * Follows the terrain at a depth that ramps from 0 at the portals to
 * `TUBE_BURY` at mid-span, then smooths the result. Smoothing matters: the
 * terrain noise has a 105-unit wavelength term, and following it exactly gives a
 * tube that visibly wobbles rather than one that is bored through rock.
 *
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @returns {THREE.CatmullRomCurve3}
 */
export function metroCurve(a, b, opts = {}) {
  const bury = opts.bury != null ? opts.bury : TUBE_BURY;
  const samples = opts.samples || TERRAIN_SAMPLES;

  const floorA = seafloorHeightAt(a.x, a.z);
  const floorB = seafloorHeightAt(b.x, b.z);

  // Depth BELOW THE LOCAL SEAFLOOR, not an absolute Y.
  //
  // The first version smoothed absolute Y and then subtracted nothing, which
  // looked right and was wrong in a way only measurement caught: where the
  // terrain dropped away sharply, the smoothed curve stayed high while the
  // floor fell, and the tube surfaced through a trench. On the delhi->sf edge
  // the clearance went from -19 at t=0.30 to -0.08 at t=0.70 — the vessel
  // popped out of the seabed halfway along its run.
  //
  // Smoothing the DEPTH and subtracting it from the local floor makes the
  // clearance exactly the smoothed profile, so a tube is buried by as much as
  // the ramp asks for at every station, and cannot be pulled above the ground
  // by a neighbour that happens to sit on a ridge.
  const depths = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Ramps in over the first and last sixth so the portals meet the stations
    // exactly and the vessel is fully buried for the middle two thirds.
    const ramp = Math.min(1, Math.min(t, 1 - t) / (1 / 6));
    depths.push(bury * (ramp * ramp * (3 - 2 * ramp))); // smoothstep
  }

  // Smooth the depth profile. A moving average over a window wide enough to
  // swallow the 105-unit terrain term but narrow enough to keep the ramp.
  const win = Math.max(2, Math.round(samples / 12));
  const smoothDepth = depths.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j < 0 || j >= depths.length) continue;
      sum += depths[j];
      n++;
    }
    return sum / n;
  });

  // The portals meet the stations exactly: zero depth at both ends, whatever
  // the smoothing did to the neighbours.
  smoothDepth[0] = 0;
  smoothDepth[samples] = 0;

  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    pts.push(new THREE.Vector3(x, seafloorHeightAt(x, z) - smoothDepth[i], z));
  }

  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  return curve;
}

const metroVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const metroFragment = /* glsl */ `
precision highp float;
uniform vec3  uShell;
uniform vec3  uFlowColor;
uniform float uFlow;
uniform float uLength;
uniform float uOpacity;
uniform float uTime;
uniform float uActivity;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  // A pressure vessel reads as a dark sealed shell with a bright seam where
  // the two halves are welded, and a pulse of light running inside it.
  float around = vUv.y;
  float along = vUv.x;

  // Weld seam: a thin bright line at the crown of the bore.
  float seam = smoothstep(0.02, 0.0, abs(around - 0.5) - 0.47);
  seam = 1.0 - smoothstep(0.0, 0.035, abs(around - 0.5) - 0.465);

  // The flow pulse. uFlow is in world units along the bore, uLength is the
  // tube's arc length, so the pulse takes longer over a longer run — the same
  // vehicle at the same speed, not the same animation stretched.
  float head = fract(uFlow / max(uLength, 0.001));
  float d = abs(fract(along - head + 0.5) - 0.5);
  float pulse = smoothstep(0.075, 0.0, d);
  pulse *= 0.55 + 0.45 * sin(uTime * 2.4 + along * 12.0);

  // A second, slower pulse the other way, so a busy line never looks idle.
  float head2 = fract(-uFlow * 0.55 / max(uLength, 0.001));
  float d2 = abs(fract(along - head2 + 0.5) - 0.5);
  float pulse2 = smoothstep(0.045, 0.0, d2) * 0.5;

  // Rim light along the top of the bore, so the tube separates from the
  // sediment it is buried in even when no pulse is passing.
  float rim = pow(1.0 - abs(dot(normalize(vNormalW), vec3(0.0, 1.0, 0.0))), 2.2);

  vec3 col = uShell;
  col += uFlowColor * seam * 0.55;
  col += uFlowColor * (pulse + pulse2) * (0.55 + uActivity * 0.9);
  col += uFlowColor * rim * 0.12;

  float alpha = uOpacity + seam * 0.25 + (pulse + pulse2) * 0.35;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export class MetroNetwork {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.quality = opts.quality || "high";
    this.isMobile = opts.isMobile || this.quality === "mobile";

    this.group = new THREE.Group();
    this.group.name = "metro";

    this.tubes = [];
    this.time = 0;
  }

  /**
   * @param {Array} stations  [{x, z, cluster}]
   * @param {Array<[object, object]>} edges  pairs of stations
   */
  build(stations, edges) {
    if (!this.scene || !edges || !edges.length) return this;

    this.scene.add(this.group);

    // Fewer segments around the bore on low quality: the tube is a few pixels
    // wide at every zoom that matters, so 8 sides is indistinguishable from 20
    // and costs less than half the vertices.
    const radial = this.isMobile ? 6 : this.quality === "low" ? 8 : 14;
    const perMetre = this.quality === "low" ? 1 / 14 : 1 / 9;
    const minSeg = 12;
    const maxSeg = this.isMobile ? 48 : 160;

    for (const [a, b] of edges) {
      const curve = metroCurve(a, b);
      const length = stationDistance(a, b);

      const segments = THREE.MathUtils.clamp(
        Math.round(length * perMetre),
        minSeg,
        maxSeg
      );

      // Name the tube after its two stations. Every mesh was named
      // `metro:?-?` because the station records carry `cluster` but the
      // obelisk's own id lives one level down — and a network of anonymous
      // tubes is a network you cannot debug, because a census report cannot
      // tell you which two cities an edge actually connects.
      const idOf = (s) =>
        (s && ((s.cluster && s.cluster.id) || s.id)) || "unknown";
      const label = `${idOf(a)}-${idOf(b)}`;

      const geo = new THREE.TubeGeometry(
        curve,
        segments,
        TUBE_RADIUS,
        radial,
        false
      );

      const material = new THREE.ShaderMaterial({
        vertexShader: metroVertex,
        fragmentShader: metroFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uShell: { value: new THREE.Color(COLORS.waferRaw) },
          uFlowColor: { value: new THREE.Color(COLORS.waferGlow) },
          // Start each tube's pulse at a different point along its run. All
          // six pulsing in unison reads as a machine cycling; offset, it reads
          // as a network carrying traffic.
          uFlow: { value: (length * 0.37) % Math.max(length, 1) },
          uLength: { value: length },
          uOpacity: { value: this.quality === "low" ? 0.5 : 0.62 },
          uTime: { value: 0 },
          uActivity: { value: ((a.cluster && a.cluster.glow) || 0.6) * 0.5 +
                                  ((b.cluster && b.cluster.glow) || 0.6) * 0.5 },
        },
      });

      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `metro:${label}`;
      // Tubes are buried: they should never intercept a pick meant for a tower
      // standing above them.
      mesh.userData.noPick = true;
      this.group.add(mesh);
      this.tubes.push({ mesh, curve, length });
    }

    return this;
  }

  /**
   * Advance the flow.
   *
   * Speed is constant in world units per second, so the pulse's *fraction* of
   * the run differs per tube — which is the honest behaviour, and is why the
   * shader divides by uLength rather than animating a 0..1 parameter.
   *
   * `now` is an explicit clock, not an accumulated `this.time + delta`, for the
   * same reason `PerfGovernor.sample(now)` is: a test can drive it without
   * sleeping, and a frame that is long does not make the pulse jump further than
   * the wall clock actually advanced.
   */
  update(delta, now) {
    this.time = now != null ? now : this.time + delta;
    if (!this.tubes.length) return;
    // A slow line: roughly one traversal every twenty seconds over 700 units.
    const speed = 34;
    for (const t of this.tubes) {
      const u = t.mesh.material.uniforms;
      u.uFlow.value = (u.uFlow.value + speed * delta) % Math.max(t.length, 1);
      u.uTime.value = this.time;
    }
  }

  dispose() {
    for (const t of this.tubes) {
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    }
    this.tubes.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}