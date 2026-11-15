import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildWorld } from "../src/world/worldData";
import { LegacyColony } from "../src/world/LegacyCreatures";

/**
 * A legacy colony must release each resource exactly once.
 *
 * Fourth instance of the dispose family in this project (after the kelp forest,
 * the whale and the ocean environment), and the one where the defect is most
 * clearly a consequence of the design rather than a slip.
 *
 * A colony is not flat. Each builder reuses ONE geometry and ONE material across
 * a whole herd — a ring of barnacles, a cloud of copepods, a bed of urchins — so
 * a naive traverse disposes the same buffers once per animal in the herd.
 * Measured on a full low-tier colony: 39 mesh objects, 59 unique resources (39
 * geometries and 39 materials), 1 geometry and 9 materials shared across several
 * meshes, and 78 dispose events for 59 objects.
 *
 * The population is data-driven, so the damage is proportional to how busy the
 * repository is: a repo with 9,800 open issues builds a far larger colony and
 * therefore fires its shared resources far more times. That makes this the worst
 * of the four on a busy repo and invisible on a quiet one.
 *
 * As with the others, nothing throws. three's destroyGeometry removes the
 * listener and deletes the map entry, so a second dispose is a silent no-op. The
 * count is the only evidence, and the count was wrong.
 */
describe("legacy colony dispose", () => {
  const colonyFor = (repoName) => {
    const world = buildWorld();
    const repo =
      world.yourRepos.find((r) => r.name === repoName) ||
      world.following.find((r) => r.name === repoName);
    if (!repo) throw new Error(`no such repo: ${repoName}`);
    return { world, colony: new LegacyColony(repo, { quality: "low" }) };
  };

  const inventory = (colony) => {
    const resources = new Set();
    const sharedGeo = new Map();
    const sharedMat = new Map();
    colony.group.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints) return;
      if (o.geometry) {
        resources.add(o.geometry);
        sharedGeo.set(o.geometry, (sharedGeo.get(o.geometry) || 0) + 1);
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        resources.add(m);
        sharedMat.set(m, (sharedMat.get(m) || 0) + 1);
      }
    });
    return { resources, sharedGeo, sharedMat };
  };

  /** Total instances drawn across every instanced mesh, i.e. the population. */
  const countInstances = (colony) => {
    let n = 0;
    colony.group.traverse((o) => {
      if (o.isInstancedMesh) n += o.count;
    });
    return n;
  };

  const watched = (resources) => {
    const counts = new Map();
    for (const r of resources) {
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

  it("releases each shared resource once, however many animals use it", () => {
    const { colony } = colonyFor("code-lemuria-git-ocean");
    const { resources, sharedGeo, sharedMat } = inventory(colony);
    const counts = watched(resources);

    colony.dispose();

    // Some resources are shared by construction, so the graph cannot be the
    // unit of counting. This is the whole assertion.
    expect([...sharedGeo.values()].some((n) => n > 1)).toBe(true);
    expect([...sharedMat.values()].some((n) => n > 1)).toBe(true);

    const { fired, repeated, never, distinct } = summary(counts);
    expect(repeated).toBe(0);
    expect(never).toBe(0);
    expect(fired).toBe(distinct);
  });

  it("fires once per resource on a colony whose population is in the hundreds", () => {
    // `vue`: 2,604 open discussions and 386 releases, so the largest herds the
    // mock world can build — 469 instances across 26 mesh objects.
    //
    // The count of *animals* is what the naive traverse scaled with, and the
    // builders already collapse those animals into instanced meshes (that is why
    // `buildSeaUrchins` uses two InstancedMeshes for eighteen urchins rather than
    // thirty-six draw calls). What a traverse cannot collapse is the sharing of
    // the geometry and material BETWEEN the instanced meshes of different
    // creatures — a sponge and a polyp and an anemone that each reach for the
    // same unit shape. That is the residue this test pins.
    const { colony } = colonyFor("vue");
    const { resources, sharedGeo, sharedMat } = inventory(colony);
    const counts = watched(resources);
    const instances = countInstances(colony);

    colony.dispose();

    const { fired, repeated, never, distinct } = summary(counts);
    expect(instances).toBeGreaterThan(300);
    expect(resources.size).toBeLessThan(instances);
    expect(repeated).toBe(0);
    expect(never).toBe(0);
    expect(fired).toBe(distinct);
    // The sharing is real, so the "once" is not vacuous.
    expect([...sharedGeo.values()].some((n) => n > 1)).toBe(true);
    expect([...sharedMat.values()].some((n) => n > 1)).toBe(true);
  });

  it("is idempotent, because a teardown may arrive twice", () => {
    const { colony } = colonyFor("code-lemuria-git-ocean");
    const { resources } = inventory(colony);
    const counts = watched(resources);

    colony.dispose();
    const afterFirst = summary(counts).fired;
    colony.dispose();

    expect(summary(counts).fired).toBe(afterFirst);
  });

  it("leaves every resource released, none leaked", () => {
    const { colony } = colonyFor("ky");
    const { resources } = inventory(colony);
    const counts = watched(resources);

    colony.dispose();

    expect(summary(counts).never).toBe(0);
  });

  it("disposes nothing at all when the colony built nothing", () => {
    // A repository with no README quality, no discussions, no releases: the
    // builders return early and the colony is empty. Guards a guard that
    // mis-fires on an empty group.
    const world = buildWorld();
    const repo = {
      ...world.following[0],
      readmeQuality: 0,
      readmeLength: 0,
      branchCount: 0,
    };
    const colony = new LegacyColony(repo, { quality: "low" });
    const { resources } = inventory(colony);
    const counts = watched(resources);

    colony.dispose();

    expect(summary(counts).fired).toBe(resources.size);
    expect(summary(counts).repeated).toBe(0);
  });
});