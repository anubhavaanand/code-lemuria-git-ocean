/**
 * Git Ocean — whale body resolution
 *
 * Gives every repository a whale with the correct meaning, and lets an imported
 * sculpt supply the silhouette where one exists and is licensed.
 *
 * Why this is a subclass and not a wrapper
 * ---------------------------------------
 * RepoWhale owns the whole swim cycle: beat frequency from commit frequency,
 * body oscillation, fluke beat, flipper scull, remora orbit, spout pulse. It
 * also owns every part that carries a repository's data — flipper span from open
 * PRs, fluke span from forks, barnacle count from open issues, remora count from
 * watchers, pleat count from closed issues.
 *
 * Re-implementing all of that in a wrapper would duplicate the most important
 * file in the project. So instead: keep RepoWhale's constructor and update()
 * exactly as they are, build its procedural body, then *drop that body mesh* and
 * parent the imported sculpt in its place. The swim cycle, the parts and the
 * data mapping are untouched; only the silhouette changes.
 *
 * The rule for who gets a sculpt is strict: only the species that was actually
 * modelled. A humpback sculpt cannot stand in for a blue whale — that would put
 * a smaller animal in the wrong body, which is the "unexplainable" failure the
 * constitution forbids. Every other species keeps the lathe, and a failed fetch
 * silently keeps it too.
 */

import * as THREE from "three";
import { RepoWhale } from "./RepoWhale";
import { WHALE_ASSETS, loadWhaleAsset, normalizeWhale } from "./WhaleAssets";
import { whaleSkinVertex, whaleSkinFragment } from "./shaders";

export class WhaleWithSculpt extends RepoWhale {
  constructor(repo, opts = {}) {
    super(repo, opts);
    this.sculptKind = "procedural";
    this.sculptCredit = null;
    this.sculpt = null;
  }

  /** True when this repository's species has an imported body available. */
  static hasSculpt(repo) {
    const id = repo.whaleSpecies && repo.whaleSpecies.id;
    return !!WHALE_ASSETS[id];
  }

  /**
   * Build the imported body and swap it in. Resolves true on success.
   *
   * Called immediately after construction by the factory; kept separate so the
   * constructor stays synchronous and a failed load leaves a fully working
   * procedural whale rather than a half-built one.
   */
  async adoptSculpt() {
    const asset = WHALE_ASSETS[this.repo.whaleSpecies && this.repo.whaleSpecies.id];
    if (!asset) return false;

    const gltf = await loadWhaleAsset(this.repo.whaleSpecies.id);
    if (!gltf) return false;

    try {
      const { wrapper: sculpt, size: measured } = normalizeWhale(
        gltf.scene,
        this.length
      );

      const skin = new THREE.ShaderMaterial({
        uniforms: this.skinUniforms,
        vertexShader: whaleSkinVertex,
        fragmentShader: whaleSkinFragment,
      });
      // Counter-shading is written against the *world* normal, so the shader
      // still works after the model's own yaw is baked into the wrapper.

      sculpt.traverse((o) => {
        if (!o.isMesh) return;
        o.material = skin;
        o.frustumCulled = true;
        // The sculpt is authored at its own scale; normalizing already set the
        // wrapper's scale, so nothing to fix here beyond casting shadows off.
        o.castShadow = false;
        o.receiveShadow = false;
      });

      // Drop the procedural body (mesh + its additive belly highlight), keep
      // every appendage and its material. The lathe geometry is the only thing
      // being replaced, so disposing it here is safe and necessary.
      if (this.body) {
        this.group.remove(this.body);
        this.body.geometry.dispose();
      }
      if (this.belly) {
        this.group.remove(this.belly);
        this.belly.geometry.dispose();
        this.belly.material.dispose();
        this.belly = null;
      }

      this.sculpt = sculpt;
      this.bodyMesh = sculpt;
      this.sculptSkin = skin;
      this.sculptKind = "imported";
      this.sculptCredit = asset.credit;
      this.group.add(sculpt);

      // Measured, not boxed — see measuredExtent() in WhaleAssets for why a
      // skinned mesh's bounding box reports its bind pose.
      // The sculpt is modelled at a different height-to-length ratio than the
      // lathe (measured 0.72 vs the lathe's ~0.38), so uniform scaling to
      // `length` would leave a body far too deep. Scale Y down to the lathe's
      // proportion: the animal then reads at the right size, and girth still
      // comes from contributors the way it always did.
      //
      // Note this sets the scale on the WRAPPER, and the normalization scale
      // lives on its child, so the two multiply: the child carries k and the
      // wrapper carries ky. Applying the correction to the child instead would
      // overwrite k and shrink the animal back to its native 4.6 units — which
      // is exactly what happened once, and is invisible in any single scale
      // reading because each node's own numbers look plausible.
      const wantY = this.length * 0.38;
      if (measured.y > 0.0001) {
        const ky = wantY / measured.y;
        sculpt.scale.y *= ky;
        measured.y = wantY;
      }

      this.sculptSize = measured;

      // Flipper blades were sized from the lathe's girth; a sculpt has a
      // different one, so the blades are rebuilt to match the animal they are
      // now hanging on. The *mapping* (open PRs → span) is unchanged.
      this.rescaleAppendages();

      return true;
    } catch (err) {
      console.warn("[git-ocean] whale sculpt failed, keeping procedural body", err);
      return false;
    }
  }

