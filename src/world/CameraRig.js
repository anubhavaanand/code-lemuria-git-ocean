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
import { ZOOM_LEVELS, LAYERS } from "./constants";

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
    const height = a.height + (b.height - a.height) * ease;
    const fog = a.fog + (b.fog - a.fog) * ease;

    // Focus height is authored per level, so the camera always frames the
    // band that belongs to that zoom. No guessing from depth — that coupling
    // is what made the old rig look at empty water.
    const baseFocusY = a.focusY + (b.focusY - a.focusY) * ease;

    if (follow && follow.position) {
      // When following a repo, track it in X/Z but keep the level's height so
      // the tower stays vertically framed instead of drifting out of shot.
      this.targetFocus.set(
        follow.position.x,
        baseFocusY,
        follow.position.z
      );
    } else {
      this.targetFocus.set(0, baseFocusY, 0);
    }

    if (immediate) {
      this.focus.copy(this.targetFocus);
    } else {
      this.focus.lerp(this.targetFocus, 1 - Math.pow(0.002, delta || 0.016));
    }

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    // Orbit around the focus: yaw sweeps the camera on a circle, pitch lifts
    // and lowers it. Clamped so you can never end up under the sediment.
    const px = this.focus.x + sinY * distance * cosY;
    const pz = this.focus.z + cosY * distance * cosY;
    const py = this.focus.y + height - Math.sin(this.pitch) * distance * 0.55;
    const clampedY = Math.max(4, py);

    this.camera.position.set(px, clampedY, pz);
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