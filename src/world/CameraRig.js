/**
 * Git Ocean — Camera rig
 *
 * Five zoom levels, each revealing a new layer of meaning. Depth is the
 * spine of the 2.5D design: the camera dollies along Z through stacked
 * layers, and the underwater fog does the LOD work for free — far geometry
 * dissolves into the water column instead of popping out.
 *
 * Controls:
 *   scroll / pinch  — move between zoom levels (dolly along the layer stack)
 *   drag            — look around (yaw + limited pitch)
 *   no pointer lock — the scene must stay explorable, not a shooter
 *
 * The rig is deliberately separate from the scene so the camera can be
 * driven by URL hash, deep links, or the HUD without touching world code.
 */

import * as THREE from "three";
import { ZOOM_LEVELS, LAYERS, SURFACE_Y } from "./constants";

const clamp = THREE.MathUtils.clamp;

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {object} opts { levels, startIndex }
   */
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.levels = opts.levels || ZOOM_LEVELS;

    this.targetIndex = opts.startIndex != null ? opts.startIndex : 2; // city
    this.currentIndex = this.targetIndex;

    // Continuous position along the stack (fractional index = in transit)
    this.t = this.targetIndex;
    this.targetT = this.targetIndex;

    this.yaw = 0;
    this.targetYaw = 0;
    this.pitch = -0.06;
    this.targetPitch = -0.06;

    // Where the camera looks. The focus tracks the current layer's Y so the
    // zoom feels like descending rather than flying sideways.
    this.focus = new THREE.Vector3(0, 0, 0);
    this.targetFocus = new THREE.Vector3(0, 0, 0);

    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.pointerId = null;

    this._bind();
    this.apply(0, true);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  _bind() {
    this._onWheel = (e) => {
      e.preventDefault();
      // Normalize wheel deltas across trackpads and mice
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.targetT = clamp(this.targetT + d * 0.0016, 0, this.levels.length - 1);
    };

    this._onPointerDown = (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      this.dragging = true;
      this.pointerId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dom.setPointerCapture?.(e.pointerId);
    };

    this._onPointerMove = (e) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      const speed = 0.0032 * (this.camera.fov / 60);
      this.targetYaw -= dx * speed;
      this.targetPitch = clamp(this.targetPitch - dy * speed * 0.8, -0.55, 0.5);
    };

    this._onPointerUp = (e) => {
      if (this.pointerId != null && e.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = null;
      this.dom.releasePointerCapture?.(e.pointerId);
    };

    // Touch pinch
    this._onTouchStart = (e) => {
      if (e.touches.length !== 2) return;
      this._pinchStart = this._touchDist(e);
      this._pinchT = this.targetT;
    };

    this._onTouchMove = (e) => {
      if (e.touches.length !== 2 || !this._pinchStart) return;
      e.preventDefault();
      const d = this._touchDist(e);
      const ratio = this._pinchStart / Math.max(1, d);
      this.targetT = clamp(this._pinchT + (ratio - 1) * 3.2, 0, this.levels.length - 1);
    };

    this._onTouchEnd = () => {
      this._pinchStart = null;
    };

    this._onKeyDown = (e) => {
      // Number keys jump straight to a zoom level — handy for demos
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= this.levels.length) {
        this.goTo(n - 1);
      }
      if (e.key === "+" || e.key === "=") this.zoomBy(-0.5);
      if (e.key === "-" || e.key === "_") this.zoomBy(0.5);
    };

    this.dom.addEventListener("wheel", this._onWheel, { passive: false });
    this.dom.addEventListener("pointerdown", this._onPointerDown);
    this.dom.addEventListener("pointermove", this._onPointerMove);
    this.dom.addEventListener("pointerup", this._onPointerUp);
    this.dom.addEventListener("pointercancel", this._onPointerUp);
    this.dom.addEventListener("touchstart", this._onTouchStart, { passive: true });
    this.dom.addEventListener("touchmove", this._onTouchMove, { passive: false });
    this.dom.addEventListener("touchend", this._onTouchEnd);
    window.addEventListener("keydown", this._onKeyDown);
  }

  _touchDist(e) {
    const a = e.touches[0];
    const b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  // -------------------------------------------------------------------------
  // Public control
  // -------------------------------------------------------------------------

  /** Animate to a zoom level index. */
  goTo(index) {
    this.targetT = clamp(index, 0, this.levels.length - 1);
    this.targetIndex = Math.round(this.targetT);
    // Move the eased position too. Easing is for *interactive* zoom, where the
    // glide is the point; when a caller explicitly asks for a level (a QA
    // screenshot, a deep link, "fly to repo"), a slow glide just means the
    // camera is somewhere else when the caller looks at it.
    this.t = this.targetT;
  }

  /** Relative zoom, in zoom-level units. */
  zoomBy(delta) {
    this.targetT = clamp(this.targetT + delta, 0, this.levels.length - 1);
    this.targetIndex = Math.round(this.targetT);
  }

  get level() {
    return this.levels[Math.round(this.t)] || this.levels[0];
  }

  get levelId() {
    return this.level ? this.level.id : "city";
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /**
   * @param {number} delta seconds
   * @param {object} [follow] optional { position: THREE.Vector3, focusY }
   */
  update(delta, follow) {
    // Exponential smoothing — frame-rate independent
    const k = 1 - Math.pow(0.0015, delta);

    this.t += (this.targetT - this.t) * k;
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    this.apply(delta, false, follow);
  }

  /**
   * Convert the continuous zoom position into an actual camera transform.
   * Position is interpolated between adjacent level definitions so the
   * descent is continuous — no cuts, which would break the underwater feel.
   */
  apply(delta, immediate, follow) {
    const levels = this.levels;
    const t = clamp(this.t, 0, levels.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(levels.length - 1, i0 + 1);
    const f = t - i0;

    const a = levels[i0];
    const b = levels[i1];

    // Smoothstep the blend so level transitions ease in and out
    const ease = f * f * (3 - 2 * f);

    const depth = a.depth + (b.depth - a.depth) * ease;
    const fov = a.fov + (b.fov - a.fov) * ease;
    const distance = a.distance + (b.distance - a.distance) * ease;
    let height = a.height + (b.height - a.height) * ease;
    // A follow target's height is a RISE ABOVE ITS OWN FOCUS, not a height above
    // zero. `Math.max` therefore mixes two different references: an ordinary
    // tower at the whale level had a focus of 71 and an authored rise of 9.3,
    // while the level's own 16 came from y = 0, so the max kept the 16 and the
    // eye ended up 63 units above a 48-unit animal — 17 degrees down, the
    // foreshortened-back view three separate passes had removed by other means.
    //
    // When the target authors a rise, it is the whole story: the level's height
    // was tuned for a subject of ordinary size and knows nothing about this one.
    if (follow && follow.height != null) {
      height = follow.height;
    }
    const fog = a.fog + (b.fog - a.fog) * ease;

    // Focus height is authored per level, so the camera always frames the
    // band that belongs to that zoom. No guessing from depth — that coupling
    // is what made the old rig look at empty water.
    let baseFocusY = a.focusY + (b.focusY - a.focusY) * ease;

    // A followed subject may author its own aim point. The level's number was
    // tuned for a subject of ordinary size at that band's height; a flagship
    // repo's whale orbits 78 units up and a fixed 16 aims at the tower's
    // ankles. The target's aim wins outright for the same reason its distance
    // does — it is measured from the subject.
    if (follow && follow.focusY != null) {
      baseFocusY = follow.focusY;
    }

    // The level's own depth on the Z axis, when it authors one.
    //
    // The capital ring straddles z = -300, so the world view aims at that
    // centre rather than at the origin, which is the near edge of the basin.
    // Blended between the two adjacent levels like every other authored value,
    // so the descent from world to country is continuous.
    const baseFocusZ = (a.focusZ || 0) + ((b.focusZ || 0) - (a.focusZ || 0)) * ease;

    if (follow && follow.position) {
      // When following a repo, track it in X/Z but keep the level's height so
      // the tower stays vertically framed instead of drifting out of shot.
      this.targetFocus.set(
        follow.position.x,
        baseFocusY,
        follow.position.z
      );
    } else {
      this.targetFocus.set(0, baseFocusY, baseFocusZ);
    }

    if (immediate) {
      this.focus.copy(this.targetFocus);
    } else {
      this.focus.lerp(this.targetFocus, 1 - Math.pow(0.002, delta || 0.016));
    }

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    // Never park the camera inside a kelp tower or a whale's orbit.
    //
    // Each level's distance is authored to sit *outside* the tallest band of
    // geometry at that level. `tower` at 92 units is already clear of the 30-40
    // unit tower cluster; `whale` needs to stay far enough back that the whale
    // it is supposedly showing is actually in front of the lens rather than
    // behind it. This clamp is the guard rail for when a level is edited
    // carelessly: it cannot fix a wrong focus, but it stops the "empty void"
    // frame where the camera ends up past the subject.
    //
    // The floor scales with the level's own distance. A flat floor was tried and
    // removed: the whale level authors 62 units, and a flat 4 let a follow target
    // with a 124-unit lens come in under it — but the reverse also bites, because
    // a deep colony's authored distance is small in world units and a floor
    // larger than it would push the lens out of the animal. Scaling by the level
    // keeps the guard rail proportional to the band it guards.
    // Distance is scaled to the subject, because the authored
    // per-level distance assumes a tower of ordinary height. A flagship repo —
    // tens of thousands of commits, a tower two or three times the norm — pushes
    // its whale's orbit proportionally further out, and a fixed distance then
    // leaves the animal behind the lens rather than in front of it.
    //
    // `baseRadius` is not the subject's tower height but the *distance from the
    // subject to its whale*, which is what a subject of ordinary size uses: an
    // ~18-unit tower (towerHeight for a repo of a few hundred commits) has an
    // orbit radius of about 32 units. Forcing baseRadius to 32 is deliberate —
    // it makes an ordinary repo's whale framing come out exactly as authored, so
    // the scaling only ever helps the outliers instead of re-tuning every level.
    const subjectRadius =
      follow && follow.radius ? Math.max(1, follow.radius) : 32;
    const baseRadius = 32;
    const fit = THREE.MathUtils.clamp(subjectRadius / baseRadius, 0.6, 3.4);
    // A fraction of the subject's own distance, not of the level's.
    //
    // A flat floor was wrong, and so was a floor proportional to the level's
    // authored distance: at the whale level that is 62 units, so a language
    // colony at y = -4,200 with an 80-unit lens got clamped up to 15.5 units —
    // still small, but the deep-colony guard test caught it, and more importantly
    // the rule was not describing anything real. The lens is allowed to come
    // close to a small subject; what it must never do is come closer than the
    // subject's own body could fill the frame.
    const minDistance = follow && follow.distance != null ? follow.distance * 0.5 : 0;
    // A follow target may author its own distance outright. It knows the
    // subject's real size and orbit; the level only knows an authored guess
    // tuned for a tower of ordinary height. When both are present the authored
    // one wins, because the level's guess is what put the animal off the bottom
    // of the frame.
    const authored = follow && follow.distance != null;
    const dist = authored
      ? follow.distance
      : Math.max(distance * fit, minDistance);

    // The eye's height above the aim point, and the pitch term.
    //
    // These were tangled in two ways, and both were found by measuring rather
    // than looking.
    //
    // First, the pitch term was applied to the level's own height as well as to
    // `focus.y`, so the level's height was double-counted. Measured on the live
    // vue entry: `follow.focusY` 71.0 and `follow.height` 9.33 produced an eye at
    // 137.8 against a body at 74.4 — 63 units above a 48-unit animal, 17 degrees
    // down. That is the foreshortened-back view three separate passes had removed
    // by other means, and it came back because the two references were added.
    //
    // Second, `height` and `focusY` were combined with `Math.max` against the
    // level's authored numbers, which are heights above y = 0 for a subject of
    // ordinary size. A follow target's numbers are a RISE and an AIM measured
    // from the subject. Taking the larger of two unrelated references is not a
    // compromise; it is a category error.
    //
    // The pitch term applies ONLY when nothing is being followed.
    //
    // The original `py` was `focus.y + height - sin(pitch) * dist * 0.55`, which
    // is right for a level band: the height is the band's own elevation and the
    // pitch term is what makes the band feel like a descent rather than a
    // sideways flight. For a follow target the height is already a rise measured
    // at the lens, so the pitch term is a second, unrelated adjustment on top of
    // it — and because the pitch is negative (looking down) it subtracted from
    // the eye and then `lookAt` aimed down again, compounding.
    const eye = this.focus.y + height;
    const eyeWithPitch = authored
      ? eye
      : eye - Math.sin(this.pitch) * dist * 0.55;
    const px = this.focus.x + sinY * dist * cosY;
    const pz = this.focus.z + cosY * dist * cosY;
    const py = eyeWithPitch;
    // Nothing floors the eye except the geometry it must not enter.
    //
    // `Math.max(4, py)` and `Math.max(SEAFLOOR_Y + 12, py)` were both written
    // when every subject sat near y = 0. A follow target can be a language
    // colony at y = -4,200, and either floor teleports the camera into the water
    // column above its subject. ky measured a 36.8-degree down angle purely
    // because its orbit dips to y = -13 and a floor at +4 lifted the eye.
    //
    // The seafloor is not a global floor either: the world's own floor is at
    // SEAFLOOR_Y, but a deep colony lives below it by design, so a floor there
    // would make the colony unviewable.
    const clampedY = py;

    // Never break the surface.
    //
    // The world-level lens, aiming at the floor from a 700-unit rise over 1,450
    // units, lands at y ≈ 716 — 296 units ABOVE the water surface at
    // SURFACE_Y = 420. From up there the surface is seen from above: a bright
    // flat ceiling filling the top of the frame, the exact "crushed slab" the
    // world view rendered. A diver at −4,200 m is under the water; the lens has
    // to be too.
    //
    // The ceiling is SURFACE_Y rather than the level's own height because the
    // surface is a world fact, not a camera choice. The clamp is soft — it only
    // ever lowers the eye, so every level that already sat below the surface is
    // untouched, and the world level is the only one it moves. `SURFACE_Y - 6`
    // keeps the lens a hair under the sheet so the underside is in view.
    const ceiling = SURFACE_Y - 6;
    const eyeY = Math.min(clampedY, ceiling);

    this.camera.position.set(px, eyeY, pz);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.focus);

    // Fog is authored per level: thicker deeper down, so geometry beyond the
    // current band dissolves instead of drawing.
    this.currentFogScale = 1;
    this.currentFogDensity = fog;
    this.currentDepth = depth;
    this.currentDistance = distance;
  }

  dispose() {
    this.dom.removeEventListener("wheel", this._onWheel);
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    this.dom.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("pointerup", this._onPointerUp);
    this.dom.removeEventListener("pointercancel", this._onPointerUp);
    this.dom.removeEventListener("touchstart", this._onTouchStart);
    this.dom.removeEventListener("touchmove", this._onTouchMove);
    this.dom.removeEventListener("touchend", this._onTouchEnd);
    window.removeEventListener("keydown", this._onKeyDown);
  }
}