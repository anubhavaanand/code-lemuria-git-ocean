/**
 * Git Ocean — World data model
 *
 * The complete world structure, from the original design session:
 *
 *   Git Ocean World
 *   ├── Surface Layer          — caustics, god rays, water surface
 *   ├── Geographic Zones       — capital station, city pockets, language districts
 *   │   ├── Central Sonar Obelisk (community landmark + metro station)
 *   │   ├── Kelp towers (repos) at city coordinates
 *   │   └── Whales + orbital creatures per repo
 *   ├── Deep Ocean Language Colonies — unlocated users, scattered, clustered by language
 *   │   └── Python Trench, JavaScript Current, Rust Ridge, ...
 *   └── Metro System           — pressure-vessel tubes connecting capitals
 *
 * Clustering rule (locked in session):
 *   Located user   → nearest capital station, then language district within it
 *   Unlocated user → deep ocean language colony (random scatter + language cluster)
 *
 * Frontend only, mock data. Everything here is deterministic so the world is
 * stable between renders — no flicker, no reshuffling.
 */

import { WHALE_SPECIES, assignWhaleSpecies } from "./constants";

// ---------------------------------------------------------------------------
// Deterministic pseudo-random — stable worlds across reloads
// ---------------------------------------------------------------------------

/** Mulberry32 — small, fast, seeded PRNG. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Language → colour (GitHub linguist palette) and colony terrain character
// ---------------------------------------------------------------------------

export const LANGUAGE_STYLE = {
  JavaScript: { color: "#f1e05a", colony: "JavaScript Current", terrain: "fast", desc: "Fast, chaotic water movement — the largest colony." },
  TypeScript: { color: "#3178c6", colony: "TypeScript Plateau", terrain: "structured", desc: "Elevated, terraced seafloor — everything typed and ordered." },
  Python: { color: "#3572a5", colony: "Python Trench", terrain: "wide-deep", desc: "Wide and deep — the trench where most things begin." },
  Rust: { color: "#dea584", colony: "Rust Ridge", terrain: "sharp", desc: "Sharp, dramatic rock formations. Fearless and correct." },
  Go: { color: "#00add8", colony: "Go Shelf", terrain: "clean", desc: "Clean, minimal, efficient shelf. Nothing wasted." },
  Java: { color: "#b07219", colony: "Java Basin", terrain: "ancient", desc: "Vast and ancient. Enterprise-grade and slow to change." },
  "C++": { color: "#f34b7d", colony: "C++ Abyss", terrain: "abyssal", desc: "Deep, ancient, intimidating. Nothing here is safe." },
  C: { color: "#555555", colony: "C Trench", terrain: "abyssal", desc: "Barely mapped. Runs everything, trusts nothing." },
  Ruby: { color: "#701516", colony: "Ruby Cove", terrain: "warm", desc: "Warm, small, tight community. Everyone knows everyone." },
  "C#": { color: "#178600", colony: "C# Shelf", terrain: "clean", desc: "Structured shelf. Tools for everything." },
  Kotlin: { color: "#a97bff", colony: "Kotlin Drift", terrain: "structured", desc: "Modern drift, gently terraced." },
  Swift: { color: "#F05138", colony: "Swift Shoal", terrain: "warm", desc: "Bright shoal near the surface, always moving." },
  PHP: { color: "#4f5d95", colony: "PHP Shallows", terrain: "ancient", desc: "Ancient shallows. Still powering most of the web." },
};

export const DEFAULT_LANGUAGE_STYLE = {
  color: "#8b9bb0",
  colony: "The Uncharted",
  terrain: "open",
  desc: "Open water. Unclaimed by any single language.",
};

export function languageStyle(lang) {
  return LANGUAGE_STYLE[lang] || DEFAULT_LANGUAGE_STYLE;
}

// ---------------------------------------------------------------------------
// Capital clusters — each has an obelisk landmark + metro station
// ---------------------------------------------------------------------------

export const CAPITAL_CLUSTERS = [
  {
    id: "delhi",
    city: "New Delhi",
    country: "India",
    countryCode: "IN",
    lat: 28.6139,
    lon: 77.209,
    repos: 412,
    contributions: 128400,
    dominantLanguage: "JavaScript",
    glow: 0.86,
    depth: -620,
    skinTheme: "ISRO rocket spire / ancient temple pillar / bioluminescent crystal",
  },
  {
    id: "sf",
    city: "San Francisco",
    country: "United States",
    countryCode: "US",
    lat: 37.7749,
    lon: -122.4194,
    repos: 980,
    contributions: 342100,
    dominantLanguage: "TypeScript",
    glow: 1.0,
    depth: -700,
    skinTheme: "silicon wafer tower / brutalist campus pillar / golden gate cable spire",
  },
  {
    id: "berlin",
    city: "Berlin",
    country: "Germany",
    countryCode: "DE",
    lat: 52.52,
    lon: 13.405,
    repos: 386,
    contributions: 98400,
    dominantLanguage: "TypeScript",
    glow: 0.72,
    depth: -540,
    skinTheme: "TV tower / Brandenburg column / crystal formation",
  },
  {
    id: "tokyo",
    city: "Tokyo",
    country: "Japan",
    countryCode: "JP",
    lat: 35.6762,
    lon: 139.6503,
    repos: 341,
    contributions: 121700,
    dominantLanguage: "TypeScript",
    glow: 0.81,
    depth: -660,
    skinTheme: "Tokyo Skytree / torii gate pillar / neon coral spire",
  },
  {
    id: "london",
    city: "London",
    country: "United Kingdom",
    countryCode: "GB",
    lat: 51.5074,
    lon: -0.1278,
    repos: 312,
    contributions: 88200,
    dominantLanguage: "Python",
    glow: 0.68,
    depth: -500,
    skinTheme: "Big Ben spire / Crystal Palace / sonar obelisk",
  },
  {
    id: "beijing",
    city: "Beijing",
    country: "China",
    countryCode: "CN",
    lat: 39.9042,
    lon: 116.4074,
    repos: 726,
    contributions: 264800,
    dominantLanguage: "Java",
    glow: 0.91,
    depth: -720,
    skinTheme: "Temple of Heaven spire / Great Wall pillar / jade obelisk",
  },
];

// ---------------------------------------------------------------------------
// Station lattice — where a capital actually stands
// ---------------------------------------------------------------------------

/**
 * The radius of the capital ring, in scene units.
 *
 * Chosen against the world-zoom camera, not against the map. World zoom parks
 * the camera at (0, 700, 1450) looking at (0, 16, 0) with a 62 degree vertical
 * fov and a 1.6 aspect, which gives a half-width of about 1,226 units at the
 * ring's near edge and 1,761 at its far edge. A ring of 900 puts all six
 * capitals inside that frustum with margin, which is the point: the world zoom
 * has to be able to see the whole network at once, because a metro is only
 * legible as a network when you can see all of its stations.
 */
