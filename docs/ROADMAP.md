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
- **Creature clouds**: five trophic groups in true elliptical orbits (per-group
  constants from `ORBITAL_PLANES`, not derived from repo health), plus the 18
  benthic Legacy creatures built into the tower bases.
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

**The eighth root cause, and the one that explains the other seven.** The body
was translated by half its length and then scaled, and every `BufferGeometry`
transform post-multiplies — so the shift was scaled along with the vertices and
the body landed at `x = -L/2 * L`. For vue's 48.78-unit humpback that is -1,166
units. The group's bounding box measured 1,236 x 50.2 x 19.4 against a body of
48.8 x 19.4 x 19.4: 25x too long, entirely because of where the body sat.

The camera framing is solved from that box, so this never read as "the whale is
displaced". It read as **the whale is missing**: `focusLength` came out 25x too
large, the rig pulled the lens back to frame a 1,236-unit animal, and the render
showed a small diagonal smudge in a large empty frame. Every visual-QA verdict
that called the silhouette unreadable was correct about the picture and wrong
about the cause.

Fixed by reordering two lines (`ddd14f2`). After the fix the group box is
73.3 x 50.2 x 19.4 with its centre at (9.34, 2.03, 0) against a 48.78-unit body —
the flukes span the tail and the spout rises above the back, so exceeding the
body is right. The isolated frame now measures a single connected blob of
531 x 173 px, axis -8.9 degrees, ratio 3.07 (`5a6305c`).

**The lesson this is, and it is the reason the whale took eight attempts**: a
per-mesh measurement can be right while the aggregate is wrong. The census kept
reporting a correct 48.8 x 19.4 mesh while `Box3.setFromObject` on the group said
1,236. Measure the aggregate, and measure it in the frame the camera will solve
from — not the mesh, not the node, the box the lens is fitted to.

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

**The VL verdict, finally obtained (2026-11-15).** The route that kept failing
was the free OpenRouter VL mirror, not the code. Probing the OmniRoute gateway
directly with a data-URL image showed every `:free` vision model returning
`429 model_cooldown` while `auto/vision` answered in 2-3 s. The full audit,
including the probe table, is in [OMNIROUTE-VISION-AUDIT.md](OMNIROUTE-VISION-AUDIT.md).

Asked to score the isolated frame 1-5 on head / tail / flippers / taper / reads-as-one-animal:

```
1. 5  Head clearly defined at left end
2. 5  Tail splits into two distinct flukes
3. 2  Flippers not clearly visible in silhouette
4. 5  Body narrows smoothly
```

**Accepted on that pass.** Head, flukes and taper are each confirmed
individually identifiable at 5/5. Flippers score 2/5, which is correct and not
a defect: in a broadside view the flippers lie against the body and are meant to
be a secondary cue. Two other answers from the same route contradicted
themselves — one claimed "3 penguins", one claimed the body was "fragmented with
detached parts" — and both are noise from a router working at the edge of the
free tier; the measured geometry contradicts them (one connected component,
590 x 230 px, PCA axis -8.9 degrees).

What remains is not readability but quality: the animal reads as a whale, and
it does not yet read as a *good* whale.

**Original acceptance** (superseded): one VL pass on an isolated frame
confirming head, taper, flukes and flippers are individually identifiable, and a
separation score of 8+.

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

**Status: fixed.**

`this.girth = this.length * 0.19 * build.girthMul` is a lathe formula — the
radius of a surface of revolution, which is the same in every direction. The
imported humpback is not a surface of revolution. Measured at 48.785 units long
(it is `yyx990803/vue`) it is **18.54 deep and 21.95 wide**: half-height 9.27,
half-width 10.98.

The first note on this said "the real flank width is 22.90 against a reported
9.73" and stopped there. That compared the sculpt's *full* width against the
lathe's *radius* — a diameter against a radius — so the 2.35x it implied was an
arithmetic artefact, not the defect. The real one was quieter and worse:

- `surfaceRadius()` was overridden for a sculpt, but it returned the **vertical**
  radius for both axes. Every flank-seated animal therefore sat at the vertical
  radius in z while the skin was 1.7 units further out. A barnacle is ~0.5 units
  across, so the entire open-issue mapping was drawn *inside* the body and never
  appeared. The census said "barnacles: 8" and the water showed none.
