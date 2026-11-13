/**
 * Git Ocean — World constants
 *
 * Per the Git Ocean Constitution:
 *  - Scientific Accuracy: every element explainable by marine biology / engineering
 *  - Stylized Realism: deep blue, bioluminescent glow, smooth forms (Bruno Simon benchmark)
 *  - Visual Render First: mock data before API wiring
 *  - Phase Architecture: Phase 1 = personal dashboard (read-only)
 *  - Creature Group Integrity: 7 groups, all data points mapped
 *
 * Depth is expressed in metres. Negative Y = below the surface (y = 0).
 * The scene is a 2.5D layered cross-section: real depth spacing, real fog
 * attenuation, real parallax between layers.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const COLORS = {
  // Water column, darkest at depth. Raised from the first prototype: at
  // 0x00060f the deep water read as pure black on every display and the
  // scene lost all separation between geometry and water.
  abyss: 0x030b18,
  midnight: 0x061a30,
  deep: 0x0a2b48,
  mid: 0x0d4a70,
  shallow: 0x14709e,
  surfaceGlow: 0x3aa8cf,

  // Bioluminescence (real: dinoflagellates, ostracods, lanternfish)
  biolumCyan: 0x4deaff,
  biolumBlue: 0x3f95ff,
  biolumGreen: 0x5effbd,
  biolumGold: 0xffd479,
  biolumViolet: 0xa87bff,
  biolumRed: 0xff6b6b,

  // Whale skin (counter-shaded, like real cetaceans)
  whaleDorsal: 0x2a4a70,
  whaleLateral: 0x4d80a6,
  whaleVentral: 0xc2d9e6,
  whaleScar: 0xe4eef5,

  // Kelp / flora — brighter so the towers read against the water
  kelpStipeDark: 0x24543a,
  kelpStipe: 0x3d8a4d,
  kelpBlade: 0x52a85c,
  kelpBladeLit: 0x7ed07a,
  holdfast: 0x4a3d31,

  // Seafloor
  sediment: 0x2a3644,
  sedimentLit: 0x415468,
  basalt: 0x1e2731,

  // Silicon wafer obelisk (wafer is a real semiconductor slice: mirror-polished)
  waferMirror: 0xdfe9f2,
  waferEdge: 0x8fa8bd,
  waferRaw: 0x5c6b7a,
  waferGlow: 0x66d9ff,

  // Status
  success: 0x4dffb0,
  failure: 0xff5a5a,
  running: 0xffd479,
};

// ---------------------------------------------------------------------------
// Depth zones (real oceanographic layers)
// ---------------------------------------------------------------------------

export const DEPTH = {
  sunlight: { min: 0, max: -200, label: "Epipelagic", fog: 0.0016 },
  twilight: { min: -200, max: -1000, label: "Mesopelagic", fog: 0.0026 },
  midnight: { min: -1000, max: -4000, label: "Bathypelagic", fog: 0.0042 },
  abyss: { min: -4000, max: -6000, label: "Abyssopelagic", fog: 0.0060 },
  hadal: { min: -6000, max: -11000, label: "Hadal", fog: 0.0085 },
};

/** Convert a real depth in metres to scene Y units. */
export const Y_PER_METRE = 0.01;

export function depthToY(metres) {
  return metres * Y_PER_METRE;
}

// ---------------------------------------------------------------------------
// Coordinate system — one system, used everywhere
//
//   X  lateral position inside a band
//   Y  height. The seafloor sits at SEAFLOOR_Y; everything grows upward (+Y).
//   Z  depth ordering. The camera sits at +Z looking toward -Z. Each band owns
//      a Z slice, so a camera dolly through Z *is* the zoom, and parallax
//      between bands is real parallax rather than a painted effect.
//
// This is the fix for the earlier drift: environment modules were reading
// LAYERS as Y while the scene assembly read it as Z. Both are Z now, and the
// only vertical constant is SEAFLOOR_Y.
// ---------------------------------------------------------------------------

/** Height of the sediment surface. Towers stand on this. */
export const SEAFLOOR_Y = 0;

export const LAYERS = {
  farRidge: -860, // distant landmass silhouette, dissolved in fog
  godRays: -800, // shafts of surface light, far back
  caustics: -740, // animated light pattern on the sediment
  marineSnow: -620, // the constant fall of detritus
  kelpForestFar: -430,
  obelisk: -340, // the community landmark, behind the user's zone
  ambientFar: -280,
  whaleFar: -230,
  kelpForestMid: -170,
  creatures: -120,
  whaleNear: -20,
  kelpForestNear: 60,
  creaturesNear: 130,
  ambientNear: 190,
  ui: 260,
};

