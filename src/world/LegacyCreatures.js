/**
 * Git Ocean — Legacy creatures
 *
 * A kelp tower is the repository's skeleton. These are the organisms that live
 * on it — the ones that turn a column of numbers into an ecosystem you can
 * read at a glance.
 *
 * THE RULE (constitution, Scientific Accuracy): every creature below is driven
 * by exactly one GitHub data point. If a creature cannot name the field it
 * renders, it does not exist.
 *
 *   sponge          ← hasWiki          (a filter feeder: permanently attached, strains nutrients from the current)
 *   barnacle ring   ← hasHomepage      (sessile, cements itself to the stipe and filters)
 *   sea urchins     ← discussionsOpen  (grazers on the stipe; they cluster where there is food)
 *   copepods        ← discussionsClosed(resolved grazers, tiny, drift off the base)
 *   feather star    ← releases         (a crinoid: arms unfurl into the current to catch what drifts by)
 *   amphipods       ← downloads        (scavengers swarming the holdfast where material collects)
 *   parrotfish      ← hasChangelog     (grazes the stipe, leaves a visible scar line)
 *   seahorse        ← preRelease       (hovers in the canopy, anchored by its tail)
 *   grouper         ← branchCount      (a big ambush predator, sits still, occupies the whole radius)
 *   cleaner wrasse  ← hasContributing  (small, fast, works the surface of the stipe)
 *   anemone         ← hasCodeOfConduct (sessile, stinging tentacles, guards the base)
 *   isopod          ← hasIssueTemplate (benthic scavenger, trundles over the sediment)
 *   nudibranch      ← hasPRTemplate    (slow, brilliantly coloured, crawls the blades)
 *   coral polyp     ← hasProjects      (colonial builder, adds to the reef structure)
 *   lanternfish     ← hasDownloads     (a photophore that hangs in the water column)
 *   basking shark   ← readmeLength     (a huge slow shadow passing behind the tower)
 *   brain coral     ← readmeQuality    (a massive folded dome on the sediment: the better the README, the deeper the folds)
 *   anglerfish lure ← securityScanning (an esca on an illicium, a light where you would not expect one)
 *
 * Anything that is simply "present or absent" renders as a boolean colony: one
 * instance when present, nothing when absent. That is deliberate — a boolean
 * signal should not be drawn as a magnitude.
 */

import * as THREE from "three";
import { COLORS } from "./constants";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Deterministic per-repo jitter so a tower looks the same every visit.
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// A matte, slightly translucent body material. Cheaper than a shader and it
// reads correctly at every distance because fog does the work.
function flesh(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness != null ? opts.roughness : 0.85,
    metalness: 0.02,
    transparent: opts.opacity != null && opts.opacity < 1,
    opacity: opts.opacity != null ? opts.opacity : 1,
    flatShading: !!opts.flat,
  });
}

function emissive(color, strength = 1.4, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: strength,
    roughness: 0.4,
    transparent: opacity < 1,
    opacity,
  });
}

/**
 * One instance of a creature, placed by a callback. Kept tiny on purpose: most
 * of these are one or two draw calls.
 */
function place(mesh, x, y, z, scale, rotY = 0) {
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(scale);
  mesh.rotation.y = rotY;
  return mesh;
}

// ---------------------------------------------------------------------------
// LegacyColony — the container that owns every Legacy creature on one tower.
// ---------------------------------------------------------------------------

export class LegacyColony {
  /**
   * @param {object} repo   a worldData repo record
   * @param {object} opts   { tower, quality, isMobile }
   *   tower — the KelpTower instance, for height/girth and for parenting.
   */
  constructor(repo, opts = {}) {
    this.repo = repo;
    this.tower = opts.tower || null;
    this.quality = opts.quality || "high";
    this.isMobile = !!opts.isMobile;
    this.disposables = [];
    this.animated = [];
    this.time = Math.random() * 100;

    // The tower owns the transform, so parent to it and work in its local
    // space: y=0 is the holdfast, +y runs up the stipe.
    this.group = new THREE.Group();
    this.group.name = `legacy:${repo.name}`;

    this.rng = mulberry(hashString(repo.id || repo.name || "legacy"));
    this.H = this.tower ? this.tower.height : 20;
    this.G = this.tower ? this.tower.girth : 1.2;

    // One registry of what this colony built, keyed by the GitHub field that
    // drove it. Two consumers read it:
    //
    //   - the HUD's "creatures" tab, so the mapping list can say what is
    //     actually on screen for THIS repo rather than listing all eighteen and
    //     leaving the user to guess which are present;
    //   - the fauna census, which counted by guessing at fifteen optional
    //     properties and could not see a creature at all unless its builder
    //     remembered to assign one. Two builders never did.
    //
    // A field the registry says is absent is a field whose creature did not
    // build, which is the one fact the census exists to establish.
    this.registry = [];

    // Creature root node → creature name. Populated by `tag()`, which every
    // builder calls on the object it considers the creature's body, so a click
    // anywhere inside that subtree resolves to the creature rather than to the
    // kelp tower around it.
    this.roots = new Map();

    this.build();
  }

  get root() {
    return this.group;
  }

  // Height of a given fraction of the stipe — the only way anything attaches.
  yAt(f) {
    return this.H * f;
  }

  // Radius of the stipe at a given height fraction. The stipe tapers, so a
  // creature that ignores this either floats or intersects.
  rAt(f) {
    return this.G * (0.34 - 0.18 * clamp(f, 0, 1));
  }

  build() {
    // Order matters only for readability: benthic first (they define the
    // footprint), then the stipe dwellers, then the water-column animals.
    this.buildBrainCoral(); //    ← readmeQuality
    this.buildAnemone(); //       ← codeOfConduct
    this.buildIsopod(); //        ← issueTemplate
    this.buildSeaUrchins(); //    ← open discussions
    this.buildCopepods(); //      ← closed discussions
    this.buildBarnacleRing(); //  ← hasHomepage
    this.buildSponge(); //        ← hasWiki
    this.buildFeatherStar(); //   ← releases
    this.buildAmphipods(); //     ← downloads
    this.buildCoralPolyp(); //    ← hasProjects
    this.buildParrotfish(); //    ← hasChangelog
    this.buildNudibranch(); //     ← pullRequestTemplate
    this.buildSeahorse(); //      ← preRelease
    this.buildGrouper(); //       ← branchCount
    this.buildCleanerWrasse(); // ← contributingGuide
    this.buildLanternfish(); //    ← downloadsEnabled
    this.buildBaskingShark(); //   ← readmeLength
    this.buildAnglerfish(); //     ← securityScanning
  }

