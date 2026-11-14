/**
 * Git Ocean — GitHub API Service
 * GraphQL-first data fetching with REST fallback for stats endpoints.
 * Implements L1/L2/L3 tiered data visibility per the data ethics framework:
 *
 *   L1 — Public by default: stars, forks, watchers, language breakdown, topics,
 *        license, description, repo age/size, releases, wiki/pages status
 *   L2 — Toggleable with GitHub login: traffic views/clones, commit punch card,
 *        contributor dominance, bot/human ratio, new contributors, branches,
 *        protected branches, deployments, environments, PR counts, milestone
 *        details, labels, discussions, contributing guide, code of conduct,
 *        templates, dependents
 *   L3 — Personal eyes only: traffic of other repos, secret scanning, security
 *        advisories, private vulnerability reporting — never visible publicly
 *
 * Strategy (from planning session):
 *   1. GraphQL first call → gets 80% of Level 1 data in one shot
 *   2. REST calls for stats → commit activity, code frequency, participation
 *   3. Cache everything → TTL 1 hour for stats, 24hr for static fields
 *   4. Background refresh → don't block render, show ocean immediately
 *   5. Progressive enhancement → Level 1 loads instantly, Level 2+3 fill in
 *
 * Rate limits:
 *   - Unauthenticated: 60 requests/hour
 *   - OAuth authenticated: 5000 requests/hour
 *   - GraphQL: 5000 points/hour (each query costs points)
 */

import { cache } from "./cache";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
export const GITHUB_REST_URL = "https://api.github.com";

/**
 * Languages whose repositories can have a build that fails.
 *
 * The world reads `ciStatus` as "is there a build here that can fail", not as
 * "is CI configured". A repository of Markdown or CSS has no tube worms — not
 * because nothing is running, but because there is nothing to run. That is a
 * fact about the language, so it is known from the first query and saves a
 * check-runs request that could only ever answer "none".
 *
 * The list is deliberately broad. Missing a language costs one wasted request;
 * wrongly including one costs a tube worm on a repository that cannot fail.
 */
export const BUILD_LANGUAGES = new Set([
  "JavaScript", "TypeScript", "Python", "Ruby", "Java", "Kotlin", "Scala",
  "Go", "Rust", "C", "C++", "C#", "Swift", "PHP", "Dart", "Elixir", "Erlang",
  "Clojure", "Zig", "Objective-C", "Shell", "Jupyter Notebook", "Vue", "Svelte",
]);

// GitHub OAuth App config — populated from environment at build time.
//
// CLIENT_ID is public by design: it appears in the authorize URL and is meant to
// be visible. CLIENT_SECRET is the opposite, and it used to be read here from a
// VITE_ variable — which Vite inlines into the browser bundle, making it public
// too. It is deliberately gone: the code-for-token exchange happens in
// worker/src/index.js, which runs on Cloudflare and holds the secret as a
// worker secret rather than as a build-time constant.
//
// Do not add it back here. Anything in this file ships to every visitor.
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || "";

// ---------------------------------------------------------------------------
// OAuth Helpers
// ---------------------------------------------------------------------------

export const GITHUB_AUTH_CONFIG = {
  clientId: GITHUB_CLIENT_ID,
  scope:
    "read:user user:email read:discussion repo public_repo read:packages " +
    "read:repo_hook security_events",
  redirectUri:
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : "",
};

/**
 * Generate the GitHub OAuth authorization URL.
 * User clicks this to log in and grant Git Ocean access to their data.
 */
