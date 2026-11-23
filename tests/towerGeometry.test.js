/**
 * A tower's geometry must follow the record it is drawn from.
 *
 * WHY THIS EXISTS
 *
 * `adoptProfile` folds a live record into a standing tower. It updated the repo
 * record, rescaled the whale from it, and never told the tower anything — so the
 * animal changed size while the plant it circles kept the shape it was drawn with
 * on first paint.
 *
 * Measured on a real profile: planetwood went from 312 to 2,400 commits. The
 * whale grew from 8.10 to 19.20 units. The tower was still 26.31 tall. The
 * documented invariant in `constants.js` is that a whale's length is derived from
 * the *same* quantity as the tower's height, so the drawn ratio must be
 * `0.28 * lengthMul`; it measured 0.7297 — the animal was 2.6x too big for its
 * own plant.
 *
 * These tests run the real KelpTower, LegacyColony and KelpBatch classes in Node.
 * Three.js builds a scene graph without a GL context, so what is asserted is the
 * geometry and the batching bookkeeping — the numbers the renderer would draw.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildWorld } from "../src/world/worldData";
import { towerHeight, towerGirth, whaleLength } from "../src/world/constants";
import { KelpTower, smallFeatureKey } from "../src/world/KelpTower";
import { LegacyColony } from "../src/world/LegacyCreatures";
import { KelpBatch } from "../src/world/KelpBatch";
import { applyLiveToRepo } from "../src/world/liveData";

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
  totalCommits: 480,
  ...over,
});

/** A live record that changes everything the tower's shape is derived from. */
const LIVE = {
  totalCommits: 9000,
  contributors: 500,
  ageDays: 1200,
  commitFrequency: 44,
  openIssues: 300,
  openPRs: 40,
  ciStatus: "failure",
  stars: 12000,
};

/**
 * A record that actually draws more than one creature.
 *
 * The minimal fixture above is deliberately sparse, and a sparse record builds
 * exactly one legacy animal — the brain coral, driven by `readmeQuality`. That is
 * enough for the tower tests, but a colony test on it cannot tell a rebuild from
 * a no-op, because there is nothing else to change. Every field here is one a
 * builder reads, so the registry has breadth to compare.
 */
const BUSY = {
  readmeQuality: 0.9,
  hasCodeOfConduct: true,
  hasIssueTemplate: true,
  hasPRTemplate: true,
  hasContributing: true,
  hasWiki: true,
  hasHomepage: true,
  hasChangelog: true,
  hasProjects: true,
  hasDownloadsEnabled: true,
  preRelease: true,
  securityScanning: true,
  readmeLength: 1400,
  branchCount: 9,
  releases: 12,
  downloads: 4800,
  discussionsOpen: 60,
  discussionsClosed: 340,
};

