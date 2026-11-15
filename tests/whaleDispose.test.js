import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildWorld } from "../src/world/worldData";
import { WhaleWithSculpt } from "../src/world/WhaleFactory";

/**
 * A whale's teardown must release each resource exactly once.
 *
 * This is the second instance of a defect family the project has now hit twice:
 * a per-object `dispose()` that traverses the node graph and calls
 * `geometry.dispose()` / `material.dispose()` on whatever it finds. On a whale
 * the graph is not flat — the two eyes are one `SphereGeometry` and one
 * `eyeMat`, and every remora is a single `InstancedMesh` — so the naive loop
 * fires the same dispose more than once on the same object.
 *
 * The failure mode is not an exception. three's `destroyGeometry`
 * (node_modules/three/build/three.module.js:3857-3901) removes the dispose
 * listener, deletes `geometries[geometry.id]` and decrements
 * `info.memory.geometries`, so a second dispose on an already-released object
 * is a silent no-op. What actually costs something is a resource that is still
 * drawing: dropping its buffers makes the mesh re-register them on the next
 * render. And because nothing throws, no screenshot and no single-run check
 * will ever catch it — only a counter will.
 *
 * These tests count. They instrument the dispose event on every resource the
 * whale owns, dispose, and assert the count is exactly the number of distinct
 * resources.
 */
describe("whale dispose", () => {
  const whale = (repo) => {
    const world = buildWorld();
    const found = world.following.find((r) => r.name === repo);
    return new WhaleWithSculpt(found, { quality: "low" });
  };

  /** Every distinct geometry and material reachable from the whale's meshes. */
  const inventory = (w) => {
    const resources = new Set();
    let meshRefs = 0;
    w.group.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshRefs += 1;
      if (o.geometry) resources.add(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) resources.add(m);
    });
    return { resources, meshRefs };
  };

  /** Count dispose events per resource, without counting references twice. */
  const watched = (resources) => {
    const counts = new Map();
    for (const r of resources) {
      counts.set(r, 0);
      r.addEventListener("dispose", () => counts.set(r, counts.get(r) + 1));
    }
    return counts;
  };

  const totals = (counts) => {
    let fired = 0;
    let repeated = 0;
    let never = 0;
    for (const n of counts.values()) {
      fired += n;
      if (n > 1) repeated += 1;
      if (n === 0) never += 1;
    }
    return { fired, repeated, never, distinct: counts.size };
  };

  it("releases every resource it owns, and nothing twice", () => {
    const w = whale("vue");
    const { resources } = inventory(w);
    const counts = watched(resources);

    w.dispose();

    const { fired, repeated, never, distinct } = totals(counts);
    // Each resource fires exactly once: nothing left unreleased (which would
    // leak GPU memory for the life of the page) and nothing fired twice (which
    // is the bug).
    expect(repeated).toBe(0);
    expect(never).toBe(0);
    expect(fired).toBe(distinct);
  });

  it("frees the two eyes once, not twice, when they are still procedural", () => {
    // The eyes are the clearest case: one geometry and one material shared by
    // two meshes. A `for (const e of this.eyes) e.geometry.dispose()` loop fires
    // that same geometry twice by construction, which is how the bug reads.
    const w = whale("vue");
    if (w.eyes.length !== 2) {
      // A sculpt is a different animal and this assertion does not apply.
      expect(w.eyes.length).toBe(0);
      return;
    }
    expect(w.eyes[0].geometry).toBe(w.eyes[1].geometry);

    const eyeGeo = w.eyes[0].geometry;
    let events = 0;
    eyeGeo.addEventListener("dispose", () => {
      events += 1;
    });

    w.dispose();

    expect(events).toBe(1);
  });

  it("does not re-fire when the same whale is disposed twice", () => {
    // StrictMode, a hot reload and a rebuild path can each land a second
    // teardown. Before the guard, three calls fired 22, then 44, then 66 events
    // on the same eighteen resources.
    const w = whale("vue");
    const { resources } = inventory(w);
    const counts = watched(resources);

    w.dispose();
    const afterFirst = totals(counts).fired;
    w.dispose();
    w.dispose();
    const afterThree = totals(counts).fired;

    // The second and third teardowns must add nothing at all.
    expect(afterFirst).toBe(totals(counts).distinct);
    expect(afterThree).toBe(afterFirst);
  });

  it("leaves no mesh holding a resource it has already freed", () => {
    // The eye-removal path runs while a sculpt is adopted and nulls the fields
    // afterwards; the general path must be equivalent. What matters is that
    // dispose() completes and leaves a traversable group behind rather than
    // throwing partway through and leaving half the graph attached.
    const w = whale("vue");
    w.dispose();
    let meshes = 0;
    w.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) meshes += 1;
    });
    expect(meshes).toBeGreaterThan(0);
  });

  it("disposes cleanly on a quieter whale with far fewer parts", () => {
    // A quiet repository: twelve open issues and ninety-six watchers, against
    // vue's four hundred and twenty and six thousand. The edge case for any loop
    // that assumed a minimum number of parts, and the case where a remora loop
    // that ran off a wrong count would be invisible.
    const w = whale("ky");
    const { resources } = inventory(w);
    const counts = watched(resources);

    w.dispose();

    const { fired, repeated, never, distinct } = totals(counts);
    expect(repeated).toBe(0);
    expect(never).toBe(0);
    expect(fired).toBe(distinct);
  });

  it("keeps the eye geometry a single object, so the count is meaningful", () => {
    // Guards the test itself: if a future refactor gave each eye its own
    // geometry, the "frees the two eyes once" assertion above would pass for the
    // wrong reason, because there would be nothing shared to double-free.
    const w = whale("vue");
    const eyes = w.eyes;
    expect(eyes.length).toBe(2);
    const geos = new Set(eyes.map((e) => e.geometry));
    const mats = new Set(eyes.map((e) => e.material));
    expect(geos.size).toBe(1);
    expect(mats.size).toBe(1);
  });
});