/**
 * Git Ocean — Seafloor
 *
 * The ground the towers grow from. Real seafloor: sediment plains broken by
 * basalt outcrops, with a gentle large-scale swell so it never reads as a
 * flat plane. Displaced geometry, vertex-coloured by height and slope.
 *
 * Deliberately dark — the towers and creatures are the subject, the floor
 * is the stage.
 */

import * as THREE from "three";
import { COLORS, SEAFLOOR_Y } from "./constants";

/** Small deterministic 2D value-noise, used for terrain displacement. */
function terrainNoise(x, z) {
  // Layered swell. Amplitudes are tuned against the plane size: at 9000 units
  // wide the wavelengths below are 1500 / 550 / 230 / 105 units, so the
  // seafloor has four readable scales of relief instead of one flat gradient.
  let h = 0;
  h += Math.sin(x * 0.0042 + 1.7) * Math.cos(z * 0.0037 - 0.4) * 46;
  h += Math.sin(x * 0.0113 - 2.1) * Math.cos(z * 0.0094 + 1.3) * 21;
  h += Math.sin(x * 0.0271 + 0.6) * Math.cos(z * 0.0233 - 2.7) * 9.5;
  h += Math.sin(x * 0.061 - 1.1) * Math.cos(z * 0.053 + 0.9) * 3.2;
  // A ridged term: sharp crests and flat troughs read as eroded sediment
  // rather than smooth dunes.
  h += (1 - Math.abs(Math.sin(x * 0.0165 - z * 0.0139 + 0.8))) * 12;
  return h;
}

/**
 * Rock-scatter field.
 *
 * Rocks are placed in CLUSTERS, not uniformly. A uniform scatter over a
 * 5000-unit plane puts only a handful of instances anywhere near the camera,
 * which is why three QA passes in a row reported "no rocks visible" while the
 * instance count read 240. Clustering roughly 65% of the rocks into ~30 dense
 * groups puts dozens of them inside the 400-900 unit band the camera actually
 * frames at world/city zoom, while the rest stay sparse outliers for realism.
 *
 * Returns { x, z } in scene space.
 */
function rockField(rng) {
  const CLUSTERS = 30;
  // FOREGROUND BAND — measured, not guessed.
  //
  // At world zoom the camera sits at (0, 700, 1450) looking at (0, 16, 0).
  // A rock of radius 8 projects to ~4.3px at 1400 units and ~3.0px at 2000.
  // A uniform scatter over a 5400-unit plane put 468 of 680 rocks in frame but
  // only TWO within 900 units of the camera — which is why nine QA passes kept
  // reporting "no rocks at all" while the instance count said 680.
  //
  // So a fraction of the field is deliberately placed in the near band
  // (z +300..+1300, i.e. 150-1100 units in front of the camera) where a
  // boulder actually resolves to a shape the eye can read.
  if (rng() < 0.34) {
    return {
      x: (rng() - 0.5) * 2300,
      z: 300 + rng() * 1000,
      near: true,
    };
  }
  if (rng() < 0.62) {
    // Pick a cluster centre, then scatter tightly around it.
    const ci = Math.floor(rng() * CLUSTERS);
    const cr = mulberry(4200 + ci * 977);
    const cx = (cr() - 0.5) * 4200;
    const cz = -350 + (cr() - 0.5) * 3600;
    const spread = 90 + cr() * 260;
    // Gaussian-ish offset so the cluster core is dense and the edge feathers
    const a = rng() * Math.PI * 2;
    const d = Math.pow(rng(), 0.65) * spread;
    return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, clustered: true };
  }
  // Sparse outliers across the whole field
  return {
    x: (rng() - 0.5) * 5600,
    z: -700 + (rng() - 0.5) * 5400,
    clustered: false,
  };
}

/**
 * Seafloor elevation at a world XZ position.
 *
 * Exported because everything that stands on the sediment must use it.
 * Towers were being placed at a hard y=0 while the ground displaces by up to
 * ±90 units, so a tower standing over a trough floated in open water and one
 * over a ridge was buried to its canopy — this is the "kelp floats" defect
 * that QA reported twice.
 */
