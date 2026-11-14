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
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("git-ocean:token");
}

/**
 * Get the stored GitHub access token.
 */
export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("git-ocean:token");
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
      hasPagesEnabled
      discussions {
        totalCount
      }
      codeOfConduct {
        name
        url
      }
      contributingGuide {
        name
        url
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

  // Commit frequency estimate from pushes (we don't have weekly data in GraphQL)
  // Use updated_at vs created_at as a rough proxy
  const updatedAt = new Date(r.updatedAt);
  const daysSinceUpdate = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
  const commitFrequency = daysSinceUpdate > 0 ? Math.max(1, Math.round(10 / (daysSinceUpdate + 1))) : 10;

  return {
    name: r.name,
    description: r.description || "",
    language: r.primaryLanguage?.name || "Unknown",
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
    commitFrequency,
    commitStreak: 0, // Needs commit stats
    codebaseSize: r.diskUsage ? Math.round(r.diskUsage / 1024) : 0, // KB
    fileCount: 0, // Not directly available
    dependenciesCount: 0, // Not directly available
    isArchived: r.isArchived || false,
    isPrivate: r.isPrivate || false,
    isFork: r.isFork || false,
    hasWiki: r.hasWikiEnabled || false,
    hasPages: r.hasPagesEnabled || false,
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
    discussionsOpen: 0, // Needs discussions query
    discussionsClosed: 0, // Needs discussions query
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
  const results = await Promise.allSettled(
    repos.map(({ owner, name }) => fetchRepository(owner, name))
  );

  return results.map((result) =>
    result.status === "fulfilled" ? result.value : null
  );
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
