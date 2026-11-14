/**
 * Git Ocean — imported whale bodies
 *
 * The procedural whales in RepoWhale.js are good, but they are still lathed
 * profiles: correct data mapping, generic silhouette. A real sculpted humpback
 * carries detail no lathe will ever produce — tubercles on the rostrum, the
 * long white flippers, the ventral pleats running from chin to navel, the
 * knobbly fluke trailing edge. Those are the things that make an animal read as
 * itself at close zoom, and at whale zoom (distance ~30) the camera is close
 * enough to see every one of them.
 *
 * This module is deliberately an *optional* skin. It exists to answer one
 * question: can a CC-BY sculpt replace the procedural body without breaking the
 * data mapping? The answer it encodes is: only for the species that were
 * actually sculpted. Everything else stays procedural.
 *
 * Why one file and not a new class
 * --------------------------------
 * RepoWhale owns the mapping. A whale's *size* is codebase, its *orbit* is the
 * repo's position, its *beat* is commit frequency, its *barnacles* are open
 * issues. None of that should move into the loader, and none of it should be
 * duplicated here. So this module only does three things:
 *
 *   1. fetch + parse the GLB (no Draco — the humpback asset is uncompressed)
 *   2. orient and scale it to match RepoWhale's contract
 *   3. swap the material for the skin shader, keeping the per-repo colours
 *
 * The caller keeps ownership of transform, animation and disposal.
 *
 * Licence
 * -------
 * humpback-whale.glb — "Humpback Whale" by Unit299e, CC BY 4.0, via Sketchfab.
 * Attribution is required by the licence, so it is rendered in the HUD when an
 * imported whale is in the scene, not just noted in a comment.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Assets that are known to exist and are known to be licensed permissively.
 * Keyed by species id. Anything not in here stays procedural — which is the
 * correct default, because a missing or wrongly-licensed asset must degrade to
 * a working whale, never to a broken one.
 */
export const WHALE_ASSETS = {
  humpback: {
    url: "models/humpback-whale.glb",
    credit: "Humpback Whale by Unit299e (CC BY 4.0, Sketchfab)",
    // Orientation and native length are deliberately NOT listed here. They are
    // measured from the geometry at load time by normalizeWhale(), because a
    // hard-coded guess is how the first version of this swap went wrong: the
    // comment claimed the head was at +Z when it is at −Z, and the declared
    // length was a number nothing checked. Measuring survives an upstream
    // re-export, which is the common case with Sketchfab assets.
  },
};

const loader = new GLTFLoader();
const cache = new Map();

/**
 * Load an asset once and share it. A whale is 8 MB; fetching it per repo would
 * be absurd, and cloning a parsed scene graph is cheap by comparison.
 *
 * Resolves to null rather than rejecting — the caller must be able to fall back
 * to procedural geometry without a try/catch on every whale.
 */
export function loadWhaleAsset(key) {
  const asset = WHALE_ASSETS[key];
  if (!asset) return Promise.resolve(null);
  if (cache.has(key)) return cache.get(key);

  const promise = new Promise((resolve) => {
    loader.load(
      asset.url,
      (gltf) => resolve(gltf),
      undefined,
      (err) => {
        // A missing asset is a real possibility (not deployed yet, offline
        // dev, a typo). Warn once and let the procedural whale stand in.
        console.warn(`[git-ocean] whale asset "${key}" unavailable, using procedural body`, err);
        resolve(null);
      }
    );
  });

  cache.set(key, promise);
  return promise;
}

/**
 * Measured extent of an object along a LOCAL axis, read from the geometry.
 *
 * Why this cannot be Box3.setFromObject(): that reads `geometry.boundingBox`
 * transformed by the world matrix, which for a skinned mesh is the *bind pose* —
 * the modelling pose, not the swim pose. On this humpback the bind pose has the
 * flippers stretched wide, so a Box3 reports a span across them of 0.85x the
 * body length when a real humpback's is about 0.35x. Building the profile from
 * that produced a whale 2.4x too wide, and every appendage was then seated
 * against the wrong radius.
 *
 * So the extents are measured from the POSITION accessor directly: the same
 * geometry the GPU draws, with no rig assumptions baked in.
 *
 * Note the axis is read in the mesh's OWN local space, before the wrapper's
 * rotation is applied — the whole point is to find which local axis the body
 * runs along.
 */
