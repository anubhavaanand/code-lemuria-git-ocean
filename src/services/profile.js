/**
 * Git Ocean — the orchestration layer
 *
 * The two GitHub passes exist. This module is what joins them into one call the
 * scene can make, because the join has three real decisions in it and none of
 * them belong in a React effect.
 *
 *   1. Render first, enrich after. The first query is cheap and the world can
 *      draw from it alone; the enrichment costs six to eight more requests. The
 *      caller gets world records immediately and again when the enrichment
 *      lands, rather than waiting for the slow pass before anything appears.
 *      Constitution principle III, restated as a function signature.
 *
 *   2. The enrichment is allowed to be partial. A repository whose check-runs
 *      endpoint is rate-limited should still get its branch count. So the
 *      enriched record is merged over the first one, field by field, and the
 *      caller is told which parts failed.
 *
 *   3. Public repositories cost one authenticated request each for the first
 *      pass and six to eight for the second. That is affordable. A profile of
 *      thirty public repos is ~200 requests, which is why the second pass runs
 *      four at a time and why everything is cached.
 *
 * Everything here is framework-free on purpose: no React, no DOM, no window.
 * That is what lets it be tested with a mocked fetch, and what will let a future
 * server-side renderer use the same code.
 */

import { fetchRepository, fetchRepositories } from "./github-api";
import { apiToWorldRepo } from "./repoAdapter";
import {
  enrichRepositories,
  enrichmentToWorldFields,
} from "./repoEnrich";
import { cache } from "./cache";

/** One pass's progress, as the UI would want to render it. */
export const STAGE = {
  IDLE: "idle",
  FIRST_PASS: "first-pass",
  ENRICHING: "enriching",
  READY: "ready",
  FAILED: "failed",
};

/**
 * Turn API records into world records, attaching an enrichment when one exists.
 *
 * `enrichments` is the Map enrichRepositories returns. A repository with no
 * entry gets its defaults, which is the same thing that happened before the
 * enrichment pass existed.
 */
function toWorld(api, owner, enrichments) {
  if (!api) return null;
  const key = `${owner}/${api.name}`;
  const result = enrichments ? enrichments.get(key) : null;
  return apiToWorldRepo(api, {
    owner,
    enrich: result ? enrichmentToWorldFields(result) : undefined,
  });
}

/**
 * Load a whole profile as world records.
 *
 * @param {object} opts
 * @param {string} opts.owner               whose profile
 * @param {string[]} opts.repos             repository names
 * @param {object}  [opts.viewer]           viewer data, passed through untouched
 * @param {boolean} [opts.enrich=true]      run the second pass
 * @param {number}  [opts.concurrency=4]
 * @param {(stage: string, detail: object) => void} [opts.onStage]
 * @returns {Promise<{viewer, repos, enrichments, errors}>}
 */
