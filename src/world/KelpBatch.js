/**
 * Git Ocean — the small props of every kelp tower, in one draw call.
 *
 * A tower is built from a holdfast, a stipe, blades, polyps, growth rings, a star
 * halo and tube worms. Seven draw calls, twenty-three towers, and the city zoom
 * spends most of its budget on the smallest of them: the growth rings are a band
 * a few pixels wide, the holdfast tendrils are hairs on the sediment, the tube
 * worms are lamps at the base. Across the whole world that is a hundred and
 * sixty calls for detail that no camera position can resolve.
 *
 * The rings and the tendrils are static and decorative, so they batch: one
 * instance buffer per shape, shared by every tower, one draw call for all of
 * them. The tube worms pulse, so they stay with their tower — animating a shared
 * buffer would mean twenty-three writers per frame, which trades a draw call for
 * a dependency and a much harder bug.
 *
 * The towers keep their own meshes when batching is off (`batchProps: false`),
 * which is what the QA captures use: a capture that measures one tower has no
 * reason to pay for the world.
 */

import * as THREE from "three";
import { COLORS } from "./constants";
import { SHARED, smallFeatureKey } from "./KelpTower";

/**
 * Below this many instances, a shared buffer costs more than it saves.
 *
 * A batch is one draw call per shape per group, and a tower's own mesh is one
 * draw call per shape per tower. When a group holds only a handful of instances
 * the two are the same number of calls, and the shared path adds a matrix
 * multiply per instance per frame in `update()` plus a second hop through the
 * batch. Eight is roughly where the arithmetic turns: past it the batch is a
 * visible reduction, below it the extra hop is all you have.
 */
const TINIEST_BATCH = 8;

/**
 * Collect the towers that can share a batch.
 *
 * Grouping is by `smallFeatureKey`: girth, height, ring count, CI status and worm
 * count, each quantised to a twentieth of a unit. Two towers in the same group are
 * the same silhouette as far as a camera can tell, so one buffer serves both.
 */
export class KelpBatch {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map(); // key -> { towers: [], rings: [], tendrils: [] }
    this.meshes = [];
  }

  /** Register a tower's static props for batching. */
  add(tower) {
    const key = smallFeatureKey(tower);
    let g = this.groups.get(key);
    if (!g) {
      g = { towers: [], rings: [], tendrils: [] };
      this.groups.set(key, g);
    }
    g.towers.push(tower);
    if (tower.ringMatrices) {
      for (const m of tower.ringMatrices) g.rings.push({ tower, m });
    }
    if (tower.tendrilMatrices) {
      for (const m of tower.tendrilMatrices) g.tendrils.push({ tower, m });
    }
  }

  /**
   * Build the batches.
   *
   * Called once, after every tower has been added. A batch is only worth its own
   * draw call if it holds more than one tower's worth of instances — a single
   * tower's rings are one call either way, so those stay where they are and cost
   * nothing extra.
   */
  build() {
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLORS.kelpBladeLit,
      transparent: true,
      opacity: 0.4,
    });
    const tendrilMat = new THREE.MeshStandardMaterial({
      color: COLORS.holdfast,
      roughness: 0.95,
    });

    const m = new THREE.Matrix4();
    const world = new THREE.Matrix4();

    for (const g of this.groups.values()) {
      // The threshold is per SHAPE, not per group.
      //
      // Sharing costs one draw call per shape, plus a matrix multiply per
      // instance per frame in `update()` — cheap, but not free. So a shape only
      // earns a shared buffer when there is enough of it to be worth the hop; a
      // lone tower's two rings are one call whether they live here or in its own
      // mesh, and the shared buffer would add the hop for nothing.
      //
      // Tendrils are the opposite: a holdfast with a dozen roots is usually the
      // largest single batch in the world, so it batches from the first tower.
      this._split(g.rings, SHARED.ring, ringMat, m, world);
      this._split(g.tendrils, SHARED.tendril, tendrilMat, m, world);
    }
  }

  /** Batch a shape when the group holds enough of it; otherwise hand it back. */
  _split(entries, geometry, material, m, world) {
    if (!entries.length) return;

    if (entries.length >= TINIEST_BATCH) {
      this._make(entries, geometry, material, m, world);
      return;
    }

    // Too few to share, and the matrices are not necessarily this tower's: the
    // entries belong to their own towers, so group them by owner before building.
    // Building one mesh per entry would make as many draw calls as it saved.
    const byTower = new Map();
    for (const e of entries) {
      let list = byTower.get(e.tower);
      if (!list) {
        list = [];
        byTower.set(e.tower, list);
      }
      list.push(e.m);
    }

    const kind = geometry === SHARED.ring ? "ring" : "tendril";
    for (const [tower, mats] of byTower) {
      tower.buildProp(kind, mats, material);
    }
  }

  /**
   * One InstancedMesh for a group's instances, each posed in world space.
   *
   * The tower's own matrix is applied on top of the recorded local matrix, so a
   * tower that moves — and every tower drifts with the current — carries its props
   * with it. Without that, a drifting tower would leave its rings behind.
   */
  _make(entries, geometry, material, m, world) {
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    for (let i = 0; i < entries.length; i++) {
      const { tower, m: local } = entries[i];
      tower.group.updateMatrixWorld(true);
      world.multiplyMatrices(tower.group.matrixWorld, local);
      mesh.setMatrixAt(i, world);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    this.meshes.push({ mesh, entries });
  }

  /** Re-pose every batch. Called from the world loop, after the towers move. */
  update() {
    const world = new THREE.Matrix4();
    for (const { mesh, entries } of this.meshes) {
      for (let i = 0; i < entries.length; i++) {
        const { tower, m: local } = entries[i];
        world.multiplyMatrices(tower.group.matrixWorld, local);
        mesh.setMatrixAt(i, world);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const { mesh } of this.meshes) {
      this.scene.remove(mesh);
      // `InstancedMesh.dispose()` frees the instance buffers but not the
      // geometry or the material, which is what is wanted: the geometry is
      // SHARED, owned by the module and still in use by every tower.
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.groups.clear();
    // The materials are shared with the batches, so disposing the geometry is
    // enough; SHARED holds the geometry and is module-level, so it must survive.
  }
}
