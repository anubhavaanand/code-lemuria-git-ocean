# Git Ocean — Roadmap

What is done, what is next, and — more usefully — *why* the order is what it is.

The through-line: **make the metaphor legible before you populate it.** Every
major defect found so far was a legibility defect, not a feature gap, and every
one of them was found by measuring pixels rather than by looking at code.

---

## Done

### Phase 1 — the personal dive (visual)

- **World geometry**: 2.5D layered depth — real depth spacing, fog and
  parallax, but not a full 3D sphere. Chosen deliberately over both a flat
  plane (no depth cues) and true 3D (unreadable at these scales).
- **Ocean environment**: depth gradient, animated caustics, god rays, water
  surface, marine snow, far ridges, horizon seal. All shader-driven.
- **Seafloor**: displaced terrain with vertex-colour sediment, outcrops, and a
  boulder field with a near band so the ground reads as ground.
- **Kelp towers**: one per repository. Height = commit history, blade density =
  contributors, sway = recent activity, caustics driven by CI status.
- **Whales**: one per repository, five species, size from commit history.
  Imported humpback sculpt where licensed; procedural lathe for every other
  species (see the Design Law note in `VISION.md` §2).
- **Creature clouds**: five trophic groups in real Keplerian orbits, plus the
  18 benthic Legacy creatures built into the tower bases.
- **Sonar obelisk**: silicon wafer marker for capital clusters.
- **Camera**: continuous five-level zoom rig with pointer look and pinch, and a
  subject-scaled focus that frames the animal rather than the tower.
- **HUD**: glass-over-water chrome, language tally, CC BY attribution for the
  imported sculpt.

### Build and deploy

- Vite + React 18 + three.js, 62 modules, ~1.1 MB of JS (302 kB gzipped).
- GitHub Pages deploy as **manual only** (`workflow_dispatch`), never on push —
  because a deploy on every commit is a deploy on every typo.
- `base: "./"` so the build works on a project path.
- Feature-grained commit history, each commit body explaining *why*.

### Performance

- **Draw calls: 728 → 664** at city zoom, measured with `?debug=perf`. Growth
  rings, the legacy fauna, and the kelp props are instanced; the stipe and the
  tube worms stay per-tower because they animate (`cdf3c49`, `532b899`,
  `766a489`, `bcc269d`).
- **The frame profiler reports its own renderer.** Every fps this project measured
  in headless Chrome came from SwiftShader, a CPU rasteriser — the number was
  real and it was not the user's (`becbba1`).
- **`/tmp` is a 5.8 GB tmpfs here, not the root filesystem.** A full tmpfs kills
  the shell dead (`ENOSPC` on every command, no output, no exit status) while
  the root has 55 GB free. The capture harness left ~4 GB of Chrome profiles
  there; check `df -h / /tmp` separately.
- **Cached responses persist to localStorage**, with `set()` refusing null: a
  rate limit lasting an hour must not become a mock world lasting a day
  (`3a89862`).

### API layer (built, and now wired)

`src/services/` contains the GitHub GraphQL layer and OAuth — `fetchRepository`,
`fetchViewerAndRepos`, `fetchRepositories`, `fetchCommitStats`,
`prefetchUserRepos`, `checkRateLimit`, a TTL cache, and an `AuthService`.

It was complete and unused for a while, because Phase 1's job was to prove the
metaphor reads before it is populated. It is wired now: `loadProfile` runs on
mount, the records land through `adoptProfile`, and the world re-derives the
whale from the real commit count. What is left is not wiring but scale — one
anonymous budget of sixty requests an hour covers a profile of four repositories
and its enrichment, and a signed-in user gets 5,000 points, so the API path is
correct and the anonymous one is a proof rather than a product.

Three things that wiring taught, all of them fixed:

- **React's StrictMode mounts twice in development.** The live pass ran twice per
  page view, so four repositories cost eight requests. The cache now shares the
  in-flight promise, not just the answer (`fab7dcc`).
- **The enrichment asked for the repository's own body again.** Seven requests
  per repository, one of them re-reading an answer the first pass already had,
  against sixty an hour (`3b36dab`).
- **A failed fetch was invisible.** The world falls back to mock data and looks
  correct, and the console is only readable with the devtools open — so the
  census now carries `liveIssues` (`f19b80a`, `fb1de41`).

---

## Next — in this order

### 1. Finish the whale readability pass

**Status: in progress, and it is the current blocker.**

The whale is the project's hero element — it is what a viewer's eye goes to
first, and it is the only element that is unmistakably an *animal*. It has been
through seven distinct root causes:

1. **Framing** — the whale zoom aimed at the tower's mid-height while the animal
   orbited 2.4x higher, so the lens pointed at water below it.
2. **Camera pitch** — 11 degrees down put the lens above the animal, showing its
   dark dorsal surface instead of its flank.
