/**
 * Git Ocean — selection and hover markers
 *
 * Before this existed, `OceanWorld.selectedId` was written and never read: the
 * scene had no way to say "this is the one". Clicking a tower moved the camera
 * and filled the HUD card, but if two towers stood close together there was
 * nothing on screen that told you which one you had picked — and nothing at all
 * under the pointer, so there was no hint that a tower was interactive before
 * you clicked it.
 *
 * Two marks, both cheap and both driven by data already on the tower:
 *
 *   hover  — a thin ring at the holdfast, in the tower's own language colour.
 *            Appears under the pointer, so the world says "clickable" before
 *            the click. Deliberately faint: it must not compete with selection.
 *
 *   select — a brighter ring plus a slow vertical pulse that climbs the stipe.
 *            The climb is the part that reads at a glance: a static ring can be
 *            mistaken for part of the scene, a moving one cannot.
 *
 * Both are one InstancedMesh each — or rather, one Mesh each — so adding them
 * costs 2 draw calls and nothing per-frame beyond a transform write.
 *
 * Design law: nothing here is decorative. A ring on the sediment around a kelp
 * holdfast is what a diver's marker light actually looks like, and the climbing
 * pulse is the same "activity rising through the stipe" read that the canopy
 * polyps already use for contributor count. Both follow the project rule that
 * every element must be explainable by ocean or engineering.
 */

import * as THREE from "three";

const RING_SEGMENTS = 64;

export class SelectionMarker {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    this.group = new THREE.Group();
    this.group.name = "selection-marker";
    // Above the sediment and the tower's holdfast, below the blades, so it
    // never z-fights with either.
    this.group.renderOrder = 5;
    this.scene.add(this.group);

    this.hoverRing = this._makeRing(0.55, 0.55);
    this.hoverRing.name = "marker:hover";
    this.hoverRing.visible = false;
    this.group.add(this.hoverRing);

    this.selectRing = this._makeRing(1.0, 0.9);
    this.selectRing.name = "marker:select";
    this.selectRing.visible = false;
    this.group.add(this.selectRing);

    // The climbing pulse. A torus, not a full column: a column would hide the
    // tower it is pointing at, and the point of the mark is to point at it.
    this.pulse = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 6, RING_SEGMENTS),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.pulse.rotation.x = Math.PI / 2;
    this.pulse.name = "marker:pulse";
    this.pulse.visible = false;
    this.group.add(this.pulse);

    this.target = null; // tower being marked
    this.hoverTarget = null;
    this.t = 0;
  }

  _makeRing(opacity, thicknessScale) {
    // A flat annulus on the sediment: an inner and outer edge, no fill, so it
    // reads as a drawn line rather than a disc of light.
    const geo = new THREE.RingGeometry(0.94, 1.0, RING_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(thicknessScale);
    return m;
  }

  /**
   * Point the hover ring at a tower, or clear it.
   * @param {object|null} tower KelpTower instance
   */
  setHover(tower) {
    if (this.hoverTarget === tower) return;
    this.hoverTarget = tower;
    this.hoverRing.visible = !!tower;
    if (tower) {
      this._place(this.hoverRing, tower);
      this.hoverRing.material.color.setHex(tower.languageColor);
    }
  }

  /**
   * Mark a tower as selected, or clear the mark entirely.
   * @param {object|null} tower
   */
  setSelected(tower) {
    this.target = tower;
    const on = !!tower;
    this.selectRing.visible = on;
    this.pulse.visible = on;
    if (on) {
      this._place(this.selectRing, tower);
      this.selectRing.material.color.setHex(tower.languageColor);
      this.pulse.material.color.setHex(tower.languageColor);
      this._pulseBase = tower.height;
      this._pulseGirth = tower.girth;
    }
  }

  /**
   * Both rings sit on the sediment at the tower's foot, scaled to the holdfast
   * so a wide tower gets a wide mark. The tower's own group carries the y, so
   * the marker only needs x and z.
   */
  _place(ring, tower) {
    const p = tower.group.position;
    // `tower.group` may be scaled (ambient towers are), so read the world scale
    // for the radius rather than assuming 1.
    const s = tower.group.scale.x || 1;
    const r = Math.max(tower.girth * 1.9 * s, 3.2);
    ring.position.set(p.x, p.y + 0.35 * s, p.z);
    ring.scale.setScalar(r);
  }

  /** Advance the marks. Call once per frame with the scene's elapsed time. */
  update(delta, elapsed) {
    this.t = elapsed;

    if (this.hoverRing.visible) {
      // A slow breath, not a blink: the ring should be noticeable without
      // flickering. 0.34-0.5 keeps it clearly present but never loud.
      this.hoverRing.material.opacity = 0.34 + Math.sin(elapsed * 2.2) * 0.12;
    }

    if (!this.target) return;

    // The select ring is steady at a higher opacity than hover, so the two
    // states are distinguishable by brightness alone even for someone who
    // cannot see the colour difference.
    this.selectRing.material.opacity = 0.78 + Math.sin(elapsed * 1.6) * 0.14;

    // Climbing pulse: rises from the holdfast to the canopy, then restarts.
    // `height` is the tower's real height, so a tall repo takes longer to
    // climb, which is the point — the mark is scaled by the thing it marks.
    const h = this._pulseBase || 20;
    const speed = 0.34; // fraction of the tower per second
    const f = (elapsed * speed) % 1;
    const p = this.target.group.position;
    const s = this.target.group.scale.x || 1;
    this.pulse.position.set(p.x, p.y + f * h * s, p.z);
    // Fade out as it nears the canopy so it does not pop out of existence.
    this.pulse.material.opacity = 0.5 * Math.sin(f * Math.PI);
    // The tower tapers, so the ring must shrink as it climbs or it floats
    // away from the stipe.
    const taper = 1 - f * 0.66;
    this.pulse.scale.setScalar(Math.max(this._pulseGirth * 1.5 * s * taper, 0.4));
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (this.group.parent) this.group.parent.removeChild(this.group);
  }
}