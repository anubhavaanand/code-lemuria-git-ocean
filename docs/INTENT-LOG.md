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

### What the measurements say to do next

1. **Draw calls.** 657 of the city zoom's 728 calls belong to the non-whale
   scene: 23 towers (7 named, 16 ambient) at roughly 30 calls each, being 7 kelp
   sub-objects plus 15-20 legacy creature meshes plus creature clouds. These are
   small repeated props sharing materials — the textbook case for merging or
   instancing. This is the single biggest performance win available.
2. **Interactivity depth.** GithubCity's entire interaction surface is a username
   form, orbit controls, an auto-rotate toggle, a shadow slider and an STL export.
   We already have picking, selection, a repo card, a legend, a zoom rail and
   five levels; what we lack is the *layer* between "look at it" and "understand
   it" — per-creature inspect, a codex, camera flights between related things.
3. **Vision passes.** Still blocked on the VL route.

### State at the time this log was started

- Last commit: 08481bf (screenshot refresh), preceded by ba4c971 (the whale
  measurement fix). Both pushed to origin/main.
- Working tree clean.
- Open from earlier: relay the Nemotron asset report (b14).

---

## Earlier entries

The conversation before this file existed is captured in the project's own
history rather than here: the README documents the vision and the creature map,
docs/VISION.md holds the design law and the phasing, and docs/ROADMAP.md holds
what is done and what is next. Those three are the canonical statement of the
project; this log only records instructions that arrived as chat.