3. **Skin collapse** — `Object3D.clone()` shares the `Skeleton`, so every clone
   pointed its bones at the original scene's bones, which never get
   `matrixWorld` updated. The body was in the scene and being drawn as a speck.
4. **The Y axis** — `measuredExtent` was `axis === "x" ? getX : getZ`, so
   measuring height returned the nose-to-tail length. The body came out 0.22 of
   its length deep instead of 0.38.
5. **The pivot** — three correction formulas mixed local and parent space,
   putting the body 15.6 units below its tower.
6. **Heading** — wrong twice; the animal swam backwards around the whole orbit,
   and both wrong versions happened to be right at the one phase the screenshots
   used.
7. **Duplicate parts** — a procedural jaw and eyes on top of a sculpt that
   already had them, reading as a second animal superimposed.

What remains: the body's projected size now matches the prediction
(~280 x 100 px against a 266 x 101 prediction) and the skin colour reads, but
the silhouette still reads as a diagonal band rather than a clean broadside
animal, and **no visual-QA pass has confirmed it** — the VL route is failing
silently about half the time.

**Acceptance**: one VL pass on an isolated frame confirming head, taper, flukes
and flippers are individually identifiable, and a separation score of 8+.

### 2. Wire the API to the scene

**Status: done.** `loadProfile` runs on mount, the records land through
`adoptProfile`, and the whale is re-derived from the real commit count. The
mapping is `transformRepoData` → `apiToWorldRepo` → `makeRepo`, with the mock
values in `worldData.js` left as defaults rather than as data.

It was ordered after the whale deliberately: populating the world with real data
while the hero element is unreadable would entangle every future visual defect
with "and also the data is real now." One variable at a time.

What is left is not wiring but **scale**: sixty anonymous requests an hour covers
a profile of four repositories and its enrichment, and a signed-in user gets 5,000
points. The blockers below are still what a real launch needs.

**Blockers** (unchanged, and now the only ones on this item):
- **B1** — Cloudflare `account_id` → `wrangler.jsonc`.
- **B2** — GitHub OAuth `CLIENT_ID` / `CLIENT_SECRET` → `.dev.vars`.

### 3. Girth fiction

`this.girth = this.length * 0.19 * build.girthMul` is a lathe formula. For a
sculpt the real flank width is 22.90 units against a reported 9.73, so any
appendage seated against `girth` is misplaced. `surfaceRadius()` is already
overridden per-species from the measured profile, so most parts are fine — but
anything reading `girth` directly is wrong. Noted, not fixed.

### 4. Metro geometry

Referenced in comments in `SonarObelisk.js` and `worldData.js`, but no tube
geometry exists. Deliberately Phase 2: a city needs a map before it needs
transit.

### 5. Docs

- [x] `README.md` — vision, design law, creature map, world structure, inspiration.
- [x] `docs/VISION.md` — this roadmap's companion; the *why*.
- [x] `docs/ROADMAP.md` — this file.

---

## Deferred

- **Full 3D world** — a future major version. The 2.5D layered-depth build has
  to be good first; a half-finished 3D world would prove nothing the 2.5D one
  has not already proved.
- **Audio** — `LANGUAGE_SONG` exists in `constants.js` with a per-language base
  frequency, wobble and timbre, and is consumed by nothing. The mapping is
  designed; the implementation is not.
- **Obelisk skin voting** — 7-day epoch, culturally themed skins per cluster.
- **Onboarding**, **perf budget**, **rate limiting**, **user avatar**,
  **info-reveal UX**, **project naming** — all still open from the original
  design pass.

---

## Working method

Worth recording, because it is the reason this project has moved at all.

**I cannot see images.** Every visual judgement in this project has been made by
measuring pixels — luminance grids, connected components, principal axes,
colour masks — or by delegating to a VL subagent, which fails silently about
half the time.

That constraint produced better results than looking would have:

- It is how the skin-collapse bug was found. A visual QA pass said "no whale in
  the frame" three times. The *measurement* said the mesh's local extent was
  0.19 x 0.39 x 0.10 units against a geometry extent of 2.18 x 2.71 x 4.64 —
  the body was drawn as a speck, not missing.
- It is how the axis bug was found. The silhouette said the body was 0.206 as
  deep as it was long; the census said 0.38. Both could not be right, and the
  silhouette was the one with pixels behind it.
- It is how the pivot bug was found. Three correction formulas produced a
  byte-identical rendered offset, which is only possible if the block never ran
  or the numbers were never in the assumed space. Guessing from pixels would
  have produced three more formulas.

The lesson, now written into the code comments where the next person will hit
it: **a correction is only valid if the measured centre and the value it is
subtracted from are in the same space; and a census field that reports whether
a block ran is worth more than three rounds of guessing.**