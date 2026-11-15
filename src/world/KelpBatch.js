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
    // The meshes this batch handed back to individual towers because a shape was
    // too small to be worth a shared buffer. Kept so a rebuild does not hand the
    // same shape out twice — see the sweep in `_split`.
    this.handed = [];
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

    // Free the previous generation of handed meshes for the towers this rebuild
    // is about to hand them to again.
    //
    // A rebuild runs after `dispose()`, which only knows about the shared
    // buffers — the handed meshes were created by `buildProp` on the towers
    // themselves, so nothing else knows they exist. `buildProp` also APPENDS: it
    // does not check whether the tower already holds a mesh for this shape. So
    // rebuilding a group whose shape is still under the threshold without
    // releasing the old mesh gave each of those towers one extra InstancedMesh per
    // refresh, never freed: measured, five updates left a tower with six ring
    // meshes where one was drawn.
    //
    // Scoped to the towers being re-handed rather than swept over the whole
    // ledger, and the scoping is load-bearing: `_split` runs TWICE per build — once
    // for rings, once for tendrils — so a whole-ledger sweep in the first call
    // would free the tendril hand-outs the second call is about to replace,
    // leaving the tower with its rings and no holdfast roots at all.
    for (const tower of byTower.keys()) {
      for (let i = this.handed.length - 1; i >= 0; i--) {
        const h = this.handed[i];
        if (h.tower !== tower || !h.mesh.parent) continue;
        h.mesh.parent.remove(h.mesh);
        h.mesh.dispose();
        this.handed.splice(i, 1);
      }
    }

    for (const [tower, mats] of byTower) {
      const mesh = tower.buildProp(kind, mats, material);
      if (mesh) this.handed.push({ tower, mesh });
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

  /**
   * Re-register one tower after its shape changed.
   *
   * A live record can change a tower's height, girth, ring count, CI status or
   * worm count — and `smallFeatureKey` is derived from all five. So the key the
   * tower was filed under when it was built is now wrong: its rings and tendrils
   * are still posed in the buffer for the old silhouette, and it is missing from
   * the buffer for its new one.
   *
   * Rebuilding the whole batch is the honest fix, and it is affordable: this runs
   * once per live record, not once per frame, and a batch build is a matrix
   * multiply per instance plus one buffer upload. Adding a `remove(tower)` that
   * had to splice it out of every group and every entry array would be more code
   * than the rebuild, and the splice is the part that is easy to get wrong.
   *
   * @returns {boolean} whether the tower was found and the batch rebuilt
   */
  refresh(tower) {
    if (!tower) return false;

    // Every tower currently filed, minus the one being refreshed, plus it again.
    // Reading the tower list back out of the groups means a caller does not have
    // to remember which towers exist — the batch already knows.
    const all = [];
    let found = false;
    for (const g of this.groups.values()) {
      for (const t of g.towers) {
        if (t === tower) {
          found = true;
          continue;
        }
        if (!all.includes(t)) all.push(t);
      }
    }

    // Not registered yet (or already dropped): nothing to rebuild from.
    if (!found) return false;

    all.push(tower);

    this.dispose();
    for (const t of all) this.add(t);
    this.build();
    return true;
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
      // The two materials built in `build()` are owned by THIS batch, not by a
      // tower and not by SHARED — nothing else draws with them, so they are
      // freed here rather than left for a traverse to find.
      if (mesh.material) mesh.material.dispose();
    }
    this.meshes.length = 0;
    this.groups.clear();

    // The handed meshes are the batch's to release too: it created them, through
    // `buildProp`, and it is the only thing that knows they exist. Leaving them
    // means a rebuild leaks one mesh per tower per shape that fell under the
    // threshold, and the tower's own `_clearOwn` cannot see them either — it only
    // knows about the props it built for itself.
    for (const { mesh } of this.handed) {
      if (!mesh.parent) continue;
      mesh.parent.remove(mesh);
      mesh.dispose();
      // The material is the batch's (it passed it in), not the tower's, so it is
      // freed here rather than left for a tower that never owned it.
      if (mesh.material) mesh.material.dispose();
    }
    this.handed.length = 0;
  }
}
