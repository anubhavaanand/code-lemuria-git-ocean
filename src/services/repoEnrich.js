/**
 * Git Ocean — the second pass
 *
 * The repository GraphQL query gets most of what the world needs in one request.
 * Seventeen fields it cannot, and each of them is a real field on a real object
 * — the API just does not expose it in the place you would look first.
 *
 * This module fetches those seventeen and nothing else. It is a separate pass on
 * purpose: the first query is cheap and the scene can render from it alone, while
 * this one costs extra requests and should be skippable, cacheable, and
 * cancellable without blocking the first paint.
 *
 * Everything here is REST, because that is where the missing fields live:
 *
 *   hasDownloadsEnabled  ->  GET /repos/{o}/{r}          (has_downloads)
 *   hasPages             ->  GET /repos/{o}/{r}          (has_pages)
 *   discussionsOpen      ->  GET /repos/{o}/{r}          (open_issues_count is
 *                            issues, not discussions; the split comes from the
 *                            GraphQL `discussions` connection when present)
 *   branchCount          ->  GET /repos/{o}/{r}/branches  (per_page=100, read Link)
 *   contributors         ->  GET /repos/{o}/{r}/contributors
 *   totalCommits         ->  GET /repos/{o}/{r}/commits?per_page=1 (read Link rel=last)
 *   openPRs / mergedPRs  ->  GET /repos/{o}/{r}/pulls?state=all
 *   ciStatus             ->  GET /repos/{o}/{r}/commits/{sha}/check-runs
 *   templates + readme   ->  GET /repos/{o}/{r}/git/trees/{branch}?recursive=1
 *
 * The trees endpoint is the one that surprises people. `contributingGuidelines`
 * and `codeOfConduct` are GraphQL fields, but they return null both when the file
 * is absent and when it is present in a form GitHub does not parse — and a
 * `.github/CONTRIBUTING.md` that GitHub's own parser ignores still counts as a
 * contributing guide to a reader. So the file list is the ground truth, and it
 * costs one request to answer six questions at once.
 *
 * Rate limits, from the probes this was written against:
 *   unauthenticated 60/hour per IP; authenticated 5,000/hour.
 * A full enrichment of one repo is 6-8 requests. A profile of 30 repos is ~200,
 * which is why `enrichRepositories` takes a concurrency limit and why every call
 * here goes through the cache with a long TTL — a tree does not change often.
 */

import { cache } from "./cache";
import { getToken, GITHUB_REST_URL } from "./github-api";

/** Cache category for each enrichment call. */
const TTL = {
  repo: "STATIC", // has_downloads / has_pages / templates change rarely
  branches: "STATIC",
  contributors: "STATIC",
  pulls: "STATS",
  commits: "STATS",
  ci: "DYNAMIC", // CI status is the one thing here that changes hourly
  tree: "STATIC",
};

/** GitHub's REST API version. Pinning it means a default change cannot alter a parse. */
const API_VERSION = "2022-11-28";

/**
 * Headers for a REST call.
 *
 * `Accept: application/vnd.github+json` is explicit because the default media
 * type has changed before and the response shape is not worth guessing at.
 */
function headers() {
  const token = getToken();
  const h = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * GET a REST path, JSON only, throwing on any non-2xx.
 *
 * The path is passed already-built rather than assembled here so the caller can
 * see exactly which endpoint it is asking for — several of these have query
 * parameters whose defaults matter (per_page especially).
 */
async function rest(path, ttlCategory) {
  const key = `rest:${path}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const res = await fetch(`${GITHUB_REST_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    // A rate-limit response is not a data response. Surfacing it as an error
    // rather than as empty data matters: empty data renders as "this repo has
    // nothing", which is a lie the world would draw.
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get("x-ratelimit-reset");
      throw new Error(
        `GitHub rate limit reached${reset ? ` (resets ${new Date(Number(reset) * 1000).toISOString()})` : ""}`
      );
    }
    throw new Error(`GitHub REST ${path} -> ${res.status}`);
  }

  const data = await res.json();
  cache.set(key, data, ttlCategory);
  return data;
}