  /**
   * Record that a creature built, and which GitHub field put it there.
   *
   * Called by every builder at the point the creature is finished, so the
   * registry can never drift from the geometry the way a hand-maintained list
   * does: if a builder returns early, it never records, and the absence is
   * visible in the census.
   *
   * @param {string} name       creature key, e.g. "brainCoral"
   * @param {string} field      GitHub field it is driven by
   * @param {string} meaning    short human phrase, for the HUD
   * @param {number} [count]    instance count, for the HUD and the census
   */
  _record(name, field, meaning, count) {
    this.registry.push({
      name,
      field,
      meaning,
      count: count != null ? count : 1,
      // The object a click on this creature resolves to. Picking walks a hit up
      // to the tower, which is all a click used to be able to answer; without
      // this a polyp and a kelp blade are the same object by the time the walk
      // finishes.
      //
      // Not derived from `this.group.children` at record time: a builder that
      // keeps adding nodes afterwards would silently retag itself onto the wrong
      // object, and the tag would be a coincidence of ordering rather than a
      // claim about identity. Instead the tag is written on the creature's root
      // the first time `creatureAt` sees a node inside it, and only that root
      // and its descendants can be marked.
      node: null,
    });
  }

  /**
   * Which creature a raycast hit belongs to, or null.
   *
   * Walks up from the hit looking for a node this colony tagged as a creature
   * root. Bounded by the depth of the group, which is small — a few wrappers at
   * most — so it costs nothing on a click, and it is not run per frame.
   *
   * @param {THREE.Object3D} node
   * @returns {string|null}
   */
  creatureAt(node) {
    // The nearest registered root above the hit, if there is one. A creature is
    // a whole subtree — a coral dome, an instanced crown, a fish — and clicking
    // any part of it should name the creature, not the part.
    let n = node;
    let root = null;
    while (n && n !== this.group) {
      if (this.roots.has(n)) {
        root = n;
        break;
      }
      n = n.parent;
    }
    return root ? this.roots.get(root) : null;
  }

  /**
   * Mark `obj` as the root of creature `name`.
   *
   * Call after the creature's own geometry is in place but before the next
   * builder runs. Tagging is by identity, not by position in `group.children`,
   * so a builder is free to add helper nodes afterwards.
   */
  tag(name, obj) {
    if (!obj) return;
    this.roots.set(obj, name);
  }

  /** Creatures that actually built for this colony. */
  get creatures() {
    return this.registry.map((r) => r.name);
  }

  // -------------------------------------------------------------------------
  // Benthic — lives on the sediment, not the stipe
  // -------------------------------------------------------------------------

  /**
   * Brain coral ← readmeQuality.
   * A dome with meandering grooves. The deeper and more convoluted the folds,
   * the better the README — a good README has structure, a bad one is a lump.
   */
  buildBrainCoral() {
    const q = clamp(this.repo.readmeQuality != null ? this.repo.readmeQuality : 0.5, 0, 1);
    if (q < 0.05) return;

    const R = this.G * (1.1 + q * 2.2);
    const geo = new THREE.SphereGeometry(R, this.isMobile ? 12 : 20, this.isMobile ? 8 : 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    // Squash into a dome
    geo.scale(1, 0.55 + q * 0.25, 1);

    const mat = flesh(0x9a8c6a, { flat: true, roughness: 0.95 });
    const dome = new THREE.Mesh(geo, mat);
    dome.position.y = 0;
    dome.receiveShadow = true;

    // Grooves: concentric ridges whose count and depth ARE the quality. A
    // low-quality README is nearly smooth; a high-quality one is deeply folded.
    //
    // One InstancedMesh for all the ridges. These were a Mesh and a fresh
    // TorusGeometry per fold — up to eleven extra draw calls per colony for
    // ridges that only ever differ in radius. A unit torus scaled in X and Z is
    // the same shape at a fraction of the cost.
    const folds = Math.round(2 + q * 9);
    const foldDepth = 0.06 + q * 0.16;
    const ridgeGeo = new THREE.TorusGeometry(1, foldDepth * 0.4, 5, this.isMobile ? 16 : 28);
    ridgeGeo.rotateX(Math.PI / 2);
    const ridges = new THREE.InstancedMesh(ridgeGeo, mat, folds);
    const rm = new THREE.Matrix4();
    const rq = new THREE.Quaternion();
    const rp = new THREE.Vector3();
    const rs = new THREE.Vector3();
    for (let i = 0; i < folds; i++) {
      const t = (i + 1) / (folds + 1);
      const rr = R * t * 0.98;
      rp.set(0, R * (0.55 + q * 0.25) * Math.sqrt(Math.max(0, 1 - t * t)) * 0.92, 0);
      // The tube radius scales with the fold, so scale uniformly by the radius.
      rs.set(rr, rr, rr);
      rm.compose(rp, rq, rs);
      ridges.setMatrixAt(i, rm);
    }
    ridges.instanceMatrix.needsUpdate = true;
    dome.add(ridges);

    const a = this.rng() * Math.PI * 2;
    const d = this.G * (2.6 + this.rng() * 2.4);
    dome.position.x = Math.cos(a) * d;
    dome.position.z = Math.sin(a) * d;
    dome.rotation.y = this.rng() * Math.PI;
    this.group.add(dome);
    this.brainCoral = dome;
    this.tag("brainCoral", dome);
    this._record("brainCoral", "readmeQuality", "README structure", Math.round(2 + q * 9));
  }

  /** Anemone ← codeOfConduct. A sessile polyp with stinging tentacles. */
  buildAnemone() {
    if (!this.repo.hasCodeOfConduct) return;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(this.G * 0.5, this.G * 0.72, this.G * 0.5, 9),
      flesh(0x8a5a6a)
    );
    const a = this.rng() * Math.PI * 2;
    const d = this.G * (2.2 + this.rng() * 1.8);
    base.position.set(Math.cos(a) * d, this.G * 0.25, Math.sin(a) * d);
    this.group.add(base);

    // Tentacles: a ring of thin tapered cones. Their count is fixed because
    // the signal is boolean — presence is the message, not quantity.
    const n = this.isMobile ? 9 : 16;
    const tMat = emissive(0xc06a8a, 0.55);
    const tGeo = new THREE.ConeGeometry(this.G * 0.07, this.G * 0.9, 4);
    tGeo.translate(0, this.G * 0.45, 0);
    const tentacles = new THREE.InstancedMesh(tGeo, tMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const lean = 0.35 + this.rng() * 0.3;
      e.set(Math.cos(th) * lean, th, Math.sin(th) * lean);
      q.setFromEuler(e);
      p.set(Math.cos(th) * this.G * 0.3, this.G * 0.45, Math.sin(th) * this.G * 0.3);
      m.compose(p, q, s);
      tentacles.setMatrixAt(i, m);
    }
    tentacles.instanceMatrix.needsUpdate = true;
    base.add(tentacles);
    this.anemone = base;
    this.tag("anemone", base);
    this._record("anemone", "hasCodeOfConduct", "code of conduct", 1);

    // Slow pulse — anemones breathe by contracting
    this.animated.push((t) => {
      const k = 1 + Math.sin(t * 0.55) * 0.07;
      tentacles.scale.set(k, 1 / k, k);
    });
  }

