# Git Ocean — Vision

This document is the *why*. The README is the sales pitch; the constitution is
the rules; this file is the intent. If a decision ever seems arbitrary, check it
against here first — most of it comes from one rule and one benchmark.

---

## 1. The Question

Most GitHub visualisations are dashboards: a grid of green squares, a bar chart,
a contribution graph. They answer **how much**. They cannot answer **what it
feels like**.

Git Ocean asks a different question:

> **What would your work look like if it were an ecosystem?**

Not "a chart wearing an ocean theme." An ecosystem the data *actually
describes*, where a repository with 12 contributors and 900 commits is a
different kind of animal than one with a single commit — and where you can read
the state of someone's work by looking at the water before you read a single
number.

The target experience is a dive, not a report: bioluminescence in the dark, kelp
moving in a current, a whale passing overhead whose colour tells you its primary
language and whose song is generated from it.

---

## 2. The One Rule

> **Every element must be scientifically or technically explainable within the
> ocean's own logic. Fantasy is allowed only if it follows real physics, real
> biology, or real engineering.**

This is the rule that keeps the project honest, and it is enforced, not
aspirational. The test is simple and unforgiving:

**Could a marine biologist and a software engineer both explain this creature,
in the same sentence, from the same field?**

- A whale's **size** is its codebase size — that is why a big repo is a big
  animal, and why it is slow.
- A kelp tower's **height** is its commit history. Five commits is a seedling;
  twelve thousand is a canopy reaching the light.
- **Orbits are real ellipses**, not circles with a wobble. Trophic level sets
  the radius, inclination and eccentricity, and `CreatureGeometry` solves a
  true-anomaly ellipse from them. Those planes are fixed per group: a failing
  pipeline does **not** change the path (§9 records why that sentence used to
  claim otherwise).
- **Bioluminescence is data.** Glow is recent activity. Colour is language. A
  dead repo does not glow.

Nothing is in this world because it looks good. It is there because it *means*
something, and the meaning survives being explained out loud.

**Where this rule has bitten:** the imported humpback sculpt was deliberately
restricted to the humpback species. A blue whale is a different animal, and
putting a humpback model on a blue whale's data would be exactly the
"unexplainable" failure the rule forbids — a smaller animal in the wrong body.
Species without a modelled body keep the procedural lathe and never pretend
otherwise.

---

## 3. The Benchmark

The quality bar is the **Bruno Simon portfolio**: stylised realism, not
photorealism. Everything is lit and shaded as if it were a real place, but the
shapes stay readable and the palette stays authored.

Concretely, this is why:

- **Realism without legibility** is a screenshot. You can see it; you cannot
  read it. Every element has to survive being looked at for two seconds and
  understood.
- **Stylisation without grounding** is a cartoon. It loses the "this could
  exist" quality that makes the ocean framing meaningful.

Stylised realism is the only register where both the data mapping and the
biological claim hold up at the same time.

Reference material used for actual shape and behaviour: `neal.fun/deep-sea`,
`coastalcreatures.com`, and *Aquatilis*.

---

## 4. The Inspiration

The project is a direct descendant of **honzaap/GithubCity** — a three.js piece
that turns one person's GitHub year into a city. The debt is explicit in the
README, and so is the distinction, which is the actual creative thesis:

- **GitCity renders a city that is *built*.** Buildings, blocks, streets. It is
  architecture, and architecture is finished.
- **Git Ocean renders an ecosystem that is *grown*.** Nothing in it is finished;
  everything is alive, moving, and responding to what you do next.

Same ancestor, same medium (three.js, WebGL, GitHub data), opposite metaphor.
A city is what you made. An ocean is what your work is doing while you are not
looking.

---

## 5. World Structure

The ocean is not one flat space. It is a water column with real depth, and depth
is meaning.

**Three nested clustering levels** take an unlocated, unclustered pile of
repositories and give it geography:

1. **Capital station** — the anchor of a cluster, marked by a **silicon wafer
   obelisk** (the one piece of hardware in the world: height = repos,
   width = contributions, glow = recent activity, colour = dominant language).
2. **City pocket** — the mid-level district.
3. **Language district** — the finest grain, where repos of a language gather.

**Unlocated users** — anyone whose location the API does not return — are not
dropped on the floor. They scatter into **deep-ocean language colonies**,
habitable trenches named after the languages themselves: Python Trench,
JavaScript Current, Rust Ridge, Go Shelf, C++ Abyss, TypeScript Plateau, Ruby
Cove. Being unlocated is not being absent; it is living at depth.

**Five zoom levels** are the camera's whole vocabulary:

| Level | What you are looking at |
| :--- | :--- |
| World | The whole ocean; clusters as lights in the dark |
| Country | A region; districts become visible |
| City | A capital station and its districts |
| Tower | One repository as a kelp tower |
| Whale | One repository as an animal — close enough to read it |

**The metro** is a pressure vessel, not a subway: magnetohydrodynamic tubes
between stations. The **network is built** — `stationEdges()` derives
two-nearest-neighbour links between the six capital stations and `Metro.js`
draws the tubes. The **transit is not**: there is no way to ride it. That
distinction matters more than the phasing label; a city needs a map before it
needs transit, and right now the map is what exists.

---

## 6. Trophic Structure

**Five** orbital groups, each at a real trophic level, plus one sessile group on
the seafloor. The counts here are the ones in `ORBITAL_PLANES` and
`LegacyCreatures`, not a design target:

| GitHub entity | Marine form | Group | Why the mapping is honest |
| :--- | :--- | :--- | :--- |
| Repository | Apex Whale | — | Apex animal; **length = commit count**, colour = language |
| Commit history | Giant Kelp Tower | — | Height = commits, girth = contributors |
| Contributors | Builders (reef fish) | 5 | Innermost, tightest, near-circular — coordination, not drift |
| Closed issues / merged PRs | Resolutions | 4 | Inner, calm, slightly inclined — the finished work |
| Open issues / PRs | Problems (mesopredators) | 3 | Wide and erratic — steepest inclination and eccentricity |
| Forks | Offspring | 2 | Slow, wide, trailing ellipse — descendants that spread |
| Stars / watchers | Admirers (drifters) | 1 | Outermost, slowest, near-horizontal — passive by nature |
| README, wiki, templates | Legacy (benthic) | — | Structural, sessile, on the tower base and stipe |

The orbital radius, speed, inclination and eccentricity per group are in
`ORBITAL_PLANES` (`src/world/constants.js`). They are **constants per group**,
not derived from a repository's health; see §8 for what that means for the
"Keplerian" claim in the README.

The **Legacy** layer is **18 creatures**, one per repository attribute, each
built only when that attribute is present: README quality (brain coral), code of
conduct (anemone), issue template (isopod), open discussions (sea urchins),
closed discussions (copepods), homepage (barnacle ring), wiki (sponge), releases
(feather star), downloads (amphipods), projects (coral polyps), changelog
(parrotfish), PR template (nudibranch), pre-release (seahorse), branch count
(grouper), contributing guide (cleaner wrasse), downloads-enabled (lanternfish),
README length (basking shark shadow), and security scanning (anglerfish lure).

> **Correction, 2026-11-26.** This section previously claimed "71 GitHub data
> points across 7 trophic levels" and "26 Legacy features". Neither was ever
> true of this codebase. There are five orbital groups, one sessile Legacy
> group of eighteen creatures, and the data model carries 49 fields of which ten
> drive no geometry at all. The inflated numbers came from the planning session
> and were never checked against the build. See §9.

---

---

## 7. What This Is Not

- **Not a dashboard.** There is no number on screen that is not embodied in an
  animal or a plant. If you want the number, you can find it, but the world is
  the interface.
- **Not a game.** There is nothing to win, no score, no avatar, no fail state.
  You are a diver, not a player.