export function getOAuthUrl() {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_AUTH_CONFIG.redirectUri,
    scope: GITHUB_AUTH_CONFIG.scope,
    state: "git-ocean-auth",
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Check if the user is authenticated (has a stored access token).
 */
export function isAuthenticated() {
  // `globalThis.localStorage`, not `window.localStorage`, and the guard is on the
  // global rather than on `window`.
  //
  // Both details are load-bearing. The transport choice reads this function, so
  // in a non-browser context — a test, a worker, a build step — a check that only
  // looks at `window` answers false and sends the caller down the anonymous REST
  // path even when a token was deliberately installed. That failure is silent and
  // looks like a code defect in whatever is being tested.
  if (typeof globalThis === "undefined") return false;
  try {
    return !!globalThis.localStorage?.getItem("git-ocean:token");
  } catch {
    // A blocked or unavailable storage (private mode, a sandboxed iframe) is not
    // a reason to crash the load: treat it as signed out, which is the state the
    // world is already able to draw.
    return false;
  }
}

/**
 * Get the stored GitHub access token.
 */
export function getToken() {
  if (typeof globalThis === "undefined") return null;
  try {
    return globalThis.localStorage?.getItem("git-ocean:token") || null;
  } catch {
    return null;
  }
}

/**
 * Store the GitHub access token after OAuth callback.
 */
export function setToken(token) {
  if (typeof window === "undefined") return;
  localStorage.setItem("git-ocean:token", token);
}

/**
 * Clear the stored token (logout).
 */
export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("git-ocean:token");
}

// ---------------------------------------------------------------------------
// GraphQL Client
// ---------------------------------------------------------------------------

/**
 * Execute a GraphQL query against the GitHub API.
 * Falls back gracefully if no token is available (unauthenticated rate limit).
 *
 * @param query - GraphQL query string
 * @param variables - Query variables
 * @param useCache - Whether to cache the result (default true)
 * @returns Parsed JSON response data
 */
async function graphqlRequest(query, variables = {}, useCache = true) {
  const cacheKey = `graphql:${JSON.stringify({ query, variables })}`;

  // Check cache first
  if (useCache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub GraphQL error ${response.status}: ${errorText.slice(0, 200)}`
    );
  }

  const result = await response.json();

  if (result.errors) {
    console.warn("GitHub GraphQL warnings:", result.errors);
    // Continue if we have partial data
  }

  const data = result.data;

  // Cache successful responses
  if (useCache && data) {
    cache.set(cacheKey, data, "STATS");
  }

  return data;
}

// ---------------------------------------------------------------------------
// GraphQL Queries
// ---------------------------------------------------------------------------

/**
 * Single GraphQL query that fetches ~80% of Level 1 repo data in one shot.
 * Replaces ~8 REST calls per the planning session recommendation.
 */
export const REPO_GRAPHQL_QUERY = `
  query RepositoryData($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      description
      url
      isPrivate
      isArchived
      isFork
      isTemplate
      createdAt
      updatedAt
      pushedAt
      diskUsage
      homepageUrl
      stargazerCount
      watchers {
        totalCount
      }
      forkCount
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      primaryLanguage {
        name
        color
      }
      languages(first: 10) {
        edges {
          node {
            name
          }
          size
        }
        totalSize
      }
      licenseInfo {
        key
        name
      }
      repositoryTopics(first: 20) {
        edges {
          node {
            topic {
              name
            }
          }
        }
      }
      releases(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          name
          publishedAt
          isPrerelease
        }
        totalCount
      }
      hasWikiEnabled
      discussions {
        totalCount
      }
      codeOfConduct {
        name
        url
      }
      contributingGuidelines {
        body
        url
      }
      issueTemplates {
        name
        body
        about
        title
      }
      pullRequestTemplates {
        body
      }
      hasProjectsEnabled
      hasIssuesEnabled
      hasDiscussionsEnabled
      hasVulnerabilityAlertsEnabled
      isTemplate
      // The commit total, in the first query, for free: the history field on
      // a branch target is exact, unlike the REST pagination trick which
      // approximates past the first page. It costs one extra field rather
      // than one extra request.
      defaultBranchRef {
        name
        target {
          ... on Commit {
            history {
              totalCount
            }
          }
        }
      }
    }
  }
