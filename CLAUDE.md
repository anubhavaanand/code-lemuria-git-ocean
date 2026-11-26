# Git Ocean — notes for working in this repo

A GitHub profile rendered as a 3D ocean: repositories are whales, commit history
is kelp, and every visual element is supposed to correspond to a real data point.
React 18 + Three.js + Vite. Tests are vitest, in `tests/`.

`docs/VISION.md` is the *why*. Read it before changing anything visual — it is
short, and §9 records claims the build does not actually support, so do not
re-derive those from the marketing copy in `README.md`.

## The one rule

**Every element must be scientifically or technically explainable.** If a
creature, colour or orbit cannot be justified in one sentence from a real field,
it does not belong. `VISION.md` §2 has the test: *could a marine biologist and a
software engineer explain this in the same sentence?*

Practical consequence: when adding a visual, name the source field in a comment.
When you cannot, you have found a decoration, not a feature.

## Verifying visual work

Claude cannot see images. Do **not** claim a visual fix works because the code
looks right or a subagent said so.

- Measure pixels: luminance grids, connected components, principal axes, colour
  masks. Or delegate to a VL subagent, which fails silently about half the time —
  confirm its answer against a measurement.
- Measure the **aggregate**, not one node. A per-mesh box can be correct while
  the group is 25x too large; `Box3.setFromObject` on the group is the number the
  camera actually solves from.
- Use the census hooks rather than eyeballing: `window.__GO` in the console, or
  `?debug=whale`, `?debug=fauna`, `?debug=rocks`, `?debug=perf` in the URL.
  (`window.__GO.colonies()` exists but has no `?debug=` flag — call it from the
  console.)
- If a fix changes a number the camera solves from, add a unit test that pins the
  arithmetic. `tests/whaleGeometry.test.js` is the model: it builds a real
  `WhaleWithSculpt` in Node and asserts on measured geometry, no WebGL needed.
  For pure arithmetic over a few fields, call the method on a bare object with
  only those fields set.

## Writing code here

- **`girth` is a lathe formula, not a measurement.** It is only correct for the
  procedural body. A part that must survive a sculpt swap reads
  `surfaceRadius()` (position on skin), `bodyDiameter()` (size), or is re-seated
  by `WhaleFactory.rescaleAppendages()`.
- **`xAt(t)` interpolates nose→tail**, in body-local units, clamped to `[0,1]`.
  It is the x coordinate of a station *on the body*, not in the world — parts
  placed with it still need the group's transform.
- Determinism matters: mock data is seeded (`makeRng`), so two loads must agree.
  A screenshot pass and a census pass are only comparable if the world is stable.
- Comments explain *why*, including what was tried and failed. This codebase's
  comments are load-bearing; match that register rather than adding narration.

## Commits and PRs

Scoped conventional commits, one logical change each:

```
fix(whale): size the blowhole and plume from the sculpt, not the lathe
feat(world): put the deep ocean language colonies in the water
docs(roadmap): the same Keplerian overstatement lived here too
```

The body explains the defect and the reasoning, not the diff. PRs are opened as
drafts and stay drafts until a human reviews them.

## Tests

`npm test` runs vitest. `npm run build` builds. CI (`.github/workflows/ci.yml`) runs
both on every push and PR; `deploy-pages.yml` is manual-only by design.

Tests live in `tests/` and import from `src/`. They run in Node — no WebGL, no
DOM unless a test installs one. Prefer testing arithmetic and data derivation
over rendering.

## Layout

```
src/world/     scene graph: OceanWorld, KelpTower, RepoWhale, WhaleFactory,
               OceanEnvironment, Metro, LegacyCreatures, CameraRig, constants
src/services/  GitHub API, cache, auth, repo adapters — the data layer
src/ui/        HUD, AuthCallback — React, the only place that renders chrome
tests/         vitest, one file per concern
worker/        Cloudflare Worker for OAuth token exchange
docs/          VISION (why), ROADMAP (state + working method), INTENT-LOG
```
