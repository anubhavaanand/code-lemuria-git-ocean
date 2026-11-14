/**
 * Git Ocean — the codex
 *
 * One entry per creature in the world: what it is, which GitHub field it is
 * driven by, and — the part that makes the design law enforceable — why that
 * creature and not another.
 *
 * This lives outside the scene on purpose. The builders know how to draw a
 * thing; they should not also have to know how to explain it. Keeping the
 * explanation in one place means the HUD can offer an entry for every creature
 * without each builder carrying prose, and it means a reviewer can check the
 * whole mapping in one read rather than across eighteen methods.
 *
 * `biology` is the honest answer to "why does a README make a coral?" — the
 * project's rule is that every element must be explainable within the ocean's
 * own logic, and this field is where that argument is written down.
 */

/**
 * @typedef {object} CodexEntry
 * @property {string} name     creature key, matches the registry
 * @property {string} label    display name
 * @property {string} field    the GitHub field that drives it
 * @property {string} meaning  what a change in that field looks like here
 * @property {string} biology  the ecological argument for the mapping
 * @property {string} trophic  benthic | stipe | water column
 */

/** @type {Record<string, CodexEntry>} */
export const CODEX = {
  brainCoral: {
    name: "brainCoral",
    label: "Brain coral",
    field: "readmeQuality",
    meaning: "Deep, meandering folds on the sediment dome",
    biology:
      "A brain coral's grooves are its surface area, and surface area is how it " +
      "filters. A README is the repo's filtering surface: it decides what a " +
      "reader can take in. A structured one is folded; a bare one is a lump.",
    trophic: "benthic",
  },
  anemone: {
    name: "anemone",
    label: "Anemone",
    field: "hasCodeOfConduct",
    meaning: "A sessile polyp with stinging tentacles, present or absent",
    biology:
      "An anemone is a boundary. It sits still and decides what may come close. " +
      "A code of conduct does the same job for a community, so presence alone " +
      "is the honest mapping — there is no such thing as a weak code of conduct.",
    trophic: "benthic",
  },
  isopod: {
    name: "isopod",
    label: "Isopod",
    field: "hasIssueTemplate",
    meaning: "A trundling scavenger working the holdfast",
    biology:
      "Isopods are the animals that turn up when something is broken down in an " +
      "orderly way. An issue template is the orderly breakdown: it tells the " +
      "next person where the edges are.",
    trophic: "benthic",
  },
  urchins: {
    name: "urchins",
    label: "Sea urchins",
    field: "discussionsOpen",
    meaning: "One grazer per cluster of open discussions",
    biology:
      "Urchins graze. Open discussions are unresolved grazing — the community " +
      "is still working over an idea, and the count of them is the count of " +
      "animals on the rock.",
    trophic: "benthic",
  },
  copepods: {
    name: "copepods",
    label: "Copepods",
    field: "discussionsClosed",
    meaning: "Small translucent drifters, one per resolved discussion",
    biology:
      "Copepods are what is left after grazing: tiny, everywhere, and the base " +
      "of the food web. Closed discussions are resolved material, and resolved " +
      "material is what everything else feeds on.",
    trophic: "water column",
  },
  barnacleRing: {
    name: "barnacleRing",
    label: "Barnacle ring",
    field: "homepage",
    meaning: "A ring of cemented filter feeders around the stipe",
    biology:
      "Barnacles cement themselves and filter what the current brings. A project " +
      "homepage is the same posture — a fixed point that catches traffic the " +
      "repo would not otherwise see.",
    trophic: "benthic",
  },
  sponge: {
    name: "sponge",
    label: "Sponge",
    field: "hasWiki",
    meaning: "A tall filter column, present when a wiki exists",
    biology:
      "A sponge is passive infrastructure: it stands in the current and makes " +
      "the water usable. A wiki does that for a codebase, so it gets a body " +
      "rather than a behaviour.",
    trophic: "benthic",
  },
  featherStar: {
    name: "featherStar",
    label: "Feather star",
    field: "releases",
    meaning: "One arm per release, unfurled into the current",
    biology:
      "A crinoid climbs and spreads its arms to catch what drifts past. A " +
      "release is exactly that gesture: something thrown out into the water to " +
      "be caught, so each release is another arm.",
    trophic: "stipe",
  },
  amphipods: {
    name: "amphipods",
    label: "Amphipods",
    field: "downloads",
    meaning: "Scavengers swarming the holdfast, scaled by download count",
    biology:
      "Amphipods are the animals that arrive where material collects. " +
      "Downloads are material collecting, so the count of them scales with the " +
      "count of animals — not a fixed number that happens to look busy.",
    trophic: "benthic",
  },
  parrotfish: {
    name: "parrotfish",
    label: "Parrotfish",
    field: "hasChangelog",
    meaning: "A grazing fish working the stipe, present when a changelog exists",
    biology:
      "A parrotfish eats the reef and excretes sand — it is the animal that " +
      "turns structure into a record of what happened. A changelog is that " +
      "record.",
    trophic: "stipe",
  },
  nudibranch: {
    name: "nudibranch",
    label: "Nudibranch",
    field: "hasPRTemplate",
    meaning: "One brilliant, slow slug per template",
    biology:
      "Nudibranchs are conspicuous and unhurried: they advertise. A pull request " +
      "template is an advertisement of how work is meant to arrive, so it gets " +
      "the animal that makes the convention visible.",
    trophic: "benthic",
  },
  seahorse: {
    name: "seahorse",
    label: "Seahorse",
    field: "preRelease",
    meaning: "A hovering, anchored animal in the canopy",
    biology:
      "A seahorse is the one fish that swims upright and holds on with its tail: " +
      "unstable, deliberate, not yet swimming free. A pre-release is that " +
      "state exactly — published, anchored, not yet current.",
    trophic: "stipe",
  },
  grouper: {
    name: "grouper",
    label: "Grouper",
    field: "branchCount",
    meaning: "One large, slow fish per set of long-lived branches",
    biology:
      "A grouper is a big, territorial animal that holds a place rather than " +
      "roaming. Long-lived branches hold a place in the repository, so the " +
      "animal is a grouper and its size follows the count of them.",
    trophic: "water column",
  },
  cleanerWrasse: {
    name: "cleanerWrasse",
    label: "Cleaner wrasse",
    field: "hasContributing",
    meaning: "Small bright fish working a station on the stipe",
    biology:
      "Cleaner wrasse run a station where other animals come to be maintained. " +
      "A contributing guide is that station: it is where a newcomer is cleaned " +
      "up and made ready to join.",
    trophic: "water column",
  },
  coralPolyp: {
    name: "coralPolyp",
    label: "Coral polyps",
    field: "hasProjects",
    meaning: "A crown of polyps on the stipe, one per project board",
    biology:
      "A polyp is a tiny animal that builds structure by joining others of its " +
      "kind. Project boards are the same: individual units that only become " +
      "architecture in aggregate.",
    trophic: "stipe",
  },
  lanternfish: {
    name: "lanternfish",
    label: "Lanternfish",
    field: "hasDownloadsEnabled",
    meaning: "A string of photophores hanging below the canopy",
    biology:
      "Lanternfish carry their own light because they live where sunlight does " +
      "not reach. Downloads enabled is the repo's own light source: the thing " +
      "that makes it visible to someone who is not already looking.",
    trophic: "water column",
  },
  baskingShark: {
    name: "baskingShark",
    label: "Basking shark shadow",
    field: "readmeLength",
    meaning: "A vast, slow shadow crossing the whole tower",
    biology:
      "A basking shark is enormous and harmless — it moves through and is felt " +
      "more than seen. A long README is that: the largest single thing about a " +
      "repository, and the one a visitor notices before anything else.",
    trophic: "water column",
  },
  anglerfish: {
    name: "anglerfish",
    label: "Anglerfish",
    field: "securityScanning",
    meaning: "A dark body with one lit lure, in the deep water below",
    biology:
      "An anglerfish is the only animal here that hunts with a light. Security " +
      "scanning is exactly that: a thing that watches in the dark and shows you " +
      "only what it has caught.",
    trophic: "water column",
  },
};

/** Ordered for display: benthic first, then the stipe, then the water column. */
export const CODEX_ORDER = Object.keys(CODEX);

/** A single entry, or a placeholder for an unknown key. */
export function codexEntry(name) {
  return (
    CODEX[name] || {
      name,
      label: name,
      field: "unknown",
      meaning: "",
      biology: "",
      trophic: "unknown",
    }
  );
}