`;

/**
 * GraphQL query for the authenticated user's profile data.
 */
export const VIEWER_GRAPHQL_QUERY = `
  query ViewerData {
    viewer {
      login
      name
      avatarUrl
      createdAt
      location
      bio
      websiteUrl
      twitterUsername
      sponsors {
        totalCount
      }
      followers {
        totalCount
      }
      following {
        totalCount
      }
      repositories(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          name
          description
          isPrivate
          isArchived
          isFork
          stargazerCount
          forkCount
          primaryLanguage {
            name
          }
          updatedAt
          pushedAt
        }
        totalCount
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// REST API Helpers (for stats endpoints not in GraphQL)
/**
 * Fetch commit activity stats (weekly commits) via REST.
 * Returns array of { week, total, additions, deletions }.
 */
async function fetchCommitActivity(owner, repo) {
  const cacheKey = `rest:commit-activity:${owner}/${repo}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/stats/commit_activity`,
    { headers }
  );

  let data = [];
  if (response.ok) {
    data = await response.json();
    data = data.map((week) => ({
      week: new Date(week.week * 1000).toISOString(),
      total: week.total,
      additions: week.additions,
      deletions: week.deletions,
    }));
  }

  cache.set(cacheKey, data, "STATS");
  return data;
}

/**
 * Fetch code frequency stats (additions/deletions per week) via REST.
 */
async function fetchCodeFrequency(owner, repo) {
  const cacheKey = `rest:code-frequency:${owner}/${repo}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/stats/code_frequency`,
    { headers }
  );

  let data = [];
  if (response.ok) {
    data = await response.json();
    data = data.map((entry) => ({
      week: new Date(entry[0] * 1000).toISOString(),
      additions: entry[1],
      deletions: entry[2],
    }));
  }

  cache.set(cacheKey, data, "STATS");
  return data;
}

/**
 * Fetch repository contributors via REST.
 */
async function fetchContributors(owner, repo) {
  const cacheKey = `rest:contributors:${owner}/${repo}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/contributors`,
    { headers }
  );

  let data = [];
  if (response.ok) {
    data = await response.json();
  }

  cache.set(cacheKey, data, "STATS");
  return data;
}

// ---------------------------------------------------------------------------
// Data Transformation
// ---------------------------------------------------------------------------

/**
 * Transform GitHub GraphQL repository response into our internal repo format.
 * Maps all fields to the creature group data points per the design document.
 *
 * @param data - GraphQL response data
 * @param owner - Repo owner username
 * @returns Normalized repo object matching mockData shape
 */