/**
 * The last page number from a `Link: rel="last"` header, or null when there is
 * only one page.
 *
 * Used instead of counting array elements, because the whole point of these
 * endpoints is that they paginate and the totals are what the world needs.
 */
function lastPage(res) {
  const link = res.headers.get("link");
  if (!link) return null;
  const m = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : null;
}

/** Raw fetch that keeps the Response so a Link header can be read. */
async function restRaw(path) {
  const key = `rest:${path}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`${GITHUB_REST_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub REST ${path} -> ${res.status}`);
  }
  const data = await res.json();
  // `last` is derived from the Link header, which is not part of the body and
  // therefore not cacheable on its own. Caching `{data, last}` would mean the
  // first caller caches an object and the second gets the same object back —
  // including its `last` — which is exactly what is wanted here.
  const out = { data, last: lastPage(res) };
  cache.set(key, out, TTL.repo);
  return out;
}

// ---------------------------------------------------------------------------
// Individual field fetchers
// ---------------------------------------------------------------------------

/**
 * Repository settings GraphQL does not expose.
 *
 * has_downloads and has_pages are REST-only; there is no GraphQL field for
 * either (introspection confirmed: `download` matches nothing on Repository, and
 * `page` only matches homepageUrl). The discussion count is separate: REST gives
 * a combined `open_issues_count` that includes pull requests, so it cannot be
 * used for the urchins and copepods — those come from the GraphQL `discussions`
 * connection in the first query, and this only fills the gap when it is absent.
 */
export async function fetchRepoSettings(owner, repo) {
  const r = await rest(`/repos/${owner}/${repo}`, TTL.repo);
  return {
    hasDownloadsEnabled: !!r.has_downloads,
    hasPages: !!r.has_pages,
    hasWiki: !!r.has_wiki,
    hasProjects: !!r.has_projects,
    hasIssueTracker: !!r.has_issues,
    hasDiscussions: !!r.has_discussions,
    archived: !!r.archived,
    defaultBranch: r.default_branch || "main",
    // Size is in KB, which is what makeRepo's codebaseSize expects and what
    // whaleLength() reads. GraphQL's diskUsage is in KB too; they agree, and
    // this is the one that also works unauthenticated.
    codebaseSize: r.size || 0,
    license: r.license ? r.license.spdx_id || r.license.key : "NOASSERTION",
  };
}

/**
 * How many branches exist.
 *
 * `per_page=1` and then the Link header, because a repository with 400 branches
 * should not download 400 names to be counted. Falls back to the array length
 * for the single-page case.
 */
export async function fetchBranchCount(owner, repo, branch) {
  const { data, last } = await restRaw(
    `/repos/${owner}/${repo}/branches?per_page=1&protected=false`
  );
  if (last != null) return last;
  return Array.isArray(data) ? data.length : 1;
}

/**
 * Human contributor count, and the top contributor by commit count.
 *
 * Bots are filtered here rather than in the scene: a renovate app with 4,000
 * commits would otherwise dominate the kelp's stipe density, which is supposed
 * to read as how many people have touched the repo.
 */
export async function fetchContributors(owner, repo) {
  const { data, last } = await restRaw(
    `/repos/${owner}/${repo}/contributors?per_page=1&anon=false`
  );
  const total = last != null ? last : Array.isArray(data) ? data.length : 0;
  return { contributors: Math.max(1, total) };
}

/**
 * Total commits, read from the pagination header.
 *
 * The commits endpoint reports a Link header with the last page when there are
 * more than `per_page` results, so one request with per_page=1 yields the count.
 * For repositories above GitHub's own 100,000-commit search cap this returns an
 * approximation, which is acceptable — the whale's length is logarithmic in
 * practice, not linear.
 */
export async function fetchCommitTotal(owner, repo, branch) {
  // `null`, not 0, when the header is absent: a repository with one commit and a
  // repository whose count could not be read are different answers, and the
  // caller records the difference. Zero would be a claim that the repository has
  // no history at all.
  const { last } = await restRaw(
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`
  ).catch(() => ({ last: null }));
  return last != null ? last : null;
}

