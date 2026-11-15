/**
 * Git Ocean — adaptive quality
 *
 * perf.js measures frame time; until now nothing read it. A user on integrated
 * graphics at 2560x1440 got the same pixel ratio and the same shadow map as a
 * user on a discrete card at 1280x720, and the only evidence that the frame was
 * slow was a number behind `?debug=perf` that nobody was looking at.
 *
 * This is the missing half: a governor that reads the frame interval and steps
 * the render cost down when the machine cannot hold the budget.
 *
 * THREE DECISIONS, each of them a bug avoided rather than a preference:
 *
 * 1. It only ever steps DOWN. A machine that briefly dips — a shader compile, a
 *    tab regaining focus, a GC pause — must not be "corrected" back up, because
 *    stepping up on a machine that cannot sustain it produces an oscillation
 *    far more visible than either tier held steady. A user who wants more can
 *    raise it by hand; the governor's job is to stop a bad frame rate, not to
 *    maximise pixels.
 *
 * 2. It ignores the first three seconds. Shader compilation and texture upload
 *    land in the opening frames and would otherwise downgrade every machine on
 *    every load. Same reason perf.js ignores the first five frames.
 *
 * 3. It requires the badness to be SUSTAINED, measured as a fraction of frames
 *    over budget inside a window rather than a single EMA sample. An EMA reacts
 *    to one stall; a windowed fraction reacts to a pattern, and a pattern is
 *    what "this machine cannot cope" actually means.
 *
 * The frame interval is measured as the gap between successive `sample` calls —
 * the real wall-clock gap between rendered frames, which is the number the user
 * feels. Deliberately not `clock.getDelta()`: that is clamped to 0.05 s upstream,
 * so it cannot distinguish 10 fps from 20 fps.
 *
 * Deliberately NOT done here: resolution scaling via `setSize` with a reduced
 * internal buffer. It is the largest single win on a fill-rate-bound scene, but
 * it changes the projection's effective aspect handling and needs its own
 * verification against the HUD's DOM overlays. Pixel ratio is the same lever
 * with none of that risk, and the shadow map is the next biggest.
 */

/**
 * The tiers, cheapest first. `pixelRatio` is a cap, not a value: the renderer
 * still respects `devicePixelRatio` when it is lower, so a 1x display is never
 * asked to draw more pixels than it has.
 */
export const TIERS = [
  { id: "high", pixelRatio: 2, shadows: true, label: "full resolution, shadows on" },
  { id: "medium", pixelRatio: 1.5, shadows: true, label: "1.5x resolution, shadows on" },
  { id: "low", pixelRatio: 1, shadows: false, label: "1x resolution, shadows off" },
];

/**
 * Where a device should start, expressed as an index into the tiers.
 *
 * Deliberately not a pass-through of the scene-quality strings: `detectQuality`
 * is a construction hint (how many rocks, how many towers, antialias or not) and
 * it answers "mobile" for a phone, which is not one of the governor's tiers.
 * Mapping it is what stops a phone starting on the high tier's 2x pixel ratio
 * and waiting two seconds to be corrected.
 *
 * `undefined` means "start at the top". An unknown string is a machine we could
 * not characterise, and that machine should be given the benefit of the doubt
 * and corrected by measurement, not by a guess.
 */
export function tierIndexFor(quality) {
  if (quality === "low") return 2;
  if (quality === "mobile") return 1;
  if (quality === "high") return 0;
  return undefined;
}

const WARMUP_MS = 3000;
const WINDOW_MS = 2000;
const BUDGET_MS = 1000 / 45;
const DOWNGRADE_FRACTION = 0.6;

export class PerfGovernor {
  /**
   * @param {object} opts
   * @param {(tier: object, index: number) => void} opts.apply  called when the
   *   tier changes, with the new tier and its index
   * @param {object[]} [opts.tiers]
   * @param {number} [opts.startIndex]  where to begin, default 0 (high)
   * @param {number} [opts.budgetMs]  frame budget, default 1000/45
   */
  constructor(opts = {}) {
    this.apply = opts.apply || (() => {});
    this.tiers = opts.tiers || TIERS;
    this.budgetMs = opts.budgetMs || BUDGET_MS;
    this.index = Math.max(0, Math.min(opts.startIndex || 0, this.tiers.length - 1));
    this.warmupMs = WARMUP_MS;
    this.windowMs = WINDOW_MS;
    this.downgradeFraction = DOWNGRADE_FRACTION;

    this.reset();
  }

  reset() {
    this.started = 0;
    this.last = 0;
    this.windowStart = 0;
    this.frames = 0;
    this.overBudget = 0;
    this.worst = 0;
    this.changes = 0;
  }

  get tier() {
    return this.tiers[this.index];
  }

  get atFloor() {
    return this.index >= this.tiers.length - 1;
  }

  /**
   * Call once per frame, after the frame has been drawn.
   * @param {number} [now]  performance.now()
   * @returns {{fraction: number, overBudget: number}|undefined} the window that
   *   just closed, for the census — undefined on every frame but the last of a
   *   window, so it doubles as the "did a window close" signal
   */
  sample(now) {
    if (typeof now !== "number") now = performance.now();

    // First call only sets the baseline. There is no interval yet, and there is
    // nothing to compare it against.
    if (!this.started) {
      this.started = now;
      this.windowStart = now;
      this.last = now;
      return;
    }

    const frameMs = now - this.last;
    this.last = now;
    const elapsed = now - this.started;

    // Warm-up: shader compilation and texture upload live here. Counting them
    // would downgrade every machine on every load.
    if (elapsed < this.warmupMs) return;

    // At the floor there is nothing left to give up, so stop counting. Leaving
    // the window running would make `report()` describe a tier that can never
    // change.
    if (this.atFloor) {
      this.frames++;
      this.overBudget += frameMs > this.budgetMs ? 1 : 0;
      if (frameMs > this.worst) this.worst = frameMs;
      return;
    }

    this.frames++;
    if (frameMs > this.budgetMs) this.overBudget++;
    if (frameMs > this.worst) this.worst = frameMs;

    const span = now - this.windowStart;
    if (span < this.windowMs) return;

    const fraction = this.overBudget / Math.max(1, this.frames);
    const window = {
      fraction: Math.round(fraction * 1000) / 1000,
      overBudget: this.overBudget,
      frames: this.frames,
      worstMs: Math.round(this.worst * 10) / 10,
    };

    this.frames = 0;
    this.overBudget = 0;
    this.worst = 0;
    this.windowStart = now;

    if (fraction >= this.downgradeFraction) {
      this.index++;
      this.changes++;
      this.apply(this.tier, this.index);
    }

    return window;
  }

  /** A plain object for the census. */
  report() {
    return {
      tier: this.tier.id,
      tierIndex: this.index,
      pixelRatio: this.tier.pixelRatio,
      shadows: this.tier.shadows,
      changes: this.changes,
      atFloor: this.atFloor,
      budgetMs: Math.round(this.budgetMs * 10) / 10,
      warmupMs: this.warmupMs,
      windowMs: this.windowMs,
    };
  }
}