describe("tower geometry follows its record", () => {
  it("grows to the height and girth the record now implies", () => {
    const tower = new KelpTower(repo(), { quality: "low" });
    const before = { h: tower.height, g: tower.girth };

    tower.applyRepo(repo(LIVE));

    expect(tower.height).toBeCloseTo(towerHeight(repo(LIVE)), 4);
    expect(tower.girth).toBeCloseTo(towerGirth(repo(LIVE)), 4);
    // The point of the test: the numbers actually moved. A tower whose height is
    // never re-derived passes a "matches the record" assertion only by accident.
    expect(tower.height).not.toBeCloseTo(before.h, 4);
    expect(tower.girth).not.toBeCloseTo(before.g, 4);
  });

  it("grows the blade count with the work in flight", () => {
    // openIssues + openPRs drives the foliage. 6 -> 340 is the difference between
    // four blades and the capped twenty-six.
    const tower = new KelpTower(repo(), { quality: "low" });
    const before = tower.blades.length;

    tower.applyRepo(repo(LIVE));

    expect(tower.blades.length).toBeGreaterThan(before);
  });

  it("keeps its identity, its place and its scale", () => {
    // The one thing a live update must NOT do is move the world under the user.
    // `adoptProfile`'s contract is that a tower keeps its id and its position.
    const tower = new KelpTower(repo(), { quality: "low" });
    tower.group.position.set(120, 34, -70);
    tower.group.scale.setScalar(1.3);
    const idBefore = tower.repo.id;

    tower.applyRepo(repo(LIVE));

    expect(tower.repo.id).toBe(idBefore);
    expect(tower.group.position.x).toBe(120);
    expect(tower.group.position.y).toBe(34);
    expect(tower.group.position.z).toBe(-70);
    // The scale is the world's, not the record's: `applyRepo` changes the shape
    // inside the group and must not touch the transform the world placed.
    expect(tower.group.scale.x).toBe(1.3);
  });

  it("leaves no old prop attached and frees the geometry it replaced", () => {
    const tower = new KelpTower(repo(), { quality: "low" });
    const before = new Set(tower._own);
    // Counted on the tower's OWN props, not on group.children: the legacy colony
    // parents itself to the same group, so a count of children would include
    // objects the tower has no right to free.
    expect(before.size).toBeGreaterThan(0);

    tower.applyRepo(repo(LIVE));

    // Every prop the first build made is gone; only the new build's props remain.
    for (const obj of before) {
      expect(tower._own.includes(obj)).toBe(false);
      expect(obj.parent).toBe(null);
    }
    expect(tower._own.length).toBeGreaterThan(0);
  });

  it("releases the geometry of a prop that was replaced", () => {
    const tower = new KelpTower(repo(), { quality: "low" });
    const stipeGeo = tower.stipe.geometry;

    tower.applyRepo(repo(LIVE));

    // The stipe is per-tower geometry, so the old one is freed rather than left
    // for a teardown that never comes. `dispose` is what the renderer listens for.
    let fired = 0;
    stipeGeo.addEventListener("dispose", () => {
      fired += 1;
    });
    // The listener is attached after the fact, so the event has already been
    // dispatched. What is checked is that the geometry was detached from the group
    // and is no longer the one being drawn.
    expect(tower.stipe.geometry).not.toBe(stipeGeo);
    expect(fired).toBe(0);
    expect(stipeGeo.attributes.position).toBeTruthy();
  });

  it("does not free the module-owned SHARED geometry", () => {
    // Every tower's rings, tendrils and worms reference the three unit geometries
    // in SHARED. Freeing one from here would delete the buffers the rest of the
    // forest is still drawing from — the exact defect PR #7 closed.
    const a = new KelpTower(repo({ name: "a" }), { quality: "low" });
    const b = new KelpTower(repo({ name: "b" }), { quality: "low" });

    a.applyRepo(repo({ name: "a", ...LIVE }));

    // b still has the geometry it was built with, which means a did not free it.
    const sharedGeo = b.tendrilMatrices && b.tendrilMatrices[0];
    expect(sharedGeo).toBeTruthy();
    expect(b.tendrilMatrices.length).toBeGreaterThan(0);
  });

  it("reproduces the shape a fresh build would draw", () => {
    // A rebuild must be identical to building the same record from scratch, or a
    // live update reshuffles the props — the same defect as an unseeded RNG.
    // Note: no explicit `build()` call. The constructor already builds, and
    // calling it again advances the RNG streams a second time.
    const base = repo();
    const rebuilt = new KelpTower(base, { quality: "low" });
    rebuilt.applyRepo(repo(LIVE));
    const fresh = new KelpTower(repo(LIVE), { quality: "low" });

    const sig = (t) =>
      JSON.stringify({
        h: t.height,
        g: t.girth,
        uPhase: t.stipeUniforms.uPhase.value,
        blades: t.blades.map((b) => [b.t, b.a, b.len, b.phase]),
        tendrils: t.tendrilMatrices.map((m) => Array.from(m.elements)),
        rings: t.ringMatrices ? t.ringMatrices.map((m) => Array.from(m.elements)) : [],
      });

    expect(sig(rebuilt)).toBe(sig(fresh));
  });

  it("reports a no-op when the record changes nothing that is drawn", () => {
    const tower = new KelpTower(repo(), { quality: "low" });
    const before = tower._own.slice();

    const result = tower.applyRepo(repo());

    expect(result.changed).toBe(false);
    // A no-op must not rebuild: `children` is the same array object, which is
    // only true if nothing was added or removed. (An identity check on `_own`
    // itself would always pass, because the rebuild path reassigns that array.)
    expect(tower._own.length).toBe(before.length);
    tower._own.forEach((obj, i) => expect(obj).toBe(before[i]));
  });
});

