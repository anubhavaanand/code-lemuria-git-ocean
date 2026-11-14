/**
 * Git Ocean — the orchestration, checked
 *
 * The orchestration layer is the only place that knows the enrichment pass is
 * allowed to be partial. These tests pin the two things that would otherwise be
 * discovered in the browser: that a profile renders from the first pass alone,
 * and that a second pass which half-fails still improves the record it did
 * reach rather than discarding it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { STAGE, loadProfile, loadOne, estimateEnrichCost, shouldEnrich, __clearCacheForTests } from "../src/services/profile";
import { transformRepoData } from "../src/services/github-api";

/** A GraphQL repository payload, as REPO_GRAPHQL_QUERY would return it. */
function repoNode(overrides = {}) {
  return {
    name: "planetwood",
    description: "A planet made of wood",
    url: "https://github.com/anubhavaanand/planetwood",
    isPrivate: false,
    isArchived: false,
    isFork: false,
    isTemplate: false,
    createdAt: "2026-06-26T18:25:11Z",
    updatedAt: "2026-11-07T17:38:12Z",
    pushedAt: "2026-11-07T17:38:12Z",
    diskUsage: 153387,
    homepageUrl: "",
    stargazerCount: 0,
    watchers: { totalCount: 0 },
    forkCount: 0,
    openIssues: { totalCount: 9 },
    closedIssues: { totalCount: 55 },
    primaryLanguage: { name: "HTML", color: "#e34c26" },
    languages: { edges: [{ node: { name: "HTML" }, size: 529770 }], totalSize: 529770 },
    licenseInfo: null,
    repositoryTopics: { edges: [] },
    releases: { nodes: [], totalCount: 0 },
    hasWikiEnabled: true,
    discussions: { totalCount: 0 },
    codeOfConduct: null,
    contributingGuidelines: null,
    issueTemplates: [],
    pullRequestTemplates: [],
    hasProjectsEnabled: true,
    hasIssuesEnabled: true,
    hasDiscussionsEnabled: false,
    hasVulnerabilityAlertsEnabled: false,
    defaultBranchRef: {
      name: "main",
      target: { history: { totalCount: 36 } },
    },
    ...overrides,
  };
}

/** Replace the network with a canned answer per repository name. */
function mockGithub(byName, opts = {}) {
  const calls = { graphql: 0, rest: [] };
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/graphql")) {
      calls.graphql++;
      const body = JSON.parse(init.body);
      const name = body.variables.name;
      const node = byName[name];
      if (!node) return new Response(JSON.stringify({ data: { repository: null } }), { status: 200 });
      return new Response(JSON.stringify({ data: { repository: node } }), { status: 200 });
    }
    calls.rest.push(u);
    // REST answers, in the order the enrichment asks.
    if (u.includes("/branches")) {
      // Link: rel="last" is what fetchBranchCount reads. Without it the count
      // falls back to the array length, and every test that asserts a branch
      // count above 1 fails for a reason that has nothing to do with the code.
      return new Response(JSON.stringify([{ name: "main" }]), {
        status: 200,
        headers: { Link: '<https://api.github.com/x?per_page=1&page=6>; rel="last"' },
      });
    }
    if (u.includes("/contributors")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { Link: '<https://api.github.com/x?per_page=1&page=6>; rel="last"' },
      });
    }
    if (u.endsWith("/pulls?state=all&per_page=100")) {
      return new Response(JSON.stringify([{ state: "open", merged_at: null }]), { status: 200 });
    }
    if (u.includes("/check-runs")) {
      return new Response(
        JSON.stringify({ check_runs: [{ name: "build", status: "completed", conclusion: "success" }] }),
        { status: 200 }
      );
    }
    if (u.includes("/git/trees/")) {
      return new Response(
        JSON.stringify({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 4200 },
            { path: "CONTRIBUTING.md", type: "blob", size: 900 },
          ],
        }),
        { status: 200 }
      );
    }
    if (u.includes("/commits/main?per_page=1")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { Link: '<https://api.github.com/x?per_page=1&page=36>; rel="last"' },
      });
    }
    return new Response(
      JSON.stringify({ has_downloads: true, has_pages: true, size: 150, default_branch: "main", license: { spdx_id: "MIT" } }),
      { status: 200 }
    );
  });
  return calls;
}

beforeEach(() => {
  __clearCacheForTests();
});

describe("estimateEnrichCost", () => {
  it("counts six requests per repository", () => {
    expect(estimateEnrichCost(1)).toBe(6);
    expect(estimateEnrichCost(5)).toBe(30);
  });

  it("refuses a profile that would blow the budget", () => {
    // An unauthenticated browser has 60 an hour. Spending 30 on one profile is a
    // decision; spending 180 is an outage.
    expect(shouldEnrich(5, { maxRequests: 200 })).toBe(true);
    expect(shouldEnrich(50, { maxRequests: 200 })).toBe(false);
  });
});

