/**
 * The batching rules, pinned without a renderer.
 *
 * These tests run the real KelpTower and KelpBatch classes in Node. Three.js does
 * not need a GL context to build a scene graph, so what is asserted here is the
 * bookkeeping the draw-call reduction depends on — which towers share a buffer,
 * which keep their own, and that neither path breaks the other's geometry.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { KelpTower, SHARED, smallFeatureKey } from "../src/world/KelpTower";
import { KelpBatch } from "../src/world/KelpBatch";

const repo = (over = {}) => ({
  id: "o/r",
  owner: "o",
  name: "r",
  contributors: 12,
  stars: 400,
  commitFrequency: 8,
  ageDays: 900,
  openIssues: 4,
  openPRs: 2,
  ciStatus: "success",
  language: "JavaScript",
  ...over,
});

describe("tower prop batching", () => {
  it("poses the props instead of building them when batching", () => {
    const t = new KelpTower(repo(), { batchProps: true, quality: "low" });
    expect(t.ringMatrices.length).toBe(t.rings);
    expect(t.tendrilMatrices.length).toBeGreaterThan(0);
    // Six children: stipe, blades, polyps, star glow, worms and the holdfast cap.
    // No ring mesh and no tendril mesh — those are the batch's.
    expect(t.group.children.length).toBeLessThan(8);
  });

  it("builds its own props when it is not batched", () => {
    const a = new KelpTower(repo(), { batchProps: true, quality: "low" });
    const b = new KelpTower(repo(), { batchProps: false, quality: "low" });
    expect(b.group.children.length).toBeGreaterThan(a.group.children.length);
  });

  it("gives two towers from the same repo the same shape key", () => {
    const a = new KelpTower(repo(), { batchProps: true, quality: "low" });
    const b = new KelpTower(repo(), { batchProps: true, quality: "low" });
    expect(smallFeatureKey(a)).toBe(smallFeatureKey(b));
  });

  it("splits towers that differ only by commit frequency", () => {
    const a = new KelpTower(repo({ commitFrequency: 0 }), { batchProps: true, quality: "low" });
    const b = new KelpTower(repo({ commitFrequency: 30 }), { batchProps: true, quality: "low" });
    expect(smallFeatureKey(a)).not.toBe(smallFeatureKey(b));
  });

  it("ignores the star count, which the props do not depend on", () => {
    const a = new KelpTower(repo({ stars: 1 }), { batchProps: true, quality: "low" });
    const b = new KelpTower(repo({ stars: 90000 }), { batchProps: true, quality: "low" });
    expect(smallFeatureKey(a)).toBe(smallFeatureKey(b));
  });

  it("is deterministic, so a batch is stable across reloads", () => {
    const a = new KelpTower(repo(), { batchProps: true, quality: "low" });
    const b = new KelpTower(repo(), { batchProps: true, quality: "low" });
    expect(a.tendrilMatrices.map((m) => m.elements.slice())).toEqual(
      b.tendrilMatrices.map((m) => m.elements.slice())
    );
  });

  // That test only covers the tendrils, because only the tendrils were ever
  // routed through `this.rng`. The blades and the canopy polyps were placed
  // with `Math.random()` and so reshuffled on every load, which a tendril
  // assertion could not see.
  it("gives a repo the same blades and polyps on every load", () => {
    const readMesh = (mesh) => {
      const m = new THREE.Matrix4();
      const out = [];
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        out.push(Array.from(m.elements).map((v) => v.toFixed(4)).join(","));
      }
      return out;
    };
    const a = new KelpTower(repo(), { quality: "low" });
    const b = new KelpTower(repo(), { quality: "low" });

    expect(readMesh(a.bladeMesh)).toEqual(readMesh(b.bladeMesh));
    expect(readMesh(a.polyps.mesh)).toEqual(readMesh(b.polyps.mesh));
    // The phases are what the update loop animates, so they must match too.
    expect(a.blades.map((x) => x.phase)).toEqual(b.blades.map((x) => x.phase));
    expect(a.polyps.map((x) => x.phase)).toEqual(b.polyps.map((x) => x.phase));
  });

  it("sways on a phase the repo owns, not a fresh one per visit", () => {
    const a = new KelpTower(repo(), { quality: "low" });
    const b = new KelpTower(repo(), { quality: "low" });
    expect(a.stipeUniforms.uPhase.value).toBe(b.stipeUniforms.uPhase.value);
  });

  it("gives two different repos different blades, so a batch is not uniform", () => {
    // Determinism must not be bought by making every tower identical.
    const readMesh = (mesh) => {
      const m = new THREE.Matrix4();
      const out = [];
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        out.push(Array.from(m.elements).map((v) => v.toFixed(4)).join(","));
      }
      return out;
    };
    const a = new KelpTower(repo(), { quality: "low" });
    const b = new KelpTower(repo({ id: "o/other", name: "other" }), {
      quality: "low",
    });
    expect(readMesh(a.bladeMesh)).not.toEqual(readMesh(b.bladeMesh));
    expect(a.stipeUniforms.uPhase.value).not.toBe(b.stipeUniforms.uPhase.value);
  });

  it("uses one shared geometry for every tower's rings", () => {
    const a = new KelpTower(repo(), { batchProps: false, quality: "low" });
    const b = new KelpTower(repo({ id: "o/other" }), { batchProps: false, quality: "low" });
    const ringOf = (t) =>
      t.group.children.find((c) => c.isInstancedMesh && c.geometry === SHARED.ring);
    expect(ringOf(a)).toBeTruthy();
    expect(ringOf(a).geometry).toBe(SHARED.ring);
    expect(ringOf(b).geometry).toBe(SHARED.ring);
  });

  it("does not dispose a shared geometry with its tower", () => {
    const before = SHARED.ring.attributes.position.count;
    const t = new KelpTower(repo(), { batchProps: false, quality: "low" });
    t.dispose();
    expect(SHARED.ring.attributes.position.count).toBe(before);
    expect(!!SHARED.ring.attributes.position).toBe(true);
  });
});

describe("KelpBatch", () => {
  const towerAt = (t) => {
    t.group.position.set(10, 0, 20);
    t.group.updateMatrixWorld(true);
    return t;
  };

  it("groups towers by shape key and poses one buffer per shape", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const a = towerAt(new KelpTower(repo(), { batchProps: true, quality: "low" }));
    const b = towerAt(new KelpTower(repo({ id: "o/r2" }), { batchProps: true, quality: "low" }));
    batch.add(a);
    batch.add(b);
    batch.build();

    const meshes = scene.children.filter((c) => c.isInstancedMesh);
    // The tendrils batch is large enough to share; two rings are not, so they
    // stay with their towers.
    expect(meshes.length).toBe(1);
    const tendrils = meshes.find((m) => m.geometry === SHARED.tendril);
    expect(tendrils.count).toBe(a.tendrilMatrices.length + b.tendrilMatrices.length);
    batch.dispose();
  });

  it("poses a shared instance at the tower's world position", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const a = towerAt(new KelpTower(repo(), { batchProps: true, quality: "low" }));
    batch.add(a);
    batch.build();

    const mesh = scene.children.find((c) => c.isInstancedMesh && c.geometry === SHARED.tendril);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    // The first tendril's local offset is inside the tower's footprint, so its
    // world position must be near the tower's, not at the origin.
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.distanceTo(a.group.position)).toBeLessThan(a.girth * 4 + 1);
    batch.dispose();
  });

  it("re-poses when the towers move", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const a = towerAt(new KelpTower(repo(), { batchProps: true, quality: "low" }));
    batch.add(a);
    batch.build();

    a.group.position.set(500, 0, 500);
    a.group.updateMatrixWorld(true);
    batch.update();

    const mesh = scene.children.find((c) => c.isInstancedMesh && c.geometry === SHARED.tendril);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.distanceTo(new THREE.Vector3(500, 0, 500))).toBeLessThan(a.girth * 4 + 1);
    batch.dispose();
  });

  it("disposes its meshes without touching the shared geometry", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const a = towerAt(new KelpTower(repo(), { batchProps: true, quality: "low" }));
    batch.add(a);
    batch.build();
    const before = SHARED.tendril.attributes.position.count;
    batch.dispose();
    expect(scene.children.length).toBe(0);
    expect(SHARED.tendril.attributes.position.count).toBe(before);
  });

  it("hands a small shape back to each tower rather than sharing it", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const a = towerAt(new KelpTower(repo(), { batchProps: true, quality: "low" }));
    const b = towerAt(
      new KelpTower(repo({ id: "o/r2" }), { batchProps: true, quality: "low" })
    );
    batch.add(a);
    batch.add(b);
    batch.build();

    // Two rings each across two towers — four instances, under the threshold — so
    // no shared ring mesh exists and each tower carries its own.
    const ringMeshes = scene.children.filter(
      (c) => c.isInstancedMesh && c.geometry === SHARED.ring
    );
    expect(ringMeshes.length).toBe(0);

    const owned = [a, b].filter((t) => t.ringMesh);
    expect(owned.length).toBe(2);
    // And the tendrils, at twelve each, are above the threshold and do share.
    const tendrilMeshes = scene.children.filter(
      (c) => c.isInstancedMesh && c.geometry === SHARED.tendril
    );
    expect(tendrilMeshes.length).toBe(1);
    expect(tendrilMeshes[0].count).toBe(
      a.tendrilMatrices.length + b.tendrilMatrices.length
    );
    batch.dispose();
  });
});
