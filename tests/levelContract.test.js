import { describe, it, expect, afterEach } from "vitest";
import { LEVEL_ALIASES, resolveLevelId, startupLevelId } from "../src/App";
import { ZOOM_LEVELS } from "../src/world/constants";

/**
 * `?level=` is a published contract, not an internal detail.
 *
 * It is documented in the README and it is what every shared link and screenshot
 * command carries. When the world collapsed from five zoom levels to three
 * (`world`/`country`/`city`/`tower`/`whale` → `deep`/`tower`/`whale`) three
 * things broke silently and none of them threw:
 *
 *   1. `?level=city` — and `world`, and `country` — resolved to nothing.
 *   2. The fallback was the literal string `"city"`, which no longer existed, so
 *      an unmatched query produced a level id that was not in the list.
 *   3. The depth seed read `ZOOM_LEVELS[2]`, which was `city` and became `whale`
 *      — so every visitor's first frame changed from a district to one animal,
 *      chosen by nobody.
 *
 * These tests pin the contract and the two defaults.
 */
const withQuery = (search) => {
  const real = globalThis.window;
  globalThis.window = { location: { search } };
  return () => {
    globalThis.window = real;
  };
};

let restore = null;
afterEach(() => {
  if (restore) restore();
  restore = null;
});

describe("?level= contract", () => {
  it("accepts every current level id", () => {
    for (const level of ZOOM_LEVELS) {
      expect(resolveLevelId(level.id)).toBe(level.id);
    }
  });

  it("still accepts the ids that were retired, rather than dropping them", () => {
    // A shared link from before the rename must land somewhere sensible.
    for (const old of Object.keys(LEVEL_ALIASES)) {
      const resolved = resolveLevelId(old);
      expect(resolved).toBeTruthy();
      expect(ZOOM_LEVELS.some((l) => l.id === resolved)).toBe(true);
    }
  });

  it("maps each retired id to a level that exists", () => {
    expect(resolveLevelId("world")).toBe("deep");
    expect(resolveLevelId("country")).toBe("deep");
    expect(resolveLevelId("city")).toBe("tower");
  });

  it("returns null for a level that does not exist, so the caller decides", () => {
    expect(resolveLevelId("nowhere")).toBeNull();
    expect(resolveLevelId("")).toBeNull();
    expect(resolveLevelId(null)).toBeNull();
  });
});

describe("startup level", () => {
  it("opens on the default when no ?level is given", () => {
    restore = withQuery("");
    expect(startupLevelId()).toBe("tower");
  });

  it("does not silently open on the whale when the default is unset", () => {
    // The old depth seed indexed `ZOOM_LEVELS[2]`; with three levels that is
    // `whale`, which turned every first frame into a single animal close-up.
    restore = withQuery("");
    expect(startupLevelId()).not.toBe("whale");
  });

  it("honours an explicit ?level", () => {
    restore = withQuery("?level=deep");
    expect(startupLevelId()).toBe("deep");
    restore();
    restore = null;

    restore = withQuery("?level=whale");
    expect(startupLevelId()).toBe("whale");
  });

  it("routes a retired ?level id to its replacement", () => {
    restore = withQuery("?level=city");
    expect(startupLevelId()).toBe("tower");
  });

  it("always returns an id that exists in the level list", () => {
    for (const q of ["", "?level=deep", "?level=city", "?level=nonsense"]) {
      restore = withQuery(q);
      const id = startupLevelId();
      expect(ZOOM_LEVELS.some((l) => l.id === id)).toBe(true);
      restore();
      restore = null;
    }
  });
});