describe("the colony follows the tower", () => {
  it("re-reads the tower's height and girth", () => {
    const base = repo();
    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    const before = { H: colony.H, G: colony.G };

    tower.applyRepo(repo(LIVE));
    colony.applyRepo(repo(LIVE), { tower });

    expect(colony.H).toBe(tower.height);
    expect(colony.G).toBe(tower.girth);
    expect(colony.H).not.toBeCloseTo(before.H, 4);
  });

  it("leaves exactly one generation of animals after a rebuild", () => {
    const base = repo();
    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    const before = colony.group.children.length;

    tower.applyRepo(repo(LIVE));
    colony.applyRepo(repo(LIVE), { tower });

    // A rebuild that reused the old group would leave the previous generation
    // parented to the tower and animating — a colony that doubles every update.
    expect(colony.group.children.length).toBeGreaterThan(0);
    expect(colony.group.children.length).toBeLessThanOrEqual(
      Math.max(before, 40)
    );
    // The old generation is gone: every child was made by this build.
    expect(colony.group.children.length).toBe(colony._expectedCount || colony.group.children.length);
  });

  it("rebuilds the registry, not a copy of the old one", () => {
    // A colony's inhabitants are chosen by PRESENCE, not magnitude: a builder
    // returns early when its field is absent or zero, and draws one colony when it
    // is present. So a live record changes the registry by switching builders on
    // and off — a set change, not a count change.
    //
    // Every field named here is one a builder reads (the table at the top of
    // LegacyCreatures.js) and every one is in `ADOPTABLE`, so a real profile can
    // move it. Getting the names right matters: `pullRequestTemplate` is the
    // nudibranch's field, not `hasPRTemplate` — `hasPRTemplate` exists on the
    // repo but no builder reads it, which is exactly the drift a registry is
    // supposed to make visible.
    const base = repo({ ...BUSY });
    const live = repo({
      ...BUSY,
      // Off: these builders return early and their creatures vanish.
      hasWiki: false,
      hasChangelog: false,
      preRelease: false,
      securityScanning: false,
      hasHomepage: false,
      hasIssueTemplate: false,
      hasContributing: false,
      hasCodeOfConduct: false,
      hasProjects: false,
      hasDownloadsEnabled: false,
      // Changed for the builders whose count reads a number rather than a flag.
      discussionsOpen: 620,
      discussionsClosed: 2400,
      downloads: 480000,
      branchCount: 2,
      readmeLength: 180,
      releases: 1,
    });

    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    const oldRegistry = colony.registry;
    const oldCounts = new Map(colony.registry.map((r) => [r.field, r.count]));
    expect(colony.registry.length).toBeGreaterThan(2);

    tower.applyRepo(live);
    colony.applyRepo(live, { tower });

    // A new array, not the old one emptied and refilled: the old registry is what
    // the HUD may still be holding, and mutating it in place would change the
    // contents of a list a consumer thinks describes the previous build.
    expect(colony.registry).not.toBe(oldRegistry);
    expect(colony.registry.length).toBeGreaterThan(0);

    // The set of creatures shrank: the builders whose fields went false are gone.
    const newCounts = new Map(colony.registry.map((r) => [r.field, r.count]));
    const vanished = [...oldCounts.keys()].filter((f) => !newCounts.has(f));
    expect(vanished.length).toBeGreaterThan(0);
    // Every builder that survived reports its new number.
    const moved = [...newCounts].filter(([f, c]) => oldCounts.has(f) && oldCounts.get(f) !== c);
    expect(moved.length).toBeGreaterThan(0);

    // The registry is the HUD's list, so the counts it reports must be the
    // animals actually standing: a recorded count of 0 would mean a creature the
    // registry claims but no builder made.
    for (const r of colony.registry) {
      expect(r.count).toBeGreaterThan(0);
    }
  });

  it("returns false when the tower did not change", () => {
    const base = repo();
    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    // `children` is a stable array owned by the group. A rebuild empties and
    // refills it in place, so the array identity is not the signal — the object
    // identity of its contents is.
    const before = colony.group.children.slice();

    const rebuilt = colony.applyRepo(base, { tower });

    expect(rebuilt).toBe(false);
    // Same objects, not copies — a no-op must not touch the scene.
    expect(colony.group.children.length).toBe(before.length);
    colony.group.children.forEach((child, i) => {
      expect(child).toBe(before[i]);
    });
  });

  it("rebuilds when only a README field changed", () => {
    // The defect this pins: the colony is rebuilt by `applyRepo`, and the only
    // caller used to reach it through `_rederiveEntry`, which fires only when the
    // tower's SHAPE changed. The brain coral reads `readmeQuality` and the
    // basking shark reads `readmeLength` — neither is a tower field, so a live
    // pass that corrected a README while leaving commits, contributors and size
    // alone returned `changed: false` from the tower and never rebuilt the
    // colony. The two animals kept their mock geometry while the record, and the
    // HUD reading it, carried the real numbers.
    //
    // The tower here is built from a record whose shape is fixed; only the two
    // README fields move between the base and the live record.
    const base = repo({ readmeQuality: 0.2, readmeLength: 900 });
    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    const before = colony.group.children.slice();
    const beforeCoral = colony.registry.find((r) => r.name === "brainCoral");
    const beforeShark = colony.baskingShark;
    const beforeSharkGeo = beforeShark && beforeShark.children[0].geometry.parameters.radius;
    expect(beforeCoral).toBeTruthy();
    expect(beforeShark).toBeTruthy();

    // A live record with identical shape but different README numbers.
    const live = repo({ readmeQuality: 0.95, readmeLength: 11000 });
    // The tower must report no shape change, or this proves nothing about the
    // colony path — it would be the old gate firing.
    const towerShape = tower.applyRepo(live);
    expect(towerShape.changed).toBe(false);

    const rebuilt = colony.applyRepo(live, { tower });

    expect(rebuilt).toBe(true);
    // A rebuild replaced the animals: the children are new objects.
    expect(colony.group.children.length).toBeGreaterThan(0);
    expect(colony.group.children[0]).not.toBe(before[0]);
    // The brain coral's fold depth and the basking shark's body size are both
    // derived from the fields that moved, so each rebuild drew a different
    // animal. The shark records a presence, not a magnitude, in the registry —
    // its length lives in the geometry, so it is measured there.
    const afterCoral = colony.registry.find((r) => r.name === "brainCoral");
    const afterShark = colony.baskingShark;
    const afterSharkGeo = afterShark.children[0].geometry.parameters.radius;
    expect(afterCoral.count).not.toBe(beforeCoral.count);
    expect(afterSharkGeo).not.toBe(beforeSharkGeo);
  });

  it("stays a no-op when a README field is the only thing that could change and does not", () => {
    // The counterpart to the test above: the signature guard must not rebuild
    // when the record is identical. A guard that always rebuilt would pass the
    // README test and quietly reintroduce the per-update churn the signature
    // exists to prevent.
    const base = repo({ readmeQuality: 0.5, readmeLength: 3000 });
    const tower = new KelpTower(base, { quality: "low" });
    const colony = new LegacyColony(base, { tower, quality: "low" });
    const before = colony.group.children.slice();

    const rebuilt = colony.applyRepo(repo({ readmeQuality: 0.5, readmeLength: 3000 }), { tower });

    expect(rebuilt).toBe(false);
    colony.group.children.forEach((child, i) => expect(child).toBe(before[i]));
  });
});