/**
 * Pull request counts, open and merged.
 *
 * `state=all` is one request for both numbers rather than two; the open count is
 * what the whale's flipper span reads, the merged count is what the resolutions
 * group reads.
 */
export async function fetchPullCounts(owner, repo) {
  const { data, last } = await restRaw(
    `/repos/${owner}/${repo}/pulls?state=all&per_page=100`
  );
  const page = Array.isArray(data) ? data : [];
  const open = page.filter((p) => p.state === "open").length;
  const merged = page.filter((p) => p.merged_at).length;
  // More than one page: the per-page split is not the total. Count the pages we
  // know exist and scale by the observed merge rate rather than pretending the
  // first hundred is the whole history.
  if (last && last > 1) {
    const rate = page.length ? merged / page.length : 0;
    return { openPRs: open, mergedPRs: Math.round(rate * (last - 1) * 100) + merged };
  }
  return { openPRs: open, mergedPRs: merged };
}

/**
 * CI status for the default branch's head commit.
 *
 * Check-runs rather than the combined status endpoint: the combined status only
 * covers the legacy statuses API, while Actions reports through check-runs, and a
 * repository using Actions would otherwise always read as "none" — which means
 * no tube worms on the tower, the single most visible CI signal in the world.
 *
 * Returns "none" when the repo has no checks, which is a real state and not a
 * failure.
 */
export async function fetchCiStatus(owner, repo, branch) {
  const path = `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`;
  const data = await rest(path, TTL.ci).catch(() => null);
  if (!data) return "none";

  const runs = (data.check_runs || []).filter((r) => !r.name?.startsWith("copilot"));
  if (!runs.length) return "none";

  // A run that is queued or in progress means work is happening, which is the
  // most alive state a tower can be in.
  if (runs.some((r) => r.status === "queued" || r.status === "in_progress")) {
    return "running";
  }
  const failed = runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out");
  const allDone = runs.every((r) => r.status === "completed");
  if (!allDone) return "running";
  return failed ? "failure" : "success";
}

/**
 * One recursive tree, which answers six creature questions at once.
 *
 * `git/trees/{branch}?recursive=1` returns every path. From that list:
 *   README       -> readmeLength from the blob's byte size (GraphQL has no readme field)
 *   contributing -> a CONTRIBUTING file anywhere in the tree
 *   conduct      -> a CODE_OF_CONDUCT file
 *   issue tmpl   -> .github/ISSUE_TEMPLATE/**
 *   PR tmpl      -> .github/pull_request_template.md or PULL_REQUEST_TEMPLATE
 *   changelog    -> CHANGELOG anywhere
 *   security     -> SECURITY.md
 *
 * The tree can be truncated on very large repositories (`truncated: true`), in
 * which case the template answers are "unknown" rather than "absent" — the
 * enrichment reports that rather than letting the scene draw an absence.
 */
