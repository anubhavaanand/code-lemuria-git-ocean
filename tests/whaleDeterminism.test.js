/**
 * A repository's whale must be the same animal on every load.
 *
 * These tests run the real RepoWhale class in Node. Three.js builds the scene
 * graph without a GL context, so what is asserted is the instance data and the
 * placement parameters the animation loop reads.
 *
 * WHY THIS EXISTS
 *
 * The barnacle settlement, the remora stations and the flipper stroke phase were
 * all `Math.random()`. Each is presented as a property of the animal — "real
 * barnacles are hitchhikers", the remoras ride at a station along the flank —
 * so each must survive a reload. They did not: the same repo drew a different
 * crust of shells and a different set of passengers every visit.
 *
 * The consequence is the same one as everywhere else in this codebase. A whale
 * is the thing a repo is identified by, so a per-load reshuffle destroys the
 * signature it exists to carry, and it makes a frozen-frame capture
 * unreproducible — the only way this project can be checked at all.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { RepoWhale } from "../src/world/RepoWhale";

const repo = (over = {}) => ({
  id: "o/r",
  owner: "o",
  name: "r",
  contributors: 12,
  stars: 400,
  forks: 20,
  watchers: 6100,
  openIssues: 420,
  openPRs: 2,
  closedIssues: 40,
  mergedPRs: 15,
  commitFrequency: 8,
  ageDays: 900,
  language: "JavaScript",
  whaleSpecies: "humpback",
  ...over,
});

const barnacleMatrices = (whale) => {
  const mesh = whale.barnacleMesh;
  if (!mesh) return [];
  const m = new THREE.Matrix4();
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(Array.from(m.elements).map((v) => v.toFixed(4)).join(","));
  }
  return out;
};

const remoraParams = (whale) =>
  (whale.remoras || []).map((r) =>
    [r.t, r.a, r.phase, r.speed].map((v) => v.toFixed(4)).join(",")
  );

const flipperPhases = (whale) =>
  (whale.flippers || []).map((f) => f.phase.toFixed(4)).join(",");

describe("whale determinism", () => {
  it("settles the barnacles in the same place on every load", () => {
    const a = new RepoWhale(repo(), { quality: "low" });
    const b = new RepoWhale(repo(), { quality: "low" });
    expect(barnacleMatrices(a)).toEqual(barnacleMatrices(b));
  });

  it("keeps the same number of barnacles, which the data drives", () => {
    // Determinism must not be bought by freezing the count. Open issues are
    // the barnacle signal: 420 issues is a heavily encrusted animal.
    const a = new RepoWhale(repo({ openIssues: 420 }), { quality: "low" });
    const b = new RepoWhale(repo({ openIssues: 420 }), { quality: "low" });
    const sparse = new RepoWhale(repo({ openIssues: 1 }), { quality: "low" });
    expect(a.barnacleMesh.count).toBe(b.barnacleMesh.count);
    expect(a.barnacleMesh.count).toBeGreaterThan(sparse.barnacleMesh.count);
  });

  it("rides the remoras at the same stations on every load", () => {
    const a = new RepoWhale(repo(), { quality: "low" });
    const b = new RepoWhale(repo(), { quality: "low" });
    expect(remoraParams(a)).toEqual(remoraParams(b));
  });

  it("keeps the remora count tracking the watcher count", () => {
    const a = new RepoWhale(repo({ watchers: 6100 }), { quality: "low" });
    const b = new RepoWhale(repo({ watchers: 6100 }), { quality: "low" });
    const quiet = new RepoWhale(repo({ watchers: 10 }), { quality: "low" });
    expect(a.remoras.length).toBe(b.remoras.length);
    expect(a.remoras.length).toBeGreaterThan(quiet.remoras.length);
  });

  it("strokes the flippers on a gait the repo owns", () => {
    const a = new RepoWhale(repo(), { quality: "low" });
    const b = new RepoWhale(repo(), { quality: "low" });
    expect(flipperPhases(a)).toBe(flipperPhases(b));
  });

  it("gives two different repos different animals", () => {
    // A determinism fix that made every whale identical would pass every test
    // above. This is the guard against that.
    const a = new RepoWhale(repo(), { quality: "low" });
    const c = new RepoWhale(repo({ id: "o/other", name: "other" }), {
      quality: "low",
    });
    expect(barnacleMatrices(a)).not.toEqual(barnacleMatrices(c));
    expect(remoraParams(a)).not.toEqual(remoraParams(c));
    expect(flipperPhases(a)).not.toBe(flipperPhases(c));
  });

  it("does not let the barnacles move when the remora count changes", () => {
    // Two streams, not one. A shared stream would make the shell pattern a
    // function of how many passengers were drawn first, so adding watchers
    // would silently re-encrust the whole animal.
    const base = new RepoWhale(repo({ watchers: 6100, openIssues: 420 }), {
      quality: "low",
    });
    const more = new RepoWhale(repo({ watchers: 9000, openIssues: 420 }), {
      quality: "low",
    });
    expect(barnacleMatrices(base)).toEqual(barnacleMatrices(more));
  });

  it("does not let the remoras move when the barnacle count changes", () => {
    const base = new RepoWhale(repo({ watchers: 6100, openIssues: 420 }), {
      quality: "low",
    });
    const more = new RepoWhale(repo({ watchers: 6100, openIssues: 900 }), {
      quality: "low",
    });
    expect(remoraParams(base)).toEqual(remoraParams(more));
  });
});