  /**
   * Skin radius at body fraction t.
   *
   * For a sculpt this is the measured half-girth at that fraction, so remoras
   * sit on the skin. The lathe version is a sine; a real humpback swells at the
   * shoulders and is nearly cylindrical through the middle, so the profile is
   * sampled from the bounding box and eased rather than assumed.
   */
  surfaceRadius(t) {
    if (!this.sculptSize) return super.surfaceRadius(t);
    const k = THREE.MathUtils.clamp(t, 0, 1);
    const s = this.sculptSize;
    // Half-girth, then taper toward the peduncle the way the sculpt does.
    const shoulder = Math.min(1, k / 0.24) ** 0.5;
    const taper = k < 0.55 ? 1 : 1 - ((k - 0.55) / 0.45) ** 1.5 * 0.82;
    return s.y * 0.5 * shoulder * taper;
  }

  /** Nose position in local space, for the blowhole and spout. */
  surfaceAtDorsal(t) {
    const r = this.surfaceRadius(t);
    const s = this.sculptSize;
    return new THREE.Vector3(-s.x * 0.5 + t * s.x, r, 0);
  }

  update(delta, elapsed) {
    // RepoWhale.update writes group.position.y for the swim cycle and drives
    // every appendage; the sculpt is a child of group, so it rides along.
    super.update(delta, elapsed);
    if (this.sculptSkin) {
      this.sculptSkin.uniforms.uTime.value =
        elapsed != null ? elapsed : this.time;
    }
  }

  /**
   * Re-seat and re-size the procedural appendages on the imported body.
   *
   * Each part keeps the data mapping it was built with (flipper span is still
   * open PRs, flukes are still forks), but its LENGTH and STATION are now
   * fractions of the measured animal rather than of the lathe.
   *
   * Scaled uniformly through the mesh's own scale where possible, because that
   * preserves the original geometry (and its material sharing) and only changes
   * size. The flukes are the exception: they are rebuilt, because the pivot's
   * seat is what matters and the geometry is 6 vertices.
   */
  rescaleAppendages() {
    if (!this.sculptSize) return;

    const half = this.sculptSize.y * 0.5;
    const girthRatio = half / this.girth;

    // Flippers: same blade, scaled to the real half-girth at their station.
    const prRatio = THREE.MathUtils.clamp((this.repo.openPRs || 0) / 20, 0.1, 1);
    const wantSpan = half * (0.85 + prRatio * 1.1);
    for (const f of this.flippers || []) {
      const built = this.girth * (0.85 + prRatio * 1.1);
      const k = built > 0.0001 ? wantSpan / built : 1;
      f.mesh.scale.setScalar(k);
      f.mesh.position.set(
        this.xAt(0.26),
        -this.surfaceRadius(0.26) * 0.72,
        f.side * this.surfaceRadius(0.26) * 0.86
      );
    }

    // Flukes: re-seat on the true tail stock.
    if (this.flukePivot) {
      this.flukePivot.position.x = this.tailX();
      this.flukePivot.scale.setScalar(Math.max(0.6, girthRatio));
    }

    // Barnacles and remoras were positioned with the lathe profile. They are
    // animated every frame from surfaceRadius()/xAt(), so both now resolve to
    // the sculpt automatically — but their own body size is absolute, so it is
    // scaled with the animal.
    const partScale = THREE.MathUtils.clamp(girthRatio, 0.55, 2.2);
    for (const m of [this.barnacleMesh, this.remoraMesh]) {
      if (m) m.scale.setScalar(partScale);
    }
    for (const e of this.eyes || []) e.scale.setScalar(partScale);
    if (this.jaw) this.jaw.scale.setScalar(partScale);
  }

  dispose() {
    super.dispose();
    if (this.sculptSkin) this.sculptSkin.dispose();
  }
}

export default WhaleWithSculpt;