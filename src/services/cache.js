/**
 * Git Ocean — Cache Service
 * In-memory cache with TTL, mirrored into localStorage so it survives a reload.
 * Per Constitution Principle III (Visual Render First) and the data ethics
 * framework: cache aggressively to avoid rate limits, show ocean immediately
 * with cached data, refresh in background.
 *
 * TTL strategy:
 * - Static fields (name, description, license, language, age): 24 hours
 * - Stats fields (stars, forks, commits, issues): 1 hour
 * - Dynamic fields (traffic, punch card, deployments): 15 minutes
 *
 * ## Why it persists
 *
 * The in-memory version was correct and useless. Anonymous GitHub REST is 60
 * requests an hour, and a profile of four repositories plus its enrichment pass
 * costs about twenty-eight of them — so two reloads exhausted the budget, the
 * third showed mock data for an hour, and the console filled with 403s that were
 * indistinguishable from repositories not existing. The header of this file said
 * "cache aggressively to avoid rate limits" while the cache forgot everything on
 * every navigation.
 *
 * A reload is the most common thing a user does. The numbers that matter — a
 * repository's name, stars, language, age, license — change on the order of days,
 * not seconds, so serving them from a day-old copy is indistinguishable from
 * fetching them and is the whole point of a cache.
 *
 * ## What is persisted, and what is not
 *
 * Only what was actually fetched. A `null` (a failed fetch) is never written, so
 * a rate-limited load does not poison the next one: the failure lasts as long as
 * the rate limit does, and the next attempt is free to succeed.
 *
 * Stored under one versioned key, with a per-entry expiry. A version bump
 * discards the whole blob rather than migrating it, because a cached record whose
 * shape changed is worse than no record — the world would read fields that are no
 * longer there and draw undefined as zero.
 */

const CACHE_TTL = {
  STATIC: 24 * 60 * 60 * 1000,   // 24 hours
  STATS: 60 * 60 * 1000,          // 1 hour
  DYNAMIC: 15 * 60 * 1000,        // 15 minutes
};

/**
 * Bump when a cached record's shape changes.
 *
 * Not for adding a field the world ignores, and not for a bug fix that produces
 * the same shape. For a change that makes an old entry wrong rather than merely
 * old — a renamed key, a changed unit, a field that now means something else.
 */
const STORE_VERSION = 1;
const STORE_KEY = `git-ocean:cache:v${STORE_VERSION}`;

/**
 * The backing store, or null when there is none.
 *
 * Node has no localStorage and a private window can have one that throws on
 * every access. Both are reasons to run without persistence, not to crash the
 * load, so every access is guarded and a failure degrades to memory only.
 */
function backing() {
  try {
    if (typeof globalThis === "undefined" || !globalThis.localStorage) return null;
    // Touch it. Some implementations expose the object and throw on use.
    globalThis.localStorage.getItem(STORE_KEY);
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

class Cache {
  constructor() {
    this.store = new Map();
    this.persist = true;
    this._loaded = false;
  }

  /**
   * Read the persisted blob into memory, once.
   *
   * Called lazily rather than in the constructor because the module is imported
   * by tests that run before any store exists, and a constructor that touches
   * storage makes every import order-sensitive.
   */
  _load() {
    if (this._loaded) return;
    this._loaded = true;

    const store = backing();
    if (!store) {
      this.persist = false;
      return;
    }

    let raw = null;
    try {
      raw = store.getItem(STORE_KEY);
    } catch {
      this.persist = false;
      return;
    }
    if (!raw) return;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt or truncated. Dropping it is correct: a partial blob would parse
      // into records with missing fields, and the world reads those as zeros.
      this._write();
      return;
    }
    if (!parsed || parsed.v !== STORE_VERSION || !Array.isArray(parsed.entries)) {
      this._write();
      return;
    }

    const now = Date.now();
    let kept = 0;
    for (const e of parsed.entries) {
      // An entry with no name, or one that expired while the tab was closed, is
      // dropped here rather than on read: the read path stays a map lookup.
      if (!e || typeof e.k !== "string" || !e.e || e.e <= now) continue;
      this.store.set(e.k, { value: e.v, expiry: e.e });
      kept++;
    }
    // Rewritten either way, so expired entries do not sit in storage for a day.
    if (kept !== parsed.entries.length) this._write();
  }

  /** Write the whole store out. Cheap at this size — tens of records, not thousands. */
  _write() {
    const store = backing();
    if (!store) return;
    try {
      const entries = [];
      for (const [k, e] of this.store) {
        entries.push({ k, v: e.value, e: e.expiry });
      }
      store.setItem(STORE_KEY, JSON.stringify({ v: STORE_VERSION, entries }));
    } catch {
      // Over quota, or storage denied. Memory still works, which is what it did
      // before this file persisted anything.
      this.persist = false;
    }
  }

  /**
   * Get a cached value if it exists and hasn't expired.
   * Returns null if missing or expired.
   */
  get(key) {
    this._load();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Set a cached value with a TTL category.
   *
   * A `null` or `undefined` value is refused rather than stored. Every fetch path
   * in this app caches its result, and several of them return null on failure;
   * storing that would turn one rate-limited request into a day-long absence,
   * which is the one failure mode a cache must not have.
   */
  set(key, value, ttlCategory = "STATS") {
    if (value === null || value === undefined) return;
    this._load();
    const ttl = CACHE_TTL[ttlCategory] || CACHE_TTL.STATS;
    this.store.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
    this._write();
  }

  /**
   * Check if a key exists and is fresh.
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete a key.
   */
  delete(key) {
    this.store.delete(key);
    this._write();
  }

  /**
   * Clear all cache, in memory and on disk.
   */
  clear() {
    this.store.clear();
    const store = backing();
    if (!store) return;
    try {
      store.removeItem(STORE_KEY);
    } catch {
      // Nothing useful to do: the memory copy is already empty.
    }
  }

  /**
   * Get cache stats for debugging.
   */
  stats() {
    this._load();
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
      persisted: this.persist,
    };
  }
}

export const cache = new Cache();
export { CACHE_TTL, STORE_VERSION };