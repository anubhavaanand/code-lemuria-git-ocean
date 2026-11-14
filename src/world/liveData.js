/**
 * Git Ocean — the seam between the API's records and the world that is standing.
 *
 * `OceanWorld` builds its whole scene synchronously in the constructor and runs
 * from mock data. Wiring the real API in naively would mean blocking the
 * constructor on a network request, which is how a scene ends up blank behind a
 * spinner — the opposite of the constitution's render-first principle.
 *
 * So the world builds from whatever data it already has, and this module is where
 * the real records land. It holds:
 *
 *   applyLiveToRepo   — merge a live record over a standing tower, in place
 *   adoptIntoWorld    — the same for a whole profile
 *   toHudRepo         — a copy for React, because React cannot see a mutation
 *   placementFor      — where a new repository belongs in the district wheel
 *   worldRecordFromLive — the single constructor the scene trusts
 *
 * A tower's *identity* has to survive the swap. `id` is what picking returns and
 * what `entries` is keyed on, `position` is where the tower stands and the whale
 * orbits, and `depth` feeds the HUD readout. Re-deriving any of them would
 * silently move the world under the user while they were looking at it.
 *
 * There is deliberately no `rebuild()`. Re-placing towers would mean disposing and
 * re-creating geometry, and the measured cost of that is a visible hitch — so a
 * live record keeps its place and only its numbers change.
 */

import { makeRepo, hashString } from "./worldData";

/**
 * Which fields a live record may change after a tower is standing.
 *
 * Everything here is a number, a flag or a label that feeds a scale, a colour, a
 * count or a creature's presence. Nothing here moves the tower, reorders the
 * world or changes what a click refers to — and nothing is a geometry field,
 * because a tower's height and girth are derived once at construction.
 */
export const ADOPTABLE = [
  "description",
  "language",
  "stars",
  "forks",
  "watchers",
  "contributors",
  "openIssues",
  "closedIssues",
  "openPRs",
  "mergedPRs",
  "totalCommits",
  "commitFrequency",
  "commitStreak",
  "codebaseSize",
  "ageDays",
  "isPrivate",
  "isArchived",
  "isFork",
  "license",
  "topics",
  "ciStatus",
  "testCoverage",
  "downloads",
  "deployments",
  "hasWiki",
  "homepage",
  "hasPages",
  "hasChangelog",
  "discussions",
  "releases",
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
  "preRelease",
];

/**
 * Merge a live record over a standing tower, in place.
 *
 * Returns the same object it was given, mutated. That is deliberate: the towers,
 * the whales and the legacy colonies all hold a reference to their repo object,
 * and returning a copy would leave every one of them reading the old numbers.
 * The HUD gets a new object instead (see `toHudRepo`), because React needs a new
 * reference to re-render.
 *
 * `id` and `owner` are excluded on purpose. `id` is the pick key; changing it
 * mid-flight would make a selected entry unreachable. `owner` is part of the same
 * identity. A live record whose owner disagrees with the standing tower is a
 * different repository that happens to share a name, and matching it here would
 * quietly rewrite one tower with another's data.
 */
export function applyLiveToRepo(repo, live) {
  if (!repo || !live) return repo;
  for (const key of ADOPTABLE) {
    if (live[key] !== undefined) repo[key] = live[key];
  }
  if (live.meta) repo.meta = Object.assign({}, repo.meta, live.meta);
  return repo;
}

/**
 * A copy for React.
 *
 * The scene keeps the mutated object because mutating it is what updates the
 * tower. React would not notice a mutation, so it gets a shallow copy — same
 * data, different reference, and a `__creature` key survives because it is copied
 * along with everything else.
 */
export function toHudRepo(repo) {
  if (!repo) return null;
  return Object.assign({}, repo, {
    meta: Object.assign({}, repo.meta),
  });
}

/**
 * The data the mock world drew, keyed by `${owner}/${name}`.
 *
 * A live record has to be matched to a tower by name, not by order: the API can
 * return repositories the mock data never had, and it can omit ones it did.
 * Keying by name makes "no matching tower" a normal case rather than an error.
 */
export function indexMockRepos(data) {
  const index = new Map();
  if (!data) return index;
  for (const repo of data.yourRepos || []) {
    index.set(`${repo.owner}/${repo.name}`, repo);
  }
  for (const repo of data.following || []) {
    index.set(`${repo.owner}/${repo.name}`, repo);
  }
  return index;
}

