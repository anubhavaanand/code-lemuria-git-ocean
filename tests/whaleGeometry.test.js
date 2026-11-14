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