describe("loadProfile", () => {
  it("reports the first pass before it has enriched anything", async () => {
    const calls = mockGithub({ planetwood: repoNode() });
    const stages = [];
    await loadProfile({
      owner: "anubhavaanand",
      repos: ["planetwood"],
      enrich: false,
      onStage: (stage) => stages.push(stage),
    });

    // The stage list is the contract the HUD would render against: it must be
    // able to say "drawing from the first pass" before the slow pass is done.
    expect(stages[0]).toBe(STAGE.FIRST_PASS);
    expect(stages).toContain(STAGE.READY);
    expect(stages).not.toContain(STAGE.ENRICHING);
    // And it must not have spent a single REST request.
    expect(calls.rest.length).toBe(0);
  });

  it("enriches when asked, and reports progress", async () => {
    mockGithub({ planetwood: repoNode() });
    const stages = [];
    const { repos } = await loadProfile({
      owner: "anubhavaanand",
      repos: ["planetwood"],
      onStage: (stage, detail) => stages.push([stage, detail]),
    });

    expect(stages.some(([s]) => s === STAGE.ENRICHING)).toBe(true);
    // The enriched record carries the fields the first query cannot reach.
    expect(repos[0].branchCount).toBe(6);
    expect(repos[0].contributors).toBe(6);
    expect(repos[0].hasContributing).toBe(true);
    expect(repos[0].hasDownloadsEnabled).toBe(true);
  });

  it("keeps the first-pass identity when the second pass lands", async () => {
    mockGithub({ planetwood: repoNode() });
    const { repos } = await loadProfile({ owner: "anubhavaanand", repos: ["planetwood"] });
    // The world assigns an `id` that picking and the HUD both key on. If the
    // enrichment re-derived it, a click would refer to something that no longer
    // exists.
    expect(repos[0].id).toBeTruthy();
    expect(repos[0].position).toBeDefined();
  });

  it("survives a repository that does not exist", async () => {
    mockGithub({});
    const { repos, errors } = await loadProfile({ owner: "anubhavaanand", repos: ["nope"] });
    expect(repos.length).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("skips the enrichment when there is nothing to enrich", async () => {
    mockGithub({});
    const stages = [];
    await loadProfile({
      owner: "anubhavaanand",
      repos: ["nope"],
      onStage: (s) => stages.push(s),
    });
    // A 404 in the first pass must not become eight wasted REST requests.
    expect(stages).not.toContain(STAGE.ENRICHING);
  });

  it("carries the enrichment errors through instead of swallowing them", async () => {
    mockGithub({ planetwood: repoNode() }, {});
    // Force the tree to fail while everything else succeeds: the record should
    // still be enriched, and the failure should be visible.
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes("/git/trees/")) return new Response("{}", { status: 500 });
      return realFetch(url, init);
    });

    const { repos, errors } = await loadProfile({
      owner: "anubhavaanand",
      repos: ["planetwood"],
    });

    expect(repos[0].branchCount).toBe(6);
    expect(repos[0].meta.enrichFailed).toBe(true);
    expect(repos[0].meta.enrichErrors.length).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("loadOne", () => {
  it("returns a single enriched world record", async () => {
    mockGithub({ planetwood: repoNode() });
    const world = await loadOne("anubhavaanand", "planetwood");
    expect(world).not.toBeNull();
    expect(world.name).toBe("planetwood");
    expect(world.ciStatus).toBe("success");
  });

  it("returns null for a repository that is not there", async () => {
    mockGithub({});
    expect(await loadOne("anubhavaanand", "nope")).toBeNull();
  });

  it("can skip the enrichment", async () => {
    const calls = mockGithub({ planetwood: repoNode() });
    const world = await loadOne("anubhavaanand", "planetwood", { enrich: false });
    expect(world.name).toBe("planetwood");
    expect(calls.rest.length).toBe(0);
  });
});

describe("transformRepoData, the fields the first pass now answers", () => {
  it("reads an exact commit total from the branch history", () => {
    const t = transformRepoData({ repository: repoNode() }, "anubhavaanand");
    expect(t.totalCommits).toBe(36);
    expect(t.commitSource).toBe("exact");
    expect(t.branch).toBe("main");
  });

  it("does not claim a commit total when there is no history", () => {
    const t = transformRepoData(
      { repository: repoNode({ defaultBranchRef: { name: "main", target: null } }) },
      "anubhavaanand"
    );
    // Zero commits is a claim about a repository, not about a query. If the
    // query did not say, the honest answer is "unknown", and the adapter's
    // estimate fills the gap.
    expect(t.totalCommits).toBe(0);
    expect(t.commitSource).toBe("unknown");
  });

  it("reads the template files the first query can see", () => {
    const t = transformRepoData(
      {
        repository: repoNode({
          issueTemplates: [{ name: "Bug report" }],
          pullRequestTemplates: [{ body: "## What" }],
          contributingGuidelines: { body: "Be nice" },
          codeOfConduct: { name: "Contributor Covenant" },
          hasVulnerabilityAlertsEnabled: true,
        }),
      },
      "anubhavaanand"
    );
    expect(t.hasIssueTemplate).toBe(true);
    expect(t.hasPRTemplate).toBe(true);
    expect(t.hasContributing).toBe(true);
    expect(t.hasCodeOfConduct).toBe(true);
    expect(t.securityScanning).toBe(true);
  });

  it("splits a discussion total rather than dropping it", () => {
    const t = transformRepoData(
      { repository: repoNode({ discussions: { totalCount: 10 } }) },
      "anubhavaanand"
    );
    expect(t.discussions).toBe(10);
    expect(t.discussionsOpen + t.discussionsClosed).toBe(10);
  });

  it("says a language is not buildable rather than guessing", () => {
    const t = transformRepoData({ repository: repoNode() }, "anubhavaanand");
    // HTML has no build to fail. This is why the enrichment can skip a request.
    expect(t.buildable).toBe(false);
    expect(t.hasPages).toBe(false);
    expect(t.hasDownloadsEnabled).toBe(false);
  });
});