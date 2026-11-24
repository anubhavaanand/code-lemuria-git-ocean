import { describe, it, expect } from "vitest";
import { resolveSong, driftFor } from "../src/world/LanguageSong";
import { LANGUAGE_SONG, DEFAULT_SONG } from "../src/world/constants";

/**
 * A whale sings in its language's dialect.
 *
 * `LANGUAGE_SONG` was designed on day one and consumed by nothing, which meant
 * a claim the project makes — real whale populations have regional dialects,
 * so a repo's primary language is its song — existed only as a comment. These
 * tests pin the resolution half of the feature; the oscillator is not testable
 * in Node and is not where the claim lives.
 */
describe("language song", () => {
  it("gives each language its own dialect, not one shared tone", () => {
    const js = resolveSong({ language: "JavaScript" });
    const rust = resolveSong({ language: "Rust" });
    expect(js.base).toBe(LANGUAGE_SONG.JavaScript.base);
    expect(rust.base).toBe(LANGUAGE_SONG.Rust.base);
    // Rust's 110 Hz against JavaScript's 196 Hz is the point: they differ.
    expect(js.base).toBeGreaterThan(rust.base);
    expect(js.timbre).not.toBe(rust.timbre);
  });

  it("takes the primary language from the tally, not the repo field", () => {
    // A polyglot repo whose tally leads with something other than `language`.
    const song = resolveSong({ language: "JavaScript" }, [
      { language: "Rust", count: 40 },
      { language: "JavaScript", count: 10 },
    ]);
    expect(song.language).toBe("Rust");
    expect(song.base).toBe(LANGUAGE_SONG.Rust.base);
  });

  it("falls back to the neutral dialect rather than inventing a pitch", () => {
    const unknown = resolveSong({ language: "COBOL" });
    expect(unknown.base).toBe(DEFAULT_SONG.base);
    expect(unknown.timbre).toBe(DEFAULT_SONG.timbre);
    // The language is still reported, so the UI can say which one it is.
    expect(unknown.language).toBe("COBOL");

    const missing = resolveSong({});
    expect(missing.base).toBe(DEFAULT_SONG.base);
    expect(missing.language).toBe("unknown");
  });

  it("drops pitch and roughens the call as the animal gets further away", () => {
    expect(driftFor(1).pitch).toBeCloseTo(1, 6);
    expect(driftFor(0).pitch).toBeCloseTo(0.58, 6);
    const near = driftFor(0.9);
    const far = driftFor(0.1);
    expect(far.pitch).toBeLessThan(near.pitch);
    expect(far.wobble).toBeGreaterThan(near.wobble);
  });

  it("clamps closeness so a bad number cannot invert the song", () => {
    expect(driftFor(-5).pitch).toBeCloseTo(driftFor(0).pitch, 6);
    expect(driftFor(9).pitch).toBeCloseTo(driftFor(1).pitch, 6);
  });
});