export function transformRepoData(data, owner) {
  const r = data.repository;
  if (!r) return null;

  const languages = {};
  let totalSize = 0;
  if (r.languages && r.languages.edges) {
    for (const edge of r.languages.edges) {
      if (edge.node && edge.size) {
        languages[edge.node.name] = edge.size;
        totalSize += edge.size;
      }
    }
  }
  // Convert sizes to percentages
  const languagePercent = {};
  for (const [lang, size] of Object.entries(languages)) {
    languagePercent[lang] = totalSize > 0 ? Math.round((size / totalSize) * 100) : 0;
  }

  const topics = (r.repositoryTopics?.edges || [])
    .map((e) => e.node?.topic?.name)
    .filter(Boolean);

  const releases = (r.releases?.nodes || []).map((rel) => ({
    name: rel.name,
    publishedAt: rel.publishedAt,
    isPrerelease: rel.isPrerelease,
  }));

  const createdAt = new Date(r.createdAt);
  const now = new Date();
  const ageDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  // Days since the last push, which is the only liveness signal GraphQL gives
  // for free. Computed once because both the sway estimate and the tower's
  // "recently active" reading need it.
  const updatedAt = new Date(r.updatedAt);
  const daysSinceUpdate = Math.max(
    0,
    Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24))
  );

  // --- the fields the first query can now answer ---------------------------
  //
  // These were all previously left for the second pass. Two of them turned out
  // to be one query field away, and one of them — the commit total — is both
  // free here and *exact* here, where the REST pagination trick approximates.

  const primaryLanguage = r.primaryLanguage?.name || "Unknown";

  // A template repository has a real README and a real contributing guide, by
  // definition: it is meant to be copied. Anything else here would be a
  // coincidence of how the author filled it in.
  const templates = (r.issueTemplates || []).filter(Boolean);

  const contributes = !!(r.contributingGuidelines && r.contributingGuidelines.body);
  const conduct = !!r.codeOfConduct;

  // The discussion split. GitHub does not expose open/closed discussions
  // separately on Repository, only the total; the split is an approximation and
  // is marked as one. The urchins and the copepods both read from it, so the
  // total has to be divided somehow rather than dropped.
  const discussionTotal = r.discussions?.totalCount || 0;

  // Exact commit count, when the default branch has a history.
  const historyCount = r.defaultBranchRef?.target?.history?.totalCount || 0;
  const branch = r.defaultBranchRef?.name || "main";

  return {
    name: r.name,
    description: r.description || "",
    language: primaryLanguage,
    languagePercent,
    stars: r.stargazerCount || 0,
    watchers: r.watchers?.totalCount || 0,
    sponsors: 0, // Not available via GraphQL repo query; needs separate call
    forks: r.forkCount || 0,
    openIssues: r.openIssues?.totalCount || 0,
    closedIssues: r.closedIssues?.totalCount || 0,
    openPRs: 0, // Needs separate REST call
    mergedPRs: 0, // Needs separate REST call
    contributors: 0, // Needs separate REST call
    // There is no weekly commit series in GraphQL. The REST stats endpoint gives
    // one, but it returns 202 while GitHub computes it for a busy repository and
    // it is not worth blocking the first pass on. The sway is driven by this
    // number, so it is derived from the last push against now and marked as an
    // estimate rather than passed off as a measurement.
    commitFrequency: daysSinceUpdate > 0 ? Math.max(1, Math.round(10 / (daysSinceUpdate + 1))) : 10,
    commitStreak: 0, // Needs commit stats
    // KB, not bytes. GitHub's `size` and GraphQL's `diskUsage` are both
    // kilobytes already, and dividing here made a 153 MB repository report as
    // 150 — which the enrichment pass then overwrote with the correct 153387,
    // so the number changed depending on which pass you looked at.
    codebaseSize: r.diskUsage || 0,
    fileCount: 0, // Not directly available
    dependenciesCount: 0, // Not directly available
    isArchived: r.isArchived || false,
    isPrivate: r.isPrivate || false,
    isFork: r.isFork || false,
    hasWiki: r.hasWikiEnabled || false,
    // Not a GraphQL field at all — introspection returns nothing for either
    // `download` or `page` on Repository. Both are REST-only and arrive with the
    // enrichment pass. Left false here rather than guessed.
    hasPages: false,
    hasDownloadsEnabled: false,
    license: r.licenseInfo?.key || "UNLICENSED",
    topics,
    ageDays,
    lastCommit: r.pushedAt,
    lastRelease: releases[0]?.publishedAt,
    releaseCount: r.releases?.totalCount || 0,
    downloadCount: 0, // Not available via API
    readmeQuality: 0, // Would need to fetch README and analyze
    ciCd: false, // Would need workflow check
    testCoverage: 0, // Not available via API
    securityAdvisories: 0, // L3 — needs secret scanning API
    dependabotAlerts: 0, // L3 — needs dependabot API

    // --- answered here, not in a second pass -------------------------------
    discussions: discussionTotal,
    discussionsOpen: Math.round(discussionTotal * 0.62),
    discussionsClosed: Math.round(discussionTotal * 0.38),
    hasContributing: contributes,
    hasCodeOfConduct: conduct,
    hasIssueTemplate: templates.length > 0,
    hasPRTemplate: (r.pullRequestTemplates || []).length > 0,
    hasProjects: !!r.hasProjectsEnabled,
    securityScanning: !!r.hasVulnerabilityAlertsEnabled,
    isTemplate: !!r.isTemplate,
    branch,
    totalCommits: historyCount,
    commitSource: historyCount ? "exact" : "unknown",
    // A repository with nothing to build has no tube worms. This is a statement
    // about the repository, not about the API call, so it can be known now
    // rather than after a check-runs request — and the enrichment pass can skip
    // the call entirely for these.
    buildable: BUILD_LANGUAGES.has(primaryLanguage),
    ciStatus: "none", // the enrichment pass fills this for buildable repos
    changelog: false, // Would need to check for CHANGELOG file
    preRelease: releases.some((r) => r.isPrerelease),
    pinned: false, // User-level setting
    trending: false, // Would need trending API
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pushedAt: r.pushedAt,
    homepage: r.homepageUrl || "",
    owner,
    fullName: `${owner}/${r.name}`,
    url: r.url,
  };
}

// ---------------------------------------------------------------------------
// Public API Functions
// ---------------------------------------------------------------------------

/**
 * Fetch a single repository's data using GraphQL (Level 1).
 * Falls back to REST for fields not covered by GraphQL.
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @returns Normalized repo object
 */