export const STATION_RING_RADIUS = 900;

/**
 * Where a capital cluster stands in the world.
 *
 * This exists because the placement it replaced was wrong, and wrong in a way
 * that only shows up once something has to connect two stations. The old
 * formula was:
 *
 *     ox = cluster.lat * 0.6 - 90
 *     oz = LAYERS.obelisk + (cluster.lon % 7) * 14
 *
 * `lat` spans 28.6 to 52.5, so `lat * 0.6 - 90` spans -72.8 to -58.5: fourteen
 * units of lateral spread for an entire planet. `lon % 7` is worse — it takes
 * the remainder of a longitude, so -122.4 and 139.7 both land in the same
 * handful of values, and the six capitals ended up inside a box 14 wide and
 * 141 deep. Six cities occupying the same few cubic units.
 *
 * That was invisible while an obelisk was just a landmark to look at. It stops
 * being invisible the moment a tube has to run between two of them: every edge
 * of the network had almost the same midpoint, so the "network" was a knot.
 *
 * The replacement is an orthographic projection of real latitude and longitude
 * onto the seafloor, which is the honest way to lay out a map:
 *
 *     x = sin(lon) * cos(lat) * R
 *     z = cos(lon) * cos(lat) * R
 *
 * `cos(lat)` is what keeps the high-latitude capitals from crowding the rim —
 * without it, Berlin and Tokyo would sit further out than their real distance
 * from the equator warrants. On this set it is the difference between a ring
 * and a smear.
 *
 * The `z` offset pushes the whole ring behind the user's own zone, which sits
 * at LAYERS.kelpForestMid. A capital in front of the viewer's own repositories
 * would occlude the one part of the scene that is about them.
 */
