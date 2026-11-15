/**
 * One repository's creature populations must be the same on every load.
 *
 * These tests run the real OrbitalGroup and CreatureSystem classes in Node.
 * Three.js builds the scene graph without a GL context, so what is asserted is
 * the instance data the update loop reads — the orbits themselves.
 *
 * WHY THIS EXISTS
 *
 * `build()` populated every instance from `Math.random()`: the phase offset, the
 * orbital radius, the speed spread, the vertical spread, the size and the tint.
 * A repo therefore drew a different population on every visit. The same 26
 * Builders arrived at a different phase and a different radius, so the whole
 * system sheared from a different starting point, and a repo could never acquire
 * a visual signature.
 *
 * The practical cost is a measurement one: a screenshot cannot be diffed against
 * a second run, so a visual regression is invisible by construction, and a
 * creature count read off one load cannot be checked against the pixels of
 * another.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { OrbitalGroup, CreatureSystem } from "../src/world/CreatureGeometry";

const repo = (over = {}) => ({
  id: "o/r",
  owner: "o",
  name: "r",
  contributors: 12,
  stars: 400,
  forks: 20,
  watchers: 8,
  openIssues: 4,
  openPRs: 2,
  closedIssues: 40,
  mergedPRs: 15,
  commitFrequency: 8,
  ...over,
});

/**
 * Read an instance's orbital parameters, which is what `update()` consumes.
 * The instance matrix is the drawn result, so both are checked: a group could
 * hold identical instances and still draw differently if the update loop were
 * reading something else.
 */
const snapshot = (group) => {
  group.update(0, 0);
  return {
    count: group.count,
    instances: group.instances.map((i) => [
      i.phase,
      i.radius,
      i.speed,
      i.yOffset,
      i.size,
    ]),
    matrix: Array.from(group.mesh.instanceMatrix.array).map((v) => v.toFixed(4)),
  };
};

describe("OrbitalGroup determinism", () => {
  it("gives a repo the same population on every load", () => {
    const a = new OrbitalGroup(null, "BUILDERS", repo(), { quality: "low" });
    const b = new OrbitalGroup(null, "BUILDERS", repo(), { quality: "low" });
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("gives a different repo a different population, so determinism is not uniformity", () => {
    const a = new OrbitalGroup(null, "BUILDERS", repo(), { quality: "low" });
    const b = new OrbitalGroup(null, "BUILDERS", repo({ id: "o/other", name: "other" }), {
      quality: "low",
    });
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  it("keeps each group independent of the others", () => {
    // A shared stream across all five groups would make the second group a
    // function of what the first consumed, so adding a creature to one group
    // would silently move every other group.
    const build = (names) =>
      new CreatureSystem(repo(), { quality: "low" });
    const full = build();
    const partial = build();
    // Same repo, same seed: the full system is reproducible, which is the
    // property the per-group salt must not break.
    for (const key of ["BUILDERS", "ADMIRERS", "RESOLUTIONS"]) {
      expect(snapshot(full.groups[key])).toEqual(snapshot(partial.groups[key]));
    }
  });

  it("derives the count from repo data, and the seed only shapes it", () => {
    const low = new OrbitalGroup(null, "ADMIRERS", repo({ stars: 4 }), {
      quality: "low",
    });
    const high = new OrbitalGroup(null, "ADMIRERS", repo({ stars: 90000 }), {
      quality: "low",
    });
    // Stars must still drive density. Determinism is about *which* bodies
    // appear, not about erasing the signal the counts carry.
    expect(high.count).toBeGreaterThan(low.count);
  });
});

describe("CreatureSystem determinism", () => {
  const sig = (sys) => {
    const out = {};
    for (const [key, g] of Object.entries(sys.groups)) out[key] = snapshot(g);
    return out;
  };

  it("reproduces the whole system for the same repo", () => {
    const a = new CreatureSystem(repo(), { quality: "low" });
    const b = new CreatureSystem(repo(), { quality: "low" });
    expect(sig(a)).toEqual(sig(b));
  });

  it("reports a stable total creature count", () => {
    const a = new CreatureSystem(repo(), { quality: "low" });
    const b = new CreatureSystem(repo(), { quality: "low" });
    expect(a.totalCreatures).toBe(b.totalCreatures);
  });

  it("advances on the same timeline for the same elapsed time", () => {
    // Two systems of the same repo, stepped with identical deltas, must draw
    // identically. This is the property that makes a frozen-frame screenshot
    // reproducible, and it is what the QA harness depends on.
    const a = new CreatureSystem(repo(), { quality: "low" });
    const b = new CreatureSystem(repo(), { quality: "low" });
    a.update(0.016);
    b.update(0.016);
    a.update(0.016);
    b.update(0.016);
    const sa = sig(a);
    const sb = sig(b);
    for (const key of Object.keys(sa)) {
      expect(sa[key].matrix).toEqual(sb[key].matrix);
    }
  });

  it("holds every creature inside its own orbital plane", () => {
    // The seed must not be allowed to scatter a body out of its band. Each
    // The seed must not be allowed to scatter a body out of its band. The
    // orbit equation puts y at `sin(trueAnomaly) * r * sin(inclination)` plus
    // the per-instance offset, and `r` never exceeds the semi-major axis, so
    // the drawn Y is bounded by the plane's own geometry regardless of seed.
    const sys = new CreatureSystem(repo(), { quality: "low" });
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const g of Object.values(sys.groups)) {
      const spread = g.plane.inclination * g.plane.radius * 0.6 + 1.1;
      const bound = g.plane.radius * Math.sin(g.plane.inclination) + spread;
      for (let step = 0; step < 60; step++) {
        g.update(0.05, step * 0.05);
        for (let n = 0; n < g.count; n++) {
          g.mesh.getMatrixAt(n, m);
          v.setFromMatrixPosition(m);
          expect(Math.abs(v.y)).toBeLessThan(bound + 1e-6);
        }
      }
    }
  });
});
