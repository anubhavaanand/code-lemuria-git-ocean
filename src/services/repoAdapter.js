/**
 * Git Ocean — the shape the world actually consumes
 *
 * `transformRepoData` in services/github-api.js produces a record for the API's
 * own sake: it mirrors GitHub's field names and fills in whatever the GraphQL
 * query could not reach. `makeRepo` in world/worldData.js produces a record for
 * the world: it has twenty-something fields the scene reads, several of which
 * the API does not name the same way at all.
 *
 * Neither of those is a bug. They are two different jobs, and pretending the API
 * record is already a world record is how a scene ends up full of zeroes.
 *
 * This module is the seam. One direction only:
 *
 *     api record  ->  world record
 *
 * The reverse is deliberately absent: the world's mock data is authored for
 * display and must never be sent back to GitHub.
 *
 * The mapping is written out field by field rather than spread, because a spread
 * would silently carry the API's names across and leave the world reading
 * `undefined` for anything the two disagree on. Every field below is either
 * copied with an explicit fallback or computed, and the reason is in the comment.
 */

import { makeRepo } from "../world/worldData";

/**
 * Derive a README quality score and length from what GitHub will actually tell
 * us without a second fetch.
 *
 * A README is not in the repository GraphQL payload. What is available is
 * whether the repo has a description, whether it has a homepage, how many
 * releases it has, and whether it has a license — none of which is a README.
 *
 * So this is not an estimate of README quality. It is a placeholder that is
 * honest about being one: the value is derived from real fields, it is stable
 * for a given repo, and `readmeSource` records that it is inferred so the HUD
 * can say so rather than presenting a guess as a measurement.
 *
 * A real implementation needs one extra call: GET /repos/{owner}/{repo}/readme,
 * which returns the file's size in bytes. That is the only number worth calling
 * "README length".
 */
function inferReadme(api) {
  let score = 0.45;
  if (api.description && api.description.length > 20) score += 0.12;
  if (api.description && api.description.length > 80) score += 0.08;
  if (api.homepage) score += 0.06;
  if (api.license && api.license !== "UNLICENSED") score += 0.08;
  if (api.topics && api.topics.length >= 3) score += 0.08;
  if (api.releaseCount > 0) score += 0.06;
  if (api.isArchived) score -= 0.15;
  return {
    readmeQuality: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    readmeLength: 900 + Math.round(score * 2600),
    readmeSource: "inferred",
  };
}

/**
 * Estimate how many commits a repository has.
 *
 * GraphQL has no total-commit field, and the REST contributors endpoint is what
 * normally supplies it. Rather than call it here and make every repo cost an
 * extra request, the caller can pass a real `totalCommits` when it has one and
 * this only fills the gap.
 *
 * The fallback is deliberately conservative: disk usage and age give a rough
 * magnitude, and under-reporting is better than inventing a number that drives
 * the whale's length wrongly.
 */
function inferCommits(api) {
  const kb = api.codebaseSize || 0;
  const age = api.ageDays || 0;
  if (!kb && !age) return 0;
  // ~14 KB of tracked content per commit is a rough historical average for a
  // small-to-medium repository; a repo that is 10 MB has plausibly a few hundred.
  const fromSize = Math.round(kb / 14);
  const fromAge = Math.round(age * 0.35);
  return Math.max(fromSize, fromAge, 1);
}

/**
 * Map an API record to the shape the world consumes.
 *
 * @param {object} api   output of transformRepoData
 * @param {object} [opts]
 * @param {string} [opts.owner]       override the owner (the API record carries one)
 * @param {number} [opts.totalCommits] real commit count, if a REST call supplied it
 * @param {string} [opts.ciStatus]    success | failure | running | none
 * @param {Array}  [opts.contributors] REST contributor list, if fetched
 * @returns {object|null} a world repo record, or null when there is no repository
 */
export function apiToWorldRepo(api, opts = {}) {
  if (!api) return null;

  const readme = inferReadme(api);
  const contributors = opts.contributors
    ? opts.contributors.filter((c) => c && c.login && c.type !== "Bot").length
    : 0;

  const world = makeRepo({
    name: api.name,
    owner: opts.owner || api.owner || "you",
    description: api.description || "",
    language: api.language || "JavaScript",
    stars: api.stars || 0,
    forks: api.forks || 0,
    watchers: api.watchers || 0,
    contributors: contributors || 1,
    openIssues: api.openIssues || 0,
    closedIssues: api.closedIssues || 0,
    openPRs: api.openPRs || 0,
    mergedPRs: api.mergedPRs || 0,
    totalCommits: opts.totalCommits != null ? opts.totalCommits : inferCommits(api),
    commitFrequency: api.commitFrequency || 0,
    commitStreak: api.commitStreak || 0,
    codebaseSize: api.codebaseSize || 0,
    ageDays: api.ageDays || 0,
    isPrivate: !!api.isPrivate,
    isArchived: !!api.isArchived,
    isFork: !!api.isFork,
    pinned: !!api.pinned,
    license: api.license && api.license !== "UNLICENSED" ? api.license : "NOASSERTION",
    topics: api.topics || [],
    ciStatus: opts.ciStatus || "none",
    downloads: api.downloadCount || 0,
    homepage: api.homepage || "",
    hasWiki: api.hasWiki !== false,
    hasPages: !!api.hasPages,
    hasChangelog: !!api.changelog,
    releases: api.releaseCount || 0,
    preRelease: !!api.preRelease,

    // --- the legacy-creature fields the GraphQL query cannot reach ---------
    // These default to "absent" rather than to a flattering guess. A repo with
    // no contributing guide should not grow a cleaner wrasse because the API
    // did not say either way; absence is the honest reading of an unfetched field,
    // and it is visible in the fauna census.
    readmeQuality: readme.readmeQuality,
    readmeLength: readme.readmeLength,
    branchCount: api.branchCount || 1,
    discussionsOpen: api.discussionsOpen || 0,
    discussionsClosed: api.discussionsClosed || 0,
    hasContributing: !!api.hasContributing,
    hasCodeOfConduct: !!api.hasCodeOfConduct,
    hasIssueTemplate: !!api.hasIssueTemplate,
    hasPRTemplate: !!api.hasPRTemplate,
    hasProjects: !!api.hasProjects,
    hasDownloadsEnabled: !!api.hasDownloadsEnabled,
    securityScanning: !!api.securityScanning,
  });

  // Not a world field, but the HUD's "inferred" note needs it and the world
  // record is the one object the HUD is given.
  world.meta = {
    readmeSource: readme.readmeSource,
    fromApi: true,
  };

  return world;
}

/**
 * Which legacy-creature fields the current GraphQL query cannot supply.
 *
 * Exported so the query itself can be checked against the scene's needs rather
 * than discovered by a creature silently not building.
 */
export const UNSUPPLIED_FIELDS = [
  "readmeQuality",
  "readmeLength",
  "branchCount",
  "discussionsOpen",
  "discussionsClosed",
  "hasContributing",
  "hasCodeOfConduct",
  "hasIssueTemplate",
  "hasPRTemplate",
  "hasProjects",
  "hasDownloadsEnabled",
  "securityScanning",
  "ciStatus",
  "totalCommits",
  "contributors",
  "openPRs",
  "mergedPRs",
];