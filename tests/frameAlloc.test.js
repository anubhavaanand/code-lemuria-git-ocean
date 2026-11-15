import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildWorld } from "../src/world/worldData";
import { LegacyColony } from "../src/world/LegacyCreatures";
import { WhaleWithSculpt } from "../src/world/WhaleFactory";

/**
 * The animation loop must not allocate.
 *
 * A different defect class from the four dispose fixes: this one is invisible in
 * any single screenshot and only shows up as GC pressure after minutes of
 * running. There is no wrong pixel to point at — only a frame that occasionally
 * stutters, which no screenshot can show.
 *
 * What it looked like: four animation closures called
 * `q.setFromEuler(new THREE.Euler(...))`. That is one fresh Euler per creature
 * per frame. Measured on a `vue` colony (2,604 open discussions, 469 instances),
 * that is 80 allocations per update — 4,800 a second of pure garbage on a small
 * colony, and 1,500 on a busy one. A whale adds 19 per update for its remora
 * school.
 *
 * The fix is the oldest one in real-time graphics: keep a scratch object and
 * mutate it in place. Every one of these closures already hoists a Matrix4, a
 * Quaternion and two Vector3s for exactly this reason; the Euler was the one
 * object that got missed in all four places.
 *
 * This test asserts the property rather than the mechanism, so it cannot be
 * satisfied by "allocate slightly less often": it counts DISTINCT Euler objects
 * reaching `setFromEuler` over a full second of animation and requires the count
 * to be a small constant that does not grow with the population.
 */
describe("animation allocations", () => {
  const repo = (name) => {
    const world = buildWorld();
    return (
      world.following.find((r) => r.name === name) ||
      world.yourRepos.find((r) => r.name === name)
    );
  };

  /**
   * Count distinct Euler instances handed to `Quaternion.setFromEuler` over a
   * number of updates, plus the total call count.
   *
   * Counts distinct OBJECTS, not calls, because the bug is garbage and garbage is
   * per-object. A closure that builds one Euler once and reuses it for eighty
   * matrix compositions a frame is correct; one that builds eighty is not.
   */
  const trackEulers = () => {
    const original = THREE.Quaternion.prototype.setFromEuler;
    const seen = new WeakSet();
    const state = { calls: 0, fresh: 0, installed: true };

    THREE.Quaternion.prototype.setFromEuler = function (e) {
      state.calls += 1;
      if (e && e.isEuler && !seen.has(e)) {
        seen.add(e);
        state.fresh += 1;
      }
      return original.call(this, e);
    };

    return {
      state,
      restore() {
        if (state.installed) {
          THREE.Quaternion.prototype.setFromEuler = original;
          state.installed = false;
        }
      },
    };
  };

  const measure = (target, updates = 60) => {
    const tracker = trackEulers();
    try {
      // Warm up first: the first update of a colony may do build-time work in
      // some closures, and counting that would measure construction, not frames.
      for (let i = 0; i < 30; i++) target.update(1 / 60, i / 60);
      tracker.state.calls = 0;
      tracker.state.fresh = 0;
      for (let i = 0; i < updates; i++) target.update(1 / 60, i / 60);
      return {
        callsPerUpdate: tracker.state.calls / updates,
        freshPerUpdate: tracker.state.fresh / updates,
      };
    } finally {
      tracker.restore();
    }
  };

  it("does not allocate an Euler per copepod per frame", () => {
    const colony = new LegacyColony(repo("vue"), { quality: "low" });
    const { callsPerUpdate, freshPerUpdate } = measure(colony);

    // The work is real, so the count is not trivially zero: eighty compositions
    // a frame on a busy colony.
    expect(callsPerUpdate).toBeGreaterThan(20);
    // But the scratch object is reused, so no new Euler reaches it.
    expect(freshPerUpdate).toBeLessThan(1);
  });

  it("does not allocate an Euler per amphipod per frame", () => {
    // A different colony on purpose: the two bugs live in different builders and
    // a fix to one says nothing about the other. `planetwood` has 680 downloads,
    // so its amphipod herd is small but present.
    const colony = new LegacyColony(repo("planetwood"), { quality: "low" });
    const { callsPerUpdate, freshPerUpdate } = measure(colony);

    expect(callsPerUpdate).toBeGreaterThan(1);
    expect(freshPerUpdate).toBeLessThan(1);
  });

  it("does not allocate an Euler per remora per frame", () => {
    const whale = new WhaleWithSculpt(repo("vue"), { quality: "low" });
    const { callsPerUpdate, freshPerUpdate } = measure(whale);

    expect(callsPerUpdate).toBeGreaterThan(1);
    expect(freshPerUpdate).toBeLessThan(1);
  });

  it("keeps the allocation count flat as the colony gets busier", () => {
    // The property that matters for GC pressure is not "zero allocations" but
    // "the same allocations regardless of population". A per-creature Euler grows
    // linearly; a per-colony scratch does not.
    const quiet = measure(new LegacyColony(repo("planetwood"), { quality: "low" }));
    const busy = measure(new LegacyColony(repo("vue"), { quality: "low" }));

    expect(busy.callsPerUpdate).toBeGreaterThan(quiet.callsPerUpdate * 2);
    // Neither one allocates a single Euler, however busy it is.
    expect(quiet.freshPerUpdate).toBeLessThan(1);
    expect(busy.freshPerUpdate).toBeLessThan(1);
  });

  it("still moves the creatures, so the scratch reuse did not freeze them", () => {
    // Guard against the cheapest possible "fix": hoist the Euler by simply not
    // writing the matrix any more. The scratch object is only correct if the
    // instances still move.
    const colony = new LegacyColony(repo("vue"), { quality: "low" });

    const instanced = [];
    colony.group.traverse((o) => {
      if (o.isInstancedMesh && o.count > 4) instanced.push(o);
    });
    expect(instanced.length).toBeGreaterThan(0);

    const snapshot = instanced.map((m) => {
      const out = new Float32Array(m.count * 16);
      const tmp = new THREE.Matrix4();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, tmp);
        out.set(tmp.elements, i * 16);
      }
      return out;
    });

    for (let i = 0; i < 40; i++) colony.update(1 / 60, i / 60);

    const tmp = new THREE.Matrix4();
    let movedInstances = 0;
    instanced.forEach((m, k) => {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, tmp);
        for (let j = 0; j < 16; j++) {
          if (Math.abs(tmp.elements[j] - snapshot[k][i * 16 + j]) > 1e-5) {
            movedInstances += 1;
            return;
          }
        }
      }
    });

    // At least one animated herd moved. Not all instances must move on every
    // frame (some creatures are slow), but a colony that froze entirely is the
    // failure this is here to catch.
    expect(movedInstances).toBeGreaterThan(0);
  });
});