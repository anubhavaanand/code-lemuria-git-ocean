import { describe, it, expect, beforeEach, vi } from "vitest";
import { PerfGovernor, TIERS, tierIndexFor } from "../src/world/adaptiveQuality.js";

/**
 * The governor is a clock, so the tests drive it with one rather than sleeping.
 * `sample` takes an explicit `now` precisely so it can be tested this way; the
 * `performance.now` path is exercised separately, once.
 *
 * `run(g, {from, to, step})` advances the clock from `from` to `to` in `step`
 * millisecond frames. Tests say "from 3.2 s to 7.1 s at 83 ms" — a duration, not
 * a frame count — because a frame count cannot be reasoned about when the whole
 * point is how long something took.
 *
 * A WINDOW STRADDLES the warm-up if you let it: the window that closes first
 * mixes the pre- and post-warm-up frames. That is why every test settles to 5.2 s
 * before it starts measuring — by then a clean window has closed at ~5.03 s and
 * the next one runs 5.03 → 7.03 s, so a phase from 5.2 s to 7.1 s is exactly one
 * window and nothing else.
 */
function run(g, { from, to, step }) {
  const windows = [];
  let t = from;
  let guard = 0;
  while (t < to && guard++ < 100000) {
    t += step;
    const w = g.sample(t);
    if (w) windows.push(w);
  }
  return { t, windows };
}

const SETTLE = { from: 0, to: 5200 };   // warm-up + one clean window closed
const COMFORTABLE = 16.7;               // 60 fps
const TROUBLE = 83;                     // 12 fps