function measuredExtent(root, axis) {
  let min = Infinity;
  let max = -Infinity;
  let found = false;

  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.getAttribute && o.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const v = AXIS_GET[axis](pos, i);
      if (v < min) min = v;
      if (v > max) max = v;
      found = true;
    }
  });

  return found ? max - min : 0;
}

/**
 * Extent of the body the GPU will actually draw, measured through the skin.
 *
 * measuredExtent() reads the POSITION accessor, which is the mesh in its REST
 * pose. A skinned mesh is not drawn in its rest pose: every vertex is pushed
 * through the armature, and on this asset the armature node carries a scale of
 * its own. measuredExtent() therefore under-reports the animal by exactly that
 * factor, and because the scale is applied uniformly the error is invisible in
 * a ratio check — the body came out the right *shape* and 2.14x the wrong *size*.
 *
 * Measured rather than assumed: the raw accessor extents are 4.646 (z) by 2.713
 * (y); the deformed cloud spans 9.96 by 5.81, a ratio of 2.144, which is the
 * armature node's 2.1436 scale. On screen the animal read 590 x 266 px where
 * the model predicted 266 x 97 px — the same 2.2x, which is what finally
 * separated "wrong size" from "wrong proportions".
 *
 * Every vertex is skinned here, not every Nth one: this runs once at load, and
 * a sampled cloud is fine for locating a centre (below) but not for a size that
 * every appendage is seated against.
 */
function drawnExtent(root, axis) {
  // SkinnedMesh.computeBoundingBox() runs getVertexPosition() for every vertex,
  // which is applyBoneTransform() — the same bindMatrix/boneMatrices/bindMatrixInverse
  // chain the vertex shader uses. Re-implementing that by hand got the spaces
  // wrong three separate times (see the note above), so this defers to three.
  //
  // The box comes back in the MESH'S local space. What the caller needs is the
  // extent the body occupies in root's space, which is that local box scaled by
  // however much the armature multiplies it — so the armature factor is applied
  // here, once, explicitly, rather than being folded into k by trial and error.
  //
  // Measured on this asset: local 1.952 (z) becomes 4.184 in root space, a
  // factor of 2.144 from the Armature_18 node. Getting this wrong is what made
  // k come out 2.14x too large: the size was measured in one space and applied
  // in another, so the animal drew at 2.14x target while every ratio still
  // checked out.
  root.updateMatrixWorld(true);

  const rootScale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld);
  const base = rootScale[axis] || 1;

  let lo = Infinity;
  let hi = -Infinity;
  let found = false;

  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry) return;
    o.computeBoundingBox();
    const bb = o.boundingBox;
    if (!bb || !isFinite(bb.min[axis]) || !isFinite(bb.max[axis])) return;
    // The mesh's own world scale, relative to root's, is the factor between the
    // box's space and root's space.
    const ws = new THREE.Vector3().setFromMatrixScale(o.matrixWorld);
    const f = base > 0.000001 ? ws[axis] / base : 1;
    const a = bb.min[axis] * f;
    const b = bb.max[axis] * f;
    if (a < lo) lo = a;
    if (b > hi) hi = b;
    found = true;
  });

  return found ? hi - lo : 0;
}

// Every axis the callers ask for, explicitly.
//
// The original helper was `axis === "x" ? pos.getX(i) : pos.getZ(i)`, so any
// axis other than "x" silently returned the Z extent. That is exactly how the
// whale came out too shallow: normalizeWhale asked for "y" to size the body's
// depth, got the 4.646-unit nose-to-tail extent instead of the 2.713-unit
// height, and reported a height equal to the body length. WhaleFactory then
// computed `ky = wantY / measured.y = 18.54 / 48.78 = 0.38` instead of 0.65 and
// applied it to the wrapper, so the drawn animal was 10.81 units deep — 0.22 of
// its length — where 0.38 was intended. The silhouette agreed with the buggy
// number (89 px deep against 433 px long, ratio 0.206) and disagreed with the
// census (which claimed 0.38), which is what finally separated the two.
const AXIS_GET = {
  x: (pos, i) => pos.getX(i),
  y: (pos, i) => pos.getY(i),
  z: (pos, i) => pos.getZ(i),
};

