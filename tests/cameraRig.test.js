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
import { ZOOM_LEVELS } from "../src/world/constants";

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