describe("PerfGovernor", () => {
  let applied;
  beforeEach(() => {
    applied = [];
  });
  const make = (opts = {}) =>
    new PerfGovernor({ apply: (tier, i) => applied.push([tier.id, i]), ...opts });

  it("starts at the top tier and applies nothing", () => {
    const g = make();
    expect(g.index).toBe(0);
    expect(g.tier.id).toBe("high");
    expect(g.atFloor).toBe(false);
  });

  it("does not change tier during warm-up, however slow the frames are", () => {
    const g = make();
    // A 200 ms slideshow for the whole warm-up window.
    run(g, { from: 0, to: 2900, step: 200 });
    expect(applied).toEqual([]);
    expect(g.index).toBe(0);
  });

  it("holds a tier when the frame rate is comfortable", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 12000, step: COMFORTABLE });
    expect(applied).toEqual([]);
    expect(g.index).toBe(0);
  });

  it("steps down once when a sustained fraction of frames blows the budget", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(applied).toEqual([["medium", 1]]);
    expect(g.index).toBe(1);
  });

  it("steps down again on the next window at the same rate", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(applied).toEqual([["medium", 1]]);
    run(g, { from: 7100, to: 9100, step: TROUBLE });
    expect(applied).toEqual([["medium", 1], ["low", 2]]);
    expect(g.atFloor).toBe(true);
  });

  it("stops at the floor and never goes below it", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    run(g, { from: 7100, to: 9100, step: TROUBLE });
    run(g, { from: 9100, to: 30000, step: TROUBLE });
    expect(g.index).toBe(TIERS.length - 1);
    expect(g.atFloor).toBe(true);
    // Two steps: high→medium→low, then nothing more.
    expect(applied.length).toBe(2);
  });

  it("never steps up, even when the frame rate recovers", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(applied).toEqual([["medium", 1]]);
    // The same machine is now given 240 fps for five seconds.
    run(g, { from: 7100, to: 12100, step: 4 });
    expect(applied).toEqual([["medium", 1]]);
    expect(g.index).toBe(1);
  });

  it("does not react to a single stall — one long frame is not a pattern", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    g.sample(5400); // one 400 ms stall
    run(g, { from: 5400, to: 12000, step: COMFORTABLE });
    expect(applied).toEqual([]);
  });

  it("does not react to an alternating frame rate — half the frames over is not a pattern", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    // Alternate 16 ms (inside the 22.2 ms budget) and 60 ms (over): exactly half
    // the frames are over, so the fraction sits at 0.5, under the 0.6 threshold.
    // A governor that counted "any slowness" would trip here.
    let t = 5200;
    for (let i = 0; i < 200; i++) {
      t += i % 2 === 0 ? 16 : 60;
      g.sample(t);
    }
    expect(applied).toEqual([]);
  });

  it("reports the fraction of the window that was over budget", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    // Every frame is 100 ms against a 22.2 ms budget, so a full window can only
    // contain over-budget frames and the fraction must be exactly 1.
    //
    // The FIRST window after the switch straddles the transition — it holds the
    // last few comfortable frames as well as the slow ones — so it reports 0.63.
    // That is correct behaviour, not a bug: a window that contains both kinds of
    // frame must not report 1, or it would be claiming something it did not
    // measure. Every window after it is homogeneous.
    const { windows } = run(g, { from: 5200, to: 13000, step: 100 });
    expect(windows.length).toBeGreaterThan(1);
    const [first, ...rest] = windows;
    expect(first.fraction).toBeGreaterThan(0);
    expect(first.fraction).toBeLessThan(1);   // straddles
    for (const w of rest) {
      expect(w.fraction).toBe(1);
      expect(w.overBudget).toBe(w.frames);
      expect(w.worstMs).toBeGreaterThanOrEqual(100);
    }
  });

  it("accepts a custom budget", () => {
    // 20 fps budget: 50 ms.
    const g = make({ budgetMs: 50 });
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: 30 });  // 33 fps — inside 50 ms
    expect(applied).toEqual([]);
    run(g, { from: 7100, to: 9100, step: 80 });  // 12.5 fps — outside it
    expect(applied).toEqual([["medium", 1]]);
  });

  it("reports for the census without changing behaviour", () => {
    const g = make();
    const r = g.report();
    expect(r.tier).toBe("high");
    expect(r.pixelRatio).toBe(2);
    expect(r.shadows).toBe(true);
    expect(r.changes).toBe(0);
    expect(r.atFloor).toBe(false);
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(g.report().tier).toBe("medium");
    expect(g.report().changes).toBe(1);
    expect(g.report().shadows).toBe(true); // medium keeps shadows
  });

  it("drops shadows at the floor tier", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    run(g, { from: 7100, to: 9100, step: TROUBLE });
    const r = g.report();
    expect(r.tier).toBe("low");
    expect(r.pixelRatio).toBe(1);
    expect(r.shadows).toBe(false);
  });

  it("honours a non-zero start index", () => {
    const g = make({ startIndex: 1 });
    expect(g.tier.id).toBe("medium");
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(applied).toEqual([["low", 2]]);
  });

  it("clamps a start index past the end", () => {
    const g = make({ startIndex: 99 });
    expect(g.atFloor).toBe(true);
    expect(g.tier.id).toBe("low");
  });

  it("reads performance.now when no clock is passed", () => {
    const g = make();
    const spy = vi.spyOn(performance, "now");
    spy.mockReturnValue(0);
    g.sample();                       // baseline
    spy.mockReturnValue(1000);        // inside warm-up
    expect(g.sample()).toBeUndefined();
    spy.mockReturnValue(5200);
    // Let the fake clock stand in for the driver: the governor itself must be
    // able to close a window without help.
    expect(g.sample()).toBeDefined();
    spy.mockRestore();
  });

  it("reset clears the clock and the counters but not the chosen tier", () => {
    const g = make();
    run(g, { ...SETTLE, step: COMFORTABLE });
    run(g, { from: 5200, to: 7100, step: TROUBLE });
    expect(g.index).toBe(1);
    g.reset();
    expect(g.frames).toBe(0);
    expect(g.overBudget).toBe(0);
    expect(g.index).toBe(1); // the renderer stays where it was put
  });
});
describe("tierIndexFor", () => {
  it("maps each scene-quality string onto the matching tier", () => {
    expect(tierIndexFor("high")).toBe(0);
    expect(tierIndexFor("mobile")).toBe(1);   // one step down, not the floor
    expect(tierIndexFor("low")).toBe(2);
  });

  it("returns undefined for a string it does not know", () => {
    // The caller turns this into 0: an uncharacterised machine gets the benefit
    // of the doubt and is corrected by measurement rather than by a guess.
    expect(tierIndexFor("potato")).toBeUndefined();
    expect(tierIndexFor(undefined)).toBeUndefined();
    expect(tierIndexFor("")).toBeUndefined();
  });

  it("never returns an index the tier list does not have", () => {
    for (const q of ["high", "mobile", "low", "x", undefined, null, 0]) {
      const i = tierIndexFor(q);
      if (i === undefined) continue;
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(TIERS.length);
    }
  });
});
