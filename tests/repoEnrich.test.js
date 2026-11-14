/**
 * Git Ocean — the enrichment pass, checked
 *
 * These tests exist because the enrichment pass is the one part of the backend
 * that answers questions about *absence*: whether a repository has a contributing
 * guide, a changelog, a security policy. Absence is easy to get wrong — a failed
 * request, a truncated tree and an empty repository all look identical if you
 * only read the boolean.
 *
 * Run with `npm test`. The GitHub endpoints are mocked at the fetch layer, so
 * these do not spend rate limit and do not need a token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { cache } from "../src/services/cache";
import {
  fetchTreeSignals,
  fetchBranchCount,
  fetchCiStatus,
  fetchPullCounts,
  enrichRepository,
  enrichmentToWorldFields,
} from "../src/services/repoEnrich";

/** A fetch mock that answers a URL prefix with a body and optional headers. */
function mockFetch(routes) {
  return vi.fn(async (url) => {
    const u = String(url);
    for (const [prefix, route] of Object.entries(routes)) {
      if (u.startsWith(prefix)) {
        const body = typeof route.body === "function" ? route.body(u) : route.body;
        const headers = new Headers(route.headers || {});
        return new Response(JSON.stringify(body), {
          status: route.status || 200,
          headers,
        });
      }
    }
    throw new Error(`unmocked URL: ${u}`);
  });
}

const REST = "https://api.github.com";