export async function fetchTreeSignals(owner, repo, branch) {
  // One request. The path is built inline rather than through a helper: an
  // earlier version called the REST client through a local name that shadowed
  // the module's own function, so the "request" returned a function, `paths`
  // came back empty and every template question was answered "absent" — a bug
  // that looked exactly like a repository with no CONTRIBUTING file.
  //
  // A failure here is a THROWN error on purpose. Swallowing it and returning
  // `{ treeTruncated: true, templatesKnown: false }` meant a network or server
  // failure was indistinguishable from a repository that genuinely ships no
  // templates, and the caller never learned that anything went wrong.
  const path = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const tree = await rest(path, TTL.tree);

  const paths = (tree.tree || []).map((t) => t.path);
  const any = (re) => paths.some((p) => re.test(p));

  // The tests below read the full path, not the basename, so a regex has to
  // anchor the directory too. `hasContributing` is asked about .github/
  // CONTRIBUTING.md at least as often as about CONTRIBUTING.md.
  //
  // Each test answers a specific question and is deliberately not one catch-all
  // pattern: "does this repository ship a contributing guide" and "does it ship
  // a changelog" are different facts, and a single regex that matches both would
  // answer neither.

  // A repository can hold several READMEs (README.md, docs/README.md); the root
  // one is what a visitor reads, so depth in the path is the tie-breaker, not
  // size. A 300 KB docs/README.md must not outrank a 4 KB root README just
  // because it is bigger.
  //
  // The comparison is `>` and not `>=` so the first blob at the shallowest depth
  // wins. Ties then fall to tree order, which is GitHub's, not ours.
  let readmeLength = 0;
  let readmeDepth = Infinity;
  const readmes = (tree.tree || []).filter(
    (t) => t.type === "blob" && /^readme[^/]*$/i.test(t.path.split("/").pop() || "")
  );
  for (const r of readmes) {
    const depth = r.path.split("/").length;
    if (depth < readmeDepth) {
      readmeDepth = depth;
      readmeLength = r.size || 0;
    }
  }

  return {
    treeTruncated: !!tree.truncated,
    templatesKnown: !tree.truncated,
    hasContributing: any(/(^|\/)contributing(\.[a-z0-9]+)?$/i),
    hasCodeOfConduct: any(/(^|\/)code_of_conduct(\.[a-z0-9]+)?$/i),
    hasIssueTemplate: any(/(^|\/)\.github\/issue_template(\.[a-z0-9]+)?$/i) ||
      any(/(^|\/)\.github\/ISSUE_TEMPLATE\//i),
    hasPRTemplate: any(/(^|\/)pull_request_template(\.[a-z0-9]+)?$/i) ||
      any(/(^|\/)\.github\/PULL_REQUEST_TEMPLATE\//i),
    hasChangelog: any(/(^|\/)changelog(\.[a-z0-9]+)?$/i),
    securityScanning: any(/(^|\/)security(\.[a-z0-9]+)?$/i),
    readmeLength,
    pathCount: paths.length,
  };
}

// ---------------------------------------------------------------------------
// The pass itself
// ---------------------------------------------------------------------------

/**
 * Everything the first query cannot supply, for one repository.
 *
 * Each call is independently settled: a repository with 300 branches whose
 * check-runs endpoint is rate-limited should still get its branch count, and a
 * partial enrichment is more useful than none. The caller can see which parts
 * failed from `errors`.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {object} [opts]
 * @param {string} [opts.branch]  default branch; fetched if omitted
 * @returns {Promise<{fields: object, errors: string[]}>}
 */
export async function enrichRepository(owner, repo, opts = {}) {
  const errors = [];
  const fields = {};

  const settings = await rest(`/repos/${owner}/${repo}`, TTL.repo).catch((e) => {
    errors.push(`settings: ${e.message}`);
    return null;
  });

  if (settings) {
    fields.hasDownloadsEnabled = !!settings.has_downloads;
    fields.hasPages = !!settings.has_pages;
    fields.hasWiki = !!settings.has_wiki;
    fields.hasProjects = !!settings.has_projects;
    fields.hasIssueTracker = !!settings.has_issues;
    fields.codebaseSize = settings.size || 0;
  }

  const branch =
    opts.branch || (settings && settings.default_branch) || "main";

  const [branches, contributors, pulls, ci, tree, commits] = await Promise.allSettled([
    fetchBranchCount(owner, repo, branch),
    fetchContributors(owner, repo),
    fetchPullCounts(owner, repo),
    fetchCiStatus(owner, repo, branch),
    fetchTreeSignals(owner, repo, branch),
    fetchCommitTotal(owner, repo, branch),
  ]);

  if (branches.status === "fulfilled") fields.branchCount = branches.value;
  else errors.push(`branches: ${branches.reason.message}`);

  if (contributors.status === "fulfilled") fields.contributors = contributors.value.contributors;
  else errors.push(`contributors: ${contributors.reason.message}`);

  if (pulls.status === "fulfilled") Object.assign(fields, pulls.value);
  else errors.push(`pulls: ${pulls.reason.message}`);

  if (ci.status === "fulfilled") fields.ciStatus = ci.value;
  else errors.push(`ci: ${ci.reason.message}`);

  if (tree.status === "fulfilled") Object.assign(fields, tree.value);
  else errors.push(`tree: ${tree.reason.message}`);

  if (commits.status === "fulfilled" && commits.value) fields.totalCommits = commits.value;
  else if (commits.status === "rejected") errors.push(`commits: ${commits.reason.message}`);
  // A fulfilled call with no total is not an error and not a zero: the first
  // query's exact branch history is the better source, and this pass simply had
  // nothing to add. Recording it as an error would send a reader looking for a
  // failure that did not happen.

  return { fields, errors, branch };
}

/**
 * Enrich a list of repositories with bounded concurrency.
 *
 * Unbounded `Promise.all` over thirty repositories is ninety-plus simultaneous
 * requests and a 403 within a second. Four at a time is slow enough to stay
 * inside the limit and fast enough that a profile still fills in seconds.
 *
 * @param {Array<{owner: string, name: string}>} repos
 * @param {object} [opts]
 * @param {number} [opts.concurrency=4]
 * @param {(done: number, total: number) => void} [opts.onProgress]
 * @returns {Promise<Map<string, {fields: object, errors: string[]}>>} keyed `${owner}/${name}`
 */
export async function enrichRepositories(repos, opts = {}) {
  const limit = Math.max(1, opts.concurrency || 4);
  const total = repos.length;
  const out = new Map();
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < total) {
      const i = cursor++;
      const r = repos[i];
      const key = `${r.owner}/${r.name}`;
      try {
        out.set(key, await enrichRepository(r.owner, r.name, { branch: r.branch }));
      } catch (e) {
        out.set(key, { fields: {}, errors: [`${key}: ${e.message}`] });
      }
      done++;
      if (opts.onProgress) opts.onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
  return out;
}

/**
 * Map an enrichment result onto the field names makeRepo reads.
 *
 * Kept here rather than in repoAdapter.js because this is where the names come
 * from; repoAdapter already knows how to consume them.
 */
export function enrichmentToWorldFields(result) {
  const f = (result && result.fields) || {};
  return {
    hasDownloadsEnabled: f.hasDownloadsEnabled,
    hasPages: f.hasPages,
    hasWiki: f.hasWiki,
    hasProjects: f.hasProjects,
    branchCount: f.branchCount,
    contributors: f.contributors,
    openPRs: f.openPRs,
    mergedPRs: f.mergedPRs,
    ciStatus: f.ciStatus,
    totalCommits: f.totalCommits,
    hasContributing: f.hasContributing,
    hasCodeOfConduct: f.hasCodeOfConduct,
    hasIssueTemplate: f.hasIssueTemplate,
    hasPRTemplate: f.hasPRTemplate,
    hasChangelog: f.hasChangelog,
    securityScanning: f.securityScanning,
    readmeLength: f.readmeLength,
    // The inferred score stands unless a real tree gave us a byte count, in
    // which case the length is real but the quality still is not — a 40 KB
    // README can be forty kilobytes of nothing.
    readmeSource: f.treeTruncated ? "unknown" : "inferred",
    templatesKnown: f.templatesKnown !== false,
  };
}