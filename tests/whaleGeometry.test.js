import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildWorld } from "../src/world/worldData";
import { whaleLength } from "../src/world/constants";
import { WhaleWithSculpt } from "../src/world/WhaleFactory";

/**
 * The whale's body geometry must be centred on its own group.
 *
 * This is a regression test for a transform-order bug that cost a full QA pass:
 * `geo.translate(-L/2, 0, 0)` followed by `geo.scale(L, G, G)` post-multiplies,
 * so the shift was scaled as well and the body landed at x = -L/2 * L. For a
 * 48.8 unit humpback that is -1,166 units, and the group's bounding box measured
 * 1,236 units against a 48.8 unit animal.
 *
 * The camera framing is solved from that bounding box, so the failure did not
 * read as "the mesh is in the wrong place" — it read as "the whale is missing",
 * because the lens framed empty water 25 body-lengths from the animal.
 */
describe("whale geometry", () => {
  const whale = () => {
    const world = buildWorld();
    const repo = world.following.find((r) => r.name === "vue");
    return new WhaleWithSculpt(repo, { quality: "low" });
  };

  it("centres the body on its group origin", () => {
    const w = whale();
    const box = new THREE.Box3().setFromObject(w.group);
    const centre = box.getCenter(new THREE.Vector3());
    // Half a body length of slop is generous; the bug was 24x the length.
    expect(Math.abs(centre.x)).toBeLessThan(w.length * 0.5);
  });

  it("reports a bounding box the length of the animal, not 25x it", () => {
    const w = whale();
    const size = new THREE.Box3().setFromObject(w.group).getSize(new THREE.Vector3());
    // The flukes span the tail and the spout rises above the back, so the
    // longest axis may exceed the body — but not by an order of magnitude.
    expect(size.x).toBeLessThan(w.length * 2);
    expect(size.x).toBeGreaterThan(w.length * 0.8);
  });

  it("puts the body geometry exactly where the nose-to-tail math says", () => {
    const w = whale();
    const geo = w.body.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const nose = -w.length * 0.5;
    const tail = w.length * 0.5;
    expect(bb.min.x).toBeCloseTo(nose, 1);
    expect(bb.max.x).toBeCloseTo(tail, 1);
  });

  it("keeps every part within two body lengths of the origin", () => {
    const w = whale();
    const strays = [];
    w.group.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      if (!o.geometry || !o.geometry.attributes) return;
      const pos = o.geometry.attributes.position;
      if (!pos || !pos.count) return;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < pos.count; i += 7) {
        const x = pos.getX(i);
        if (x < min) min = x;
        if (x > max) max = x;
      }
      if (max - min > w.length * 3) {
        strays.push(`${o.type}:${(max - min).toFixed(0)}`);
      }
    });
    expect(strays).toEqual([]);
  });

  it("scales the animal from the commit count, as the roadmap says", () => {
    const world = buildWorld();
    const repo = world.following.find((r) => r.name === "vue");
    const w = new WhaleWithSculpt(repo, { quality: "low" });
    // Humpback: lengthMul 1.0.
    expect(w.length).toBeCloseTo(whaleLength(repo), 5);
    expect(w.girth).toBeCloseTo(w.length * 0.19 * 1.05, 5);
  });
});

/**
 * A sculpt's cross-section is an ellipse, not a circle.
 *
 * The lathe body is a surface of revolution, so `this.girth` is the radius in
 * every direction and one number seats everything. The imported humpback is not:
 * measured at 48.785 units long it is 18.54 deep (half-height 9.27) and 21.95
 * wide (half-width 10.98). Seating a flank animal with the vertical radius puts
 * it ~1.7 units under the skin, and a barnacle is about 0.5 units across — so
 * the open-issue mapping was drawn entirely inside the body and never appeared.
 */
describe("the sculpt's elliptical cross-section", () => {
  // A humpback sculpt as normalizeWhale + WhaleFactory would report it for a
  // 48.785-unit vue: 0.38 of length deep, 0.45 of length wide.
  const sculptSize = (w) => new THREE.Vector3(w.length, w.length * 0.38, w.length * 0.45);

  // A repo that actually draws the fauna in question: open issues make
  // barnacles, watchers make remoras.
  const whaleWithFauna = (over = {}) => {
    const world = buildWorld();
    const base = world.following.find((r) => r.name === "vue");
    return new WhaleWithSculpt(
      { ...base, openIssues: 12, watchers: 40, ...over },
      { quality: "low" }
    );
  };

  it("keeps the lathe body circular", () => {
    const w = whaleWithFauna();
    expect(w.surfaceRadiusZ(0.3)).toBe(w.surfaceRadius(0.3));
    expect(w.surfaceRadiusZ(0.7)).toBe(w.surfaceRadius(0.7));
  });

  it("gives a sculpt a lateral radius wider than its vertical one", () => {
    const w = whaleWithFauna();
    w.sculptSize = sculptSize(w);
    expect(w.surfaceRadius(0.5)).toBeCloseTo(w.length * 0.38 * 0.5, 4);
    expect(w.surfaceRadiusZ(0.5)).toBeCloseTo(w.length * 0.45 * 0.5, 4);
    expect(w.surfaceRadiusZ(0.5)).toBeGreaterThan(w.surfaceRadius(0.5));
  });

  it("seats every barnacle on the ellipse, not inside it", () => {
    const w = whaleWithFauna();
    w.sculptSize = sculptSize(w);
    w.rescaleAppendages();

    expect(w.barnacleMesh).toBeTruthy();
    expect(w._barnacleSeeds.length).toBeGreaterThan(0);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    w._barnacleSeeds.forEach((seed, i) => {
      w.barnacleMesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const ry = w.surfaceRadius(seed.t);
      const rz = w.surfaceRadiusZ(seed.t);
      // On the ellipse: (y / (ry*0.85))^2 + (z / rz)^2 = 1. A barnacle seated
      // with the vertical radius on both axes lands well inside this.
      const r = (p.y / (ry * 0.85)) ** 2 + (p.z / rz) ** 2;
      expect(r).toBeCloseTo(1, 3);
    });
  });

  it("scales each barnacle rather than dragging the cluster inward", () => {
    // Scaling the InstancedMesh scales its instance POSITIONS too, so the old
    // `mesh.scale.setScalar(k)` moved the whole cluster toward the origin as it
    // shrank the animals — the opposite of seating them on the skin.
    const w = whaleWithFauna();
    w.sculptSize = sculptSize(w);
    w.rescaleAppendages();

    expect(w.barnacleMesh.scale.x).toBe(1);
    // ...and the cluster is still spread over the ellipse rather than pinned
    // near the centreline: at least one animal reaches the flank radius.
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let maxZ = 0;
    let maxRz = 0;
    w._barnacleSeeds.forEach((seed, i) => {
      w.barnacleMesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      maxZ = Math.max(maxZ, Math.abs(p.z));
      maxRz = Math.max(maxRz, w.surfaceRadiusZ(seed.t));
    });
    expect(maxZ).toBeGreaterThan(maxRz * 0.5);
  });
});