beforeEach(() => {
  cache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTreeSignals", () => {
  it("reads six creature facts out of one tree", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: {
        body: {
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 4200 },
            { path: "CONTRIBUTING.md", type: "blob", size: 900 },
            { path: "CODE_OF_CONDUCT.md", type: "blob", size: 300 },
            { path: "SECURITY.md", type: "blob", size: 200 },
            { path: "CHANGELOG.md", type: "blob", size: 8000 },
            { path: ".github/ISSUE_TEMPLATE/bug.yml", type: "blob", size: 100 },
            { path: ".github/pull_request_template.md", type: "blob", size: 150 },
          ],
        },
      },
    });

    const s = await fetchTreeSignals("o", "r", "main");

    expect(s.hasContributing).toBe(true);
    expect(s.hasCodeOfConduct).toBe(true);
    expect(s.securityScanning).toBe(true);
    expect(s.hasChangelog).toBe(true);
    expect(s.hasIssueTemplate).toBe(true);
    expect(s.hasPRTemplate).toBe(true);
    expect(s.readmeLength).toBe(4200);
    expect(s.templatesKnown).toBe(true);
    expect(s.treeTruncated).toBe(false);
  });

  it("reports the shallowest README, not the largest", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: {
        body: {
          truncated: false,
          tree: [
            { path: "docs/README.md", type: "blob", size: 300000 },
            { path: "README.md", type: "blob", size: 1400 },
          ],
        },
      },
    });

    const s = await fetchTreeSignals("o", "r", "main");
    // A 300 KB docs README must not outrank the 1.4 KB root one just because it
    // is bigger: the root is what a visitor actually reads.
    expect(s.readmeLength).toBe(1400);
  });

  it("matches contributing and changelog anywhere in the tree", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: {
        body: {
          truncated: false,
          tree: [
            { path: ".github/CONTRIBUTING.md", type: "blob", size: 900 },
            { path: "docs/changelog.md", type: "blob", size: 900 },
            { path: ".github/CODE_OF_CONDUCT.md", type: "blob", size: 300 },
          ],
        },
      },
    });

    const s = await fetchTreeSignals("o", "r", "main");
    expect(s.hasContributing).toBe(true);
    expect(s.hasChangelog).toBe(true);
    expect(s.hasCodeOfConduct).toBe(true);
  });

  it("does not mistake a similarly named file for a template", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: {
        body: {
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 100 },
            { path: "src/contributing-notes.md", type: "blob", size: 100 },
          ],
        },
      },
    });

    const s = await fetchTreeSignals("o", "r", "main");
    // `contributing-notes.md` is not a contributing guide. A substring test
    // would call it one, and the tower would grow a cleaner wrasse on the
    // strength of a file named after a file.
    expect(s.hasContributing).toBe(false);
  });

  it("treats a truncated tree as unknown rather than absent", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: {
        body: { truncated: true, tree: [{ path: "README.md", type: "blob", size: 10 }] },
      },
    });

    const s = await fetchTreeSignals("o", "r", "main");
    expect(s.treeTruncated).toBe(true);
    expect(s.templatesKnown).toBe(false);
    // The length is still known for the paths that came back, so it is reported
    // rather than zeroed.
    expect(s.readmeLength).toBe(10);
  });

  it("reports unknown when the tree request fails entirely", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/git/trees/main`]: { body: {}, status: 404 },
    });

    const s = await fetchTreeSignals("o", "r", "main");
    expect(s.templatesKnown).toBe(false);
    expect(s.treeTruncated).toBe(true);
  });
});

describe("fetchBranchCount", () => {
  it("reads the total from the Link header instead of counting names", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/branches`]: {
        body: [{ name: "main" }],
        headers: { Link: '<https://api.github.com/repos/o/r/branches?per_page=1&page=2>; rel="next", <https://api.github.com/repos/o/r/branches?per_page=1&page=7>; rel="last"' },
      },
    });

    expect(await fetchBranchCount("o", "r", "main")).toBe(7);
  });

  it("falls back to the array length on a single page", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/branches`]: { body: [{ name: "main" }, { name: "dev" }] },
    });

    expect(await fetchBranchCount("o", "r", "main")).toBe(2);
  });
});

describe("fetchCiStatus", () => {
  it("reads check-runs rather than the combined status", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/commits/main/check-runs`]: {
        body: {
          check_runs: [
            { name: "build", status: "completed", conclusion: "success" },
            { name: "test", status: "completed", conclusion: "failure" },
          ],
        },
      },
    });

    expect(await fetchCiStatus("o", "r", "main")).toBe("failure");
  });

  it("reports running when work is in progress", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/commits/main/check-runs`]: {
        body: {
          check_runs: [
            { name: "build", status: "completed", conclusion: "success" },
            { name: "test", status: "in_progress", conclusion: null },
          ],
        },
      },
    });

    expect(await fetchCiStatus("o", "r", "main")).toBe("running");
  });

  it("reports none when there are no checks, which is a real state", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/commits/main/check-runs`]: { body: { check_runs: [] } },
    });

    // "none" is not a failure. A repository with no CI has no tube worms; it
    // has not failed anything.
    expect(await fetchCiStatus("o", "r", "main")).toBe("none");
  });

  it("ignores the copilot reviewer, which is not a build", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/commits/main/check-runs`]: {
        body: {
          check_runs: [
            { name: "copilot-pull-request-reviewer[bot]", status: "completed", conclusion: "failure" },
            { name: "build", status: "completed", conclusion: "success" },
          ],
        },
      },
    });

    expect(await fetchCiStatus("o", "r", "main")).toBe("success");
  });
});

describe("fetchPullCounts", () => {
  it("splits open from merged on one page", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/pulls`]: {
        body: [
          { state: "open", merged_at: null },
          { state: "closed", merged_at: "2026-01-01T00:00:00Z" },
          { state: "closed", merged_at: null },
        ],
      },
    });

    const p = await fetchPullCounts("o", "r");
    expect(p.openPRs).toBe(1);
    expect(p.mergedPRs).toBe(1);
  });

  it("scales past the first page using the observed merge rate", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r/pulls`]: {
        body: [
          { state: "closed", merged_at: "2026-01-01T00:00:00Z" },
          { state: "closed", merged_at: null },
        ],
        headers: { Link: '<https://api.github.com/repos/o/r/pulls?page=4>; rel="last"' },
      },
    });

    const p = await fetchPullCounts("o", "r");
    // One of two on the sampled page was merged, so the unsampled pages are
    // assumed to be half merged. The alternative — pretending the first hundred
    // is the whole history — reads as a repo that has never merged anything.
    expect(p.mergedPRs).toBeGreaterThan(1);
  });
});

describe("enrichRepository", () => {
  it("keeps a partial enrichment when one part fails", async () => {
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/branches")) {
        return new Response(JSON.stringify([{ name: "main" }]), {
          status: 200,
          headers: { Link: '<https://api.github.com/x?per_page=1&page=12>; rel="last"' },
        });
      }
      if (u.endsWith("/pulls?state=all&per_page=100")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (u.includes("/commits/main/check-runs")) {
        return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      }
      if (u.includes("/git/trees/")) {
        return new Response(
          JSON.stringify({ truncated: false, tree: [{ path: "README.md", type: "blob", size: 10 }] }),
          { status: 200 }
        );
      }
      if (u.endsWith("/commits/main?per_page=1")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { Link: '<https://api.github.com/x?page=40>; rel="last"' } });
      }
      if (u.includes("/contributors")) {
        return new Response(JSON.stringify([]), {
          status: 403,
          headers: { "x-ratelimit-reset": "1800000000" },
        });
      }
      return new Response(
        JSON.stringify({
          has_downloads: false,
          has_pages: true,
          has_wiki: true,
          has_projects: false,
          has_issues: true,
          has_discussions: false,
          archived: false,
          default_branch: "main",
          size: 500,
          license: { spdx_id: "MIT" },
        }),
        { status: 200 }
      );
    });

    const { fields, errors } = await enrichRepository("o", "r");

    expect(fields.hasPages).toBe(true);
    expect(fields.branchCount).toBe(12);
    // The rate-limited contributor call must be recorded, not silently dropped:
    // an empty `errors` next to a missing field is what makes a fetch bug look
    // like a repository with no contributors.
    expect(errors.some((e) => e.startsWith("contributors:"))).toBe(true);
    expect(fields.contributors).toBeUndefined();
  });

  it("returns the branch it used so a caller can reuse it", async () => {
    global.fetch = mockFetch({
      [`${REST}/repos/o/r`]: {
        body: { default_branch: "trunk", size: 10, license: { spdx_id: "MIT" } },
      },
      [`${REST}/repos/o/r/branches`]: { body: [{ name: "trunk" }] },
      [`${REST}/repos/o/r/contributors`]: { body: [], headers: { Link: '<https://x?page=3>; rel="last"' } },
      [`${REST}/repos/o/r/pulls`]: { body: [] },
      [`${REST}/repos/o/r/commits/trunk/check-runs`]: { body: { check_runs: [] } },
      [`${REST}/repos/o/r/git/trees/trunk`]: { body: { truncated: false, tree: [] } },
      [`${REST}/repos/o/r/commits/trunk`]: { body: [], headers: { Link: '<https://x?page=2>; rel="last"' } },
    });

    const { branch } = await enrichRepository("o", "r");
    expect(branch).toBe("trunk");
  });
});

describe("enrichmentToWorldFields", () => {
  it("maps onto the names makeRepo reads", () => {
    const f = enrichmentToWorldFields({
      fields: {
        hasDownloadsEnabled: true,
        hasPages: true,
        branchCount: 4,
        contributors: 9,
        ciStatus: "success",
        readmeLength: 5000,
        treeTruncated: false,
        hasContributing: true,
      },
    });

    expect(f.hasDownloadsEnabled).toBe(true);
    expect(f.branchCount).toBe(4);
    expect(f.contributors).toBe(9);
    expect(f.ciStatus).toBe("success");
    expect(f.readmeLength).toBe(5000);
    expect(f.readmeSource).toBe("inferred");
    expect(f.templatesKnown).toBe(true);
  });

  it("never invents a creature field that was not answered", () => {
    const f = enrichmentToWorldFields({ fields: {}, errors: ["everything"] });
    // `undefined`, not `false`. A missing value must not render as a repo with
    // no contributing guide — the scene decides what to draw with an explicit
    // absence, and this must let it.
    expect(f.hasContributing).toBeUndefined();
    expect(f.hasChangelog).toBeUndefined();
    expect(f.branchCount).toBeUndefined();
  });
});