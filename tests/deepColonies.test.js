import { describe, it, expect } from "vitest";
import {
  buildWorld,
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
});
