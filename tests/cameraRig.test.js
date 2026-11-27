import { describe, it, expect, beforeAll } from "vitest";
// The rig binds a keydown handler on `window` in its constructor.
beforeAll(() => {
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 1440,
      innerHeight: 900,
    };
  }
});
import * as THREE from "three";
import { CameraRig } from "../src/world/CameraRig";
import { ZOOM_LEVELS, SURFACE_Y } from "../src/world/constants";

/**
 * The rig's follow framing.
 *
 * Four bugs were found in this one function by measuring the live scene rather
 * than by reading it, and every one produced a frame that "looked wrong" rather
 * than an error:
 *
 *  1. The level's `height` was added to `focus.y` AND the pitch term was
 *     subtracted from that sum, so a level's authored height was counted twice.
 *     On the vue entry: focus 71.0 + height 9.33 gave an eye at 137.8 against a
 *     body at 74.4 — 63 units above a 48-unit animal, 17 degrees down.
 *  2. `height` and `focusY` were merged with `Math.max` against the level's
 *     authored numbers. A level's numbers are heights above y = 0; a follow
 *     target's are a rise and an aim measured from the subject. Taking the
 *     larger of two unrelated references is a category error, not a compromise.
 *  3. `Math.max(4, py)` was written when every subject sat near y = 0. A language
 *     colony at y = -4,200 got the camera lifted to +4.
 *  4. `_follow()` solved the lens distance against the frame's HEIGHT and added
 *     the tower's orbit, which is 268 units of lens for a 48.8-unit animal.
 *
 * These tests pin the behaviour that was wrong, not the arithmetic that was
 * right: a follow target's numbers must win outright, the eye must be near the
 * subject's own level, and the animal must actually be in front of the lens.
 */
describe("camera rig follow framing", () => {
  // The rig binds pointer and wheel handlers to its DOM element in the
  // constructor. A stub is enough — nothing here exercises input.
  const dom = () => {
    const noop = () => {};
    return {
      addEventListener: noop,
      removeEventListener: noop,
      setPointerCapture: noop,
      releasePointerCapture: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
      style: {},
      ownerDocument: { addEventListener: noop, removeEventListener: noop },
    };
  };

  const rig = () => {
    const camera = new THREE.PerspectiveCamera(42, 1440 / 900, 0.5, 12000);
    const r = new CameraRig(camera, dom(), { levels: ZOOM_LEVELS });
    // The constructor calls `apply(0, true)` once, before any level has been
    // chosen, so `t` sits on the default (city) and the first explicit `apply`
    // after `goTo` is what a caller actually sees. `goTo` sets both `t` and
    // `targetT`, so a single `apply` is enough — but only if the level index
    // was set first, which every test below does.
    return r;
  };

  // A whale-level follow target shaped like `_follow()` produces: a focus point
  // at the animal, a rise of 2 degrees at the lens, and a distance solved from
  // the body length.
  const whaleFollow = (length, focusY, dist) => ({
    position: new THREE.Vector3(0, focusY, -600),
    radius: 62,
    focusY,
    height: Math.tan((2 * Math.PI) / 180) * dist,
    distance: dist,
  });

  it("uses the target's focus outright, not the larger of two references", () => {
    const r = rig();
    // The whale level authors focusY 16. A subject at y = 71 must not be pulled
    // back down to 16, and a subject at y = -40 must not be pulled up to 16.
    const f = whaleFollow(48.8, 71, 124);
    r.goTo(4);
    r.apply(0, true, f);
    expect(r.focus.y).toBeCloseTo(71, 2);
  });

  it("uses the target's rise outright, not the level's height", () => {
    const r = rig();
    const f = whaleFollow(48.8, 71, 124);
    r.goTo(4);
    r.apply(0, true, f);
    // The eye is the aim plus the rise. The level's own height (16 at whale
    // level) must not leak in and lift the camera above the animal.
    const eyeAboveFocus = r.camera.position.y - r.focus.y;
    expect(eyeAboveFocus).toBeLessThan(f.height + 0.5);
    expect(eyeAboveFocus).toBeGreaterThan(f.height - 0.5);
  });

  it("keeps the eye near the subject's own level at whale zoom", () => {
    const r = rig();
    const f = whaleFollow(48.8, 71, 124);
    r.goTo(4);
    r.apply(0, true, f);
    // 2 degrees over 124 units is 4.3 units of rise. Anything past a tenth of
    // the body length is the camera looking down on a back rather than along a
    // flank, which is the specific failure this guards.
    const rise = r.camera.position.y - r.focus.y;
    expect(rise).toBeLessThan(48.8 * 0.1);
    expect(rise).toBeGreaterThan(-48.8 * 0.1);
  });

  it("never lifts the eye above the subject just because the sea floor is at zero", () => {
    const r = rig();
    // A deep colony: aim at -4,200, body at -4,200. The old `Math.max(4, py)`
    // would put the camera at +4 and look 4,200 units down.
    // Whale level first, so the level band is out of the way, then a subject
    // at -4,200 with an 80-unit lens.
    const f = whaleFollow(20, -4200, 80);
    r.goTo(4);
    r.apply(0, true, f);
    expect(r.camera.position.y).toBeLessThan(-4190);
    expect(r.camera.position.y).toBeGreaterThan(-4215);
  });

  it("keeps the whole subject in front of the lens", () => {
    const r = rig();
    const f = whaleFollow(48.8, 71, 124);
    r.goTo(4);
    r.apply(0, true, f);
    const forward = new THREE.Vector3();
    r.camera.getWorldDirection(forward);
    const toSubject = r.focus.clone().sub(r.camera.position);
    // The aim point must be along the view axis, not behind it.
    expect(toSubject.dot(forward)).toBeGreaterThan(0);
    expect(toSubject.length()).toBeGreaterThan(48.8);
  });

  it("leaves the level bands alone when nothing is being followed", () => {
    const r = rig();
    r.goTo(2);
    r.apply(0, true, null);
    const city = ZOOM_LEVELS[2];
    // The authored behaviour, untouched by the follow rules: focus at the
    // level's focusY, eye at that plus the level's height, minus the pitch term
    // (the pitch is negative, so the term is additive — it lifts the eye so the
    // band reads as a descent).
    const pitchTerm = -Math.sin(r.pitch) * city.distance * 0.55;
    expect(r.focus.y).toBeCloseTo(city.focusY, 1);
    expect(r.camera.position.y).toBeCloseTo(city.focusY + city.height + pitchTerm, 1);
  });
});

