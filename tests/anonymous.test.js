/**
 * The anonymous path.
 *
 * Anonymous GitHub GraphQL is limited to **0 points an hour**. Every unauthenticated
 * GraphQL query therefore returns 403 and, before this was fixed, `fetchRepositories`
 * turned all four of them into `null` — the world silently stayed on mock data with
 * nothing in the console but four identical rate-limit errors. These tests pin the
 * two things that have to stay true for the fix to keep working:
 *
 *   1. an unauthenticated load goes to REST, not GraphQL;
 *   2. a REST record carries the fields the world actually reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __clearCacheForTests } from "../src/services/profile";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A plausible `GET /repos/{owner}/{repo}` body. */
const repoBody = (over = {}) => ({
  name: "planetwood",
  full_name: "anubhavaanand/planetwood",
  description: "A wood-wide web.",
  html_url: "https://github.com/anubhavaanand/planetwood",
  private: false,
  archived: false,
  fork: false,
  is_template: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  pushed_at: "2026-10-01T00:00:00Z",
  size: 153387,
  homepage: "https://planetwood.dev",
  language: "TypeScript",
  stargazers_count: 128,
  watchers_count: 7,
  forks_count: 21,
  open_issues_count: 9,
  subscribers_count: 6,
  license: { spdx_id: "MIT", key: "mit" },
  topics: ["gamedev", "threejs"],
  has_wiki: true,
  has_pages: true,
  has_projects: true,
  has_issues: true,
  has_discussions: false,
  has_downloads: false,
  default_branch: "main",
  ...over,
});

describe("anonymous repository loading", () => {
  beforeEach(() => {
    // A fresh module registry per test. `cache` is a module-level singleton, so
    // without this the second test reads the first test's cached record and
    // every assertion fails against a number the current fixture never supplied
    // — which looks like a defect in the code rather than in the setup.
    vi.resetModules();
    // The cache lives in its own module. It has to be cleared even after a
    // registry reset, because `repoEnrich` holds a reference to the singleton it
    // imported and a reset gives the test a *different* singleton while the
    // module under test keeps writing to the old one.
    __clearCacheForTests();
    // No token, by construction: the tests run in Node, so `localStorage` does
    // not exist at all and `isAuthenticated()` is false before anything is
    // stubbed. Installed anyway as an empty store so a future change that adds a
    // default token cannot silently move these onto the GraphQL path.
    globalThis.localStorage = {
      store: {},
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
      },
      setItem(k, v) {
        this.store[k] = String(v);
      },
      removeItem(k) {
        delete this.store[k];
      },
      clear() {
        this.store = {};
      },
    };
    vi.restoreAllMocks();
  });

  it("uses REST when there is no token", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/repos/anubhavaanand/planetwood")) {
        return json(repoBody());
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchRepositoryRest } = await import("../src/services/github-api");
    const record = await fetchRepositoryRest("anubhavaanand", "planetwood");

    expect(record).toBeTruthy();
    // One request, to REST — not to /graphql.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/repos/anubhavaanand/planetwood");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("graphql");
  });

  it("carries the fields the world reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(repoBody()))
    );
    const { fetchRepositoryRest } = await import("../src/services/github-api");
    const record = await fetchRepositoryRest("anubhavaanand", "planetwood");

    expect(record.name).toBe("planetwood");
    expect(record.stars).toBe(128);
    expect(record.forks).toBe(21);
    expect(record.codebaseSize).toBe(153387);
    expect(record.language).toBe("TypeScript");
    expect(record.license).toBe("MIT");
    expect(record.owner).toBe("anubhavaanand");
    // REST is authoritative for these two; GraphQL cannot express them at all.
    expect(record.hasPages).toBe(true);
    expect(record.hasDownloadsEnabled).toBe(false);
  });

  it("does not invent an issue split REST cannot provide", async () => {
    // `open_issues_count` includes pull requests, so it cannot be split into
    // open/closed issues. Both stay zero rather than one of them guessing.
    vi.stubGlobal("fetch", vi.fn(async () => json(repoBody())));
    const { fetchRepositoryRest } = await import("../src/services/github-api");
    const record = await fetchRepositoryRest("anubhavaanand", "planetwood");

    expect(record.closedIssues).toBe(0);
    expect(record.openPRs).toBe(0);
  });

  it("returns null for a missing repository rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "Not Found" }, 404))
    );
    const { fetchRepositoryRest } = await import("../src/services/github-api");
    await expect(
      fetchRepositoryRest("anubhavaanand", "ghost")
    ).resolves.toBe(null);
  });

  it("returns null on a rate limit, so one repo does not sink the profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ message: "API rate limit exceeded for 1.2.3.4." }, 403)
      )
    );
    const { fetchRepositoryRest } = await import("../src/services/github-api");
    await expect(
      fetchRepositoryRest("anubhavaanand", "planetwood")
    ).resolves.toBe(null);
  });
});

describe("the settings body is not fetched twice", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage = {
      store: {},
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
      },
      setItem(k, v) {
        this.store[k] = v;
      },
      removeItem(k) {
        delete this.store[k];
      },
      clear() {
        this.store = {};
      },
    };
  });

  it("the enrichment reuses the first pass's copy of the repository body", async () => {
    const paths = [];
    globalThis.fetch = vi.fn(async (url) => {
      paths.push(String(url));
      const body = {
        name: "planetwood",
        full_name: "anubhavaanand/planetwood",
        private: false,
        fork: false,
        archived: false,
        size: 153387,
        stargazers_count: 3,
        watchers_count: 3,
        forks_count: 1,
        open_issues_count: 2,
        default_branch: "main",
        language: "HTML",
        license: { key: "mit" },
        has_wiki: true,
        has_pages: false,
        has_downloads: true,
        has_issues: true,
        has_projects: true,
      };
      return {
        ok: true,
        status: 200,
        clone() {
          return this;
        },
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: { get: () => null },
      };
    });

    const { loadProfile, __clearCacheForTests } = await import("../src/services/profile");
    __clearCacheForTests();
    paths.length = 0;

    const p = await loadProfile({
      owner: "anubhavaanand",
      repos: ["planetwood"],
      enrich: true,
      concurrency: 1,
    });

    const settingsCalls = paths.filter((u) => /\/repos\/[^/]+\/[^/]+$/.test(u.split("?")[0]));
    // One for the first pass, and not a second one for the enrichment: the
    // enrichment asked again and spent a request re-reading an answer the page
    // already had, against a budget of sixty an hour.
    expect(settingsCalls.length).toBe(1);
    expect(p.repos.length).toBe(1);
    expect(p.repos[0].hasDownloadsEnabled).toBe(true);
  });
});