/**
 * Settle an imported scene onto the origin, nose pointing -X, and report its
 * measured size.
 *
 * Returns { wrapper, size } — the size is what callers seat appendages against.
 * The x extent (nose to tail) is measured rather than taken from the box, and
 * the lateral extent is clamped to a plausible cetacean width so a polluted bind
 * pose cannot inflate the animal.
 */
export function normalizeWhale(source, targetLength) {
  // SkeletonUtils.clone(), NOT source.clone().
  //
  // Object3D.clone() copies the node graph and shares the Skeleton object, so
  // every clone of a skinned mesh points its bones at the ORIGINAL scene's
  // bones. Those live under the cached gltf.scene, which is not in any scene
  // graph and never gets its matrixWorld updated — so the boneMatrices the GPU
  // reads are stale, and the body collapses to a speck.
  //
  // Measured, not guessed: the naive clone produced a skinned bounding box of
  // 0.19 x 0.39 x 0.10 local units against a geometry extent of 2.18 x 2.71 x
  // 4.64. Three independent visual-QA passes reported "no whale in the frame"
  // while the mesh was genuinely in the scene, and the whole discrepancy was
  // this one line. SkeletonUtils.clone() rebinds the skeleton to the CLONED
  // bones and copies bindMatrix, which is what makes a skinned clone actually
  // deform.
  const inner = cloneSkeleton(source);

  // Force the fresh bone hierarchy to compute its world matrices.
  //
  // cloneSkeleton() rebinds the skeleton to the cloned bones but does not give
  // them current matrixWorld, so the first thing to read the pose — a bounding
  // box, a raycast, the first render — sees identity bones and a collapsed
  // body. Done here, once, so no later reader has to remember to.
  inner.updateMatrixWorld(true);

  // Which local axis is the body? Compare measured extents, not bounding boxes.
  const ex = measuredExtent(inner, "x");
  const ez = measuredExtent(inner, "z");
  const alongZ = ez >= ex;

  // Size from the extent the GPU DRAWS, not from the rest pose.
  //
  // measuredExtent() reads the POSITION accessor, which is the mesh before the
  // armature touches it. On this asset the armature node scales the whole body,
  // so the drawn animal is 1.14x the rest pose — and because that factor is
  // uniform, every ratio check still passed. The body came out the right shape
  // at the wrong size, which is exactly the failure no amount of looking at one
  // frame will reveal: you need the projected pixels and the projected census
  // units in the same sentence.
  const nativeDrawn = alongZ ? drawnExtent(inner, "z") : drawnExtent(inner, "x");
  const k = nativeDrawn > 0.0001 ? targetLength / nativeDrawn : 1;

  inner.scale.setScalar(k);
  // Nose toward -X.
  //
  // Which local axis is "forward" is not a guess here: glTF is defined as
  // right-handed, Y-up, with the front of an asset facing +Z, and this mesh's
  // own geometry agrees — the thin wide slabs (flukes, only 0.13-0.25 units
  // thick vertically) sit at z +1.27..+2.20, and the blunt head at z -2.44.
  //
  // A yaw of +90 degrees maps local +Z to world +X, so the tail goes to +X and
  // the nose to -X, which is the direction RepoWhale's xAt()/surfaceRadius()
  // assume. The previous +270 degrees mapped +Z to -X and put the nose at +X:
  // every appendage was then seated against the wrong end, and the animal came
  // out facing backwards.
  if (alongZ) inner.rotation.y += Math.PI * 0.5;

  // Re-centre on the DEFORMED body, not on the bind pose.
  //
  // Box3.setFromObject() reads geometry.boundingBox through the world matrix,
  // which for a skinned mesh is the BIND pose — and on this rig the bind pose is
  // offset from the body the GPU actually draws. Measured on the live scene: the
  // animal sat 69 px to one side of the projected group origin while a
  // brightness threshold put its mass 84 px to the other. Two measurements, two
  // answers, because neither tracked the deformed mesh.
  //
  // Six attempts were made at this in earlier passes, and every one failed for
  // the same reason: the measured centre and the value it was subtracted from
  // were not in the same space. The versions that looked correct each time were
  // silently off by k or by the yaw, because the pivot correction ran before
  // the wrapper existed and `inner.matrix` is not a parent-space map once there
  // is a parent.
  //
  // The way out is to stop converting by hand. Parent the clone first, let the
  // scene graph settle, then measure the deformed body in WORLD space with
  // three's own skinned bounding box, and move inner by the negative of that
  // world centre expressed in the wrapper's frame — which, because the wrapper
  // is a plain Group at the origin with no transform of its own, is the same
  // vector.
  //
  // Measured rather than reasoned: with the old formula the drawn body's centre
  // sat at (-4.11, 18.42, 0.35) against a wrapper at the origin — an 8.4%
  // error along the body's own axis, which is enough to swing the animal out of
  // the frame at whale zoom.
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  wrapper.updateMatrixWorld(true);

  const drawnCentre = new THREE.Vector3();
  const drawnBox = new THREE.Box3();
  let drewAny = false;
  let sampled = 0;

  inner.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry) return;
    o.computeBoundingBox();
    const bb = o.boundingBox;
    if (!bb || !isFinite(bb.min.x)) return;
    drawnBox.union(bb.clone().applyMatrix4(o.matrixWorld));
    drewAny = true;
  });

  if (drewAny && !drawnBox.isEmpty()) {
    drawnBox.getCenter(drawnCentre);
    // world -> wrapper space. The wrapper is at the origin with identity
    // rotation, so this is the identity — but ask properly rather than assume,
    // so that a future wrapper transform does not silently break this again.
    wrapper.worldToLocal(drawnCentre);
    // wrapper space -> inner.position's space. inner is the wrapper's only
    // child, so its parent frame IS the wrapper's frame.
    inner.position.sub(drawnCentre);
    sampled = drawnBox.isEmpty() ? 0 : 1; // recorded for the census: the traverse ran
  }

  inner.updateMatrixWorld(true);

  // Recorded so the debug census can tell whether the re-centring ran at all.
  // It silently did not for several builds, and a silent failure here is
  // indistinguishable from a wrong correction: the rendered offset does not
  // change between two different formulas, only between "ran" and "did not".
  wrapper.userData.recentre = {
    sampled,
    centre: [drawnCentre.x, drawnCentre.y, drawnCentre.z],
    before: [drawnBox.min.x, drawnBox.min.y, drawnBox.min.z],
    after: [drawnBox.max.x, drawnBox.max.y, drawnBox.max.z],
  };

  const box2 = new THREE.Box3().setFromObject(wrapper);
  const size = new THREE.Vector3();
  box2.getSize(size);

  // The authoritative extent is MEASURED THROUGH THE SKIN, not boxed and not
  // read off the accessors.
  //
  // A Box3 on a skinned mesh reports the bind pose; the POSITION accessors report
  // the rest pose. Neither is what the GPU draws: the armature deforms every
  // vertex, and on this asset the armature node carries a scale of its own.
  // measuredExtent() therefore under-reported the animal by that factor, which
  // is how it came out 2.14x too large on screen while every ratio check passed.
  //
  // drawnExtent() is three's own skinned bounding box in the mesh's local
  // space, so multiplying by k gives the drawn extent directly.
  const dx = drawnExtent(inner, "x") * k;
  const dz = drawnExtent(inner, "z") * k;
  const dy = drawnExtent(inner, "y") * k;
  const bodyX = Math.max(dx, dz); // nose-to-tail, whichever local axis it was
  const bodyZ = Math.min(dx, dz); // across the flanks

  // Body length is what was asked for, measured through the skin.
  size.x = targetLength;
  // Lateral width is clamped: a humpback is roughly 0.3x as wide as it is long,
  // and anything above ~0.45x means a bind-pose artefact leaked through.
  size.z = THREE.MathUtils.clamp(bodyZ, targetLength * 0.16, targetLength * 0.45);
  // Height is measured, not assumed — every appendage is seated against it.
  size.y = bodyX > 0 ? dy : size.y;

  return { wrapper, size };
}
