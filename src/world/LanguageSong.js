/**
 * Git Ocean — the whale's song
 *
 * `LANGUAGE_SONG` in `constants.js` has carried a per-language base frequency,
 * wobble and timbre since the first design pass and nothing consumed it. This
 * file is the consumer, and it keeps the two halves separated on purpose:
 *
 *   resolveSong()  — pure. language in, a full description out.
 *   WhaleSong      — WebAudio. Speaks a resolved song, or stays silent.
 *
 * The pure half is the part that can be tested and the part that carries the
 * meaning: a whale's dialect is regional in real populations, so the mapping
 * from a repo's primary language to a pitch and a wobble *is* the claim. The
 * oscillator is only how the claim is heard.
 *
 * Nothing here starts on page load. A browser will not play audio without a
 * user gesture, and a site that tries anyway is the reason people mute tabs
 * before reading them.
 */

import { LANGUAGE_SONG, DEFAULT_SONG } from "./constants";

/**
 * Resolve a repository's song.
 *
 * `codes` is the language tally — the ranked list `countLanguages()` produces.
 * The primary language leads it, so the first entry wins; a repo with no tally
 * at all falls back to `repo.language`, then to the neutral default.
 *
 * @param {{language?: string}} repo
 * @param {{language: string, count: number}[]} [codes]
 * @returns {{base: number, wobble: number, timbre: string, language: string}}
 */
export function resolveSong(repo, codes) {
  const first = Array.isArray(codes) && codes.length ? codes[0] : null;
  const language = first?.language || repo?.language || null;

  if (!language) {
    return { ...DEFAULT_SONG, language: "unknown" };
  }

  const entry = LANGUAGE_SONG[language];
  if (!entry) {
    return { ...DEFAULT_SONG, language };
  }

  return { ...entry, language };
}

/**
 * How far a pitch bends when the whale calls across a distance.
 *
 * A real whale song carries further than it can be heard clearly, so a distant
 * animal is lower and rougher than a near one. Squared so the change is gentle
 * across most of the range and only obvious at the two ends.
 *
 * @param {number} closeness 1 = right beside it, 0 = across the basin
 */
export function driftFor(closeness) {
  const k = Math.min(1, Math.max(0, closeness));
  const far = (1 - k) ** 2;
  return { pitch: 1 - far * 0.42, wobble: 1 + far * 1.6 };
}

const TIMBRE_SHAPE = {
  bright: { type: "triangle", harmonics: 3 },
  structured: { type: "sine", harmonics: 2 },
  warm: { type: "sine", harmonics: 3 },
  metallic: { type: "sawtooth", harmonics: 1 },
  clean: { type: "sine", harmonics: 1 },
  deep: { type: "sine", harmonics: 2 },
  ancient: { type: "triangle", harmonics: 2 },
  neutral: { type: "sine", harmonics: 1 },
};

/**
 * A single voice that can speak one song at a time.
 *
 * Deliberately not a mixer: one selected animal is a call, not a soundscape, and
 * a page that plays nine whales at once is noise.
 */
export class WhaleSong {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.timer = null;
    this.current = null;
  }

  /** True once a context exists and the tab is allowed to make sound. */
  get active() {
    return !!this.ctx && this.ctx.state === "running";
  }

  /**
   * Speak `song` for `seconds`, replacing whatever was playing.
   *
   * Resolves false rather than throwing when the platform has no WebAudio or
   * refuses the context; a missing song must never be a broken page.
   */
  play(song, { seconds = 4, closeness = 1, volume = 0.05 } = {}) {
    const Ctx = typeof window !== "undefined" &&
      (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return false;

    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
      } catch {
        return false;
      }
    }

    // A context created outside a gesture starts "suspended" and resume() on a
    // real gesture is what actually lets it make sound.
    if (this.ctx.state === "suspended") this.ctx.resume();

    this.stop();

    const shape = TIMBRE_SHAPE[song.timbre] || TIMBRE_SHAPE.neutral;
    const drift = driftFor(closeness);
    const base = song.base * drift.pitch;
    const wobble = song.wobble * drift.wobble;
    const now = this.ctx.currentTime;

    // Two partials a fifth apart: a lone sine reads as a test tone, and the
    // interval is what makes it sound like a call.
    const partials = [
      { ratio: 1, gain: 1 },
      { ratio: 1.5, gain: 0.35 },
      { ratio: 2, gain: 0.18 },
    ].slice(0, Math.max(2, shape.harmonics));

    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + 0.35);
    master.gain.setValueAtTime(volume, now + seconds * 0.6);
    master.gain.linearRampToValueAtTime(0, now + seconds);
    master.connect(this.ctx.destination);

    // A slow vibrato, scaled by the song's own wobble, is the whale's glide.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.35 + wobble * 0.5;
    lfoGain.gain.value = base * 0.03 * wobble;
    lfo.connect(lfoGain);
    lfo.start(now);
    lfo.stop(now + seconds);

    for (const p of partials) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = shape.type;
      osc.frequency.setValueAtTime(base * p.ratio, now);
      // A downward glide over the call, which is the shape a humpback's phrase
      // actually takes — rising first, then falling away.
      osc.frequency.linearRampToValueAtTime(base * p.ratio * 1.06, now + seconds * 0.3);
      osc.frequency.linearRampToValueAtTime(base * p.ratio * 0.88, now + seconds);
      lfoGain.connect(osc.frequency);
      gain.gain.value = p.gain;
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + seconds);
      this.voices.push(osc);
    }
    this.voices.push(lfo);

    this.timer = setTimeout(() => this.stop(), seconds * 1000 + 80);
    this.current = song;
    return true;
  }

  /** Release every node. Safe to call when nothing is playing. */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const node of this.voices) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // A node that already ended throws on a second stop, and that is the
        // normal case here — the sounds are short and the timer usually wins.
      }
    }
    this.voices = [];
    this.current = null;
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // Closing an already-closed context is not an error worth reporting.
      }
      this.ctx = null;
    }
  }
}
