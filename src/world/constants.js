/**
 * Git Ocean — World constants
 *
 * Re-themed to deep-ocean GitCity style: one seafloor, properly structured 3D,
 * GitHub info and endpoints shown as ocean animals with different animals per
 * data type.
 *
 * Per the Git Ocean Constitution:
 *  - Scientific Accuracy: every element explainable by marine biology / engineering
 *  - Stylized Realism: deep blue, bioluminescent glow, smooth forms (Bruno Simon benchmark)
 *  - Visual Render First: mock data before API wiring
 *  - Phase Architecture: Phase 1 = personal dashboard (read-only)
 *  - Creature Group Integrity: 7 groups, all data points mapped
 *
 * Coordinate system — one true 3D space, one floor:
 *   X  lateral position across the seafloor
 *   Y  height above the seafloor (SEAFLOOR_Y = 0 is the single floor)
 *   Z  depth into the water column (camera sits at +Z looking toward -Z)
 *
 * This replaces the earlier 2.5D layered cross-section (where LAYERS owned Z
 * and the camera dolled through stacked bands) with a single seafloor and real
 * 3D depth: towers grow up from Y=0, whales orbit in the water column above,
 * and the camera frames them in true perspective depth.
 */

// ---------------------------------------------------------------------------
// Palette — deep ocean, not space. No near-black background, no stars.
// Surface light filters from above; bioluminescence carries the dark.
// ---------------------------------------------------------------------------

export const COLORS = {
  // Water column — deep ocean gradient, darkest at depth but never pure black.
  abyss: 0x02050a,      // deepest water — very dark blue, not black
  midnight: 0x040e1e,   // bathypelagic
  deep: 0x081c33,       // mesopelagic lower
  mid: 0x0b3355,        // mesopelagic upper
  shallow: 0x0f557a,    // near-surface water
  surfaceGlow: 0x2d8fc0, // where surface light enters

  // Bioluminescence (real: dinoflagellates, ostracods, lanternfish)
  biolumCyan: 0x4deaff,
  biolumBlue: 0x3f95ff,
  biolumGreen: 0x5effbd,
  biolumGold: 0xffd479,
  biolumViolet: 0xa87bff,
  biolumRed: 0xff6b6b,

  // Whale skin (counter-shaded, like real cetaceans)
  whaleDorsal: 0x18304a,
  whaleLateral: 0x8fb6cf,
  whaleVentral: 0xf2f8fb,
  whaleScar: 0xffffff,

  // Kelp / flora — brighter so towers read against deep water
  kelpStipeDark: 0x24543a,
  kelpStipe: 0x3d8a4d,
  kelpBlade: 0x52a85c,
  kelpBladeLit: 0x7ed07a,
  holdfast: 0x4a3d31,

  // Seafloor
  sediment: 0x1d2630,
  sedimentLit: 0x324254,
  basalt: 0x141b22,

  // Silicon wafer obelisk (community landmark + metro base)
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
// One floor — the single seafloor everything stands on.
// ---------------------------------------------------------------------------

export const SEAFLOOR_Y = 0;

/** Height of the water surface above the seafloor. Camera ceiling for deep dives. */
export const SURFACE_Y = 420;

/**
 * Depth zones (real oceanographic layers), now expressed as Y height above the
 * single seafloor rather than as separate Z bands. The water column is one
 * continuous 3D volume.
 */
export const DEPTH = {
  sunlight: { min: 0, max: 200, label: "Epipelagic", fog: 0.0016 },
  twilight: { min: 200, max: 1000, label: "Mesopelagic", fog: 0.0026 },
  midnight: { min: 1000, max: 4000, label: "Bathypelagic", fog: 0.0042 },
  abyss: { min: 4000, max: 6000, label: "Abyssopelagic", fog: 0.0060 },
  hadal: { min: 6000, max: 11000, label: "Hadal", fog: 0.0085 },
};

/** Convert a real depth in metres to scene Y units above the seafloor. */
export const Y_PER_METRE = 0.01;

export function depthToY(metres) {
  return metres * Y_PER_METRE;
}

// ---------------------------------------------------------------------------
// One floor layers — collapsed from the earlier 2.5D band stack (-860..260)
// into a single coherent set of 3D positions above the seafloor.
// ---------------------------------------------------------------------------

export const LAYERS = {
  // Distant ridgeline at the back of the basin
  farRidge: -900,
  // Surface light shafts, far back in the volume
  godRays: -700,
  // Caustic light pattern on the sediment
  caustics: -550,
  // Marine snow volume
  marineSnow: -400,
  // Followed repos (far district)
  kelpForestFar: -220,
  // Community landmark (obelisk), behind the user's zone
  obelisk: -140,
  // Ambient towers (anonymous GitHub mass)
  ambientFar: -90,
  // Far whales
  whaleFar: -50,
  // User's own repos (near district)
  kelpForestMid: -10,
  // Water-column creatures
  creatures: 25,
  // Near whales
  whaleNear: 65,
  // Near kelp forest
  kelpForestNear: 110,
  // Near creatures
  creaturesNear: 155,
  // Ambient near schools
  ambientNear: 200,
  // UI overlay plane
  ui: 260,
};

// ---------------------------------------------------------------------------
// Camera — three zoom levels on one floor, true 3D perspective depth.
//
// `depth` is a real ocean depth (HUD readout + fog). `distance`, `height`,
// `focusY` are scene units in true 3D space above the single seafloor.
// ---------------------------------------------------------------------------

export const ZOOM_LEVELS = [
  {
    id: "deep",
    label: "Deep",
    depth: -4200,
    focusY: 120,
    distance: 1600,
    height: 700,
    fov: 62,
    fog: 0.00095,
    blurb: "The whole basin — capital lights and tower districts across the seafloor.",
  },
  {
    id: "tower",
    label: "Tower",
    depth: -520,
    focusY: 40,
    distance: 110,
    height: 55,
    fov: 48,
    fog: 0.00215,
    blurb: "A single repo tower — its whale and orbital creatures.",
  },
  {
    id: "whale",
    label: "Whale",
    depth: -180,
    focusY: 20,
    distance: 72,
    height: 16,
    fov: 42,
    fog: 0.0028,
    blurb: "The whole repo as an animal. Every data point visible.",
  },
];

// ---------------------------------------------------------------------------
// Orbital planes — Keplerian, innermost to outermost. One plane per creature
// group, mapped to GitHub data types (Builders = commits, Admirers = stars,
// Problems = issues, Offspring = forks, Resolutions = pull requests).
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

export function languageStyleColor(language) {
  if (!language) return DEFAULT_LANGUAGE_COLOR;
  if (LANGUAGE_COLORS[language] != null) return LANGUAGE_COLORS[language];
  const key = Object.keys(LANGUAGE_COLORS).find(
    (k) => k.toLowerCase() === String(language).toLowerCase()
  );
  return key ? LANGUAGE_COLORS[key] : DEFAULT_LANGUAGE_COLOR;
}

// ---------------------------------------------------------------------------
// Scale helpers
// ---------------------------------------------------------------------------

export function towerHeight(repo) {
  const commits = repo.totalCommits || repo.commitFrequency * 52 || 200;
  return 6 + Math.sqrt(commits) * 1.15;
}

export function towerGirth(repo) {
  return 0.55 + Math.sqrt(Math.max(1, repo.contributors || 1)) * 0.22;
}

export function whaleLength(repo) {
  const commits = repo.totalCommits || repo.commitFrequency * 52 || 200;
  return 0.28 * towerHeight(repo);
}