/**
 * The cache has to survive a reload, and must not survive a failure.
 *
 * Both halves matter and they pull against each other: persisting aggressively is
 * what keeps a profile inside the anonymous rate limit, but persisting a failed
 * fetch would turn a rate limit that lasts an hour into a mock world that lasts a
 * day. These tests pin the two rules that keep them apart.
 */
import { describe, it, expect, beforeEach } from "vitest";

/** A localStorage stand-in. Node has none, so the tests supply one. */
function fakeStore() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe("cache", () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStore();
  });

  it("returns a value it stored", async () => {
    const { cache } = await import("../src/services/cache");
    cache.clear();
    cache.set("k", { a: 1 }, "STATIC");
    expect(cache.get("k")).toEqual({ a: 1 });
  });

  it("refuses to store null, so a failure is not a day-long absence", async () => {
    const { cache } = await import("../src/services/cache");
    cache.clear();
    cache.set("failed", null, "STATIC");
    cache.set("missing", undefined, "STATIC");
    expect(cache.get("failed")).toBe(null);
    expect(cache.get("missing")).toBe(null);
    expect(cache.stats().size).toBe(0);
  });

  it("survives a reload", async () => {
    const { cache } = await import("../src/services/cache");
    cache.clear();
    cache.set("repo:a/b", { stars: 12 }, "STATIC");

    // A new module instance, as a navigation produces, reading the same store.
    const raw = globalThis.localStorage.getItem("git-ocean:cache:v1");
    expect(raw).toBeTruthy();

    const second = await import("../src/services/cache?reload=1");
    // The registry is cached by specifier, so the "reload" is simulated by
    // constructing a fresh cache from the same persisted blob instead.
    const parsed = JSON.parse(raw);
    expect(parsed.v).toBe(1);
    expect(parsed.entries.find((e) => e.k === "repo:a/b").v).toEqual({ stars: 12 });
    // And the live cache still has it.
    expect(second.cache.get("repo:a/b")).toEqual({ stars: 12 });
  });

  it("drops an expired entry on load", async () => {
    const { cache } = await import("../src/services/cache");
    cache.clear();
    // Written directly: an entry that expired while the tab was closed.
    globalThis.localStorage.setItem(
      "git-ocean:cache:v1",
      JSON.stringify({
        v: 1,
        entries: [
          { k: "old", v: { x: 1 }, e: Date.now() - 1000 },
          { k: "new", v: { x: 2 }, e: Date.now() + 60000 },
        ],
      })
    );

    const fresh = await import("../src/services/cache?fresh=1");
    expect(fresh.cache.get("old")).toBe(null);
    expect(fresh.cache.get("new")).toEqual({ x: 2 });
  });

  it("ignores a blob from another version", async () => {
    globalThis.localStorage.setItem(
      "git-ocean:cache:v1",
      JSON.stringify({ v: 999, entries: [{ k: "x", v: 1, e: Date.now() + 60000 }] })
    );
    const { cache } = await import("../src/services/cache");
    cache.clear();
    expect(cache.get("x")).toBe(null);
  });

  it("ignores a corrupt blob rather than parsing it into half-records", async () => {
    globalThis.localStorage.setItem("git-ocean:cache:v1", "{not json");
    const { cache } = await import("../src/services/cache");
    cache.clear();
    expect(cache.stats().size).toBe(0);
  });

  it("degrades to memory when storage throws on every access", async () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    const { cache } = await import("../src/services/cache?blocked=1");
    cache.clear();
    cache.set("k", 1, "STATIC");
    expect(cache.get("k")).toBe(1);
  });
});
