import { describe, it, expect } from "vitest";
import {
  ADOPTABLE,
  applyLiveToRepo,
  toHudRepo,
  indexMockRepos,
  adoptIntoWorld,
  placementFor,
  worldRecordFromLive,
} from "../src/world/liveData";
import { makeRepo } from "../src/world/worldData";

/** A standing mock tower, as the scene would have built it. */
function tower(over = {}) {
  return makeRepo(
    Object.assign(
      {
        owner: "anubhavaanand",
        name: "planetwood",
        description: "A mock description.",
        language: "TypeScript",
        stars: 12,
        codebaseSize: 5000,
        ageDays: 400,
      },
      over
    )
  );
}

describe("applyLiveToRepo", () => {
  it("copies the fields a live record actually supplies", () => {
    const repo = tower();
    applyLiveToRepo(repo, { stars: 900, codebaseSize: 153387 });
    expect(repo.stars).toBe(900);
    expect(repo.codebaseSize).toBe(153387);
  });

  it("leaves a field the live record does not mention alone", () => {
    const repo = tower({ language: "Rust" });
    // `undefined` must not blank a value: a partial enrichment that failed
    // halfway would otherwise erase the language and the tower would recolour.
    applyLiveToRepo(repo, { stars: 5, language: undefined });
    expect(repo.language).toBe("Rust");
  });

  it("does not move the tower", () => {
    // `id` is the pick key and `position` is where the whale orbits. Neither is
    // in ADOPTABLE, so a live record cannot rename or relocate a standing tower.
    const repo = tower();
    const before = { id: repo.id, position: repo.position, depth: repo.depth };
    applyLiveToRepo(repo, { id: "anubhavaanand/other", position: [9, 9], depth: -1 });
    expect(repo.id).toBe(before.id);
    expect(repo.position).toBe(before.position);
    expect(repo.depth).toBe(before.depth);
  });

  it("returns the same object it was given, mutated", () => {
    // The towers, whales and colonies hold a reference to the repo object. A
    // copy would leave every one of them reading the old numbers.
    const repo = tower();
    expect(applyLiveToRepo(repo, { stars: 3 })).toBe(repo);
  });

  it("merges meta rather than replacing it", () => {
    const repo = tower();
    repo.meta = { readmeSource: "inferred" };
    applyLiveToRepo(repo, { stars: 1, meta: { fromApi: true } });
    expect(repo.meta.readmeSource).toBe("inferred");
    expect(repo.meta.fromApi).toBe(true);
  });
});

describe("toHudRepo", () => {
  it("returns a new reference, so React can see the change", () => {
    const repo = tower();
    const copy = toHudRepo(repo);
    expect(copy).not.toBe(repo);
    expect(copy.name).toBe(repo.name);
  });

  it("copies meta too, so a caller cannot mutate the scene's record", () => {
    const repo = tower();
    repo.meta = { a: 1 };
    const copy = toHudRepo(repo);
    copy.meta.a = 2;
    expect(repo.meta.a).toBe(1);
  });

  it("carries the __creature key a click attached", () => {
    const repo = tower();
    repo.__creature = "brainCoral";
    expect(toHudRepo(repo).__creature).toBe("brainCoral");
  });

  it("tolerates null", () => {
    expect(toHudRepo(null)).toBe(null);
  });
});

describe("indexMockRepos", () => {
  it("keys by owner and name, not by array order", () => {
    const index = indexMockRepos({
      yourRepos: [tower({ name: "a" }), tower({ name: "b" })],
      following: [tower({ owner: "yyx990803", name: "vue" })],
    });
    expect(index.get("anubhavaanand/a")).toBeTruthy();
    expect(index.get("yyx990803/vue")).toBeTruthy();
    expect(index.size).toBe(3);
  });

  it("tolerates an empty world", () => {
    expect(indexMockRepos({}).size).toBe(0);
    expect(indexMockRepos(null).size).toBe(0);
  });
});

describe("adoptIntoWorld", () => {
  it("updates the tower a live record names", () => {
    const data = { yourRepos: [tower({ name: "a" })], following: [] };
    const result = adoptIntoWorld(data, [
      { owner: "anubhavaanand", name: "a", stars: 77 },
    ]);
    expect(result.updated).toEqual(["anubhavaanand/a"]);
    expect(data.yourRepos[0].stars).toBe(77);
  });

  it("reports a live record that has no tower, rather than dropping it", () => {
    // The API knows a repository the mock world does not draw. That is a real
    // difference between the two, and a user should see it.
    const data = { yourRepos: [], following: [] };
    const result = adoptIntoWorld(data, [
      { owner: "anubhavaanand", name: "ghost", stars: 1 },
    ]);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual(["anubhavaanand/ghost"]);
  });

  it("handles an empty profile", () => {
    const data = { yourRepos: [tower()], following: [] };
    expect(adoptIntoWorld(data, []).updated).toEqual([]);
    expect(adoptIntoWorld(data, null).updated).toEqual([]);
  });
});

describe("placementFor", () => {
  it("places a new repository inside the district band", () => {
    const [x, z] = placementFor({ language: "TypeScript" }, () => 0.5, null, 5);
    const r = Math.hypot(x, z);
    // The ambient districts run from 90 to 280 units out; a new tower must land
    // in the same band or it sits in empty water.
    expect(r).toBeGreaterThanOrEqual(89);
    expect(r).toBeLessThanOrEqual(281);
  });

  it("is reproducible for the same repository", () => {
    const a = placementFor({ language: "Go" }, () => 0.5, null, 5);
    const b = placementFor({ language: "Go" }, () => 0.5, null, 5);
    expect(a).toEqual(b);
  });

  it("gives the dominant language the first sector", () => {
    const cluster = { dominantLanguage: "Python" };
    const [x] = placementFor({ language: "Python" }, () => 0.5, cluster, 5);
    // Sector 0 starts at angle -0.21 rad and the radius is positive, so x is
    // positive and z is slightly negative.
    expect(x).toBeGreaterThan(0);
  });

  it("does not throw without a cluster", () => {
    expect(() => placementFor({ language: "Ruby" }, () => 0.3, null)).not.toThrow();
  });
});

describe("worldRecordFromLive", () => {
  it("builds a record through the same constructor the scene uses", () => {
    const record = worldRecordFromLive({
      id: "anubhavaanand/newthing",
      name: "newthing",
      owner: "anubhavaanand",
      language: "Rust",
      codebaseSize: 4200,
    });
    // Every creature default is filled by makeRepo, so a creature that depends
    // on a field the live record never mentioned is absent rather than undefined.
    expect(record.readmeQuality).toBeTypeOf("number");
    expect(record.hasWiki).toBeTypeOf("boolean");
    expect(record.whaleSpecies).toBeTruthy();
  });

  it("keeps the id the first pass assigned", () => {
    const record = worldRecordFromLive({
      id: "anubhavaanand/newthing",
      name: "newthing",
      owner: "anubhavaanand",
    });
    expect(record.id).toBe("anubhavaanand/newthing");
  });

  it("returns null for nothing", () => {
    expect(worldRecordFromLive(null)).toBe(null);
  });
});

describe("ADOPTABLE", () => {
  it("never names an identity or geometry field", () => {
    // Anything here is copied straight onto a standing tower. An identity field
    // would change what a click refers to; a position field would move the tower
    // while the user is looking at it.
    for (const forbidden of ["id", "owner", "position", "depth", "name"]) {
      expect(ADOPTABLE).not.toContain(forbidden);
    }
  });
});