// ---------------------------------------------------------------------------
// Camera — five zoom levels, each revealing a new layer of meaning
//
// `depth` is a real ocean depth in metres, used only for the HUD readout and
// for fog. `focusY`, `distance`, `height` are scene units and are what actually
// position the camera, so the two never have to agree — which is what made the
// old rig fly the camera to nonsense heights.
// ---------------------------------------------------------------------------

export const ZOOM_LEVELS = [
  {
    id: "world",
    label: "World",
    depth: -4200,
    focusY: 16,
    distance: 1450,
    height: 700,
    fov: 62,
    fog: 0.00095,
    blurb: "Capital lights scattered across the ocean floor.",
  },
  {
    id: "country",
    label: "Country",
    depth: -2400,
    focusY: 16,
    distance: 780,
    height: 380,
    fov: 58,
    fog: 0.00125,
    blurb: "One capital station, its city pockets becoming legible.",
  },
  {
    id: "city",
    label: "City",
    depth: -1200,
    focusY: 14,
    distance: 330,
    height: 150,
    fov: 54,
    fog: 0.00165,
    blurb: "Language districts, kelp tower density, your own towers.",
  },
  {
    id: "tower",
    label: "Tower",
    depth: -520,
    focusY: 18,
    distance: 92,
    height: 44,
    fov: 48,
    fog: 0.00215,
    blurb: "A single repo tower — its whale and orbital creatures.",
  },
  {
    id: "whale",
    label: "Whale",
    depth: -180,
    focusY: 20,
    distance: 30,
    height: 14,
    fov: 42,
    fog: 0.0028,
    blurb: "The whole repo as an animal. Every data point visible.",
  },
];

// ---------------------------------------------------------------------------
// Orbital planes — Keplerian, innermost to outermost
// ---------------------------------------------------------------------------

export const ORBITAL_PLANES = {
  // Builders: innermost, fast, tight, near-circular — purposeful coordination
  BUILDERS: { radius: 7.5, speed: 0.34, inclination: 0.04, eccentricity: 0.02, phase: 0.0 },
  // Resolutions: calm slow spiral, slightly inclined
  RESOLUTIONS: { radius: 11.0, speed: 0.19, inclination: 0.16, eccentricity: 0.10, phase: 1.1 },
  // Problems: erratic, wide, steeply inclined
  PROBLEMS: { radius: 15.0, speed: 0.27, inclination: 0.38, eccentricity: 0.34, phase: 2.3 },
  // Offspring: trailing wide ellipse behind the parent whale
  OFFSPRING: { radius: 19.5, speed: 0.13, inclination: 0.24, eccentricity: 0.22, phase: 3.4 },
  // Admirers: outermost, slow, near-horizontal drift
  ADMIRERS: { radius: 25.0, speed: 0.07, inclination: 0.07, eccentricity: 0.06, phase: 4.6 },
};

// ---------------------------------------------------------------------------
// Trophic levels — who eats whom, enforced per group
// ---------------------------------------------------------------------------

export const TROPHIC_LEVELS = {
  APEX: 5, // dolphins, billfish
  HIGH_PREDATOR: 4.5, // barracuda, mantis shrimp
  MESOPREDATOR: 3.5, // grouper, moray eel
  PASSIVE: 2.5, // turtles, jellyfish
  ZOOPLANKTON: 2, // krill, copepods
  STRUCTURAL: 1, // kelp, coral, tube worms — not predators
};

// ---------------------------------------------------------------------------
// Whale species — 5 variants, assigned by repo character
// ---------------------------------------------------------------------------

export const WHALE_SPECIES = {
  // Fast, prolific, high commit frequency
  BLUE: {
    id: "blue",
    name: "Blue Whale",
    scientific: "Balaenoptera musculus",
    length: 30,
    build: "sleek",
    color: COLORS.whaleDorsal,
    trait: "Largest animal ever — a repo with the biggest commit history.",
  },
  // Social, many contributors, fork-friendly
  HUMPBACK: {
    id: "humpback",
    name: "Humpback Whale",
    scientific: "Megaptera novaeangliae",
    length: 15,
    build: "robust",
    color: 0x2b4a63,
    trait: "Sings regional dialects — language identity made audible.",
  },
  // Long-lived, stable, slow-moving
  BOWHEAD: {
    id: "bowhead",
    name: "Bowhead Whale",
    scientific: "Balaena mysticetus",
    length: 18,
    build: "massive",
    color: 0x1a2c3a,
    trait: "Lives over 200 years — a repo that has outlasted its peers.",
  },
  // Deep diver, holds its breath, batchy commits
  SPERM: {
    id: "sperm",
    name: "Sperm Whale",
    scientific: "Physeter macrocephalus",
    length: 16,
    build: "blocky",
    color: 0x33383d,
    trait: "Dives deepest — a repo that goes quiet, then resurfaces with a burst.",
  },
  // Fast, migratory, sprints
  ORCA: {
    id: "orca",
    name: "Orca",
    scientific: "Orcinus orca",
    length: 9,
    build: "streamlined",
    color: 0x101820,
    trait: "Apex hunter in pods — a small repo with outsized influence.",
  },
};

