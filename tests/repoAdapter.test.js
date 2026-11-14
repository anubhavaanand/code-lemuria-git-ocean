/**
 * Git Ocean — the adapter, checked
 *
 * The adapter is the seam between the GitHub API's vocabulary and the world's.
 * Its failure mode is silent: a field that does not arrive reads as `undefined`,
 * `undefined` falls through `||` to a default, and the scene draws a repository
 * that has no contributors, no stars and no README — with nothing in the log to
 * say that any of it was missing.
 *
 * These tests assert the seam holds: names line up, absent fields stay absent
 * rather than becoming flattering guesses, and an enrichment result overrides
 * only the fields it actually answered.
 */

import { describe, it, expect } from "vitest";

import { apiToWorldRepo, inferReadme, inferCommits, UNSUPPLIED_FIELDS } from "../src/services/repoAdapter";
import { transformRepoData } from "../src/services/github-api";
import { makeRepo } from "../src/world/worldData";

/** A minimal API-shaped record, as transformRepoData would produce one. */
function api(overrides = {}) {
  return {
    name: "planetwood",
    owner: "anubhavaanand",
    description: "A planet made of wood",
    language: "TypeScript",
    stars: 12,
    forks: 3,
    watchers: 1,
    openIssues: 2,
    closedIssues: 9,
    openPRs: 1,
    mergedPRs: 4,
    codebaseSize: 2048,
    ageDays: 400,
    isPrivate: false,
    isArchived: false,
    isFork: false,
    pinned: true,
    license: "MIT",
    topics: ["threejs"],
    homepage: "https://example.com",
    hasWiki: true,
    releaseCount: 3,
    preRelease: true,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("apiToWorldRepo", () => {
  it("produces a record makeRepo can actually consume", () => {
    const world = apiToWorldRepo(api());
    expect(world).not.toBeNull();
    expect(world.name).toBe("planetwood");
    expect(world.owner).toBe("anubhavaanand");
    // The whale length is read off codebaseSize; a missing value would render a
    // minnow next to a redwood.
    expect(world.codebaseSize).toBe(2048);
    expect(world.whaleSpecies).toBeTruthy();
    // Every key makeRepo emits must exist and be a defined value, except the
    // one field that is legitimately optional (depth is a position on the map).
    for (const k of Object.keys(makeRepo({ name: "x" }))) {
      if (k === "id" || k === "depth" || k === "position") continue;
      expect(world[k], `world.${k}`).toBeDefined();
    }
  });

  it("defaults creature fields to absence, not to a flattering guess", () => {
    const world = apiToWorldRepo(api());
    // None of these are in the GraphQL payload. A repository that has not said
    // must not grow a cleaner wrasse, an isopod or a seahorse.
    expect(world.hasContributing).toBe(false);
    expect(world.hasCodeOfConduct).toBe(false);
    expect(world.hasIssueTemplate).toBe(false);
    expect(world.hasPRTemplate).toBe(false);
    expect(world.hasDownloadsEnabled).toBe(false);
    expect(world.securityScanning).toBe(false);
    expect(world.meta.readmeSource).toBe("inferred");
    expect(world.meta.fromApi).toBe(true);
  });

  it("takes an enrichment result over the defaults, field by field", () => {
    const world = apiToWorldRepo(api(), {
      enrich: {
        branchCount: 12,
        contributors: 9,
        ciStatus: "success",
        hasContributing: true,
        hasCodeOfConduct: true,
        hasIssueTemplate: true,
        hasPRTemplate: true,
        hasDownloadsEnabled: true,
        securityScanning: true,
        openPRs: 5,
        mergedPRs: 40,
        totalCommits: 3200,
        readmeLength: 8000,
        readmeSource: "inferred",
        templatesKnown: true,
      },
    });

    expect(world.branchCount).toBe(12);
    expect(world.contributors).toBe(9);
    expect(world.ciStatus).toBe("success");
    expect(world.hasContributing).toBe(true);
    expect(world.securityScanning).toBe(true);
    expect(world.openPRs).toBe(5);
    expect(world.mergedPRs).toBe(40);
    expect(world.totalCommits).toBe(3200);
    expect(world.readmeLength).toBe(8000);
    expect(world.meta.enriched).toBe(true);
  });

  it("does not let a partial enrichment blank out a field it did not answer", () => {
    const world = apiToWorldRepo(api(), {
      enrich: { branchCount: 7, hasContributing: true },
    });
    // Only two fields arrived. The rest must keep their defaults rather than
    // being written as `undefined` by the merge.
    expect(world.branchCount).toBe(7);
    expect(world.hasContributing).toBe(true);
    expect(world.ciStatus).toBe("none");
    expect(world.codebaseSize).toBe(2048);
    expect(world.language).toBe("TypeScript");
  });

  it("lets the enrichment win when the API record is silent", () => {
    const bare = api({ codebaseSize: 0 });
    const world = apiToWorldRepo(bare, { enrich: { codebaseSize: 900 } });
    expect(world.codebaseSize).toBe(900);
  });

  it("returns null rather than an empty repository", () => {
    expect(apiToWorldRepo(null)).toBeNull();
  });
});

describe("inferReadme", () => {
  it("scores a README from the signals that do exist", () => {
    const good = inferReadme(
      api({
        description: "A planet made of wood, rendered in three dimensions and animated",
        homepage: "https://x.dev",
        license: "MIT",
        topics: ["a", "b", "c"],
        releaseCount: 4,
      })
    );
    expect(good.readmeQuality).toBeGreaterThan(0.5);
    expect(good.readmeSource).toBe("inferred");
  });

  it("scores a bare repository low", () => {
    const bare = inferReadme(api({ description: "", homepage: "", license: "NOASSERTION", topics: [], releaseCount: 0 }));
    expect(bare.readmeQuality).toBeLessThan(0.4);
  });
});

describe("inferCommits", () => {
  it("is at least one, because a repository exists", () => {
    expect(inferCommits(api({ codebaseSize: 0, ageDays: 0 }))).toBeGreaterThanOrEqual(1);
  });

  it("grows with size and with age", () => {
    const small = inferCommits(api({ codebaseSize: 100, ageDays: 10 }));
    const large = inferCommits(api({ codebaseSize: 90000, ageDays: 900 }));
    expect(large).toBeGreaterThan(small);
  });
});

describe("the seam against the real query", () => {
  it("produces a world record from transformRepoData output", () => {
    // Not a mock of the query: the actual transform, fed a payload shaped like
    // the one REPO_GRAPHQL_QUERY returns. If the transform's names drift, this
    // is where it shows.
    const graphql = {
      repository: {
        name: "code-lemuria-git-ocean",
        description: "Your GitHub profile as a living 3D ocean",
        url: "https://github.com/anubhavaanand/code-lemuria-git-ocean",
        isPrivate: false,
        isArchived: false,
        isFork: false,
        isTemplate: false,
        createdAt: "2026-05-28T00:00:00Z",
        pushedAt: "2026-11-14T00:00:00Z",
        diskUsage: 180000,
        homepageUrl: "",
        stargazerCount: 3,
        forkCount: 1,
        openIssues: { totalCount: 2 },
        closedIssues: { totalCount: 8 },
        primaryLanguage: { name: "JavaScript" },
        languages: { nodes: [{ name: "JavaScript" }, { name: "CSS" }] },
        licenseInfo: { spdxId: "MIT" },
        repositoryTopics: { nodes: [{ topic: { name: "threejs" } }] },
        releases: { nodes: [] },
        hasWikiEnabled: true,
        hasPagesEnabled: true,
        discussions: { totalCount: 0 },
        codeOfConduct: null,
        contributingGuidelines: null,
      },
      viewer: { login: "anubhavaanand" },
    };

    const transformed = transformRepoData(graphql, "anubhavaanand");
    const world = apiToWorldRepo(transformed);

    expect(world).not.toBeNull();
    expect(world.name).toBe("code-lemuria-git-ocean");
    expect(world.owner).toBe("anubhavaanand");
    expect(world.language).toBe("JavaScript");
    expect(world.stars).toBe(3);
    expect(world.codebaseSize).toBeGreaterThan(0);
    expect(world.hasWiki).toBe(true);
  });

  it("names every field the enrichment is expected to supply", () => {
    // A guard, not a test of behaviour: if makeRepo grows a field that the
    // enrichment pass cannot supply, this list is where someone will look.
    expect(UNSUPPLIED_FIELDS).toContain("branchCount");
    expect(UNSUPPLIED_FIELDS).toContain("hasContributing");
    expect(UNSUPPLIED_FIELDS.length).toBeGreaterThan(10);
  });
});