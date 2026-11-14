/**
 * Git Ocean — frame budget
 *
 * There was no way to answer "is this slow?" before this module. The scene had
 * a `frame` counter and nothing else, so every performance claim was a guess,
 * and the header of OceanWorld.js described a distance-culling strategy that
 * the code never implemented. Both of those are now measured rather than
 * asserted.
 *
 * What it records, per frame:
 *   - wall time between frames, as an EMA and as a worst case
 *   - the CPU time spent in the world's own update, excluding the GPU
 *   - draw calls, triangles and programs, read from renderer.info
 *
 * LIMITATION, measured rather than assumed: under Chrome's
 * `--virtual-time-budget` (which is how every headless capture in this project
 * is taken) `performance.now()` only advances when the virtual clock does, so a
 * sub-frame CPU interval can read as exactly 0. Do not trust `updateMs` from a
 * virtual-time capture — trust the frame-interval distribution and the
 * renderer counts, which are real. Run the profiler in a real browser tab for
 * the CPU number; that is the only place the clock is honest.
 *
 * The GPU's own time cannot be read from JS, so "frame time" here is the
 * interval between requestAnimationFrame callbacks — which is exactly what the
 * user feels, and is polluted by GPU stalls only indirectly (a stalled GPU
 * makes the next callback late). That is the right thing to measure anyway: it
 * is the number that decides whether the scene is smooth.
 *
 * Everything is opt-in behind `?debug=perf` so the production path pays
 * nothing: the recorder is a no-op object until it is enabled.
 */

const NOOP = {
  enabled: false,
  begin() {},
  end() {},
  sample() {},
  report() {
    return null;
  },
};

export class FrameProfiler {
  constructor(enabled) {
    this.enabled = !!enabled;
    this.reset();
  }

  reset() {
    this.frames = 0;
    this.last = 0;
    this.started = 0;

    // Frame interval, in ms. Exponentially weighted so a single long frame
    // (a GC pause, a shader compile) does not dominate the average but also
    // does not disappear.
    this.intervalEma = 0;
    this.worstInterval = 0;

    // CPU time inside the world update, same treatment.
    this.updateEma = 0;
    this.worstUpdate = 0;

    // A histogram of frame intervals, bucketed to 4 ms, so the report can say
    // "half your frames are over 20 ms" instead of "the average is 16 ms".
    this.buckets = new Map();

    this.lastInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  }

  /** Call at the top of the frame. */
  begin() {
    if (!this.enabled) return;
    const now = performance.now();
    if (!this.started) {
      this.started = now;
      this.last = now;
      return;
    }
    const dt = now - this.last;
    this.last = now;
    this.frames++;

    // Ignore the first few frames: shader compilation and texture upload land
    // there and would otherwise set the worst case forever.
    if (this.frames > 5) {
      this.intervalEma =
        this.intervalEma === 0 ? dt : this.intervalEma * 0.9 + dt * 0.1;
      if (dt > this.worstInterval) this.worstInterval = dt;
      const bucket = Math.round(dt / 4) * 4;
      this.buckets.set(bucket, (this.buckets.get(bucket) || 0) + 1);
    }
  }

  /** Call around the world's own per-frame work. */
  end(updateMs, info) {
    if (!this.enabled) return;
    if (updateMs > 0) {
      this.updateEma =
        this.updateEma === 0 ? updateMs : this.updateEma * 0.9 + updateMs * 0.1;
      if (updateMs > this.worstUpdate) this.worstUpdate = updateMs;
    }
    if (info) this.lastInfo = info;
  }

  /**
   * A plain object a headless browser can read out of the DOM. Kept JSON-safe
   * and small on purpose: this is a measurement, not a dashboard.
   */
  report() {
    if (!this.enabled) return null;

    const fps = this.intervalEma > 0 ? 1000 / this.intervalEma : 0;
    const updateFps = this.updateEma > 0 ? 1000 / this.updateEma : 0;

    // Sort the histogram so percentiles can be read off it.
    const total = [...this.buckets.values()].reduce((a, b) => a + b, 0);
    const sorted = [...this.buckets.entries()].sort((a, b) => a[0] - b[0]);
    let acc = 0;
    let p50 = 0;
    let p95 = 0;
    for (const [ms, n] of sorted) {
      acc += n;
      if (!p50 && acc >= total * 0.5) p50 = ms;
      if (!p95 && acc >= total * 0.95) {
        p95 = ms;
        break;
      }
    }

    // How much of the frame is the world's own CPU work, versus waiting on
    // the GPU. Above ~25% the CPU update is becoming the bottleneck and the
    // per-frame loops need cutting, not the shaders.
    const cpuShare =
      this.intervalEma > 0 ? (this.updateEma / this.intervalEma) * 100 : 0;

    let verdict;
    if (fps === 0) verdict = "no samples";
    else if (fps >= 55) verdict = "smooth";
    else if (fps >= 40) verdict = "acceptable";
    else if (fps >= 25) verdict = "poor";
    else verdict = "unusable";

    return {
      frames: this.frames,
      seconds: this.started ? (performance.now() - this.started) / 1000 : 0,
      fps: Number(fps.toFixed(1)),
      frameMs: Number((this.intervalEma || 0).toFixed(2)),
      worstFrameMs: Number(this.worstInterval.toFixed(1)),
      p50Ms: p50,
      p95Ms: p95,
      updateMs: Number((this.updateEma || 0).toFixed(3)),
      worstUpdateMs: Number(this.worstUpdate.toFixed(2)),
      cpuSharePct: Number(cpuShare.toFixed(1)),
      calls: this.lastInfo.calls,
      triangles: this.lastInfo.triangles,
      points: this.lastInfo.points,
      lines: this.lastInfo.lines,
      verdict,
      budgetMs: 1000 / 60,
      overBudgetPct: Number(
        (this.intervalEma > 0
          ? Math.max(0, (1 - 1000 / 60 / this.intervalEma) * 100)
          : 0
        ).toFixed(1)
      ),
    };
  }
}

export const NOOP_PROFILER = NOOP;