  /** Isopod ← issueTemplate. A benthic scavenger trundling the sediment. */
  buildIsopod() {
    if (!this.repo.hasIssueTemplate) return;

    const seg = 6;
    const body = new THREE.Group();
    const mat = flesh(0x6a6258, { flat: true, roughness: 0.7 });
    // Six segments of graded radius, all spheres. Instanced into one mesh: the
    // plates never move relative to each other, so they only need to move with
    // the body, which is the group's transform.
    const plates = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 5),
      mat,
      seg
    );
    const pm = new THREE.Matrix4();
    const pq = new THREE.Quaternion();
    const pp = new THREE.Vector3();
    const ps = new THREE.Vector3();
    for (let i = 0; i < seg; i++) {
      const t = i / (seg - 1);
      const r = this.G * (0.34 - Math.abs(t - 0.45) * 0.24);
      pp.set(0, 0, (t - 0.5) * this.G * 1.5);
      ps.set(r, r * 0.55, r * 0.85);
      pm.compose(pp, pq, ps);
      plates.setMatrixAt(i, pm);
    }
    plates.instanceMatrix.needsUpdate = true;
    plates.computeBoundingSphere();
    body.add(plates);
    const a = this.rng() * Math.PI * 2;
    const d = this.G * (3 + this.rng() * 2);
    body.position.set(Math.cos(a) * d, this.G * 0.18, Math.sin(a) * d);
    body.rotation.y = this.rng() * Math.PI * 2;
    this.group.add(body);
    this.isopod = body;
    this.tag("isopod", body);
    this._record("isopod", "hasIssueTemplate", "issue template", 1);

    const baseA = body.rotation.y;
    const radius = Math.hypot(body.position.x, body.position.z);
    const a0 = Math.atan2(body.position.z, body.position.x);
    this.animated.push((t) => {
      // Trundle: a slow, wobbly circuit of the holdfast
      const th = a0 + Math.sin(t * 0.11) * 0.9;
      body.position.x = Math.cos(th) * radius;
      body.position.z = Math.sin(th) * radius;
      body.rotation.y = baseA + Math.sin(t * 0.22) * 0.6;
      body.position.y = this.G * 0.18 + Math.abs(Math.sin(t * 1.1)) * this.G * 0.05;
    });
  }

  // -------------------------------------------------------------------------
  // On the stipe — grazers, filter feeders, hitchhikers
  // -------------------------------------------------------------------------

  /**
   * Sea urchins ← open discussions.
   * Grazers cluster where there is food. Each urchin is a spined ball; the
   * count is the count of open discussions, capped by space on the stipe.
   */
  buildSeaUrchins() {
    const n = clamp(Math.round((this.repo.discussionsOpen || 0) * 0.6), 0, this.isMobile ? 8 : 18);
    if (n === 0) return;

    const R = this.G * 0.3;
    const bodyMat = flesh(0x3a2a3a, { flat: true, roughness: 0.6 });

    // All the urchins share two InstancedMeshes — one for the tests, one for
    // every spine on every urchin. The old code built a Group, a SphereGeometry
    // and a spine InstancedMesh per urchin: 2 x 18 draw calls for the worst
    // case, when the whole colony is two. Each urchin is still its own animated
    // transform; the transform just lives in an instance matrix now.
    const coreGeo = new THREE.SphereGeometry(R, 7, 5);
    const cores = new THREE.InstancedMesh(coreGeo, bodyMat, n);
    cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const spines = this.isMobile ? 10 : 18;
    const sGeo = new THREE.ConeGeometry(R * 0.1, R * 1.5, 3);
    sGeo.translate(0, R * 0.75, 0);
    const spineMesh = new THREE.InstancedMesh(
      sGeo,
      flesh(0x5a3a5a, { flat: true }),
      n * spines
    );
    spineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Per-urchin state, so the animation can rebuild both meshes' matrices.
    const state = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const localM = new THREE.Matrix4();
    const localQ = new THREE.Quaternion();
    const localP = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const f = 0.06 + this.rng() * 0.34;
      const th = this.rng() * Math.PI * 2;
      const r = this.rAt(f) + R * 0.55;
      const rec = {
        base: new THREE.Vector3(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r),
        rot: new THREE.Euler(this.rng() * 3, this.rng() * 3, this.rng() * 3),
        phase: this.rng() * 6.28,
        // Fibonacci sphere directions, computed once: the spine layout never
        // changes, only the urchin's transform does.
        dirs: [],
      };
      for (let k = 0; k < spines; k++) {
        // Fibonacci sphere — even coverage without clumping
        const y = 1 - (k / (spines - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = k * 2.399963;
        rec.dirs.push(
          new THREE.Vector3(Math.cos(phi) * rad, y, Math.sin(phi) * rad).normalize()
        );
      }
      state.push(rec);
    }

    this._writeUrchins = (t) => {
      for (let i = 0; i < state.length; i++) {
        const rec = state[i];
        // Grazers inch upward; the spines catch the current and rock them
        const bob = this.isMobile ? 0 : Math.sin(t * 0.16 + rec.phase) * this.G * 0.22;
        const rock = this.isMobile ? 0 : Math.sin(t * 0.4 + rec.phase) * 0.0009;

        e.set(rec.rot.x, rec.rot.y, rec.rot.z + rock);
        q.setFromEuler(e);
        p.copy(rec.base);
        p.y += bob;
        m.compose(p, q, s);
        cores.setMatrixAt(i, m);

        // Each spine is the urchin's transform composed with a fixed local
        // rotation that points it out along its Fibonacci direction.
        for (let k = 0; k < spines; k++) {
          localQ.setFromUnitVectors(yAxis, rec.dirs[k]);
          localM.compose(localP.set(0, 0, 0), localQ, s);
          const out = new THREE.Matrix4().multiplyMatrices(m, localM);
          spineMesh.setMatrixAt(i * spines + k, out);
        }
      }
      cores.instanceMatrix.needsUpdate = true;
      spineMesh.instanceMatrix.needsUpdate = true;
    };

    this._writeUrchins(0);
    // One creature is two instanced meshes — cores and spines — so the tag goes
    // on a wrapper that contains both, otherwise clicking a spine names nothing.
    const bed = new THREE.Group();
    bed.add(cores);
    bed.add(spineMesh);
    this.group.add(bed);
    this.urchins = n;
    this.tag("urchins", bed);
    this._record("urchins", "discussionsOpen", "open discussions", n);

    if (!this.isMobile) {
      this.animated.push((t) => this._writeUrchins(t));
    }
  }

  /**
   * Copepods ← closed discussions.
   * Resolved, so they have moved on: tiny, translucent, drifting off the base.
   */
  buildCopepods() {
    const n = clamp(Math.round((this.repo.discussionsClosed || 0) * 0.8), 0, this.isMobile ? 10 : 22);
    if (n === 0) return;

    const geo = new THREE.CapsuleGeometry(this.G * 0.045, this.G * 0.16, 3, 5);
    geo.rotateZ(Math.PI / 2);
    const mat = emissive(0x9fd8c0, 0.35, 0.62);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tag("copepods", mesh);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);

    const bugs = [];
    for (let i = 0; i < n; i++) {
      const a0 = this.rng() * Math.PI * 2;
      const rad = this.G * (1.8 + this.rng() * 3.4);
      const y0 = this.G * (0.3 + this.rng() * this.H * 0.22);
      bugs.push({
        a0,
        rad,
        y0,
        spin: (this.rng() - 0.5) * 0.35,
        bob: this.rng() * 6.28,
        sc: 0.7 + this.rng() * 0.6,
      });
      p.set(Math.cos(a0) * rad, y0, Math.sin(a0) * rad);
      m.compose(p, q, s.set(bugs[i].sc, bugs[i].sc, bugs[i].sc));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    this.animated.push((t) => {
      for (let i = 0; i < n; i++) {
        const b = bugs[i];
        const th = b.a0 + t * b.spin;
        p.set(
          Math.cos(th) * b.rad,
          b.y0 + Math.sin(t * 0.9 + b.bob) * this.G * 0.35,
          Math.sin(th) * b.rad
        );
        q.setFromEuler(new THREE.Euler(0, -th, Math.sin(t * 2 + b.bob) * 0.3));
        m.compose(p, q, s.set(b.sc, b.sc, b.sc));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });

    // Published so the fauna census can count it. Without this the creature
    // existed and drew, but was invisible to any count of the colony.
    this.copepods = n;
    this._record("copepods", "discussionsClosed", "closed discussions", n);
  }

  /**
   * Feather star ← releases.
   * A crinoid: it climbs the stipe and unfurls its arms into the current.
   * Every release is another arm, because a release is something thrown out
   * into the water to be caught.
   */
  buildFeatherStar() {
    const rel = this.repo.releases || 0;
    if (rel <= 0) return;

    const arms = clamp(rel, 1, this.isMobile ? 6 : 11);
    const crinoid = new THREE.Group();
    const mat = flesh(0xc86a7a, { flat: true, roughness: 0.65 });

    // Calyx — the small body the arms radiate from
    const calyx = new THREE.Mesh(new THREE.SphereGeometry(this.G * 0.26, 8, 6), mat);
    calyx.scale.set(1, 1.4, 1);
    crinoid.add(calyx);

    // The arms are an InstancedMesh, not one Mesh each.
    //
    // Measured: this builder allocated 1 + arms x (1 + 4) geometries — up to 56
    // meshes for a single colony, all sharing one material and one geometry per
    // kind. Every one of them was its own draw call, and the only thing that
    // varied between them was a transform. Now: one arm mesh for all the arms,
    // and one pinnule mesh for all the pinnules, with the per-arm rotation
    // recomputed into the instance matrices each frame.
    const armGeo = new THREE.CylinderGeometry(this.G * 0.025, this.G * 0.06, this.G * 2.4, 4);
    armGeo.translate(0, this.G * 1.2, 0);
    const armMesh = new THREE.InstancedMesh(armGeo, mat, arms);
    armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crinoid.add(armMesh);

    const am = new THREE.Matrix4();
    const aq = new THREE.Quaternion();
    const ae = new THREE.Euler();
    const ap = new THREE.Vector3();
    const as = new THREE.Vector3(1, 1, 1);

    // Pinnules live in the ARM's local space, so their instance matrices are
    // relative to the arm and are written once — they never move independently.
    const PIN_PER_ARM = 4;
    let pinMesh = null;
    if (!this.isMobile) {
      const pinGeo = new THREE.CylinderGeometry(this.G * 0.008, this.G * 0.018, this.G * 0.34, 3);
      pinMesh = new THREE.InstancedMesh(pinGeo, mat, arms * PIN_PER_ARM);
      const pm = new THREE.Matrix4();
      const pq = new THREE.Quaternion();
      const pe = new THREE.Euler(0, 0, 0.9);
      pq.setFromEuler(pe);
      const pp = new THREE.Vector3();
      const ps = new THREE.Vector3(1, 1, 1);
      let idx = 0;
      for (let i = 0; i < arms; i++) {
        for (let k = 1; k <= PIN_PER_ARM; k++) {
          pp.set(0, this.G * 0.35 * k, 0);
          pm.compose(pp, pq, ps);
          pinMesh.setMatrixAt(idx++, pm);
        }
      }
      pinMesh.instanceMatrix.needsUpdate = true;
      armMesh.add(pinMesh); // inherits each arm's instance transform
    }

    // Pose the arms immediately: `animated` does not run until the first
    // update, and a colony that renders with every instance at the identity
    // matrix is a stack of cylinders on the origin for one frame.
    const armMeshes = [];
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      armMeshes.push({ th: a });
      ae.set(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
      aq.setFromEuler(ae);
      am.compose(ap.set(0, 0, 0), aq, as);
      armMesh.setMatrixAt(i, am);
    }
    armMesh.instanceMatrix.needsUpdate = true;
    this._armMesh = armMesh;

    // Perched on the stipe, arms spread into the current
    const f = 0.2 + this.rng() * 0.5;
    const th = this.rng() * Math.PI * 2;
    const r = this.rAt(f) + this.G * 0.2;
    crinoid.position.set(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r);
    crinoid.rotation.y = th;
    this.group.add(crinoid);
    this.featherStar = crinoid;
    this.tag("featherStar", crinoid);
    this._record("featherStar", "releases", "releases", arms);

    this.animated.push((t) => {
      // Arms unfurl and sweep — a crinoid is a passive suspension feeder, so
      // it holds its arms into the current and lets them flex.
      const k = Math.sin(t * 0.35) * 0.5 + 0.5;
      const spread = 0.6 + k * 0.35;
      for (let i = 0; i < armMeshes.length; i++) {
        const a = armMeshes[i].th;
        ae.set(Math.sin(a) * spread, 0, Math.cos(a) * spread);
        aq.setFromEuler(ae);
        am.compose(ap.set(0, 0, 0), aq, as);
        armMesh.setMatrixAt(i, am);
      }
      armMesh.instanceMatrix.needsUpdate = true;
    });
  }

  /**
   * Amphipods ← downloads.
   * Scavengers swarming the holdfast where material collects.
   */
  buildAmphipods() {
    const n = clamp(Math.round(Math.sqrt(this.repo.downloads || 0) * 0.5), 0, this.isMobile ? 9 : 20);
    if (n === 0) return;

    const geo = new THREE.CapsuleGeometry(this.G * 0.05, this.G * 0.22, 3, 5);
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, flesh(0xb8a888, { flat: true, roughness: 0.6 }), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tag("amphipods", mesh);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    const bugs = [];
    for (let i = 0; i < n; i++) {
      bugs.push({
        a: this.rng() * Math.PI * 2,
        r: this.G * (0.9 + this.rng() * 2.6),
        y: this.G * (0.06 + this.rng() * 0.28),
        sp: (0.25 + this.rng() * 0.55) * (this.rng() < 0.5 ? 1 : -1),
        ph: this.rng() * 6.28,
        sc: 0.6 + this.rng() * 0.7,
      });
    }

    this.animated.push((t) => {
      for (let i = 0; i < n; i++) {
        const b = bugs[i];
        const th = b.a + t * b.sp;
        // Scuttle in and out of the holdfast — they are always moving
        const rr = b.r + Math.sin(t * 1.6 + b.ph) * this.G * 0.35;
        p.set(Math.cos(th) * rr, b.y + Math.abs(Math.sin(t * 2.2 + b.ph)) * this.G * 0.12, Math.sin(th) * rr);
        q.setFromEuler(new THREE.Euler(0, -th + Math.PI / 2, Math.sin(t * 3 + b.ph) * 0.25));
        m.compose(p, q, s.setScalar(b.sc));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });

    // Published so the fauna census can count it (see buildCopepods).
    this.amphipods = n;
    this._record("amphipods", "downloads", "downloads", n);
  }

  /**
   * Barnacle ring ← hasHomepage.
   * Sessile filter feeders that cement themselves to the stipe. Presence only.
   */
  buildBarnacleRing() {
    // A live link is what the data actually carries (homepageUrl). `homepage`
    // is an empty string when unset, so treat that as absent rather than
    // inventing a separate boolean that the API layer would have to keep in sync.
    if (!this.repo.hasHomepage && !this.repo.homepage) return;

    const n = this.isMobile ? 7 : 14;
    const geo = new THREE.ConeGeometry(this.G * 0.13, this.G * 0.22, 6, 1, true);
    const mat = flesh(0xcfc6b0, { flat: true, roughness: 0.9 });
    const ring = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);

    // A ring around the holdfast — barnacles settle in the current-swept band
    const f = 0.03 + this.rng() * 0.06;
    const y = this.yAt(f);
    const r = this.rAt(f) + this.G * 0.3;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + this.rng() * 0.2;
      p.set(Math.cos(th) * r, y + (this.rng() - 0.5) * this.G * 0.3, Math.sin(th) * r);
      // Cones point outward from the stipe
      e.set(Math.PI / 2 - 0.4, -th, 0);
      q.setFromEuler(e);
      m.compose(p, q, s.setScalar(0.7 + this.rng() * 0.7));
      ring.setMatrixAt(i, m);
    }
    ring.instanceMatrix.needsUpdate = true;
    this.group.add(ring);
    this.barnacleRing = ring;
    this.tag("barnacleRing", ring);
    this._record("barnacleRing", "hasHomepage", "homepage", ring.count);
  }

  /** Sponge ← hasWiki. A permanently attached filter feeder on the stipe. */
  buildSponge() {
    if (!this.repo.hasWiki) return;

    const R = this.G * (0.6 + this.rng() * 0.4);
    const geo = new THREE.CylinderGeometry(R * 0.7, R, R * (2.2 + this.rng()), 9, 1, true);
    const mat = flesh(0x7a6a4a, { flat: true, roughness: 0.95 });
    const sponge = new THREE.Mesh(geo, mat);

    // Osculum — the excurrent opening that makes a sponge a sponge
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.7, R * 0.12, 5, 12), mat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = R * (2.2 + 0.5);
    sponge.add(lip);

    const th = this.rng() * Math.PI * 2;
    const f = 0.14 + this.rng() * 0.22;
    const r = this.rAt(f) + R * 0.85;
    const h = R * 1.1;
    sponge.position.set(Math.cos(th) * r, this.yAt(f) + h * 0.2, Math.sin(th) * r);
    sponge.rotation.z = Math.cos(th) * 0.25;
    sponge.rotation.x = Math.sin(th) * 0.25;
    this.group.add(sponge);
    this.sponge = sponge;
    this.tag("sponge", sponge);
    this._record("sponge", "hasWiki", "wiki", 1);
  }

  // -------------------------------------------------------------------------
  // Water column and canopy — the ones that move through the tower's space
  // -------------------------------------------------------------------------

  /** Parrotfish ← hasChangelog. Grazes the stipe and leaves a scar line. */
  buildParrotfish() {
    if (!this.repo.hasChangelog) return;

    const fish = new THREE.Group();
    const mat = flesh(0x3aa88a, { flat: true, roughness: 0.55 });

    const bodyGeo = new THREE.SphereGeometry(this.G * 0.3, 9, 7);
    bodyGeo.scale(1.9, 0.85, 0.55);
    const body = new THREE.Mesh(bodyGeo, mat);
    fish.add(body);

    // The beak is the identifying feature of a scarid — fused jaw plates
    const beak = new THREE.Mesh(new THREE.ConeGeometry(this.G * 0.13, this.G * 0.3, 5), flesh(0xd8e8d0, { flat: true }));
    beak.rotation.z = -Math.PI / 2;
    beak.position.x = this.G * 0.62;
    fish.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(this.G * 0.22, this.G * 0.42, 4), mat);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -this.G * 0.62;
    tail.scale.set(1, 1, 0.35);
    fish.add(tail);

    // Grow a pale scar band on the stipe: a changelog means the repo has
    // been maintained through versions, and that leaves a mark.
    const scar = new THREE.Mesh(
      new THREE.TorusGeometry(this.rAt(0.3) * 1.01, this.G * 0.03, 4, 20),
      emissive(0xbfe0c8, 0.22, 0.5)
    );
    scar.rotation.x = Math.PI / 2;
    scar.position.y = this.yAt(0.3);
    this.group.add(scar);

    const f = 0.28 + this.rng() * 0.3;
    const y = this.yAt(f);
    const r = this.rAt(f) + this.G * 1.6;
    fish.position.set(r, y, 0);
    this.group.add(fish);
    this.parrotfish = fish;
    this.tag("parrotfish", fish);
    this._record("parrotfish", "hasChangelog", "changelog", 1);

    this.animated.push((t) => {
      // Grazing circuit: slow, with a scrape at the stipe and a turn away
      const th = Math.sin(t * 0.19) * 1.5;
      fish.position.set(Math.cos(th) * r, y + Math.sin(t * 0.4) * this.G * 0.4, Math.sin(th) * r);
      fish.rotation.y = -th + Math.PI / 2;
      fish.rotation.z = Math.sin(t * 1.6) * 0.06;
      tail.rotation.y = Math.sin(t * 3.4) * 0.4;
    });
  }

  /** Seahorse ← preRelease. Hovers in the canopy, anchored by its tail. */
  buildSeahorse() {
    if (!this.repo.preRelease) return;

    const horse = new THREE.Group();
    const mat = flesh(0xd8a848, { flat: true, roughness: 0.7 });

    // Upright body — seahorses are the one fish that swims vertically
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(this.G * 0.13, this.G * 0.42, 4, 7), mat);
    torso.position.y = this.G * 0.1;
    horse.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(this.G * 0.11, 7, 5), mat);
    head.position.y = this.G * 0.44;
    horse.add(head);

    const snout = new THREE.Mesh(new THREE.CylinderGeometry(this.G * 0.03, this.G * 0.05, this.G * 0.2, 5), mat);
    snout.rotation.x = Math.PI / 2.6;
    snout.position.set(0, this.G * 0.44, this.G * 0.11);
    horse.add(snout);

    // Prehensile tail, curled around the stipe
    const tail = new THREE.Mesh(new THREE.TorusGeometry(this.G * 0.13, this.G * 0.035, 4, 10, Math.PI * 1.5), mat);
    tail.position.y = -this.G * 0.26;
    tail.rotation.y = Math.PI / 2;
    horse.add(tail);

    const f = 0.68 + this.rng() * 0.24;
    const th = this.rng() * Math.PI * 2;
    const r = this.rAt(f) + this.G * 0.35;
    horse.position.set(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r);
    horse.rotation.y = -th;
    this.group.add(horse);
    this.seahorse = horse;
    this.tag("seahorse", horse);
    this._record("seahorse", "preRelease", "pre-release", 1);

    this.animated.push((t) => {
      // Hovers in place with a tiny bob — it is anchored, not swimming
      horse.position.y = this.yAt(f) + Math.sin(t * 0.8) * this.G * 0.07;
      horse.rotation.y = -th + Math.sin(t * 0.3) * 0.25;
      horse.rotation.z = Math.sin(t * 0.55) * 0.05;
    });
  }

  /**
   * Grouper ← branchCount.
   * An ambush predator: big, sits still, occupies the whole radius. More
   * branches = more territory claimed.
   */
  buildGrouper() {
    const b = this.repo.branchCount || 0;
    if (b < 2) return;

    const size = clamp(0.6 + Math.sqrt(b) * 0.16, 0.6, 2.2);
    const fish = new THREE.Group();
    const mat = flesh(0x6a5a48, { flat: true, roughness: 0.9 });

    const bodyGeo = new THREE.SphereGeometry(this.G * 0.42, 9, 7);
    bodyGeo.scale(1.5, 0.95, 0.72);
    fish.add(new THREE.Mesh(bodyGeo, mat));

    const head = new THREE.Mesh(new THREE.SphereGeometry(this.G * 0.28, 8, 6), mat);
    head.position.x = this.G * 0.5;
    fish.add(head);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(this.G * 0.32, this.G * 0.14, this.G * 0.4), mat);
    jaw.position.set(this.G * 0.66, -this.G * 0.1, 0);
    fish.add(jaw);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(this.G * 0.3, this.G * 0.4, 4), mat);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -this.G * 0.72;
    tail.scale.set(1, 1, 0.4);
    fish.add(tail);

    fish.scale.setScalar(size);

    const f = 0.3 + this.rng() * 0.35;
    const y = this.yAt(f);
    const r = this.rAt(f) + this.G * (2.4 + size);
    const a0 = this.rng() * Math.PI * 2;
    fish.position.set(Math.cos(a0) * r, y, Math.sin(a0) * r);
    fish.rotation.y = -a0;
    this.group.add(fish);
    this.grouper = fish;
    this.tag("grouper", fish);
    this._record("grouper", "branchCount", "branch count", b);

    this.animated.push((t) => {
      // Ambush: barely moves. A slow drift with occasional darts.
      const dart = Math.max(0, Math.sin(t * 0.13)) ** 8;
      const th = a0 + dart * 0.7;
      fish.position.set(Math.cos(th) * r, y + Math.sin(t * 0.24) * this.G * 0.3, Math.sin(th) * r);
      fish.rotation.y = -th;
      fish.rotation.z = Math.sin(t * 0.7) * 0.04;
    });
  }

  /**
   * Cleaner wrasse ← contributingGuide.
   * Small, fast, works the surface of the stipe — it cleans what it touches.
   */
  buildCleanerWrasse() {
    if (!this.repo.hasContributing) return;

    const n = this.isMobile ? 2 : 4;
    const fish = new THREE.Group();
    const mat = emissive(0x4ac8e0, 0.4, 0.9);
    const bodyGeo = new THREE.SphereGeometry(this.G * 0.1, 7, 5);
    bodyGeo.scale(2.4, 0.7, 0.4);

    const members = [];
    for (let i = 0; i < n; i++) {
      const f = new THREE.Mesh(bodyGeo, mat);
      fish.add(f);
      members.push({ mesh: f, ph: this.rng() * 6.28, off: this.rng() * 6.28 });
    }
    this.group.add(fish);
    this.cleanerWrasse = fish;
    this.tag("cleanerWrasse", fish);
    this._record("cleanerWrasse", "hasContributing", "contributing guide", n);

    this.animated.push((t) => {
      for (const m of members) {
        // Darts up and down the stipe, hugging the surface
        const f = 0.12 + (Math.sin(t * 0.7 + m.ph) * 0.5 + 0.5) * 0.6;
        const th = m.off + t * 0.5;
        const r = this.rAt(f) + this.G * 0.42;
        m.mesh.position.set(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r);
        m.mesh.rotation.y = -th + Math.PI / 2;
      }
    });
  }

  /** Coral polyp ← hasProjects. A colonial builder on the stipe. */
  buildCoralPolyp() {
    if (!this.repo.hasProjects) return;

    const n = this.isMobile ? 5 : 11;
    const mat = flesh(0xc87a9a, { flat: true, roughness: 0.8 });
    const polypGeo = new THREE.CylinderGeometry(this.G * 0.06, this.G * 0.1, this.G * 0.3, 6);
    // Both parts are the same shape every time, so each is one InstancedMesh
    // rather than n Meshes plus n more for the crowns.
    const bodyMesh = new THREE.InstancedMesh(polypGeo, mat, n);
    const crownGeo = new THREE.TorusGeometry(this.G * 0.08, this.G * 0.018, 4, 8);
    const crownMat = emissive(0xe8a0b8, 0.5);
    const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, n);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const off = new THREE.Matrix4();
    const spin = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 2, 0, 0)
    );

    for (let i = 0; i < n; i++) {
      const f = 0.1 + this.rng() * 0.55;
      const th = this.rng() * Math.PI * 2;
      const r = this.rAt(f) + this.G * 0.16;
      const y = this.yAt(f);

      e.set(Math.sin(th) * 0.6, 0, Math.cos(th) * 0.6);
      q.setFromEuler(e);
      p.set(Math.cos(th) * r, y, Math.sin(th) * r);
      m.compose(p, q, s);
      bodyMesh.setMatrixAt(i, m);

      // The crown sits at the polyp's mouth: the same transform, translated up
      // the body's own axis and turned flat.
      off.compose(
        new THREE.Vector3(0, this.G * 0.16, 0),
        spin,
        s
      );
      off.premultiply(m);
      crownMesh.setMatrixAt(i, off);
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.computeBoundingSphere();
    crownMesh.computeBoundingSphere();
    // Body and crown are one animal, so they share a wrapper for picking.
    const bed = new THREE.Group();
    bed.add(bodyMesh);
    bed.add(crownMesh);
    this.group.add(bed);
    this.tag("coralPolyp", bed);
    // Counted by the fauna census, which asks how many of each creature a repo
    // grew rather than what meshes it is made of.
    this.coralPolyp = new Array(n).fill(0);
    this._record("coralPolyp", "hasProjects", "project boards", n);
  }

  /**
   * Lanternfish ← downloadsEnabled.
   * A photophore hanging in the water column — the one Legacy creature that is
   * pure light, because its signal is a capability rather than a quantity.
   */
  buildLanternfish() {
    if (!this.repo.hasDownloadsEnabled) return;

    const n = this.isMobile ? 2 : 4;
    // Photophores trail below the canopy like a string of lamps. One
    // InstancedMesh, because a lamp is a lamp — they differ only in where they
    // hang and how big they pulse.
    const geo = new THREE.SphereGeometry(this.G * 0.1, 7, 5);
    const mesh = new THREE.InstancedMesh(geo, emissive(0x8fd8ff, 2.2, 0.95), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tag("lanternfish", mesh);

    const lamps = [];
    for (let i = 0; i < n; i++) {
      const f = 0.55 + this.rng() * 0.4;
      const th = this.rng() * Math.PI * 2;
      const r = this.rAt(f) + this.G * (1.2 + this.rng() * 1.8);
      lamps.push({
        y0: this.yAt(f),
        a0: th,
        rad: r,
        ph: this.rng() * 6.28,
      });
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const write = (t) => {
      for (let i = 0; i < lamps.length; i++) {
        const L = lamps[i];
        // Hangs and drifts, pulsing — a lanternfish's photophores blink
        const pulse = 0.6 + (Math.sin(t * 1.4 + L.ph) * 0.5 + 0.5) * 0.8;
        const th2 = L.a0 + t * 0.05;
        p.set(
          Math.cos(th2) * L.rad,
          L.y0 + Math.sin(t * 0.35 + L.ph) * this.G * 0.3,
          Math.sin(th2) * L.rad
        );
        s.setScalar(pulse);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    write(0);
    this.animated.push(write);
    this.lanternfish = lamps;
    this._record("lanternfish", "hasDownloadsEnabled", "downloads enabled", n);
  }

  /** Nudibranch ← pullRequestTemplate. Slow, brilliant, crawls the blades. */
  buildNudibranch() {
    if (!this.repo.hasPRTemplate) return;

    const n = this.isMobile ? 1 : 3;
    const mat = emissive(0xff7ad8, 0.55, 0.95);
    const slugs = [];

    // A slug is a squashed sphere plus two rhinophores. Built as three
    // InstancedMeshes for the whole colony — the body deforms in the geometry,
    // so the shape is authored once rather than once per slug.
    const bodyGeo = new THREE.SphereGeometry(this.G * 0.11, 7, 5);
    bodyGeo.scale(2.2, 0.5, 0.8);
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, mat, n);
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodyMesh.frustumCulled = false;

    const rhGeo = new THREE.CylinderGeometry(this.G * 0.012, this.G * 0.02, this.G * 0.16, 4);
    const rhMesh = new THREE.InstancedMesh(rhGeo, mat, n * 2);
    rhMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rhMesh.frustumCulled = false;

    for (let i = 0; i < n; i++) {
      slugs.push({
        f0: 0.3 + this.rng() * 0.5,
        th0: this.rng() * Math.PI * 2,
        ph: this.rng() * 6.28,
      });
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const out = new THREE.Matrix4();
    const rhOffset = new THREE.Matrix4();

    const write = (t) => {
      for (let i = 0; i < slugs.length; i++) {
        const S = slugs[i];
        // Crawls slowly upward — a nudibranch grazes as it goes
        const f = S.f0 + Math.sin(t * 0.05 + S.ph) * 0.18;
        const th = S.th0 + t * 0.035;
        const r = this.rAt(f) + this.G * 0.2;
        p.set(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r);
        e.set(0, -th + Math.PI / 2, Math.sin(t * 0.4 + S.ph) * 0.08);
        q.setFromEuler(e);
        m.compose(p, q, s);
        bodyMesh.setMatrixAt(i, m);

        for (let k = 0; k < 2; k++) {
          rhOffset.makeTranslation(
            this.G * 0.14,
            this.G * 0.08,
            (k === 0 ? -1 : 1) * this.G * 0.03
          );
          out.multiplyMatrices(m, rhOffset);
          rhMesh.setMatrixAt(i * 2 + k, out);
        }
      }
      bodyMesh.instanceMatrix.needsUpdate = true;
      rhMesh.instanceMatrix.needsUpdate = true;
    };

    write(0);
    const slug = new THREE.Group();
    slug.add(bodyMesh);
    slug.add(rhMesh);
    this.group.add(slug);
    this.tag("nudibranch", slug);
    this.animated.push(write);
    this.nudibranch = slugs;
    this._record("nudibranch", "hasPRTemplate", "PR template", n);
  }

  /**
   * Basking shark ← readmeLength.
   * A huge, slow shadow passing behind the tower. The longer the README, the
   * bigger the animal and the slower it goes.
   */
  buildBaskingShark() {
    const len = clamp(this.repo.readmeLength || 0, 0, 12000);
    if (len < 60) return;

    const k = clamp(Math.sqrt(len / 6000), 0.25, 1.6);
    const L = this.H * 0.9 * k;

    const shark = new THREE.Group();
    // A basking shark is a dark silhouette with a huge mouth. Render it as an
    // unlit dark shape so it reads as a shadow rather than an object.
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0a1a26,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const bodyGeo = new THREE.SphereGeometry(L * 0.16, 10, 7);
    bodyGeo.scale(1, 0.8, 3.6);
    shark.add(new THREE.Mesh(bodyGeo, mat));

    // Dorsal fin
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(L * 0.07, L * 0.22, 3), mat);
    dorsal.position.set(0, L * 0.14, 0);
    shark.add(dorsal);

    // Tail
    const tail = new THREE.Mesh(new THREE.ConeGeometry(L * 0.11, L * 0.3, 3), mat);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -L * 0.6;
    shark.add(tail);

    // The gill slits of a basking shark are enormous — that is the whole point
    // of the animal. Three dark bands behind the head, one InstancedMesh: they
    // are the same half-torus at three depths.
    if (!this.isMobile) {
      const slitGeo = new THREE.TorusGeometry(L * 0.09, L * 0.012, 4, 10, Math.PI);
      slitGeo.rotateY(Math.PI / 2);
      const slits = new THREE.InstancedMesh(slitGeo, mat, 3);
      const sm = new THREE.Matrix4();
      const sq = new THREE.Quaternion();
      const sp = new THREE.Vector3();
      const ss = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < 3; i++) {
        sp.set(0, 0, L * 0.28 - i * L * 0.07);
        sm.compose(sp, sq, ss);
        slits.setMatrixAt(i, sm);
      }
      slits.instanceMatrix.needsUpdate = true;
      shark.add(slits);
    }

    shark.position.set(0, this.yAt(0.75), -this.G * 9);
    this.group.add(shark);
    this.baskingShark = shark;
    this.tag("baskingShark", shark);
    this._record("baskingShark", "readmeLength", "README length", 1);

    this.animated.push((t) => {
      // A slow figure-eight behind the tower. Big animal, slow passage.
      const th = t * 0.06;
      const R = this.G * 10;
      shark.position.set(
        Math.sin(th) * R,
        this.yAt(0.75) + Math.sin(t * 0.11) * this.H * 0.12,
        -this.G * 9 + Math.cos(th) * R * 0.4
      );
      shark.rotation.y = -Math.atan2(Math.cos(th) * R, -Math.sin(th) * R * 0.4) + Math.PI / 2;
      shark.rotation.z = Math.sin(t * 0.2) * 0.05;
    });
  }

  /**
   * Anglerfish lure ← securityScanning.
   * An esca on an illicium: a light where you would not expect one. Security
   * scanning is exactly that — a light in a place you would rather not look.
   */
  buildAnglerfish() {
    if (!this.repo.securityScanning) return;

    const fish = new THREE.Group();
    const mat = flesh(0x1a2028, { flat: true, roughness: 0.95 });

    const bodyGeo = new THREE.SphereGeometry(this.G * 0.3, 8, 6);
    bodyGeo.scale(1.2, 0.9, 1.0);
    fish.add(new THREE.Mesh(bodyGeo, mat));

    // Illicium — the rod — arcing forward over the mouth
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(this.G * 0.012, this.G * 0.02, this.G * 0.7, 4),
      mat
    );
    rod.position.set(this.G * 0.2, this.G * 0.28, 0);
    rod.rotation.z = -0.6;
    fish.add(rod);

    // Esca — the lure. Bright, and it pulses.
    const esca = new THREE.Mesh(
      new THREE.SphereGeometry(this.G * 0.075, 8, 6),
      emissive(0x8fffd0, 2.8)
    );
    esca.position.set(this.G * 0.5, this.G * 0.5, 0);
    fish.add(esca);

    // The esca's glow on the surrounding water — a cheap point light so the
    // lure actually lights something, which is what a lure is for.
    const light = new THREE.PointLight(0x8fffd0, 1.2, this.G * 8, 2);
    light.position.copy(esca.position);
    fish.add(light);

    const f = 0.55 + this.rng() * 0.35;
    const th = this.rng() * Math.PI * 2;
    const r = this.rAt(f) + this.G * (2 + this.rng() * 1.5);
    fish.position.set(Math.cos(th) * r, this.yAt(f), Math.sin(th) * r);
    fish.rotation.y = -th;
    this.group.add(fish);
    this.anglerfish = fish;
    this.tag("anglerfish", fish);
    this._record("anglerfish", "securityScanning", "security scanning", 1);

    this.animated.push((t) => {
      const pulse = Math.sin(t * 1.1) * 0.5 + 0.5;
      esca.scale.setScalar(0.75 + pulse * 0.55);
      esca.material.emissiveIntensity = 1.6 + pulse * 2.2;
      light.intensity = 0.6 + pulse * 1.8;
      fish.position.y = this.yAt(f) + Math.sin(t * 0.3) * this.G * 0.35;
      fish.rotation.y = -th + Math.sin(t * 0.2) * 0.3;
    });
  }

  // -------------------------------------------------------------------------

  update(delta) {
    this.time += delta;
    if (this.isMobile && this.animated.length > 6) {
      // On mobile, animate a subset — these are decorative at that distance.
      const step = Math.ceil(this.animated.length / 6);
      for (let i = 0; i < this.animated.length; i += step) {
        this.animated[i](this.time);
      }
      return;
    }
    for (let i = 0; i < this.animated.length; i++) {
      this.animated[i](this.time);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}

export default LegacyColony;