/**
 * Find the standing tower a live record belongs to.
 *
 * The mock world owns the viewer's own repositories under the literal owner
 * `"you"` — `makeRepo` defaults `owner: input.owner || "you"` and `YOUR_REPOS`
 * never overrides it — while a live record from the real profile carries the
 * real login, `anubhavaanand`. The two keys therefore never compared equal, so
 * every record fell through to `skipped`, `adoptProfile` reported
 * `updated: []`, and the HUD went on drawing mock numbers.
 *
 * This was invisible for a long time because it fails silently and looks like a
 * network problem: the census showed the REST fetches returning 200 for three of
 * the four repositories and still reported nothing adopted. The only honest
 * signal was `skipped` naming exactly the three repositories that had just
 * loaded.
 *
 * A name alone is not enough to match on, because a followed user's repository
 * can share a name with one of the viewer's. So the owner is compared, with
 * `"you"` treated as the alias it is for the viewer's own profile — and only
 * there.
 */
export function findTower(index, record) {
  if (!record || !record.name) return null;
  const direct = index.get(`${record.owner || "you"}/${record.name}`);
  if (direct) return direct;
  // Fall back to the viewer's own repositories, which the mock world files
  // under "you" whatever their real owner is.
  return index.get(`you/${record.name}`) || null;
}

/**
 * Fold a profile's live records into the standing world.
 *
 * Returns `{ updated, skipped }`. `skipped` names the live records that had no
 * tower to update — worth reporting, because they mean the API knows about a
 * repository the world does not draw, and that is a difference a user should see
 * rather than have silently swallowed.
 */
export function adoptIntoWorld(data, live) {
  const index = indexMockRepos(data);
  const updated = [];
  const skipped = [];

  for (const record of live || []) {
    const key = `${record.owner || "you"}/${record.name}`;
    const repo = findTower(index, record);
    if (!repo) {
      skipped.push(key);
      continue;
    }
    applyLiveToRepo(repo, record);
    updated.push(key);
  }

  return { updated, skipped };
}

/**
 * Where a live repository belongs, if it has no tower.
 *
 * The authored districts are angular sectors radiating from the obelisk — there
 * is no fixed (x, z) per language, only a sector count and a band of radii, which
 * is what `generateAmbientTowers` uses. So this picks the sector that matches the
 * language and scatters inside the band, the same construction the ambient mass
 * uses rather than a second convention that would put a new tower somewhere the
 * rest of the world does not agree with.
 *
 * `rng` is passed in rather than created here so the placement is reproducible for
 * a given repository: two loads of the same profile put it in the same place, and
 * a screenshot and a census agree.
 *
 * @param {object} record  a live world record
 * @param {Function} rng   a seeded 0..1 generator
 * @param {object} [cluster]  a capital cluster, for `dominantLanguage`
 * @param {number} [sectors]  how many language districts the wheel is cut into
 * @returns {[number, number]} x and z in the cluster's frame
 */
export function placementFor(record, rng, cluster = null, sectors = 5) {
  const language = (record && record.language) || "Unknown";
  const dominant = cluster && cluster.dominantLanguage;

  // A language that is the cluster's dominant one takes sector 0; any other is
  // placed by a stable hash of its name, so the same language lands in the same
  // sector on every load instead of wandering between them.
  const sector =
    dominant && language === dominant
      ? 0
      : Math.floor(((hashString(language) % 1000) / 1000) * sectors) % sectors;

  // A scatter, not a grid: repositories in one district are not at even
  // intervals, and an even grid is the tell that a world is procedural.
  const angle = (sector / sectors) * Math.PI * 2 + (rng() - 0.5) * 0.42;
  const radius = 90 + rng() * 190;

  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/**
 * Build a world record from a live one, for a repository the world does not have.
 *
 * `makeRepo` is the single constructor the scene trusts: it derives the whale
 * species and fills every creature default. Building a record by hand here would
 * mean two places to change when a creature is added, which is how a creature
 * silently stops appearing.
 */
export function worldRecordFromLive(live) {
  if (!live) return null;
  const record = makeRepo(Object.assign({}, live));
  // The first pass already assigned an id, and the scene's `entries` map is keyed
  // on it. Re-deriving it would change what a click refers to.
  if (!record.id && live.id) record.id = live.id;
  return record;
}