# Intent log

A running record of what the user has asked for in this project, in their own
framing, with the date each instruction arrived. This exists because the user
explicitly asked for it ("starting noting all my commands locally") — so the
requirements survive context compression and later sessions.

Format: newest first. Each entry keeps the user's own words where they carry
weight, then a plain statement of what it means for the work. Anything marked
OPEN is not yet done.

---

## 2026-11-14 — Depth, performance, quality, then interactivity, then backend

The user's message, paraphrased at length because it packs several instructions:

> "when you're done with your current work, focus on improving the depth of the
> website, the performance and quality. You can use taste skill if it helps with
> fonts and colours. And also research and plan on interactivity and actively
> work on more depth interactivity for users and everything explorable.
> You can use any subject model unless it's a free one, and use vision models
> most of the time after you're done with the code so a vision model could see
> the colour, font and designing and the elements working or not, or any issue
> or quality or performance. Project then you can fix by code and an agent can
> also help you work on the vision I had together because it could see the
> vision. You can use search and do research on these as well. Also you can use
> Firecrawl but only do it yourself, and max up to 50 Firecrawl commands/requests.
> Keep working. And after this you can work on backend. And also you can clone
> GitCity in this project folder, don't forget to put it in gitignore. Watch the
> GitCity project for reference and design on how they made their world
> interactive and how users are interacting with it — you can use vision models
> here as well for that — and then implement my vision even better.
> After all this you should write proper commits for specific features and pull
> PR of all, don't merge — I will review and do it myself. Just push PR and open
> it on GitHub. And after opening the PR, use another subagent, a free one with a
> good context window, to analyze our local repo, do the deep code analysis and
> find and create all issues. And a vision model to find and create all issues
> on the actual frontend of the website. And after this, you yourself take all
> the issues and verify if they're real and genuine, not hallucinated, then label
> them all according to priority and tags."

Broken into ordered instructions:

1. **Local intent log** — start noting the user's commands locally. (this file)
2. **Depth, performance, quality** — the main push, after the whale work.
3. **Taste skill** — allowed for fonts and colours.
4. **Interactivity research + plan, then implement** — deeper, more explorable.
5. **Vision models most of the time after the code is done** — so a vision model
   can see colour, font, design, and whether elements work; then fix in code.
   An agent can help with the vision the user had in mind.
6. **Search + research** allowed. **Firecrawl** allowed but **only invoked by the
   assistant directly**, capped at **50 commands/requests total**.
7. **Backend** work comes after the above.
8. **Clone GitCity into this project folder** (gitignored) and study how they
   made their world interactive and how users interact with it — vision models
   allowed for that too — then implement the user's vision even better.
9. **Commits**: feature-specific, proper messages.
10. **Open a PR with everything, do not merge.** The user reviews and merges.
11. **After the PR**: a free subagent with a large context window does deep code
    analysis on the local repo and files all the issues.
12. **A vision model** files all the issues on the actual frontend.
13. **The lead then verifies every issue** — real and genuine, not hallucinated
    — and only then labels them by priority and tag.

### Constraints carried from earlier in the project (still binding)

- Frontend and frontend only was the original scope; the 3D version is deferred
  to a future major version (m00334).
- The design law: every element must be scientifically or technically
  explainable within the ocean's own logic. Fantasy is allowed only if it
  follows real physics, real biology, or real engineering.
- Visual benchmark: Bruno Simon's portfolio, stylised realism.
- GitHub Pages deploy is manual only (`workflow_dispatch`), never on push.
- The whale GLB is CC BY 4.0 (Unit299e, Sketchfab) and must be credited on
  screen while displayed.

### Progress against this brief

Work done so far, in order, each as its own commit:

- `24ec9de` **feat(perf): measure the frame budget instead of guessing at it.**
  New src/world/perf.js: interval EMA, worst case, 4 ms histogram, CPU update
  time, draw calls / triangles / programs. Opt-in behind `?debug=perf`, no-op by
  default. Measured baseline at city zoom: 728 draw calls, 201,230 triangles, 810
  geometries, 25 programs. 810 geometries against 728 calls means nearly every
  geometry is its own draw call — nothing is batched.