export const WHALE_SPECIES_LIST = Object.values(WHALE_SPECIES);

/** Pick a whale species from repo stats. Deterministic, explainable. */
export function assignWhaleSpecies(repo) {
  const commits = repo.commitFrequency || 0;
  const contributors = repo.contributors || 1;
  const age = repo.ageDays || 0;

  if (contributors >= 6 && commits >= 8) return WHALE_SPECIES.HUMPBACK;
  if (commits >= 14) return WHALE_SPECIES.BLUE;
  if (age >= 900) return WHALE_SPECIES.BOWHEAD;
  if (commits <= 3 && age >= 300) return WHALE_SPECIES.SPERM;
  return WHALE_SPECIES.ORCA;
}

// ---------------------------------------------------------------------------
// Language → whale song (real: cetacean populations have distinct dialects)
// ---------------------------------------------------------------------------

export const LANGUAGE_SONG = {
  JavaScript: { base: 196.0, wobble: 0.35, timbre: "bright" },
  TypeScript: { base: 174.6, wobble: 0.22, timbre: "structured" },
  Python: { base: 146.8, wobble: 0.18, timbre: "warm" },
  Rust: { base: 110.0, wobble: 0.08, timbre: "metallic" },
  Go: { base: 130.8, wobble: 0.12, timbre: "clean" },
  Java: { base: 98.0, wobble: 0.10, timbre: "deep" },
  "C++": { base: 82.4, wobble: 0.05, timbre: "ancient" },
  C: { base: 73.4, wobble: 0.04, timbre: "ancient" },
  Ruby: { base: 164.8, wobble: 0.28, timbre: "warm" },
  "C#": { base: 155.6, wobble: 0.14, timbre: "clean" },
};

export const DEFAULT_SONG = { base: 123.5, wobble: 0.2, timbre: "neutral" };

// ---------------------------------------------------------------------------
// Language colour — GitHub linguist palette
// ---------------------------------------------------------------------------

/**
 * The canonical per-language colour. Mirrors the GitHub linguist palette so a
 * tower's hue is instantly recognisable as its language.
 */
export const LANGUAGE_COLORS = {
  JavaScript: 0xf1e05a,
  TypeScript: 0x3178c6,
  Python: 0x3572a5,
  Rust: 0xdea584,
  Go: 0x00add8,
  Java: 0xb07219,
  "C++": 0xf34b7d,
  C: 0x555555,
  "C#": 0x178600,
  Ruby: 0x701516,
  Kotlin: 0xa97bff,
  Swift: 0xf05138,
  PHP: 0x4f5d95,
};

export const DEFAULT_LANGUAGE_COLOR = 0x8b9bb0;

/** Resolve a language name to a hex colour int. */
export function languageStyleColor(language) {
  if (!language) return DEFAULT_LANGUAGE_COLOR;
  if (LANGUAGE_COLORS[language] != null) return LANGUAGE_COLORS[language];
  // Case-insensitive fallback so "javascript" still resolves
  const key = Object.keys(LANGUAGE_COLORS).find(
    (k) => k.toLowerCase() === String(language).toLowerCase()
  );
  return key ? LANGUAGE_COLORS[key] : DEFAULT_LANGUAGE_COLOR;
}

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------

/** Tower height in scene units from a repo's commit history length. */
export function towerHeight(repo) {
  const commits = repo.totalCommits || repo.commitFrequency * 52 || 200;
  return 6 + Math.sqrt(commits) * 1.15;
}

/** Tower girth from contributor count. */
export function towerGirth(repo) {
  return 0.55 + Math.sqrt(Math.max(1, repo.contributors || 1)) * 0.22;
}

/** Whale body length in scene units from codebase size. */
export function whaleLength(repo) {
  const kb = repo.codebaseSize || 500;
  return 2.6 + Math.sqrt(kb) * 0.09;
}