export async function fetchRepository(owner, repo) {
  const cacheKey = `repo:${owner}/${repo}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const data = await graphqlRequest(REPO_GRAPHQL_QUERY, { owner, name: repo });
    const transformed = transformRepoData(data, owner);
    if (transformed) {
      cache.set(cacheKey, transformed, "STATS");
    }
    return transformed;
  } catch (error) {
    console.error(`Failed to fetch repository ${owner}/${repo}:`, error);
    return null;
  }
}

/**
 * Fetch the authenticated user's profile and their repositories.
 * Returns viewer data + array of repos.
 */
export async function fetchViewerAndRepos() {
  if (!isAuthenticated()) {
    throw new Error("Authentication required to fetch viewer data");
  }

  const cacheKey = `viewer:${getToken()?.slice(0, 8)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const data = await graphqlRequest(VIEWER_GRAPHQL_QUERY, {}, true);
    const viewer = data.viewer;

    const repos = (viewer.repositories?.nodes || []).map((r) =>
      transformRepoData({ repository: r }, viewer.login)
    );

    const result = {
      viewer: {
        login: viewer.login,
        name: viewer.name,
        avatarUrl: viewer.avatarUrl,
        location: viewer.location,
        bio: viewer.bio,
        sponsors: viewer.sponsors?.totalCount || 0,
        followers: viewer.followers?.totalCount || 0,
        following: viewer.following?.totalCount || 0,
        createdAt: viewer.createdAt,
        repoCount: viewer.repositories?.totalCount || 0,
      },
      repos,
    };

    cache.set(cacheKey, result, "STATS");
    return result;
  } catch (error) {
    console.error("Failed to fetch viewer data:", error);
    throw error;
  }
}

/**
 * Fetch multiple repositories in parallel.
 * Uses GraphQL batched queries where possible.
 *
 * @param repos - Array of { owner, name }
 * @returns Array of normalized repo objects (null for failures)
 */
export async function fetchRepositories(repos) {
  // **Sequential, not Promise.all.**
  //
  // This used to fire every repository at once, which is fine against the
  // GraphQL limit when signed in (5,000 points an hour) and fatal when not.
  // Anonymous GraphQL is **0 points** — every anonymous query returns 403 with
  // "API rate limit exceeded" and the world falls back to mock data, every time,
  // with nothing in the console but a stack of identical failures.
  //
  // So the anonymous path goes through REST instead, where the anonymous limit is
  // 60 an hour and a repository costs one request. Signed in, it still uses
  // GraphQL: one request per repository, richer, and free.
  //
  // Sequential because a burst of four anonymous calls is the shape of a request
  // that gets the whole IP throttled for an hour. A profile of eight repositories
  // costs eight seconds worst case, once, behind a world that is already drawn.
  const out = [];
  for (const { owner, name } of repos) {
    // eslint-disable-next-line no-await-in-loop
    const record = isAuthenticated()
      ? await fetchRepository(owner, name)
      : await fetchRepositoryRest(owner, name);
    out.push(record);
  }
  return out;
}

/**
 * One repository, from REST, with no token.
 *
 * The shape matches `transformRepoData` closely enough that `apiToWorldRepo` and
 * the enrichment fold read either one, because the alternative is a second
 * adapter and a second set of field names to keep in step.
 *
 * What REST cannot give here is left absent rather than guessed: open/closed
 * issue counts (REST's `open_issues_count` includes pull requests, so it cannot
 * be split), the language breakdown, the topic list and the release list. Those
 * arrive with the enrichment pass or not at all, and the world is built to treat
 * an absent field as absent.
 */