/**
 * The camera must never break the surface.
 *
 * The world level aims at the floor from a 700-unit rise over a 1,450-unit
 * dolly, which puts the eye at y ≈ 716 — 296 units ABOVE the water surface at
 * y = 420. From up there the surface renders as a bright flat ceiling across
 * the top of the frame (the surface seen from above), not as a water column you
 * are descending through. Measured on the live scene, that bright slab was the
 * single most broken thing about the world view.
 *
 * A viewer at −4,200 m is under the water. The lens has to be too.
 */
describe("camera surface clamp", () => {
  const dom = () => {
    const noop = () => {};
    return {
      addEventListener: noop,
      removeEventListener: noop,
      setPointerCapture: noop,
      releasePointerCapture: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
      style: {},
      ownerDocument: { addEventListener: noop, removeEventListener: noop },
    };
  };

  it("keeps the eye under the surface at the world level", () => {
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.5, 12000);
    const r = new CameraRig(camera, dom(), { levels: ZOOM_LEVELS });
    r.goTo(0);
    r.apply(0, true, null);
    expect(r.camera.position.y).toBeLessThan(SURFACE_Y);
  });

  it("never lifts the eye above the surface at any level", () => {
    const camera = new THREE.PerspectiveCamera(62, 1440 / 900, 0.5, 12000);
    const r = new CameraRig(camera, dom(), { levels: ZOOM_LEVELS });
    for (let i = 0; i < ZOOM_LEVELS.length; i++) {
      r.goTo(i);
      r.apply(0, true, null);
      expect(r.camera.position.y).toBeLessThan(SURFACE_Y);
    }
  });

  it("leaves a level that already sits under the surface untouched", () => {
    // The clamp must be soft: the tower level's eye is ~62 units, nowhere near
    // the surface, and it must come out exactly as authored.
    const camera = new THREE.PerspectiveCamera(48, 1440 / 900, 0.5, 12000);
    const r = new CameraRig(camera, dom(), { levels: ZOOM_LEVELS });
    // By id, not by index. This read `ZOOM_LEVELS[3]`, which was the tower level
    // while there were five; with three levels index 3 does not exist and the
    // test threw instead of asserting. The intent was always "the tower level".
    const towerIndex = ZOOM_LEVELS.findIndex((l) => l.id === "tower");
    r.goTo(towerIndex);
    r.apply(0, true, null);
    const tower = ZOOM_LEVELS[towerIndex];
    const pitchTerm = -Math.sin(r.pitch) * tower.distance * 0.55;
    expect(r.camera.position.y).toBeCloseTo(tower.focusY + tower.height + pitchTerm, 1);
  });
});

/**
 * The station ring must actually be a ring.
 *
 * `stationPosition()` is an orthographic projection of real latitude and
 * longitude, so the capitals wrap around the map's centre. A version mirrored
 * the front hemisphere to the back to keep every station behind one camera —
 * which silently rewrote the geography (Beijing and Tokyo swapped hemispheres)
 * and left the network connecting cities that were no longer near each other.
 * This pins the projection to the real formula and pins the spread.
 */
describe("station lattice geometry", () => {
  it("places every capital by a real lat/lon projection", async () => {
    const { CAPITAL_CLUSTERS, stationPosition } = await import("../src/world/worldData");
    for (const c of CAPITAL_CLUSTERS) {
      const lat = (c.lat * Math.PI) / 180;
      const lon = (c.lon * Math.PI) / 180;
      const ring = Math.cos(lat) * 900;
      const p = stationPosition(c);
      expect(p.x).toBeCloseTo(Math.sin(lon) * ring, 4);
      expect(p.z).toBeCloseTo(Math.cos(lon) * ring - 300, 4);
    }
  });

  it("separates the capitals into a basin-wide basin, not a smear", async () => {
    const { CAPITAL_CLUSTERS, stationPosition } = await import("../src/world/worldData");
    const pts = CAPITAL_CLUSTERS.map((c) => stationPosition(c));
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      }
    }
    // No two stations may collapse onto each other.
    expect(min).toBeGreaterThan(80);
    // And the ring spans most of the basin, so it reads as a map rather than a
    // cluster: the widest pair is well over half the ring radius.
    let max = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        max = Math.max(max, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      }
    }
    expect(max).toBeGreaterThan(900);
  });
});