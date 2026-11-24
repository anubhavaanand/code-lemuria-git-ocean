import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { OceanWorld } from "../src/world/OceanWorld";

/**
 * The whale level must frame the whole orbit, not only the animal.
 *
 * The whale circles its tower at `focusRadius`, so at the far phase of the
 * orbit its nose reaches `focusRadius + length/2` from the aim point. The
 * distance used to be solved from the body alone, which is correct only while
 * the orbit is narrower than the animal. Measured on the live scene at vue —
 * orbit 62, body 48.78 — the body-only distance left a half-frame of 76 units
 * against a nose at 86.4, and the head was cut off at the left edge.
 *
 * These tests call `_follow()` directly on a bare object rather than building a
 * world: the framing is arithmetic over five fields, and a WebGL context is not
 * what makes it right or wrong.
 */
const tx = Math.tan((42 * Math.PI) / 360) * (1440 / 900);

function followFor({ orbitR, length }) {
  const fake = {
    focusPoint: { x: 0, y: 40, z: 0 },
    focusRadius: orbitR,
    focusOrbitY: 40,
    focusLength: length,
    _tmpVec: new THREE.Vector3(),
  };
  return OceanWorld.prototype._follow.call(fake);
}

describe("whale-level framing", () => {
  it("backs off far enough that the orbit plus the animal fits the width", () => {
    const f = followFor({ orbitR: 62, length: 48.78 });
    const halfFrame = f.distance * tx;
    // The nose reaches the orbit plus half the body from the aim point.
    expect(halfFrame).toBeGreaterThan(62 + 48.78 * 0.5);
    // With a margin, so a nose exactly on the edge is not the pass condition.
    expect(halfFrame).toBeGreaterThan((62 + 48.78 * 0.5) * 1.05);
  });

  it("still fits a small repo's orbit", () => {
    const f = followFor({ orbitR: 32, length: 18 });
    expect(f.distance * tx).toBeGreaterThan(32 + 18 * 0.5);
  });

  it("never comes closer than the body alone would need", () => {
    // A tiny orbit with a big animal: the body term must win.
    const f = followFor({ orbitR: 20, length: 60 });
    const bodyOnly = (60 * 0.5) / (tx * 0.42) + 60 * 0.6;
    expect(f.distance).toBeGreaterThanOrEqual(bodyOnly - 1e-6);
  });

  it("scales with the orbit, not with a constant", () => {
    const small = followFor({ orbitR: 30, length: 48.78 });
    const large = followFor({ orbitR: 62, length: 48.78 });
    expect(large.distance).toBeGreaterThan(small.distance);
  });
});