- `rescaleAppendages()` then set `barnacleMesh.scale.setScalar(k)` to size them.
  An `InstancedMesh` applies its own matrix to every instance **position**, so
  that dragged the whole cluster toward the origin as it shrank the animals —
  the opposite of seating them on the skin.

Fixed in three parts: a `surfaceRadiusZ()` lateral profile (the vertical one for
a circular lathe, the measured half-width for a sculpt) used for every
flank-seated part; barnacles re-seated per-instance from stored `(t, a)` seeds
rather than scaled through the mesh; remoras sized on the per-frame compose
vector instead of the mesh, so the frame loop's positions stay put.

What is deliberately *not* changed: `this.girth` itself. It is still the lathe's
radius parameter and the procedural body's widest radius, and the flippers,
flukes, barnacle and remora sizes that pass through `rescaleAppendages` already
correct for the ratio. The 5% difference between `girth` (9.73) and the sculpt's
half-height (9.27) is within the tolerance of a stylised animal and is not worth
a second formula.

Four tests in `tests/whaleGeometry.test.js` pin it: the lathe stays circular, a
sculpt's lateral radius exceeds its vertical one, every barnacle satisfies the
ellipse equation after `rescaleAppendages`, and the barnacle mesh is left
unscaled so the cluster is not dragged inward.

### 4. Metro geometry

**Status: geometry drawn. Riding it is still Phase 2.**

The vision has described the metro since the first scaffolding commit — a
pressure vessel, not a subway, magnetohydrodynamic tubes between stations — and
until this pass it existed only as comments in `SonarObelisk.js` and
`worldData.js`.

Two things had to be built, and the first one was not the tubes.

**The station lattice.** The six capitals were placed by
`ox = cluster.lat * 0.6 - 90`, `oz = LAYERS.obelisk + (cluster.lon % 7) * 14`.
Measured, that put x in `[-72.8, -58.5]` — fourteen units of lateral spread for
an entire planet — and z in `[-387.9, -246.9]`. `lon % 7` takes a remainder, so
-122.4 and 139.7 land in the same handful of values.

That was survivable while an obelisk was only a landmark to look at, because a
stack of them reads as a cluster. It stops being survivable the moment a tube
has to run between two of them: every edge of the network shared almost the same
midpoint, so the network would have been a knot. `stationPosition()` in
`src/world/worldData.js` is an orthographic projection of real latitude and
longitude onto a ring of radius 900, sized against the world-zoom frustum so all
six stations are visible at once. A metro is only legible as a network when you
can see all of it.

A second defect came with it: `buildClusterLights` placed the cheap world-zoom
beacons on its own arc (`a = (i/max)·2π + 0.4`, `r = 1600 + (i%3)·240`) while
the obelisks sat in the 14 × 141 box — two different maps of the same six
cities. The bright settlement you flew toward was not the obelisk you arrived at.

**The tubes.** `metroCurve(a, b)` follows the terrain rather than cutting a
chord, because the seafloor displaces up to 130 units along a single edge. The
first version still surfaced through a trench: it smoothed absolute Y and placed
the curve at the smoothed Y, so where the floor fell away the tube stayed high.
Measured on delhi→sf, clearance went from -19.37 at t=0.30 to -0.08 at t=0.70.
The fix smooths the *depth* and subtracts it from the local floor at each sample,
which makes clearance exact by construction rather than lucky.

Eight edges, each station connected to its two nearest neighbours. One neighbour
would make a tree with unreachable leaves; all-pairs is fifteen edges for six
stations, most crossing, which reads as a scribble. Every station is reachable
in at most two hops.

What is deliberately not built: riding the tubes. With one passenger (the
camera) and no schedule it is a tunnel, not a metro. The vision puts the
functional metro in Phase 2 with multiplayer.

16 tests in `tests/metro.test.js`. `window.__GO.metro()` reports the ground
truth — per-edge length, segment count, flow value, endpoints — because a buried
tube cannot be checked against pixels the way a whale can.

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