export async function loadProfile(opts) {
  const owner = opts.owner;
  const names = opts.repos || [];
  const wantEnrich = opts.enrich !== false;
  const report = (stage, detail) => {
    if (opts.onStage) opts.onStage(stage, detail);
  };

  report(STAGE.FIRST_PASS, { total: names.length });

  // One request per repository for the first pass. These are already settled
  // individually by fetchRepositories, so a 404 on one repo is not a failure of
  // the profile.
  const apis = await fetchRepositories(names.map((name) => ({ owner, name })));

  const repos = [];
  const firstErrors = [];
  for (let i = 0; i < names.length; i++) {
    const api = apis[i];
    if (!api) {
      firstErrors.push(`${owner}/${names[i]}: first pass returned nothing`);
      continue;
    }
    repos.push(toWorld(api, owner, null));
  }

  report(STAGE.READY, { count: repos.length, errors: firstErrors.length });
  if (!wantEnrich) {
    return { viewer: opts.viewer || null, repos, enrichments: new Map(), errors: firstErrors };
  }

  // Enrich what actually loaded. Asking for enrichment of a repository that
  // 404'd is six wasted requests and a misleading error.
  const loaded = repos.map((r) => ({ owner, name: r.name }));
  if (!loaded.length) {
    return { viewer: opts.viewer || null, repos, enrichments: new Map(), errors: firstErrors };
  }

  report(STAGE.ENRICHING, { total: loaded.length });
  const started = Date.now();

  const enrichments = await enrichRepositories(loaded, {
    concurrency: opts.concurrency || 4,
    onProgress: (done, total) => report(STAGE.ENRICHING, { done, total }),
  });

  // Fold the second pass back into the world records. The records are new
  // objects rather than mutated ones: a caller holding the first-pass list keeps
  // a valid one, and React sees a new reference and re-renders.
  const enrichedRepos = repos.map((r) => {
    const result = enrichments.get(`${owner}/${r.name}`);
    if (!result) return r;
    const fields = enrichmentToWorldFields(result);
    const merged = apiToWorldRepo(
      // The adapter reads an API record, and all it needs from it is the name
      // and owner, both of which are already on the world record.
      { name: r.name, owner, description: r.description, language: r.language,
        stars: r.stars, forks: r.forks, codebaseSize: r.codebaseSize,
        license: r.license, topics: r.topics, homepage: r.homepage,
        createdAt: null, ageDays: r.ageDays, isArchived: r.isArchived,
        isFork: r.isFork, releaseCount: r.releases, hasWiki: r.hasWiki,
        openIssues: r.openIssues, closedIssues: r.closedIssues,
        discussionsOpen: r.discussionsOpen, discussionsClosed: r.discussionsClosed },
      { owner, enrich: fields }
    );
    if (!merged) return r;
    // Keep the identity fields the first pass owned: the world assigns an `id`
    // that picking and the HUD both key on, and re-deriving it here would
    // silently change what a click refers to.
    merged.id = r.id;
    merged.position = r.position;
    merged.depth = r.depth;
    merged.meta = Object.assign({}, r.meta, merged.meta, {
      enrichErrors: result.errors,
      enrichFailed: result.errors.length > 0,
    });
    return merged;
  });

  const enrichErrors = [];
  for (const [key, result] of enrichments) {
    if (result.errors.length) enrichErrors.push(`${key}: ${result.errors.join("; ")}`);
  }

  report(STAGE.READY, {
    count: enrichedRepos.length,
    errors: firstErrors.length + enrichErrors.length,
    enrichedMs: Date.now() - started,
  });

  return {
    viewer: opts.viewer || null,
    repos: enrichedRepos,
    enrichments,
    errors: firstErrors.concat(enrichErrors),
  };
}

/**
 * Load one repository as a world record, enriched.
 *
 * The fly-to-a-repo path needs this: the world already has a tower for it, but
 * the tower was built from mock data, and selecting it should not quietly keep
 * showing mock numbers once the real ones are available.
 */
export async function loadOne(owner, name, opts = {}) {
  const [api] = await fetchRepositories([{ owner, name }]);
  if (!api) return null;

  const first = toWorld(api, owner, null);
  if (!first) return null;
  if (opts.enrich === false) return first;

  const enrichments = await enrichRepositories([{ owner, name }], {
    concurrency: 1,
  });
  const result = enrichments.get(`${owner}/${name}`);
  if (!result) return first;

  const merged = apiToWorldRepo(
    { name: first.name, owner, description: first.description, language: first.language,
      stars: first.stars, forks: first.forks, codebaseSize: first.codebaseSize,
      license: first.license, topics: first.topics, homepage: first.homepage,
      ageDays: first.ageDays, isArchived: first.isArchived, isFork: first.isFork,
      releaseCount: first.releases, hasWiki: first.hasWiki,
      openIssues: first.openIssues, closedIssues: first.closedIssues,
      discussionsOpen: first.discussionsOpen, discussionsClosed: first.discussionsClosed },
    { owner, enrich: enrichmentToWorldFields(result) }
  );

  if (!merged) return first;
  merged.id = first.id;
  merged.position = first.position;
  merged.depth = first.depth;
  merged.meta = Object.assign({}, first.meta, merged.meta, {
    enrichErrors: result.errors,
    enrichFailed: result.errors.length > 0,
  });
  return merged;
}

/**
 * How many REST requests the enrichment will spend, so the caller can decide
 * whether to run it at all.
 *
 * Six per repository is the flat cost; the check-runs call is skipped for a
 * repository with no commits, which is why this is a range rather than a number.
 * An unauthenticated browser has sixty an hour; spending thirty on a profile of
 * five is a decision, not an accident.
 */
export function estimateEnrichCost(repoCount) {
  return repoCount * 6;
}

/** Whether the enrichment is worth starting, given what the cache already holds. */
export function shouldEnrich(repoCount, opts = {}) {
  const max = opts.maxRequests || 200;
  return estimateEnrichCost(repoCount) <= max;
}

/** Drop every cached GitHub response. Test-only; never called by the app. */
export function __clearCacheForTests() {
  cache.clear();
}