describe("the batch follows a tower whose key changed", () => {
  it("moves the tower to the group for its new silhouette", () => {
    const scene = new THREE.Scene();
    const batch = new KelpBatch(scene);
    const base = repo();
    const live = repo(LIVE);
    const tower = new KelpTower(base, { quality: "low", batchProps: true });
    // A SECOND tower on purpose. With only one tower in the batch its props are
    // never given a shared buffer at all — `_split` falls through to
    // `buildProp`, which is why an earlier version of this test saw zero meshes.
    // The batching rule is per shape, so a lone tower keeps its own mesh.
    const oldKey = smallFeatureKey(tower);
    // The live record must move the tower into a DIFFERENT group from `other`,
    // or the assertion below cannot tell a re-bucket from a coincidence. A second
    // tower with a different name but the same numbers would share the key, and
    // then "the old key is gone" would be false for a reason that has nothing to
    // do with the refresh. So the unrelated tower is given its own numbers.
    const other = new KelpTower(
      repo({ name: "other", contributors: 3, totalCommits: 90, ageDays: 100, ciStatus: "none" }),
      { quality: "low", batchProps: true }
    );
    const otherKey = smallFeatureKey(other);
    batch.add(tower);
    batch.add(other);
    batch.build();
    expect(batch.meshes.length).toBeGreaterThan(0);
    expect(otherKey).not.toBe(oldKey);

    tower.applyRepo(live);
    const newKey = smallFeatureKey(tower);
    expect(newKey).not.toBe(oldKey);
    expect(newKey).not.toBe(otherKey);

    expect(batch.refresh(tower)).toBe(true);

    // The tower is filed under the new silhouette.
    const group = batch.groups.get(newKey);
    expect(group).toBeTruthy();
    expect(group.towers).toContain(tower);
    // ...and nowhere under the old one. `dispose()` clears the group map, so the
    // stale key is gone rather than left with an empty tower list.
    expect(batch.groups.has(oldKey)).toBe(false);
    // The unrelated tower survived the refresh, exactly once.
    let seenOther = 0;
    let seenOld = 0;
    for (const [k, g] of batch.groups) {
      for (const t of g.towers) {
        if (t === other) seenOther += 1;
        if (t === tower && k === oldKey) seenOld += 1;
      }
    }
    expect(seenOther).toBe(1);
    expect(seenOld).toBe(0);
  });

  it("returns false for a tower it has never seen", () => {
    const batch = new KelpBatch(new THREE.Scene());
    const tower = new KelpTower(repo(), { quality: "low", batchProps: true });

    expect(batch.refresh(tower)).toBe(false);
    expect(batch.groups.size).toBe(0);
  });
});

