/**
 * Git Ocean — Cache Service
 * Simple in-memory cache with TTL for GitHub API responses.
 * Per Constitution Principle III (Visual Render First) and the data ethics
 * framework: cache aggressively to avoid rate limits, show ocean immediately
 * with cached data, refresh in background.
 *
 * TTL strategy:
 * - Static fields (name, description, license, language, age): 24 hours
 * - Stats fields (stars, forks, commits, issues): 1 hour
 * - Dynamic fields (traffic, punch card, deployments): 15 minutes
 */

const CACHE_TTL = {
  STATIC: 24 * 60 * 60 * 1000,   // 24 hours
  STATS: 60 * 60 * 1000,          // 1 hour
  DYNAMIC: 15 * 60 * 1000,        // 15 minutes
};

class Cache {
  constructor() {
    this.store = new Map();
  }

  /**
   * Get a cached value if it exists and hasn't expired.
   * Returns null if missing or expired.
   */
  get(key) {
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
   */
  set(key, value, ttlCategory = "STATS") {
    const ttl = CACHE_TTL[ttlCategory] || CACHE_TTL.STATS;
    this.store.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
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
  }

  /**
   * Clear all cache.
   */
  clear() {
    this.store.clear();
  }

  /**
   * Get cache stats for debugging.
   */
  stats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}

export const cache = new Cache();