- `5d12eb1` **fix(ui): load the fonts the CSS has been asking for.** Inter and
  JetBrains Mono were named in the token block from the first commit and never
  loaded, so every review so far was of the platform fallback. Also fixed
  index.html's critical style, which set #001122 against a --go-abyss of #00060f.
- `c30de38` **fix(ui): lift the faintest ink to an accessible contrast.**
  --go-ink-faint was 3.95:1 at 10.5px; now 5.36:1. Rest of the palette checked
  and passing AA.
- `becbba1` **feat(perf): report which renderer produced the numbers.** The
  census names the GL renderer, because headless Chrome here is SwiftShader — a
  CPU rasteriser — and a frame rate from it is not the user's experience.

Also landed in the same pass: distance culling for legacy fauna (both the CPU
update and the draw), and a guard on the rocks census that was throwing under
`?only=whale` and making the report node come back empty.

- `cdf3c49`, `532b899`, `766a489` **perf: instance everything that repeats.**
  Growth rings, then the legacy fauna in two batches. Calls 728 → 707 → 608 →
  533, geometries 810 → 772 → 598 → 539. Triangles rose slightly (200,974 →
  202,158) and that is expected: instancing draws every instance every frame,
  where separate meshes let three frustum-cull the off-screen ones.
- `ef3422e` **feat(interactivity): show which tower is selected, and what is
  clickable.** `selectedId` was written and never read — nothing in the scene
  drew a selection. New src/world/SelectionMarker.js: a hover ring and a select
  ring plus a pulse climbing the stipe. Both take the tower's own language
  colour. Picking was restructured rather than duplicated: `_pickAt()` returns
  the tower and stashes the id, and hover is resolved once per frame in
  `_loop()` because pointermove fires far more often than a frame.
- `6fa86e9` **fix(fauna): make the two invisible creatures countable.**
  buildCopepods and buildAmphipods drew and animated but assigned no `this.*`
  field, so the census could not see them. Census 73 → 87 creatures.
- `8ec204f` **feat(codex): explain any creature, in the world's own logic.**
  New src/world/codex.js — one entry per creature with field, meaning and the
  ecological argument. The design law is enforceable by a reader now, not just
  asserted in the source.
- `78d4547`, `a7b95c7`, `7866717` **feat(picking): a click on an animal names the
  animal.** `LegacyColony` tags every creature root and resolves a hit back
  through them. Found and fixed two real bugs on the way: the parrotfish scar
  resolved to nothing, and the basking shark's shadow was swallowing 87 of 154
  rays meant for the tower.
- `6404d63`, `c8d6c63` **feat(hud): name what the pointer is over, and what this
  colony built.** A hover tooltip and an explore readout.
- `2a90e0d` **feat(keys): arrow keys step between zoom levels.** Number keys
  jump absolutely, arrows move relative. Plus a guard so shortcuts never steal
  keystrokes from a text field.
- `baf620d` **fix(hud): the readout collapsed to nothing on phones.**
  `calc(100vw - 460px)` goes negative below 460px.

### What the measurements say to do next

1. **Draw calls.** Started at 728; now 533 after instancing the growth rings and
   the legacy fauna. What is left: 23 towers (7 named, 16 ambient) at roughly 30
   calls each — 7 kelp sub-objects each — plus creature clouds, obelisks, the
   seafloor, rocks and the ocean layers. The next win is the kelp tower itself:
   its seven sub-objects per tower are the largest remaining repeated cost.
2. **Interactivity depth.** Done in this pass: selection, hover, per-creature
   picking, the codex, a hover tooltip, an explore readout, keyboard stepping.
   Still open: camera flights between related things — a tower, its whale, and
   its colony are three views of one repo and nothing moves you between them
   except the zoom rail.
3. **Vision passes.** Still blocked on the VL route; numeric analysis has been
   the substitute and has caught every real defect in this pass.

### State at the time this log was started

- Last commit at the time of writing: dd831b6, preceded by 2efbb1a. All pushed
  to origin/main.
- Working tree clean.
- Open from earlier: relay the Nemotron asset report (b14).

---

## Earlier entries

The conversation before this file existed is captured in the project's own
history rather than here: the README documents the vision and the creature map,
docs/VISION.md holds the design law and the phasing, and docs/ROADMAP.md holds
what is done and what is next. Those three are the canonical statement of the
project; this log only records instructions that arrived as chat.