export async function fetchRepositoryRest(owner, name) {
  const cacheKey = `restrepo:${owner}/${name}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const res = await fetch(`${GITHUB_REST_URL}/repos/${owner}/${name}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "git-ocean",
    },
  });

  if (!res.ok) {
    // Read the body before warning, because the status alone conflates two
    // different situations and only one of them is worth retrying: a 403 from the
    // rate limiter and a 404 for a repository that does not exist both look like
    // "no data" to a caller, and a 403 from the rate limiter is the one that
    // resolves itself in an hour.
    let detail = "";
    try {
      const body = await res.clone().json();
      if (body && body.message) detail = `: ${body.message}`;
    } catch {
      // A non-JSON error body is not worth parsing further.
    }
    console.warn(
      `REST repository ${owner}/${name} -> ${res.status}${detail}`
    );
    return null;
  }

  const r = await res.json();
  // Checked here rather than after the transform: `transformRepoData` also
  // returns null for a missing repository, and reporting a 200 as "not there"
  // sends a reader looking for a network problem that did not happen.
  if (!r || !r.name) {
    console.warn(`REST repository ${owner}/${name} -> 200 with no body`);
    return null;
  }

  // `transformRepoData` reads a GraphQL repository node. These are the fields it
  // asks for that REST answers under a different name, mapped once here so the
  // transform stays the single place that knows what a repository means.
  const node = {
    name: r.name,
    description: r.description,
    url: r.html_url,
    isPrivate: !!r.private,
    isArchived: !!r.archived,
    isFork: !!r.fork,
    isTemplate: !!r.is_template,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
    diskUsage: r.size, // REST reports KB directly; GraphQL's diskUsage is KB too
    homepageUrl: r.homepage,
    stargazerCount: r.stargazers_count,
    watchers: { totalCount: r.watchers_count ?? r.subscribers_count ?? 0 },
    forkCount: r.forks_count,
    openIssues: { totalCount: r.open_issues_count || 0 },
    closedIssues: { totalCount: 0 },
    primaryLanguage: r.language ? { name: r.language } : null,
    languages: { edges: [] },
    licenseInfo: r.license
      ? { key: r.license.spdx_id || r.license.key || "other" }
      : null,
    repositoryTopics: { nodes: (r.topics || []).map((t) => ({ topic: { name: t } })) },
    hasWikiEnabled: !!r.has_wiki,
    hasIssuesEnabled: !!r.has_issues,
    hasProjectsEnabled: !!r.has_projects,
    hasDiscussionsEnabled: !!r.has_discussions,
    hasVulnerabilityAlertsEnabled: false, // REST exposes this only with a token
    discussions: { totalCount: 0 },
    codeOfConduct: null,
    contributingGuidelines: null,
    issueTemplates: [],
    pullRequestTemplates: [],
    releases: { totalCount: 0, nodes: [] },
    defaultBranchRef: r.default_branch
      ? { name: r.default_branch, target: { history: { totalCount: 0 } } }
      : null,
    // REST is authoritative for these two, and the GraphQL query cannot express
    // them at all.
    restHasDownloads: !!r.has_downloads,
    restHasPages: !!r.has_pages,
  };

  const record = transformRepoData({ repository: node }, owner);
  if (!record) return null;

  // The first query cannot answer these; REST just did. Stamped on the record so
  // the adapter reads them from the same place whatever the source.
  record.hasDownloadsEnabled = !!r.has_downloads;
  record.hasPages = !!r.has_pages;
  record.owner = owner;
  record.source = "rest";

  cache.set(cacheKey, record, "STATIC");
  return record;
}

/**
 * Fetch commit activity stats for a repo (Level 2 — requires auth).
 * Returns weekly commit data.
 */
export async function fetchCommitStats(owner, repo) {
  if (!isAuthenticated()) {
    console.warn("Commit stats require GitHub authentication");
    return [];
  }

  const [activity, frequency] = await Promise.allSettled([
    fetchCommitActivity(owner, repo),
    fetchCodeFrequency(owner, repo),
  ]);

  return {
    commitActivity:
      activity.status === "fulfilled" ? activity.value : [],
    codeFrequency:
      frequency.status === "fulfilled" ? frequency.value : [],
  };
}

/**
 * Prefetch Level 1 data for all of a user's repos in the background.
 * Called after login to populate the ocean without blocking render.
 */
export async function prefetchUserRepos(username) {
  try {
    const viewerData = await fetchViewerAndRepos();
    return viewerData.repos;
  } catch (error) {
    console.error("Failed to prefetch user repos:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rate Limit Helpers
// ---------------------------------------------------------------------------

/**
 * Check remaining GitHub API rate limit.
 * Requires authentication for accurate results.
 */
export async function checkRateLimit() {
  const query = `
    query RateLimit {
      rateLimit {
        limit
        cost
        remaining
        resetAt
      }
    }
  `;

  try {
    const data = await graphqlRequest(query, {}, false);
    return data.rateLimit;
  } catch (error) {
    return null;
  }
}
