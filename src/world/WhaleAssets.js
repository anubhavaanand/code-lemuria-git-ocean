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
function deformedExtent(root, axis) {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  const skinned = new THREE.Vector3();
  const boneMat = new THREE.Matrix4();

  root.updateWorldMatrix(true, true);

  // The deformed points come back in WORLD space, so bring them back into
  // root's own space to compare like with like.
  const invRoot = new THREE.Matrix4()
    .copy(root.matrixWorld)
    .invert();

  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry) return;
    const pos = o.geometry.getAttribute("position");
    const si = o.geometry.getAttribute("skinIndex");
    const sw = o.geometry.getAttribute("skinWeight");
    if (!pos || !si || !sw) return;
    if (!o.skeleton || !o.skeleton.bones) return;

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      skinned.set(0, 0, 0);
      for (let c = 0; c < 4; c++) {
        const j = si.getComponent(i, c);
        const wgt = sw.getComponent(i, c);
        if (wgt === 0 || j === undefined) continue;
        const bone = o.skeleton.bones[j];
        if (!bone) continue;
        boneMat.multiplyMatrices(bone.matrixWorld, o.skeleton.boneInverses[j]);
        skinned.addScaledVector(v.clone().applyMatrix4(boneMat), wgt);
      }
      if (skinned.lengthSq() === 0) skinned.copy(v);
      skinned.applyMatrix4(invRoot);
      const e =
        axis === "x" ? skinned.x : axis === "y" ? skinned.y : skinned.z;
      // Compare on whichever axis was asked for, not always x.
      if (axis === "x") {
        if (e < lo.x) lo.x = e;
        if (e > hi.x) hi.x = e;
      } else if (axis === "y") {
        if (e < lo.y) lo.y = e;
        if (e > hi.y) hi.y = e;
      } else {
        if (e < lo.z) lo.z = e;
        if (e > hi.z) hi.z = e;
      }
    }
  });

  if (axis === "x") return hi.x > lo.x ? hi.x - lo.x : 0;
  if (axis === "y") return hi.y > lo.y ? hi.y - lo.y : 0;
  return hi.z > lo.z ? hi.z - lo.z : 0;
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
  const native = alongZ ? ez : ex;
  const k = native > 0.0001 ? targetLength / native : 1;

  // The armature's own scale multiplies every vertex on top of k, so applying k
  // to the native extent lands the animal at k/native = 1/1 world unit per unit
  // of target length, not at targetLength. Divide the extra out of k so the
  // drawn body — raw * armatureScale * k — is exactly targetLength long.
  //
  // This is the bug that made every silhouette 2.14x too large while every
  // ratio check passed: the body was the right shape at the wrong size, and
  // only a comparison of projected pixels against projected census units showed
  // it. See deformedExtent() for the measurement.
  const deformed = deformedExtent(inner, alongZ ? "z" : "x");
  const armatureScale = native > 0.0001 ? deformed / native : 1;
  if (armatureScale > 1.0001) k /= armatureScale;

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
  // So measure the deformed points directly. For each skinned mesh, take every
  // Nth vertex, skin it on the CPU with the same bone matrices the shader uses,
  // and take the midpoint of the resulting cloud. That is the body's real centre
  // in the mesh's own space, with no box and no bind-pose assumption.
  //
  // Done at load, once, on a stride of the vertices — a 65k-vertex mesh sampled
  // every 37th is ~1.8k points, which locates the centre to well under a
  // percent of body length while costing a few milliseconds.
  // Measure the deformed body in INNER's own space, so the result can be
  // subtracted from inner.position directly with no matrix conversion at all.
  //
  // Four attempts were needed to get this right, and the census is what finally
  // showed why: the traverse reported 5,340 sampled points with a local centre
  // of (-7.98, 41.04, 0.85) while the rendered offset never moved between three
  // different correction formulas. That is only possible if the numbers being
  // subtracted were never in the space they were assumed to be in.
  //
  // The rule: a correction is only valid if the measured centre and the value
  // it is subtracted from are in the SAME space. inner.position is in wrapper
  // space, so measure in wrapper space.
  //
  //   world  --(o.matrixWorld)-->  mesh-local  --(o.bindMatrix)-->  bind-local
  //   bind-local --(bone.matrixWorld * boneInverse)-->  world
  //
  // So the skinned point is in WORLD space, and world -> inner-local is
  // inner.worldToLocal(). Doing it in this order means lo/hi and inner.position
  // share a space and the subtraction is a plain component-wise one.
  inner.updateMatrixWorld(true);
  const invInner = new THREE.Matrix4().copy(inner.matrix).invert();

  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let sampled = 0;

  const v = new THREE.Vector3();
  const skinned = new THREE.Vector3();
  const boneMat = new THREE.Matrix4();

  inner.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry) return;
    const pos = o.geometry.getAttribute("position");
    const si = o.geometry.getAttribute("skinIndex");
    const sw = o.geometry.getAttribute("skinWeight");
    if (!pos || !si || !sw) return;

    const skeleton = o.skeleton;
    if (!skeleton || !skeleton.bones) return;

    const stride = Math.max(1, Math.floor(pos.count / 2000));

    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i);
      skinned.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const j = si.getComponent(i, k);
        const wgt = sw.getComponent(i, k);
        if (wgt === 0 || j === undefined) continue;
        const bone = skeleton.bones[j];
        if (!bone) continue;
        boneMat.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[j]);
        skinned.addScaledVector(v.clone().applyMatrix4(boneMat), wgt);
      }
      if (skinned.lengthSq() === 0) skinned.copy(v);

      // The skinned point is in world space. Convert it into inner's PARENT
      // space, which is the space `inner.position` lives in, using the inverse
      // of inner's own matrix — inner is not parented yet at this point, so
      // inner.matrix *is* the local->parent map and there is no parent to ask.
      //
      // Using inner.worldToLocal() here instead would apply the inverse twice
      // and hand back the GLB's raw local bounds with k and the yaw undone.
      // Using inner.parent.worldToLocal() throws, because parent is null.
      skinned.applyMatrix4(invInner);

      if (skinned.x < lo.x) lo.x = skinned.x;
      if (skinned.y < lo.y) lo.y = skinned.y;
      if (skinned.z < lo.z) lo.z = skinned.z;
      if (skinned.x > hi.x) hi.x = skinned.x;
      if (skinned.y > hi.y) hi.y = skinned.y;
      if (skinned.z > hi.z) hi.z = skinned.z;
      sampled++;
    }
  });

  const localCentre = new THREE.Vector3(
    (lo.x + hi.x) * 0.5,
    (lo.y + hi.y) * 0.5,
    (lo.z + hi.z) * 0.5
  );

  if (sampled > 0) {
    // Same space, so this is a plain subtraction.
    inner.position.sub(localCentre);
  }

  inner.updateMatrixWorld(true);

  const wrapper = new THREE.Group();
  wrapper.add(inner);

  // Recorded so the debug census can tell whether the re-centring ran at all.
  // It silently did not for several builds: if the traverse bails (no skeleton,
  // no skinIndex/skinWeight, no skinned mesh) `sampled` stays 0 and the pivot
  // keeps whatever offset the GLB scene root carried — which is
  // indistinguishable from a wrong correction, because the rendered offset does
  // not change between two different correction formulas.
  wrapper.userData.recentre = {
    sampled,
    lo: [lo.x, lo.y, lo.z],
    hi: [hi.x, hi.y, hi.z],
    localCentre: [
      (lo.x + hi.x) * 0.5,
      (lo.y + hi.y) * 0.5,
      (lo.z + hi.z) * 0.5,
    ],
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
  // deformedExtent() skins the cloud the same way the shader does and returns
  // the extent in the mesh's own space, so multiplying by k is the whole story.
  const dx = deformedExtent(inner, "x") * k;
  const dz = deformedExtent(inner, "z") * k;
  const dy = deformedExtent(inner, "y") * k;
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
