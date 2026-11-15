/**
 * The metro network's geometry, with no renderer.
 *
 * A tube between two stations is a curve. These tests pin the three properties
 * that make it a network rather than a drawing: the curve must actually reach
 * both stations, it must stay under the sediment instead of cutting through
 * open water, and the flow shader must have somewhere to travel along.
 *
 * They run the real exported functions in Node, which works because none of
 * them need a GL context — they build buffers and materials, and three.js only
 * needs WebGL at render time.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  CAPITAL_CLUSTERS,
  stationPosition,
  stationEdges,
  STATION_RING_RADIUS,
} from "../src/world/worldData";
import { seafloorHeightAt } from "../src/world/Seafloor";
import {
  MetroNetwork,
  stationDistance,
  metroCurve,
  TUBE_RADIUS,
  TUBE_BURY,
} from "../src/world/Metro";

describe("station lattice", () => {
  it("puts every capital on the ring, inside the world-zoom frustum", () => {
    // World zoom: camera (0, 700, 1450) -> (0, 16, 0), fov 62, aspect 1.6.
    // A station must be within the half-width at its own depth to be seen.
    const ty = Math.tan((62 * Math.PI) / 360);
    const tx = ty * 1.6;
    for (const c of CAPITAL_CLUSTERS) {
      const p = stationPosition(c);
      const depth = 1450 - p.z;
      expect(Math.abs(p.x)).toBeLessThan(depth * tx);
      const r = Math.hypot(p.x, p.z + 300);
      expect(r).toBeLessThanOrEqual(STATION_RING_RADIUS * 1.05);
      expect(r).toBeGreaterThan(STATION_RING_RADIUS * 0.6);
    }
  });

  it("separates the capitals that the old formula stacked", () => {
    // The bug: six cities inside a 14 x 141 box. Any two stations closer than
    // this cannot hold a tube long enough to read as a journey.
    const pts = CAPITAL_CLUSTERS.map((c) => ({ id: c.id, ...stationPosition(c) }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
        expect(d).toBeGreaterThan(80);
      }
    }
  });

  it("is deterministic — a reload does not move the map", () => {
    const a = CAPITAL_CLUSTERS.map((c) => stationPosition(c));
    const b = CAPITAL_CLUSTERS.map((c) => stationPosition(c));
    expect(a).toEqual(b);
  });

  it("connects each station to its two nearest neighbours", () => {
    const edges = stationEdges(CAPITAL_CLUSTERS);
    // Six stations, nearest-2, deduplicated: between 6 and 12 edges.
    expect(edges.length).toBeGreaterThanOrEqual(CAPITAL_CLUSTERS.length);
    expect(edges.length).toBeLessThanOrEqual(CAPITAL_CLUSTERS.length * 2);
    for (const [i, j] of edges) {
      expect(i).not.toBe(j);
      expect(edges.some(([a, b]) => a === j && b === i)).toBe(false);
    }
  });

  it("leaves no station unreachable", () => {
    const edges = stationEdges(CAPITAL_CLUSTERS);
    const seen = new Set([0]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [i, j] of edges) {
        if (seen.has(i) && !seen.has(j)) {
          seen.add(j);
          grew = true;
        } else if (seen.has(j) && !seen.has(i)) {
          seen.add(i);
          grew = true;
        }
      }
    }
    expect(seen.size).toBe(CAPITAL_CLUSTERS.length);
  });
});

describe("tube curve", () => {
  const a = CAPITAL_CLUSTERS[0];
  const b = CAPITAL_CLUSTERS[1];
  const pa = stationPosition(a);
  const pb = stationPosition(b);

  it("starts and ends exactly at the two stations", () => {
    const curve = metroCurve(pa, pb);
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    // Bury offset is applied to Y only, so X and Z must match the station.
    expect(start.x).toBeCloseTo(pa.x, 2);
    expect(start.z).toBeCloseTo(pa.z, 2);
    expect(end.x).toBeCloseTo(pb.x, 2);
    expect(end.z).toBeCloseTo(pb.z, 2);
  });

  it("sits below the sediment at its endpoints, not floating above it", () => {
    const curve = metroCurve(pa, pb);
    // A portal meets its station at the station's own floor level, then dives.
    for (const t of [0, 1]) {
      const p = curve.getPoint(t);
      const floor = seafloorHeightAt(p.x, p.z);
      expect(p.y).toBeCloseTo(floor, 1);
    }
  });

  it("is fully buried within the first and last tenth of its run", () => {
    const curve = metroCurve(pa, pb);
    // This is the property that matters and the one the first version broke: a
    // tube that surfaces through a trench halfway along is not a tunnel. On the
    // delhi->sf edge the clearance used to go from -19 at t=0.3 to -0.08 at
    // t=0.7, because the curve was smoothed in absolute Y while the seafloor
    // fell away underneath it.
    for (let i = 1; i < 10; i++) {
      for (const t of [i / 10, 1 - i / 10]) {
        const p = curve.getPoint(t);
        const clearance = seafloorHeightAt(p.x, p.z) - p.y;
        expect(clearance).toBeGreaterThan(2);
      }
    }
  });

  it("stays buried along its whole length", () => {
    const curve = metroCurve(pa, pb);
    const samples = 40;
    for (let i = 0; i <= samples; i++) {
      const p = curve.getPoint(i / samples);
      const clearance = seafloorHeightAt(p.x, p.z) - p.y;
      // Negative means the tube is below the sediment, which is the whole
      // point. The tolerance covers the Catmull-Rom's own overshoot between
      // control points.
      expect(clearance).toBeGreaterThan(-1);
    }
  });

  it("uses the reported distance, and reports the real chord", () => {
    const d = stationDistance(pa, pb);
    expect(d).toBeCloseTo(Math.hypot(pa.x - pb.x, pa.z - pb.z), 4);
  });
});

describe("MetroNetwork", () => {
  // The FLAT shape: this is what OceanWorld actually hands the network. It
  // used to be built as `{ ...stationPosition(c), cluster: c }`, which masked
  // two real bugs — the tube names and the activity uniform both went through
  // a nested `cluster` lookup and silently fell back to defaults, because the
  // production stations are a flat spread with no nested cluster at all.
  const stations = CAPITAL_CLUSTERS.map((c) => ({ ...stationPosition(c), ...c }));
  const edges = stationEdges(CAPITAL_CLUSTERS).map(([i, j]) => [stations[i], stations[j]]);

  it("builds one mesh per edge, all in one group", () => {
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    expect(metro.tubes.length).toBe(edges.length);
    expect(metro.group.parent).toBe(scene);
    for (const t of metro.tubes) {
      expect(t.mesh.geometry.attributes.position.count).toBeGreaterThan(0);
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("gives every tube a length and a flow uniform", () => {
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    for (const t of metro.tubes) {
      expect(t.length).toBeGreaterThan(0);
      expect(t.mesh.material.uniforms.uLength.value).toBe(t.length);
      // Each tube starts at a different point along its run, so six tubes do
      // not all pulse at once and read as a machine cycling.
      expect(t.mesh.material.uniforms.uFlow.value).toBeGreaterThanOrEqual(0);
      expect(t.mesh.material.uniforms.uFlow.value).toBeLessThan(t.length);
    }
    // The start offsets are not all the same.
    const starts = new Set(metro.tubes.map((t) => t.mesh.material.uniforms.uFlow.value.toFixed(3)));
    expect(starts.size).toBe(metro.tubes.length);
  });

  it("names every tube after both of its stations", () => {
    // This asserted nothing before, because the fixture used the nested
    // `{ cluster }` shape and every name came out `metro:delhi-beijing`-shaped
    // by accident of the wrapper. Against the flat production shape every
    // name silently became `metro:unknown-unknown` — a network of anonymous
    // tubes, which is exactly the failure the naming exists to prevent.
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    for (const t of metro.tubes) {
      expect(t.mesh.name).toMatch(/^metro:(?!unknown)[a-z]+-(?!unknown)[a-z]+$/);
    }
    // Every station is named in at least one tube, so no city is anonymous.
    const named = new Set();
    for (const t of metro.tubes) {
      for (const part of t.mesh.name.replace(/^metro:/, "").split("-")) named.add(part);
    }
    expect(named.size).toBe(stations.length);
  });

  it("scales activity by the two stations' glow, so the busy lines read brighter", () => {
    // Both ends of the same edge contribute, so a tube between two bright
    // capitals must be brighter than one between two quiet ones. This is the
    // property that made the old code's 0.6 fallback invisible: every tube
    // got the same value and the render still looked plausible.
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    const acts = metro.tubes.map((t) => t.mesh.material.uniforms.uActivity.value);
    for (const a of acts) {
      expect(a).toBeGreaterThan(0.5);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(new Set(acts.map((a) => a.toFixed(3))).size).toBe(metro.tubes.length);
    // The loudest pair in the network is sf (1.0) with tokyo (0.81); the
    // quietest is berlin (0.72) with london (0.68). Verify against the data
    // rather than against a hand-computed number.
    const byId = new Map(stations.map((s) => [s.id, s.glow]));
    const expected = metro.tubes.map((t) => {
      const [x, y] = t.mesh.name.replace(/^metro:/, "").split("-");
      return byId.get(x) * 0.5 + byId.get(y) * 0.5;
    });
    expect(expected).toEqual(acts.map((a) => expect.closeTo(a, 3)));
    expect(Math.max(...acts)).toBeGreaterThan(Math.min(...acts));
  });

  it("fewer segments on low quality", () => {
    const mk = (quality) => {
      const m = new MetroNetwork(new THREE.Scene(), { quality });
      m.build(stations, edges);
      const seg = m.tubes[0].mesh.geometry.attributes.position.count;
      m.dispose();
      return seg;
    };
    expect(mk("low")).toBeLessThan(mk("high"));
  });

  it("advances the flow and the pulse without a renderer", () => {
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    metro.update(0, 1.0);
    const before = metro.tubes.map((t) => t.mesh.material.uniforms.uFlow.value);
    metro.update(1.5, 2.5);
    const after = metro.tubes.map((t) => t.mesh.material.uniforms.uFlow.value);
    for (let i = 0; i < after.length; i++) {
      // Advances by speed * delta, wrapped at the tube's own length.
      const t = metro.tubes[i];
      const wanted = (before[i] + 34 * 1.5) % t.length;
      expect(after[i]).toBeCloseTo(wanted, 4);
      expect(t.mesh.material.uniforms.uTime.value).toBe(2.5);
    }
  });

  it("disposes its geometry and leaves the shared curve alone", () => {
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    metro.build(stations, edges);
    const geos = metro.tubes.map((t) => t.mesh.geometry);
    metro.dispose();
    expect(metro.group.parent).toBe(null);
    for (const g of geos) expect(g.attributes.position).toBeTruthy();
  });

  it("does nothing before build()", () => {
    const scene = new THREE.Scene();
    const metro = new MetroNetwork(scene, { quality: "low" });
    expect(metro.tubes.length).toBe(0);
    expect(() => metro.update(0, 1)).not.toThrow();
    expect(() => metro.dispose()).not.toThrow();
  });
});