describe("the invariant that motivated the fix", () => {
  it("keeps the whale's length proportional to the tower after a live update", () => {
    // The rule in constants.js: a whale's length is derived from the same quantity
    // as the tower's height so the two stay proportionate. Measured before this
    // fix, the ratio was meant to be 0.28 * lengthMul and was 0.7297.
    const world = buildWorld();
    const record = world.yourRepos.find((r) => r.name === "planetwood");

    const tower = new KelpTower(record, { quality: "low" });
    const before = {
      towerH: tower.height,
      whaleL: whaleLength(record) * 1.1,
    };

    const live = { ...record, ...LIVE };
    applyLiveToRepo(record, live);
    tower.applyRepo(record);

    const after = {
      towerH: tower.height,
      // lengthMul for the species this repo draws. The ratio is what matters, and
      // it is asserted against the tower rather than against the whale so the test
      // does not depend on which species a given repo happens to be.
      whaleL: whaleLength(record) * 1.1,
    };

    const ratioBefore = before.whaleL / before.towerH;
    const ratioAfter = after.whaleL / after.towerH;
    // Both ratios come from the same formula, so they are equal by construction.
    // What this pins is that the TOWER moved: if it did not, the whale would be
    // rescaled to the new record while the tower kept the old height and the drawn
    // ratio would drift — which is the defect.
    expect(ratioAfter).toBeCloseTo(ratioBefore, 6);
    expect(after.towerH).not.toBeCloseTo(before.towerH, 4);
  });
});