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
- **Orbits are Keplerian**, not decorative. Trophic level sets the radius,
  eccentricity warps it, and a failing pipeline genuinely changes the path.
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
between stations. It is deliberately Phase 2 — a city needs a map before it
needs transit.

---

## 6. Trophic Structure

Seven groups, each at a real trophic level, each mapping to GitHub entities that
genuinely play that ecological role:

| GitHub entity | Marine form | Why the mapping is honest |
| :--- | :--- | :--- |
| Repository | Apex Whale | Apex animal; size = codebase, colour = language |
| Commit history | Giant Kelp Tower | Height = commits, density = contributors |
| Contributors | Builders (reef fish) | Inner, tight orbits; pod size = humans |
| Stars / watchers | Admirers (drifters) | Outer, slow, passive — like stars |
| Open issues / PRs | Problems (mesopredators) | Erratic ellipses; count drives swarm |
| Closed issues / merged PRs | Resolutions | Inner, calmer — the finished work |
| Forks | Offspring | Slow outer drift — descendants that spread |
| README, wiki, templates | Legacy (benthic) | Structural, sessile, on the tower base |

The full map is **71 GitHub data points across 7 trophic levels**, and it is
exhaustive by design: if a field exists on the GitHub API and has a plausible
ecological role, it belongs somewhere in the water. The 26 **Legacy** features
alone cover README quality (brain coral), code of conduct (anemone), issue
template (isopod), discussions (urchins and copepods), releases (feather star),
downloads (amphipods), wiki (sponge), changelog (parrotfish), PR template
(nudibranch), pre-release (seahorse), branch count (grouper), contributing guide
(cleaner wrasse), projects (coral polyps), downloads-enabled (lanternfish),
README length (basking shark shadow), and security scanning (anglerfish lure).

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