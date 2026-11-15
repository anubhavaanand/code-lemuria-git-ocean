import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { OceanEnvironment } from "../src/world/OceanEnvironment";

/**
 * The ocean environment must release each resource exactly once.
 *
 * Third instance of the dispose family in this project (see
 * tests/whaleDispose.test.js and the kelp fix in src/world/KelpTower.js), and
 * the clearest one, because the ownership model is stated twice over.
 *
 * Every builder creates a geometry and a material, adds the mesh to
 * `this.group`, and ALSO pushes both into `this.disposables`. That is deliberate
 * belt-and-braces authoring — the module wants to be sure it can find its own
 * objects again. But the teardown then trusted both lists and ran two passes:
 * the traverse found each object by walking the scene, and the disposables loop
 * found the same objects a second time. Measured on a live low-tier environment:
 * 16 resources in the scene, 16 tracked, 32 dispose events.
 *
 * As with the other two, nothing throws. three's destroyGeometry removes the
 * listener and deletes the map entry, so the second call is a silent no-op. The
 * cost is that the count stops being evidence.
 */
describe("ocean environment dispose", () => {
  // The marine snow reads window.devicePixelRatio to pick a point size. That is
  // a legitimate browser fact for the renderer to need, but it makes the module
  // untestable outside one unless the global is filled in. Test file scope, not
  // a module change: the scene is not what this file is about.
  beforeAll(() => {
    if (typeof globalThis.window === "undefined") {
      globalThis.window = { devicePixelRatio: 1 };
    }
  });

  const environment = () => {
    const scene = new THREE.Scene();
    return new OceanEnvironment(scene, {
      quality: "low",
      isMobile: false,
    });
  };

  const resources = (env) => {
    const found = new Set();
    env.group.traverse((o) => {
      if (o.geometry) found.add(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) found.add(m);
    });
    return found;
  };

  const watched = (set) => {
    const counts = new Map();
    for (const r of set) {
      counts.set(r, 0);
      r.addEventListener("dispose", () => counts.set(r, counts.get(r) + 1));
    }
    return counts;
  };

  const summary = (counts) => {
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

  it("releases every resource in the scene exactly once", () => {
    const env = environment();
    const inScene = resources(env);
    const counts = watched(inScene);

    env.dispose();

    const { fired, repeated, never, distinct } = summary(counts);
    expect(repeated).toBe(0);
    expect(never).toBe(0);
    expect(fired).toBe(distinct);
  });

  it("does not double up between the traverse and the disposables list", () => {
    // The two passes must not overlap in what they release. If they do, the
    // second pass is invisible to the caller — it just fires more events.
    const env = environment();
    const inScene = resources(env);
    const counts = watched(new Set(env.disposables));

    env.dispose();

    // Every tracked object is also in the scene, so it was reached by the
    // traverse; the disposables pass must add nothing.
    let trackedInScene = 0;
    for (const d of env.disposables) if (inScene.has(d)) trackedInScene += 1;
    expect(trackedInScene).toBe(env.disposables.length);
    for (const n of counts.values()) expect(n).toBe(1);
  });

  it("is idempotent within a teardown, so the two passes cannot overlap", () => {
    // The guarantee that matters is narrower than "calling dispose() twice does
    // nothing", and worth stating precisely: the module releases each resource
    // once, however many passes it makes over the graph. A second *call* would
    // legitimately release the same objects again — by then they are released
    // and the question is moot. What must not happen is two passes inside one
    // teardown both firing, which is what the bug did.
    const env = environment();
    const inScene = resources(env);
    const counts = watched(inScene);

    env.dispose();

    // One teardown, one traverse and one disposables pass: 16 resources, 16
    // events. Before the fix this was 32.
    expect(summary(counts).fired).toBe(inScene.size);
    expect(summary(counts).repeated).toBe(0);
  });

  it("still covers resources that are tracked but not attached", () => {
    // Guards the fix against the wrong fix: the traverse is the authority, but
    // a tracked object that is not in the graph is a leaked handle, not a second
    // thing to free. This asserts the module still releases it.
    const env = environment();
    const detached = new THREE.PlaneGeometry(10, 10);
    env.disposables.push(detached);
    let events = 0;
    detached.addEventListener("dispose", () => {
      events += 1;
    });

    env.dispose();

    expect(events).toBe(1);
  });

  it("builds the same number of resources at every quality tier", () => {
    // The count is what the fix is calibrated against. If a tier silently drops
    // a builder, the "exactly once" assertions above would still pass.
    const low = environment();
    const high = new OceanEnvironment(new THREE.Scene(), {
      quality: "high",
      isMobile: false,
    });
    expect(resources(low).size).toBe(16);
    expect(resources(high).size).toBe(16);
    expect(high.disposables.length).toBe(low.disposables.length);
    high.dispose();
  });
});