- **Not photorealism.** See §3.
- **Not a toy.** Every visual choice is load-bearing for the data mapping. A
  pretty-but-arbitrary creature is a bug, not a feature.

---

## 8. Phasing

**Phase 1 — the personal dive.** One person's ocean, with their own repositories
as towers and whales and the people they follow as distant lights. Read-only:
no login, no writes, no backend. The point of Phase 1 is to prove the
metaphor is legible before it is populated.

**Phase 2 — the reef.** Full multiplayer: OAuth, real API data, the metro made
functional, users able to find each other, and the world populated by everyone
rather than by one person's mock data.

**Phase 3 — and beyond.** A full 3D world is deferred to a future major version
by explicit decision: the 2.5D layered-depth build has to be *good* before a
true 3D one is attempted, and a half-finished 3D world would prove nothing the
2.5D one has not already proved.

The ordering matters. Phase 1 exists to find out whether the metaphor reads.
Every visual defect found so far — the whale rendering as a speck, the camera
aiming at the tower's ankles while the animal orbited 100 units above the
frame — was a Phase 1 defect, and finding them now is the whole point.

---

## 9. What This Document Got Wrong

Added 2026-11-26 after auditing the docs against the build. Each item below was
verified in source, not inferred. They are kept rather than quietly deleted
because a vision document that rewrites its own history is worth less than one
that says where it drifted.

### The data model is not what was claimed

`makeRepo` carries **49 fields**. Ten of them drive no geometry at all —
`codebaseSize`, `commitStreak`, `deployments`, `hasPages`, `isArchived`,
`isPrivate`, `license`, `pinned`, `testCoverage`, `topics`, `trending`. Most are
fetched by `repoEnrich.js` or `github-api.js` and then sit unused in the record.
That is not fatal — a field can be modelled before it is drawn — but it means
the world is not the exhaustive projection of the GitHub API that §6 used to
claim.

### "Keplerian" is a group constant, not a data response

§2 says orbits are Keplerian and that "a failing pipeline genuinely changes the
path". The first half is true: `ORBITAL_PLANES` gives each group a real radius,
inclination and eccentricity, and `CreatureGeometry` solves a true-anomaly
ellipse from them. The second half is **not**: those five planes are constants,
identical for every repository and every CI state. CI status drives tube worms at
the tower base (`KelpTower.buildActivityLights`) and nothing else. A repo whose
pipeline is red does not get a wider orbit.

This is the one claim in this document that a viewer could fairly call false.
Either the orbit responds to repo health, or the sentence goes.

### Whale length comes from commits, not codebase size

The mapping tables used to say "size = codebase". `whaleLength()` was changed to
derive from commit count precisely because byte-size made the animal drift
independently of the tower it circles: a 340 KB repo with 1,240 commits got an
8-unit whale beside a 46-unit tower. Commits keeps the whale proportionate to
the tower at every scale. The source comment records the reasoning; the tables
now agree with it.

### Two counts were inflated

"71 data points across 7 trophic levels" and "26 Legacy features" appear in both
this file and the README. The build has **five** orbital groups and **eighteen**
Legacy creatures. The larger numbers came from the planning session and were
never reconciled with the implementation.

### The "constitution" does not exist

This document opens by citing three sources — the README, the vision, and "the
constitution". There is no constitution file in `docs/`. It was presumably a
planned artefact from the design session that was never written. The rules
attributed to it live in §2 of this file.

### The metro is built, and §5 says it is not

§5 states the metro is "deliberately Phase 2 — a city needs a map before it
needs transit". `Metro.js` exists and `OceanWorld` constructs and updates it:
`stationEdges()` derives two-nearest-neighbour links between the six capital
stations and the tubes are built at `_buildWorldGeometry`. What is _not_ built
is **transit** — you cannot ride it. The distinction between "rendered network"
and "usable transport" is the useful one, and the document conflates them.