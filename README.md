<div align="center">

# 🌊 Git Ocean

**Your GitHub profile, as a living 3D ocean.**

Every repository becomes a whale. Every commit history becomes a kelp tower.
Nothing is decorative — every creature, every colour, every orbit is a real
GitHub data point rendered as something that could exist in the sea.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-black?logo=three.js)](https://threejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)

[The Vision](#-the-vision) · [The Design Law](#-the-design-law) · [Creature Map](#-the-creature-map) · [World Structure](#-the-world-structure) · [Inspiration](#-inspiration) · [Status](#-status)

**Live:** [anubhavaanand.github.io/code-lemuria-git-ocean](https://anubhavaanand.github.io/code-lemuria-git-ocean/)

</div>

---

## 🌊 The Vision

Most "GitHub visualisations" are dashboards. A grid of green squares, a bar
chart, a contribution graph. They tell you *how much* you did. They never tell
you what it *feels* like.

Git Ocean is an attempt to answer a different question: **what would your work
look like if it were an ecosystem?**

Not a metaphor applied on top of data — an ecosystem the data actually
describes. A repository with 12 contributors and 900 commits is a different
*kind* of creature than one with a single commit. A repo with 400 open issues
swims differently from one that is healthy. You should be able to look at the
water and *read* the state of someone's work before you read a single number.

The ambition is that it feels less like a chart and more like swimming over a
reef at depth. Bioluminescence in the dark. Kelp moving in the current. A whale
passing overhead, and you can tell what language it speaks by its colour and by
the song it makes.

---

## ⚖️ The Design Law

> **Every element must be scientifically or technically explainable within the
> ocean's own logic. Fantasy is allowed only if it follows real physics, real
> biology, or real engineering.**

This is the rule that keeps the whole thing honest, and it is enforced — not
aspirational. If someone asked a marine biologist to explain any creature in
this world, the answer must be a real mechanism, not "because it looks cool."

Concretely:

- A whale's **size** is its codebase size. That is why a big repo is a big
  animal, and why it is slow.
- A kelp tower's **height** is its commit history. A repo with 5 commits is a
  seedling. A repo with 12,000 is a canopy that reaches the light.
- **Blade count** on a kelp tower is the number of open issues and pull
  requests. A stressed repo grows more blades — more surface area, more drag,
  more to carry.
- **Orbits are real ellipses**, not circles with a wobble. `ORBITAL_PLANES`
  gives each trophic group its own radius, inclination and eccentricity, and
  `CreatureGeometry` solves a true-anomaly ellipse from them. Each group's orbit
  is a fixed property of that group, **not** of a repository's health — a
  failing pipeline does not widen it. CI state is read elsewhere: it lights tube
  worms at the tower base.
- **Bioluminescence is data.** Glow intensity is recent activity. Colour is
  language. A dead repo does not glow.

Nothing is here because a designer thought it would be pretty. It is here
because it *means* something, and the meaning survives being explained.

---

## 🐋 The Creature Map

**Five** orbital groups, plus eighteen sessile Legacy creatures on the tower
base. There is no arbitrary placement — each mapping is a real ecological
relationship. (An earlier version of this section claimed "71 data points across
7 trophic levels"; neither number was ever true of the build — see
[`docs/VISION.md` §9](docs/VISION.md).)

| GitHub entity | Marine form | Why this mapping is honest |
| :--- | :--- | :--- |
| **Repository** | **Apex Whale** | An apex animal. Body length = commit count (keeps the animal proportionate to the tower it circles), dorsal colour = primary language, flippers = open PRs, flukes = forks, scars = age, remoras = watchers. |
| **Commit history** | **Giant Kelp Tower** | Height = total commits, girth = contributors, sway = recent activity, age rings = repo age, canopy glow = star count. |
| **Contributors** | **Builders** — reef fish | Innermost, tightest, near-circular orbit. Pod size = human contributors. |
| **Closed issues / merged PRs** | **Resolutions** | Inner, calm, slightly inclined. The work that got finished. |
| **Open issues / PRs** | **Problems** — mesopredators | Widest, steepest-informed, most eccentric orbit. Count drives the swarm size. |
| **Forks** | **Offspring** | Slow, wide trailing ellipse. Descendants that spread. |
| **Stars / watchers** | **Admirers** — drifters | Outermost, slowest, near-horizontal drift. Bioluminescent. Passive by nature. |
| **README, wiki, templates** | **Legacy** — coral, anemone, urchins | Eighteen benthic creatures, one per repository attribute, each built only when that attribute is present. Structural, not mobile. |

> Orbit radius, speed, inclination and eccentricity are **constants per group**
> (`ORBITAL_PLANES`), not derived from a repository's health. The "Keplerian"
> claim below is half true: the paths are true ellipses, but a repo's CI state
> drives the tube worms at the tower base, not the orbit. See
> [`docs/VISION.md` §9](docs/VISION.md).

Five whale species are recognised, each with a real scientific name and a real
build:

| Species | Build | Assigned when |
| :--- | :--- | :--- |
| 🐋 Blue *Balaenoptera musculus* | Sleek, enormous | Very high commit count |
| 🐋 Humpback *Megaptera novaeangliae* | Robust, long flippers | Many contributors |
| 🐋 Bowhead *Balaena mysticetus* | Massive, no dorsal fin | Very old repos |
| 🐋 Sperm *Physeter macrocephalus* | Blocky, blunt head | Dormant but established |
| 🐋 Orca *Orcinus orca* | Streamlined, tall dorsal | The default working repo |

---

## 🗺️ The World Structure

Depth is real. There is no flat plane and no fake perspective — the ocean is
layered, and moving between layers is moving through the water column.

**Three levels of clustering**, because the GitHub map is not flat:

1. **Capital station** — users cluster by nearest real-world capital (Delhi,
   San Francisco, Berlin, Tokyo, London, Beijing). Each station is marked by a
   **silicon wafer obelisk**: height = total repos, width = contributions, glow
   = recent activity, colour = dominant language. Its base is a metro entrance.
2. **Language district** — within a station, users cluster angularly by primary
   language. A JavaScript district sits next to a Python district.
3. **Deep ocean language colonies** — users with no location do not disappear.
   They sink to named trenches: *Python Trench*, *JavaScript Current*, *Rust
   Ridge*, *Go Shelf*, *C++ Abyss*, *TypeScript Plateau*, *Ruby Cove*.

Five zoom levels, each a real change in scale, not just a camera pull-back:

| Level | Depth | What you see |
| :--- | :--- | :--- |
| **World** | −4200 m | The whole basin. Stations as lights on the dark. |
| **Country** | −2400 m | A cluster of districts. |
| **City** | −1200 m | Towers, whales, orbital clouds. |
| **Tower** | −520 m | One repository's kelp and its creatures. |
| **Whale** | −180 m | One animal. You can see the scars. |

---

## 🎨 Visual Direction

The target is **stylised realism** — the quality bar of a portfolio piece, not a
data visualisation.

Concretely, the reference is Bruno Simon's portfolio: a world that is clearly
built out of simple shapes, but lit, coloured, and composed with real care so it
reads as *place* rather than as geometry.

The rules that keep it out of "programmer art":

- **One coherent light.** A single sun from above, cold bounce from below, and a
  warm rim. Every material agrees about where the light is.
- **Depth does the work.** Fog, not detail, sells distance. Underwater, you
  cannot see far — so the far field is a gradient and a suggestion, not a mesh.
- **Colour means something.** Bioluminescent cyan, gold, green, violet and red
  are semantic, not decorative. Red is a problem. Gold is attention. Green is
  resolved work.
- **Restraint.** Empty water is part of the composition. A reef is not a
  texture-painted wall; it is a floor with things growing on it.

---

## 💡 Inspiration

Git Ocean stands on a few specific shoulders.

**GitCity** is the direct ancestor of the idea — the project that proved GitHub
activity could be rendered as a city rather than a chart.
([honzaap/GithubCity](https://github.com/honzaap/GithubCity), three.js + Blender,
where each day of the contribution graph becomes a plot of land and a building.)

Git Ocean takes that premise and asks a different question: not *what does your
activity look like as architecture*, but *what does it look like as an
ecosystem*. A city is built; an ecosystem is grown. That distinction drives
everything — kelp instead of skyscrapers, whales instead of traffic, seasons
instead of a contribution graph.

It is also a different *scale of subject*. GitCity renders a contribution
calendar — one person, one year, 365 buildings. Git Ocean renders a whole
profile: repositories, contributors, issues, forks, languages, geography. The
city is a picture of activity; the ocean is a picture of a *body of work* and
the community around it.

**Neal Agarwal's *The Deep Sea*** — the scrolling depth scale — is the model
for how depth should feel: not a number in a corner, but a physical descent
where the light changes and the creatures change with it.

**Bruno Simon's portfolio** is the quality bar for the visual layer, described
above.

**Real marine biology** is the reference for the creature design — not
illustration, but the actual mechanics of how whales are shaped, how kelp
bends, why deep-sea animals glow, what an apex predator's body plan implies.
Where a real animal could not do what the scene needs, the scene was changed
rather than the animal.

---

## 🚀 Status

**This is an early prototype.** The ocean exists, the creatures exist, and the
data model is real — but the data is currently **mocked**, and the world is
rendered entirely client-side with no API layer wired in yet.

What works today:

- The full 2.5D layered world: seafloor, water surface, caustics, god rays,
  marine snow, parallax ridges, fog by depth.
- Procedural kelp towers driven by repository metrics.
- Procedural whales with five species, correct body plans, and identity features
  derived from data.
- Elliptical orbital creature clouds for five trophic groups.
- **Eighteen Legacy creatures** on every named tower — one per repository
  attribute, each growing or swimming where that attribute says it should. Brain
  coral from README quality, a basking-shark shadow from README length, tube
  worms from CI status, an anglerfish whose lure lights the water from security
  scanning, a seahorse only on pre-releases.
- **An imported whale sculpt** for the humpback (CC BY 4.0), skinned with the
  counter-shading shader so the dorsal colour is still the repository's language
  and the scarring is still its age. The sculpt supplies the silhouette; the
  procedural layer still supplies the meaning — flukes from forks, flippers from
  open PRs, barnacles from open issues.
- Silicon wafer obelisks marking capital clusters.
- Five zoom levels with a continuous, smooth camera.
- A React HUD: identity, depth, language tally, zoom rail, repository card,
  CC BY attribution for any sculpt on screen.

What is deliberately not built yet:

- **Real data.** The GitHub GraphQL layer exists in `src/services/` but is not
  wired in. Everything runs on deterministic mock data.
- **The 3D version.** This is the 2.5D layered build — real depth spacing, fog
  and parallax, but not a full 3D sphere. That is the next major version.
- Multiplayer, metro transport, obelisk skin voting.

The full reasoning behind the design, and the order the remaining work is in,
is in **[docs/VISION.md](docs/VISION.md)** and
**[docs/ROADMAP.md](docs/ROADMAP.md)**.

---

## 🛠 Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # production bundle
```

Query parameters for the visual QA pass:

- `?level=world|country|city|tower|whale` — start at a given zoom level
- `?focus=<owner/name>` — frame one repository at that level
- `?debug=rocks` — dump a live rock-framing report (frustum-projected instance
  sizes) into the DOM for headless inspection
- `?debug=fauna` — dump the Legacy creature census per tower
- `?debug=whale` — dump which body each whale got (procedural lathe vs imported
  sculpt) and the measured sculpt size

---

<div align="center">

**Built in the open. Licensed MIT.**

</div>