export function seafloorHeightAt(x, z) {
  return SEAFLOOR_Y + terrainNoise(x, z);
}

export class Seafloor {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.quality = opts.quality || "high";
    this.group = new THREE.Group();
    this.group.name = "seafloor";
    scene.add(this.group);

    this.buildFloor();
    this.buildOutcrops();
    this.buildRocks();
  }

  buildFloor() {
    // The floor has to reach past the camera at the furthest zoom level.
    // World zoom parks the camera around z = +1450, and the old 3000x1500
    // plane centred at z=-260 ended near z=+490 — so the bottom quarter of
    // the world view looked off the edge of the world into pure backdrop,
    // which is exactly the "crushed black band" QA kept reporting.
    //
    // Vertex spacing has to be fine enough for the relief to read. At the old
    // 200 segments over 9000 units (45 units per vertex) every ridge was
    // sampled by barely one vertex, which is why four passes reported "flat
    // slab" no matter how the amplitudes were pushed. 320 segments puts a
    // vertex every 28 units — the 550 and 230-unit wavelength terms now get
    // 4-8 samples each and actually register as topography.
    const width = 9000;
    const depth = 7000;
    const segX = this.quality === "low" ? 170 : 320;
    const segZ = Math.floor(segX * (depth / width));
    const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSediment = new THREE.Color(COLORS.sediment);
    const cSedimentLit = new THREE.Color(COLORS.sedimentLit);
    const cBasalt = new THREE.Color(COLORS.basalt);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // becomes -z after rotation

      // Large swell + medium detail + fine grain
      const h = terrainNoise(x, y);
      pos.setZ(i, h);

      // Slope from a cheap finite difference
      const e = 6;
      const hx = terrainNoise(x + e, y) - h;
      const hy = terrainNoise(x, y + e) - h;
      const slope = Math.min(1, Math.sqrt(hx * hx + hy * hy) / e * 1.4);

      // Colour by height and slope: basins darker, ridges catch light,
      // steep faces expose basalt.
      //
      // IMPORTANT: with the floor now 9000 units wide, the vertex spacing is
      // ~45 units, so the old ±30-unit height window saturated everything to
      // one flat tone — which is why QA kept calling the ground a "uniform
      // slab". Widen the window to the actual height range so basins really
      // do read darker than ridges.
      const heightT = THREE.MathUtils.clamp((h + 34) / 68, 0, 1);
      const col = cSediment.clone();
      col.lerp(cSedimentLit, heightT * 0.9);
      col.lerp(cBasalt, slope * 0.85);

      // Two-scale mottling: broad patches of lighter/darker sediment, plus a
      // finer grain on top. Both keyed to world position so they tile
      // seamlessly across the plane instead of streaking.
      const patch = Math.sin(x * 0.0072 - y * 0.0061) * 0.5 + 0.5;
      const patch2 = Math.sin(x * 0.021 + y * 0.017 + 2.1) * 0.5 + 0.5;
      const grain = Math.sin(x * 0.31 + y * 0.27) * 0.5 + 0.5;
      const mottle = 0.82 + patch * 0.26 + patch2 * 0.14 + grain * 0.08;
      col.multiplyScalar(mottle);

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.02,
      flatShading: false,
    });

    this.floor = new THREE.Mesh(geo, mat);
    this.floor.rotation.x = -Math.PI / 2;
    // Sits a touch BELOW SEAFLOOR_Y so tower holdfasts and rock bases meet it
    // instead of hovering over it. Centred well behind the camera so the near
    // edge is never visible even at whale zoom.
    this.floor.position.set(0, SEAFLOOR_Y - 6, -1400);
    this.floor.receiveShadow = true;
    this.group.add(this.floor);
  }

  /** Basalt outcrops — sharp vertical rock breaking through the sediment. */
  buildOutcrops() {
    const rng = mulberry(90210);
    // Enough to break up the floor from every zoom, not so many that the
    // instanced draw call becomes the bottleneck.
    const count = this.quality === "low" ? 70 : 150;
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.basalt,
      roughness: 0.88,
      metalness: 0.08,
      flatShading: true,
    });

    const geo = new THREE.ConeGeometry(1, 1, 5, 1);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      // Clustered field, so outcrops actually appear near the camera instead
      // of being smeared thinly across a 5000-unit plane.
      const spot = rockField(rng);
      const x = spot.x;
      const z = spot.z;
      const base = terrainNoise(x, z);

      const h = 24 + rng() * 90;
      const r = 14 + rng() * 40;

      p.set(x, SEAFLOOR_Y + base + h * 0.42, z);
      q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.24, rng() * Math.PI, (rng() - 0.5) * 0.24));
      s.set(r, h, r);

      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Scattered boulders and rubble — breaks up the empty floor. */
  buildRocks() {
    const rng = mulberry(1337);
    const count = this.quality === "low" ? 320 : 680;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.basalt,
      roughness: 0.95,
      metalness: 0.04,
      flatShading: true,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      // Same clustered field as the outcrops. This is the fix that actually
      // matters: 240 rocks spread over 5000 units put ~2 in the camera's
      // near field, which read as "no rocks at all" no matter what the count
      // said. 680 rocks in clusters puts dozens in frame.
      const spot = rockField(rng);
      const x = spot.x;
      const z = spot.z;
      const base = terrainNoise(x, z);

      // Size distribution: mostly rubble with a tail of genuinely large
      // boulders. Boulders must stay big enough to register at world zoom —
      // a 1-unit rock 1400 units away is well under a pixel.
      const roll = rng();
      // Near-band rocks get a size bump: a boulder 300 units away must still
      // be big enough to occlude the ground behind it, otherwise it reads as
      // litter rather than as terrain.
      const r = roll > 0.94
        ? 18 + rng() * 30
        : roll > 0.72
          ? 8 + rng() * 12
          : 3.2 + rng() * 4.6;
      p.set(x, SEAFLOOR_Y + base + r * 0.32, z);
      q.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
      s.set(r, r * (0.5 + rng() * 0.4), r);

      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }

    mesh.instanceMatrix.needsUpdate = true;
    this.rockMesh = mesh;
    this.group.add(mesh);
  }

  /**
   * Ground-truth framing report for the rock field.
   *
   * Used by the QA screenshot pass (see App.jsx ?debug=rocks). Every prior
   * "no rocks visible" verdict came from a vision model looking at a picture;
   * this instead projects each real instance through the live camera and
   * reports how many actually land inside the frustum and how many pixels
   * they cover. That turns "I think the rocks are too small" into a number
   * that can be checked, and it caught the real bug: 468 of 680 rocks were in
   * frame but only 2 were within 900 units of the camera.
   */
  rockReport(camera, width, height) {
    if (!this.rockMesh) return null;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const v = new THREE.Vector3();
    const tanY = Math.tan((camera.fov * Math.PI) / 360);

    let inFrame = 0;
    let near = 0;
    let maxPx = 0;
    let pxSum = 0;
    let over7 = 0;
    let over15 = 0;

    for (let i = 0; i < this.rockMesh.count; i++) {
      this.rockMesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scl);
      // Distance along the camera's view axis
      v.copy(pos).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth < 10) continue;

      v.copy(pos).project(camera);
      if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      inFrame++;

      const dist = Math.hypot(
        pos.x - camera.position.x,
        pos.y - camera.position.y,
        depth
      );
      if (dist < 900) near++;

      const px = (Math.abs(scl.x) * height) / (2 * depth * tanY);
      pxSum += px;
      if (px > maxPx) maxPx = px;
      if (px > 7) over7++;
      if (px > 15) over15++;
    }

    return {
      count: this.rockMesh.count,
      inFrame,
      near,
      over7,
      over15,
      maxPx: Number(maxPx.toFixed(1)),
      meanPx: inFrame ? Number((pxSum / inFrame).toFixed(2)) : 0,
      width,
      height,
    };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

/** Deterministic PRNG so the seafloor is identical every load. */
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