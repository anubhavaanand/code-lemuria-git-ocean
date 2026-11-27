import { describe, it, expect } from "vitest";
import {
  buildWorld,
  colonyCensus,
  colonyZ,
  generateColonyTowers,
  LANGUAGE_COLONIES,
  STATION_RING_RADIUS,
} from "../src/world/worldData";

/**
 * The deep ocean language colonies are the world's fourth region.
 *
 * `buildWorld()` has produced `data.colonies` (eight languages, five towers
 * each) since the first pass and nothing ever read it — the towers existed in
 * the data and were invisible in the scene. These tests pin the two things that
 * were actually wrong: the colonies were never placed in a renderable position,
 * and a two-way depth split would have flattened all eight into one slab.
 */
describe("deep ocean colonies", () => {
  it("gives every language a colony with towers", () => {
    const world = buildWorld();
    expect(world.colonies).toHaveLength(LANGUAGE_COLONIES.length);
    for (const colony of world.colonies) {
      expect(colony.language).toBeTruthy();
      expect(colony.towers.length).toBe(5);
      expect(colony.style.colony).toBeTruthy();
    }
  });

  it("places every colony tower at a real depth-derived position", () => {
    const world = buildWorld();
    for (const colony of world.colonies) {
      for (const tower of colony.towers) {
        const [x, z] = tower.position;
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(z)).toBe(true);
        // NaN here is the failure mode that makes a tower invisible without
        // throwing — nothing renders a mesh at an unset coordinate.
        expect(Number.isNaN(z)).toBe(false);
      }
    }
  });

  it("orders colonies by depth, deeper further back", () => {
    // The rule the colony data already stated: deeper is further from camera.
    const shallow = colonyZ(-2200);
    const deep = colonyZ(-5200);
    expect(deep).toBeLessThan(shallow);
    // Monotonic between them, not just at the ends.
    expect(colonyZ(-3000)).toBeLessThan(colonyZ(-2500));
    expect(colonyZ(-4500)).toBeLessThan(colonyZ(-3000));
  });

  it("clamps a depth outside the real range instead of extrapolating", () => {
    expect(colonyZ(-100)).toBeCloseTo(colonyZ(-2200), 6);
    expect(colonyZ(-99999)).toBeCloseTo(colonyZ(-5200), 6);
  });

  it("keeps the eight colonies in separate depth bands, not one slab", () => {
    // The defect a two-way depth split would have produced: every colony in the
    // same band because they all read deeper than -1000.
    const zs = LANGUAGE_COLONIES.map((c) => colonyZ(c.depth));
    const spread = Math.max(...zs) - Math.min(...zs);
    expect(spread).toBeGreaterThan(300);
    // And at least five distinct values, so it is a gradient and not two piles.
    expect(new Set(zs.map((z) => Math.round(z))).size).toBeGreaterThan(4);
  });

  it("keeps colonies outside the city ring", () => {
    // A colony that lands inside a community with a station contradicts both
    // the "unlocated users are elsewhere" rule and the station lattice.
    for (const colony of LANGUAGE_COLONIES) {
      const z = colonyZ(colony.depth);
      expect(z).toBeLessThan(-(STATION_RING_RADIUS - 300) - 10);
    }
  });

  it("is deterministic across loads", () => {
    const a = generateColonyTowers(LANGUAGE_COLONIES[0], 5);
    const b = generateColonyTowers(LANGUAGE_COLONIES[0], 5);
    expect(a.map((t) => t.position)).toEqual(b.map((t) => t.position));
    expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
  });

  it("keeps each colony's towers speaking that language", () => {
    const world = buildWorld();
    for (const colony of world.colonies) {
      for (const tower of colony.towers) {
        expect(tower.language).toBe(colony.language);
      }
    }
  });

  it("census keys by language, not by the colony object", () => {
    // The scene stores the whole colony record on each entry, so a reducer that
    // keyed on `c.colony` produced one bucket called "[object Object]" holding
    // all forty towers: the census reported one language and could not show
    // whether the other seven had built at all.
    const world = buildWorld();
    const entries = world.colonies.flatMap((colony) =>
      colony.towers.map((tower) => ({ colony, tower: { group: { position: { z: -1500 } } } }))
    );
    const census = colonyCensus(entries);

    expect(Object.keys(census)).not.toContain("[object Object]");
    expect(Object.keys(census)).toHaveLength(LANGUAGE_COLONIES.length);
    for (const colony of world.colonies) {
      expect(census[colony.language]).toBeTruthy();
      expect(census[colony.language].towers).toBe(colony.towers.length);
    }
    // Every tower is counted exactly once, so no bucket swallowed the rest.
    const total = Object.values(census).reduce((n, e) => n + e.towers, 0);
    expect(total).toBe(entries.length);
  });

  it("census ignores an entry with no colony and rounds z", () => {
    const census = colonyCensus([
      { colony: { language: "Rust" }, tower: { group: { position: { z: -1234.56 } } } },
      { colony: null, tower: { group: { position: { z: -1 } } } },
    ]);
    expect(Object.keys(census)).toEqual(["Rust"]);
    expect(census.Rust.z).toEqual([-1235]);
  });
});