export function stationPosition(cluster, opts = {}) {
  const radius = opts.radius != null ? opts.radius : STATION_RING_RADIUS;
  const zOffset = opts.zOffset != null ? opts.zOffset : -300;
  const lat = (cluster.lat * Math.PI) / 180;
  const lon = (cluster.lon * Math.PI) / 180;
  const ring = Math.cos(lat) * radius;
  return {
    x: Math.sin(lon) * ring,
    z: Math.cos(lon) * ring + zOffset,
  };
}

/**
 * The edges of the metro network: each station connected to its two nearest
 * neighbours.
 *
 * Two, not one, and not all-pairs. One would make a tree with leaves nobody
 * reaches without doubling back. All-pairs is fifteen edges for six stations,
 * most of them crossing each other, which reads as a scribble rather than as a
 * network and triples the tube geometry for no navigational gain. Two nearest
 * neighbours is what a real network looks like: a ring with a few chords, every
 * station reachable in at most two hops, and no edge that exists only to be
 * looked at.
 *
 * Deduplicated on an unordered key, because A's nearest neighbour is usually B
 * and B's nearest neighbour is usually A — without the key that single edge
 * would be emitted twice and drawn twice.
 */
export function stationEdges(clusters, k = 2) {
  const seen = new Set();
  const edges = [];
  for (let i = 0; i < clusters.length; i++) {
    const a = stationPosition(clusters[i]);
    const nearest = clusters
      .map((c, j) => {
        if (j === i) return null;
        const b = stationPosition(c);
        return { j, d: Math.hypot(a.x - b.x, a.z - b.z) };
      })
      .filter(Boolean)
      .sort((p, q) => p.d - q.d)
      .slice(0, k);
    for (const { j } of nearest) {
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Language colonies — deep ocean, unlocated users
// ---------------------------------------------------------------------------

export const LANGUAGE_COLONIES = [
  { language: "Python", depth: -3200, x: -1150, terrain: "wide-deep", population: 84200 },
  { language: "JavaScript", depth: -2800, x: -720, terrain: "fast", population: 128000 },
  { language: "TypeScript", depth: -2600, x: -300, terrain: "structured", population: 96400 },
  { language: "Rust", depth: -4100, x: 180, terrain: "sharp", population: 41200 },
  { language: "Go", depth: -2900, x: 640, terrain: "clean", population: 52800 },
  { language: "C++", depth: -5200, x: 1120, terrain: "abyssal", population: 68400 },
  { language: "Java", depth: -3600, x: 1560, terrain: "ancient", population: 74100 },
  { language: "Ruby", depth: -2200, x: -1560, terrain: "warm", population: 22600 },
];

// ---------------------------------------------------------------------------
// Repo record — the canonical shape used across the app
// ---------------------------------------------------------------------------

let _repoId = 0;

export function makeRepo(input) {
  const repo = {
    // A caller may supply a stable id (the API path does: `owner/name`). Only a
    // record with none gets a counter — a counter-based id cannot survive a page
    // load, and `entries` is keyed on it, so every reload would rename every
    // tower and make a selected entry unreachable.
    id: input.id || `repo_${++_repoId}`,
    name: input.name,
    owner: input.owner || "you",
    description: input.description || "",
    language: input.language || "JavaScript",
    stars: input.stars || 0,
    forks: input.forks || 0,
    watchers: input.watchers || 0,
    contributors: input.contributors || 1,
    openIssues: input.openIssues || 0,
    closedIssues: input.closedIssues || 0,
    openPRs: input.openPRs || 0,
    mergedPRs: input.mergedPRs || 0,
    totalCommits: input.totalCommits || 0,
    commitFrequency: input.commitFrequency || 0,
    commitStreak: input.commitStreak || 0,
    codebaseSize: input.codebaseSize || 0,
    ageDays: input.ageDays || 0,
    isPrivate: !!input.isPrivate,
    isArchived: !!input.isArchived,
    isFork: !!input.isFork,
    pinned: !!input.pinned,
    trending: !!input.trending,
    license: input.license || "MIT",
    topics: input.topics || [],
    ciStatus: input.ciStatus || "none", // success | failure | running | none
    testCoverage: input.testCoverage || 0,
    downloads: input.downloads || 0,
    deployments: input.deployments || 0,
    hasWiki: input.hasWiki !== false,
    homepage: input.homepage || "",
    hasPages: !!input.hasPages,
    hasChangelog: !!input.hasChangelog,
    discussions: input.discussions || 0,
    releases: input.releases || 0,
    depth: input.depth,
    position: input.position || null, // [x, z] within the zone

    // --- Legacy-creature signals ---------------------------------------
    // The 26 Legacy features hang off one field each. These are the ones the
    // API cannot always supply cheaply, so they carry sane defaults and are
    // meant to be overridden by a real fetch once services/ is wired up.
    readmeQuality: input.readmeQuality != null ? input.readmeQuality : 0.55,
    readmeLength: input.readmeLength || 1400,
    branchCount: input.branchCount || 1,
    // Split the discussion total so copepods and urchins read differently.
    discussionsOpen: input.discussionsOpen != null ? input.discussionsOpen : Math.round((input.discussions || 0) * 0.62),
    discussionsClosed: input.discussionsClosed != null ? input.discussionsClosed : Math.round((input.discussions || 0) * 0.38),
    hasContributing: input.hasContributing !== false,
    hasCodeOfConduct: input.hasCodeOfConduct !== false,
    hasIssueTemplate: !!input.hasIssueTemplate,
    hasPRTemplate: !!input.hasPRTemplate,
    hasProjects: !!input.hasProjects,
    hasDownloadsEnabled: input.hasDownloadsEnabled !== false,
    securityScanning: !!input.securityScanning,
    preRelease: !!input.preRelease,
  };

  repo.whaleSpecies = assignWhaleSpecies(repo);
  return repo;
}

// ---------------------------------------------------------------------------
// Your zone — Phase 1 personal dashboard, read-only
// ---------------------------------------------------------------------------

export const YOU = {
  username: "anubhavanand",
  name: "Anubhav Anand",
  location: "Delhi, India",
  lat: 28.6139,
  lon: 77.209,
  clusterId: "delhi",
  district: "Python",
  joined: "2023-04-18",
  followers: 42,
  following: 67,
  depth: -520,
};

/** Your own repos, placed in your language district. */
export const YOUR_REPOS = [
  makeRepo({
    // The repository's real name, not the project's. `git-ocean` is what this
    // project is called; the repository is `code-lemuria-git-ocean`, and the
    // first pass asks GitHub for the name it is given. Asking for the wrong one
    // gets a 404, which is indistinguishable from a repository that does not
    // exist — so the world would quietly keep its mock numbers.
    name: "code-lemuria-git-ocean",
    description: "Your GitHub as an underwater 3D world — repos become whales, stars become dinoflagellates.",
    language: "JavaScript",
    stars: 142,
    forks: 23,
    watchers: 28,
    contributors: 4,
    openIssues: 7,
    closedIssues: 45,
    openPRs: 3,
    mergedPRs: 12,
    totalCommits: 486,
    commitFrequency: 12,
    commitStreak: 14,
    codebaseSize: 2450,
    ageDays: 450,
    pinned: true,
    trending: false,
    license: "MIT",
    topics: ["threejs", "visualization", "github", "ocean"],
    ciStatus: "success",
    testCoverage: 78,
    downloads: 1250,
    deployments: 6,
    hasWiki: true,
    hasPages: false,
    hasChangelog: true,
    discussions: 16,
    releases: 3,
    homepage: "https://anubhavaanand.github.io/code-lemuria-git-ocean/",
    readmeQuality: 0.92,
    readmeLength: 6800,
    branchCount: 9,
    hasContributing: true,
    hasCodeOfConduct: true,
    hasIssueTemplate: true,
    hasPRTemplate: true,
    hasProjects: true,
    hasDownloadsEnabled: true,
    securityScanning: true,
    position: [0, 0],
  }),
  makeRepo({
    name: "planetwood",
    description: "Three.js multiplayer planet game with proximity chat and binary state sync.",
    language: "TypeScript",
    stars: 89,
    forks: 12,
    watchers: 15,
    contributors: 2,
    openIssues: 4,
    closedIssues: 31,
    openPRs: 1,
    mergedPRs: 8,
    totalCommits: 312,
    commitFrequency: 8,
    commitStreak: 7,
    codebaseSize: 1800,
    ageDays: 320,
    pinned: true,
    license: "Apache-2.0",
    topics: ["threejs", "game", "multiplayer"],
    ciStatus: "success",
    testCoverage: 55,
    downloads: 680,
    deployments: 2,
    hasPages: true,
    hasChangelog: false,
    discussions: 10,
    releases: 2,
    homepage: "https://anubhavaanand.github.io/planetwood/",
    readmeQuality: 0.7,
    readmeLength: 2600,
    branchCount: 4,
    hasContributing: true,
    hasCodeOfConduct: false,
    hasIssueTemplate: false,
    hasPRTemplate: true,
    hasProjects: false,
    hasDownloadsEnabled: true,
    securityScanning: false,
    position: [22, -14],
  }),
  makeRepo({
    name: "water-triage",
    description: "Water quality triage and alerting system for municipal pipelines.",
    language: "Python",
    stars: 56,
    forks: 8,
    watchers: 9,
    contributors: 3,
    openIssues: 12,
    closedIssues: 22,
    openPRs: 5,
    mergedPRs: 6,
    totalCommits: 198,
    commitFrequency: 3,
    commitStreak: 2,
    codebaseSize: 950,
    ageDays: 180,
    license: "GPL-3.0",
    topics: ["water", "environment", "data"],
    ciStatus: "failure",
    testCoverage: 40,
    downloads: 200,
    deployments: 0,
    hasWiki: false,
    hasChangelog: false,
    discussions: 9,
    releases: 1,
    readmeQuality: 0.48,
    readmeLength: 900,
    branchCount: 2,
    hasContributing: false,
    hasCodeOfConduct: false,
    hasIssueTemplate: true,
    hasPRTemplate: false,
    hasProjects: false,
    hasDownloadsEnabled: true,
    securityScanning: true,
    position: [-24, -10],
  }),
  makeRepo({
    name: "speckit-dsh",
    description: "Spec-driven development workflow kit for AI coding agents.",
    language: "Rust",
    stars: 31,
    forks: 4,
    watchers: 6,
    contributors: 1,
    openIssues: 2,
    closedIssues: 18,
    openPRs: 0,
    mergedPRs: 9,
    totalCommits: 142,
    commitFrequency: 2,
    commitStreak: 0,
    codebaseSize: 620,
    ageDays: 96,
    isArchived: true,
    license: "MIT",
    topics: ["cli", "workflow", "agents"],
    ciStatus: "running",
    testCoverage: 64,
    downloads: 410,
    deployments: 0,
    hasChangelog: true,
    discussions: 3,
    releases: 5,
    readmeQuality: 0.66,
    readmeLength: 1800,
    branchCount: 6,
    hasContributing: true,
    hasCodeOfConduct: true,
    hasIssueTemplate: true,
    hasPRTemplate: true,
    hasProjects: false,
    hasDownloadsEnabled: true,
    securityScanning: false,
    preRelease: true,
    position: [16, 18],
  }),
];

// ---------------------------------------------------------------------------
// People you follow — their towers visible at geographic distance
// ---------------------------------------------------------------------------

export const FOLLOWING = [
  makeRepo({
    owner: "sindresorhus",
    name: "ky",
    description: "Tiny and elegant HTTP client based on the browser fetch API.",
    language: "TypeScript",
    stars: 4820,
    forks: 210,
    watchers: 96,
    contributors: 42,
    openIssues: 12,
    closedIssues: 1840,
    openPRs: 4,
    mergedPRs: 2210,
    totalCommits: 1240,
    commitFrequency: 18,
    commitStreak: 62,
    codebaseSize: 340,
    ageDays: 1520,
    pinned: true,
    license: "MIT",
    topics: ["http", "fetch", "typescript"],
    ciStatus: "success",
    testCoverage: 96,
    downloads: 18400000,
    deployments: 24,
    hasChangelog: true,
    discussions: 340,
    releases: 42,
    position: [1240, -380], // Berlin direction, far across the ocean
    depth: -1180,
  }),
  makeRepo({
    owner: "yyx990803",
    name: "vue",
    description: "The progressive JavaScript framework.",
    language: "TypeScript",
    stars: 208000,
    forks: 33500,
    watchers: 6100,
    contributors: 480,
    openIssues: 420,
    closedIssues: 12400,
    openPRs: 92,
    mergedPRs: 18200,
    totalCommits: 21400,
    commitFrequency: 34,
    commitStreak: 210,
    codebaseSize: 28400,
    ageDays: 3650,
    pinned: true,
    license: "MIT",
    topics: ["framework", "frontend", "reactivity"],
    ciStatus: "success",
    testCoverage: 88,
    downloads: 42000000,
    deployments: 186,
    hasChangelog: true,
    discussions: 4200,
    releases: 386,
    position: [-1420, -260],
    depth: -1340,
  }),
  makeRepo({
    owner: "rust-lang",
    name: "rust",
    description: "Empowering everyone to build reliable and efficient software.",
    language: "Rust",
    stars: 98200,
    forks: 12800,
    watchers: 2400,
    contributors: 3400,
    openIssues: 9800,
    closedIssues: 42000,
    openPRs: 620,
    mergedPRs: 88000,
    totalCommits: 164000,
    commitFrequency: 210,
    commitStreak: 900,
    codebaseSize: 98400,
    ageDays: 4380,
    license: "Apache-2.0",
    topics: ["compiler", "language", "systems"],
    ciStatus: "success",
    testCoverage: 92,
    downloads: 8200000,
    deployments: 420,
    hasChangelog: true,
    discussions: 8400,
    releases: 520,
    position: [420, -2100],
    depth: -4200, // Rust Ridge, deep ocean colony
  }),
];

// ---------------------------------------------------------------------------
// Ambient cluster population — background towers so the city feels inhabited
// ---------------------------------------------------------------------------

const AMBIENT_NAMES = [
  "hydro-spark", "kelp-ui", "trench-db", "abyss-cache", "sonar-cli",
  "fathom", "brine", "reef-kit", "lumen", "pressure",
  "driftwood", "bathyscaphe", "narwhal", "cascade", "tidepool",
  "mangrove", "anchovy", "sextant", "buoy", "coral",
  "deepwell", "flotsam", "gyre", "halocline", "isobar",
  "jetstream", "kraken", "ligament", "mesopelagic", "nacre",
];

const AMBIENT_LANGS = ["JavaScript", "TypeScript", "Python", "Rust", "Go", "Java", "C++", "Ruby"];

/**
 * Generate ambient towers around a cluster, deterministically.
 * These fill the city so it reads as a real community, not an empty stage.
 */
export function generateAmbientTowers(cluster, count = 14) {
  const rng = makeRng(hashString(cluster.id));
  const towers = [];

  for (let i = 0; i < count; i++) {
    const name = AMBIENT_NAMES[Math.floor(rng() * AMBIENT_NAMES.length)];
    const language = rng() < 0.62
      ? cluster.dominantLanguage
      : AMBIENT_LANGS[Math.floor(rng() * AMBIENT_LANGS.length)];

    // Language districts: angular sectors radiating from the obelisk
    const districtIndex = Math.floor(rng() * 5);
    const districtAngle = (districtIndex / 5) * Math.PI * 2;
    const radius = 90 + rng() * 190;
    const spread = 0.42;

    const angle = districtAngle + (rng() - 0.5) * spread;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const repo = makeRepo({
      owner: `dev_${Math.floor(rng() * 9000 + 1000)}`,
      name: `${name}${rng() < 0.4 ? "-" + Math.floor(rng() * 99) : ""}`,
      description: `Ambient tower in the ${cluster.city} cluster.`,
      language,
      stars: Math.floor(rng() * rng() * 2400),
      forks: Math.floor(rng() * rng() * 180),
      watchers: Math.floor(rng() * rng() * 90),
      contributors: Math.max(1, Math.floor(rng() * 14)),
      openIssues: Math.floor(rng() * 30),
      closedIssues: Math.floor(rng() * 400),
      openPRs: Math.floor(rng() * 12),
      mergedPRs: Math.floor(rng() * 600),
      totalCommits: Math.floor(rng() * 4000),
      commitFrequency: Math.floor(rng() * 26),
      commitStreak: Math.floor(rng() * 90),
      codebaseSize: Math.floor(rng() * 12000 + 200),
      ageDays: Math.floor(rng() * 2200 + 60),
      ciStatus: rng() < 0.78 ? "success" : rng() < 0.7 ? "failure" : "running",
      testCoverage: Math.floor(rng() * 90),
      downloads: Math.floor(rng() * rng() * 500000),
      releases: Math.floor(rng() * 40),
      hasPages: rng() < 0.35,
      hasChangelog: rng() < 0.5,
      discussions: Math.floor(rng() * 120),
      position: [x, z],
      depth: cluster.depth + (rng() - 0.5) * 120,
    });

    towers.push(repo);
  }

  return towers;
}

// ---------------------------------------------------------------------------
// Language colony towers — sparse, deep, atmospheric
// ---------------------------------------------------------------------------

export function generateColonyTowers(colony, count = 6) {
  const rng = makeRng(hashString(colony.language + "colony"));
  const towers = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 60 + rng() * 220;
    const repo = makeRepo({
      owner: `deep_${Math.floor(rng() * 8000 + 1000)}`,
      name: `${colony.language.toLowerCase()}-${["drift", "trench", "vent", "shoal", "ventral", "abyss"][Math.floor(rng() * 6)]}`,
      description: `A tower in the ${languageStyle(colony.language).colony}.`,
      language: colony.language,
      stars: Math.floor(rng() * rng() * 900),
      forks: Math.floor(rng() * 60),
      watchers: Math.floor(rng() * 40),
      contributors: Math.max(1, Math.floor(rng() * 8)),
      openIssues: Math.floor(rng() * 16),
      closedIssues: Math.floor(rng() * 220),
      openPRs: Math.floor(rng() * 6),
      mergedPRs: Math.floor(rng() * 300),
      totalCommits: Math.floor(rng() * 2600),
      commitFrequency: Math.floor(rng() * 14),
      commitStreak: Math.floor(rng() * 40),
      codebaseSize: Math.floor(rng() * 6000 + 100),
      ageDays: Math.floor(rng() * 1800 + 120),
      ciStatus: rng() < 0.6 ? "success" : "none",
      testCoverage: Math.floor(rng() * 70),
      downloads: Math.floor(rng() * 90000),
      releases: Math.floor(rng() * 18),
      position: [colony.x + Math.cos(angle) * radius, Math.sin(angle) * radius],
      depth: colony.depth + (rng() - 0.5) * 260,
    });
    towers.push(repo);
  }

  return towers;
}

// ---------------------------------------------------------------------------
// Assemble the world
// ---------------------------------------------------------------------------

export function buildWorld() {
  const cluster = CAPITAL_CLUSTERS.find((c) => c.id === YOU.clusterId);
  const ambient = generateAmbientTowers(cluster, 16);
  const followingTowers = FOLLOWING;
  const colonies = LANGUAGE_COLONIES.map((colony) => ({
    ...colony,
    style: languageStyle(colony.language),
    towers: generateColonyTowers(colony, 5),
  }));

  return {
    you: YOU,
    cluster,
    yourRepos: YOUR_REPOS,
    ambient,
    following: followingTowers,
    colonies,
    allTowers: [...YOUR_REPOS, ...ambient, ...followingTowers],
    stats: {
      totalRepos: YOUR_REPOS.length + ambient.length + followingTowers.length,
      totalStars: [...YOUR_REPOS, ...ambient].reduce((s, r) => s + r.stars, 0),
      totalContributors: [...YOUR_REPOS, ...ambient].reduce((s, r) => s + r.contributors, 0),
      languages: countLanguages([...YOUR_REPOS, ...ambient]),
    },
  };
}

export function countLanguages(repos) {
  const counts = {};
  for (const r of repos) {
    counts[r.language] = (counts[r.language] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => ({ language, count, style: languageStyle(language) }));
}

export { WHALE_SPECIES, assignWhaleSpecies };