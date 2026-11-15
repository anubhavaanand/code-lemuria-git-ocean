/**
 * Git Ocean — App shell
 *
 * Two responsibilities only:
 *   1. Own the <canvas> container and the imperative OceanWorld instance.
 *   2. Mirror a few world facts into React state so the HUD can render.
 *
 * The world is created once on mount and never re-created on render. React
 * re-renders the HUD; Three.js keeps drawing underneath. The two communicate
 * through callbacks passed into the OceanWorld constructor — no per-frame
 * React state, no re-render storm.
 *
 * The ocean keeps running while the tab is hidden (the clock is clamped, so
 * there's no jump on return) — pausing it would break the illusion of a
 * living world and adds state for no user benefit.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OceanWorld } from "./world/OceanWorld";
import { loadProfile } from "./services/profile";
import { FrameProfiler } from "./world/perf";
import { ZOOM_LEVELS } from "./world/constants";
import HUD from "./ui/HUD";
import "./index.css";

export default function App() {
  const containerRef = useRef(null);
  const worldRef = useRef(null);
  /**
   * Failures from the live-data pass that are worth seeing outside the console.
   *
   * A failed fetch is invisible in the picture — the world falls back to mock
   * data and looks correct — and the console is only readable with the devtools
   * open, which a screenshot pass does not have. A ref rather than state: the
   * census reads it every second and a re-render would buy nothing.
   */
  const liveIssuesRef = useRef([]);

  const [world, setWorld] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [levelId, setLevelId] = useState(() => {
    // ?level=city|world|country|tower|whale — used by the screenshot QA pass
    const q =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("level")
        : null;
    const found = ZOOM_LEVELS.findIndex((l) => l.id === q);
    return found >= 0 ? q : "city";
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // How far the live-data pass has got, or null while it is not running. Shown
  // in the HUD rather than swallowed: a world that never fetched anything looks
  // identical to one that fetched and found nothing, and only one of those is a
  // bug.
  const [dataState, setDataState] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let instance;
    try {
      instance = new OceanWorld(containerRef.current, {
        onSelect: (repo) => setSelectedRepo(repo),
        onLevelChange: (level) => setLevelId(level.id),
        onReady: () => setLoading(false),
        // `?nosculpt=1` leaves the procedural body in place so a screenshot can
        // be diffed against the sculpted one. Without it there is no way to tell
        // "not drawn" from "drawn but unreadable".
        suppressSculpt: !!new URLSearchParams(window.location.search).get(
          "nosculpt"
        ),
        // `?only=whale` hides the water, the seafloor and every non-whale
        // object. See the `onlyWhales` note in OceanWorld: a screenshot diff
        // cannot isolate the animal, because removing it also changes what is
        // visible behind it — measured that way the "body" came out 604 x 268
        // px against a predicted 267 x 101.
        onlyWhales: !!new URLSearchParams(window.location.search).get(
          "only"
        ),
        // `?debug=perf` turns on the frame profiler. Constructed here rather
        // than read inside OceanWorld so the world has no opinion about URLs:
        // the profiler is a dependency like any other, and the default is the
        // no-op object, so the production path allocates nothing and measures
        // nothing.
        profiler: new FrameProfiler(
          new URLSearchParams(window.location.search).get("debug") === "perf"
        ),
        // The governor is off in a headless capture and on in a real tab.
        //
        // SwiftShader renders this scene at 2-4 fps, which is not a slow
        // machine — it is a machine with no GPU at all. A governor that acted on
        // it would step to the floor before the first frame was drawn, and then
        // every capture in this project would be comparing low-tier against
        // low-tier while believing it was looking at the default tier. That is
        // the same category of mistake as the profiler: `?debug=perf` is a
        // measurement, not a behaviour.
        //
        // `?quality=high|medium|low` pins a tier by hand, which is what a user
        // on a machine the detector misjudges needs.
        // `?quality=high|medium|low` pins a tier by hand, which is what a user
        // on a machine the detector misjudges needs. It is a RENDERER setting,
        // so it drives the governor's starting index rather than `this.quality`
        // — that field decides how many towers, rocks and creatures get built,
        // and rebuilding the whole scene for a tier change would be a different
        // and far more expensive feature.
        adaptiveQuality: new URLSearchParams(window.location.search).get("quality")
          ? false
          : !/HeadlessChrome|swiftshader/i.test(navigator.userAgent),
        qualityTier:
          new URLSearchParams(window.location.search).get("quality") || undefined,
      });
    } catch (e) {
      console.error("[GitOcean] failed to start world", e);
      setError(e && e.message ? e.message : String(e));
      setLoading(false);
      return;
    }

    worldRef.current = instance;
    setWorld(instance);

    // Honour an explicit ?level= for the QA screenshot pass
    const q =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("level")
        : null;
    const start = ZOOM_LEVELS.findIndex((l) => l.id === q);
    if (start >= 0) {
      // Set BOTH. `t` is the eased position the rig actually reads; `targetT`
      // is what it eases toward every frame. Setting only `t` used to mean the
      // rig glided back to the default level within a second, so a headless
      // screenshot taken at 9s captured an intermediate zoom — the reported
      // level said "city" while the camera was still parked at the world view.
      instance.rig.t = start;
      instance.rig.targetT = start;
      instance.rig.apply(0, true, null);
    }

    // ?focus=<owner/name|repo-name> points the camera at one repository.
    //
    // Without this, the "whale" zoom frames the origin — which is only correct
    // if the followed repo happens to sit there. It does not: your own repos are
    // spread across the district, so a whale-level screenshot of the origin was
    // mostly empty water with the animals 200+ units off to the side. Naming a
    // repo makes the level mean what its label says.
    const focusQuery = new URLSearchParams(window.location.search).get("focus");
    if (focusQuery) {
      const needle = focusQuery.toLowerCase();
      let found = null;
      for (const e of instance.entries.values()) {
        const full = `${e.repo.owner}/${e.repo.name}`.toLowerCase();
        if (full === needle || e.repo.name.toLowerCase() === needle) {
          found = e;
          break;
        }
      }
      if (found) {
        instance.select(found.repo.id);
        instance.focusSelected(start >= 0 ? start : 3);
      } else {
        console.warn(`[git-ocean] ?focus=${focusQuery} matched no repository`);
      }
    }

    // Debug/QA handle: lets a headless browser drive zoom levels and read the
    // camera state so visual regressions can be caught without a human.
    if (typeof window !== "undefined") {
      // `?freeze=1` pins every whale's orbital phase and the elapsed time.
      //
      // Without it a screenshot and a geometry census are two different frames:
      // the orbit advances with wall-clock delta, so the pixel coordinates a QA
      // pass is asked to inspect never match the reported position, and the only
      // honest conclusion from empty water is "the whale is missing". Freezing
      // makes the two measurements agree, which is what turns that verdict back
      // into a measurement.
      const freeze = new URLSearchParams(window.location.search).get("freeze");
      if (freeze) {
        instance.orbitScale = 0;
        instance.timeScale = 0;
      }

      window.__GO = {
        THREE,
        world: instance,
        rig: instance.rig,
        goTo: (i) => instance.rig.goTo(i),
        select: (id) => instance.select(id),
        // Whale census: which body a repo got, and whether the imported sculpt
        // actually landed. `sculptSize` is measured after normalization, so a
        // non-null size is proof the swap completed rather than a claim about it.
        whale: (repoId) => {
          const target = repoId
            ? instance.entries.get(repoId)
            : instance.entries.values().next().value;
          if (!target || !target.whale) return null;
          const w = target.whale;
          return {
            repo: target.repo.name,
            species: (target.repo.whaleSpecies && target.repo.whaleSpecies.id) || null,
            kind: w.sculptKind || "procedural",
            credit: w.sculptCredit || null,
            sculptSize: w.sculptSize
              ? [
                  Number(w.sculptSize.x.toFixed(2)),
                  Number(w.sculptSize.y.toFixed(2)),
                  Number(w.sculptSize.z.toFixed(2)),
                ]
              : null,
            bodyLength: Number(w.length.toFixed(2)),
            girth: Number(w.girth.toFixed(2)),
            nodes: (() => {
              let n = 0;
              w.group.traverse(() => n++);
              return n;
            })(),
            // Live placement, so a "whale is missing" report can be checked
            // against geometry instead of guessed from pixels.
            position: [
              Number(w.group.position.x.toFixed(1)),
              Number(w.group.position.y.toFixed(1)),
              Number(w.group.position.z.toFixed(1)),
            ],
            visible: w.group.visible,
            // Where the body centre actually lands on screen right now.
            screen: (() => {
              const v = w.group.position.clone();
              v.y += w.bodyY || 0;
              v.project(instance.camera);
              return [
                Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
                Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
                Number(v.z.toFixed(3)),
              ];
            })(),
            // What the census itself cannot be trusted on.
            //
            // `screen` projects the group origin, which equals the body centre
            // only if the sculpt's pivot is centred — and it is not, because the
            // armature's bind pose is offset from the drawn body. `rect` calls
            // Box3.setFromObject on a SkinnedMesh, which reports the bind pose,
            // so it once returned w=15132 with behind:true while the animal was
            // plainly elsewhere in frame.
            //
            // These make the discrepancy visible instead of misleading: if
            // groupWorld and bodyCentre disagree, the pivot is off, and any
            // projection taken from the origin is wrong by exactly that much.
            // The sculpt's world-space bounds taken from the DRAWN vertices,
            // not from Box3 (which reads the bind pose). This is the number
            // that decides apparent size, and it is what every hand projection
            // has been missing: `sculptSize` is computed from raw geometry
            // accessors and can disagree with what the GPU actually draws.
            drawnBounds: (() => {
              if (!w.sculpt) return null;
              const b = new THREE.Box3();
              w.sculpt.updateWorldMatrix(true, true);
              w.sculpt.traverse((o) => {
                if (!o.isSkinnedMesh || !o.geometry) return;
                o.computeBoundingBox();
                const bb = o.boundingBox;
                if (!bb || !isFinite(bb.min.x)) return;
                b.union(bb.clone().applyMatrix4(o.matrixWorld));
              });
              if (b.isEmpty()) return null;
              const s = new THREE.Vector3();
              b.getSize(s);
              const c = new THREE.Vector3();
              b.getCenter(c);
              return {
                size: [
                  Number(s.x.toFixed(2)),
                  Number(s.y.toFixed(2)),
                  Number(s.z.toFixed(2)),
                ],
                centre: [
                  Number(c.x.toFixed(2)),
                  Number(c.y.toFixed(2)),
                  Number(c.z.toFixed(2)),
                ],
              };
            })(),
            bodyOffset: (() => {
              const inner = w.sculpt && w.sculpt.children && w.sculpt.children[0];
              if (!inner) return null;
              const p = inner.position;
              return [
                Number(p.x.toFixed(2)),
                Number(p.y.toFixed(2)),
                Number(p.z.toFixed(2)),
              ];
            })(),
            // The camera's own orientation, so a projection can be checked
            // instead of trusted.
            cameraBasis: (() => {
              const c = instance.camera;
              const q = c.quaternion;
              const fwd = { x: 0, y: 0, z: -1 };
              // rotate (0,0,-1) by q
              const { x, y, z, w } = q;
              const ix = w * fwd.x + y * fwd.z - z * fwd.y;
              const iy = w * fwd.y + z * fwd.x - x * fwd.z;
              const iz = w * fwd.z + x * fwd.y - y * fwd.x;
              const iw = -x * fwd.x - y * fwd.y - z * fwd.z;
              const rx = ix * w + iw * -x + iy * -z - iz * -y;
              const ry = iy * w + iw * -y + iz * -x - ix * -z;
              const rz = iz * w + iw * -z + ix * -y - iy * -x;
              return {
                pos: [Number(c.position.x.toFixed(1)), Number(c.position.y.toFixed(1)), Number(c.position.z.toFixed(1))],
                fwd: [Number(rx.toFixed(3)), Number(ry.toFixed(3)), Number(rz.toFixed(3))],
                fov: c.fov,
              };
            })(),
            // Distance from the lens, which is what decides apparent size.
            distance: Number(
              instance.camera.position.distanceTo(w.group.position).toFixed(1)
            ),
            childMeshes: (() => {
              const out = [];
              w.group.traverse((o) => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                const m = Array.isArray(o.material) ? o.material[0] : o.material;
                out.push({
                  name: o.name || o.type,
                  visible: o.visible,
                  type: m ? m.type : null,
                  hasMap: !!(m && m.map),
                  opacity: m ? m.opacity : null,
                  transparent: m ? !!m.transparent : null,
                });
              });
              return out;
            })(),
          };
        },
        // Legacy fauna census, straight from the live scene graph. Lets a
        // numeric check confirm which creatures actually built for a repo,
        // instead of inferring it from a screenshot.
        legacy: (repoId) => {
          const target = repoId
            ? instance.entries.get(repoId)
            : instance.entries.values().next().value;
          if (!target || !target.legacy) return null;
          const l = target.legacy;
          return {
            repo: target.repo.name,
            brainCoral: !!l.brainCoral,
            anemone: !!l.anemone,
            isopod: !!l.isopod,
            urchins: l.urchins || 0,
            copepods: l.copepods || 0,
            featherStar: !!l.featherStar,
            amphipods: l.amphipods || 0,
            barnacles: !!l.barnacleRing,
            sponge: !!l.sponge,
            parrotfish: !!l.parrotfish,
            seahorse: !!l.seahorse,
            grouper: !!l.grouper,
            cleanerWrasse: !!l.cleanerWrasse,
            lanternfish: !!l.lanternfish,
            nudibranch: !!l.nudibranch,
            baskingShark: !!l.baskingShark,
            anglerfish: !!l.anglerfish,
            animated: l.animated.length,
            objects: (() => {
              let n = 0;
              l.group.traverse(() => n++);
              return n;
            })(),
          };
        },
        camera: () => ({
          x: instance.camera.position.x,
          y: instance.camera.position.y,
          z: instance.camera.position.z,
          focus: instance.rig.focus.toArray(),
          level: instance.rig.levelId,
        }),
        // Ground-truth rock framing, straight from the live scene graph. The
        // vision QA model can only look at a picture; this reports the actual
        // instance positions, so a "rocks are invisible" verdict can be checked
        // against geometry instead of argued about.
        rocks: () => {
          const cam = instance.camera;
          const el = containerRef.current;
          return instance.floor.rockReport(
            cam,
            el ? el.clientWidth : 1440,
            el ? el.clientHeight : 900
          );
        },
        // What the governor has done, and to what. `force(index)` pins a tier
        // without touching `this.quality`, so the scene's object counts stay
        // where they were and only the renderer changes — which is the whole
        // point of the tier being a renderer setting.
        quality: (index) => {
          if (!instance.governor) return { enabled: false };
          if (typeof index === "number") {
            instance.governor.index = Math.max(
              0,
              Math.min(index, 3 - 1)
            );
            instance._applyQualityTier(instance.governor.tier, instance.governor.index);
          }
          return {
            enabled: true,
            ...instance.governor.report(),
            pixelRatio: instance.renderer.getPixelRatio(),
            shadowMap: instance.renderer.shadowMap.enabled,
          };
        },
      };
    }

    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    // Also catch container-size changes that aren't window resizes
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(containerRef.current);
    }

    // ?debug=rocks writes the live rock-framing report into a DOM node so a
    // headless browser can read it back with --dump-dom. This is how the rock
    // visibility problem got measured without interpreting an image: the report
    // is computed from the real instance matrices and the real camera, so it
    // cannot be fooled by a dark screenshot or a flattering angle.
    let debugTimer = null;
    const debugMode = new URLSearchParams(window.location.search).get("debug");
    const wantsRockReport = debugMode === "rocks";
    const wantsFaunaReport = debugMode === "fauna";
    const wantsWhaleReport = debugMode === "whale";
    const wantsPerfReport = debugMode === "perf";
    if (wantsRockReport || wantsFaunaReport || wantsWhaleReport || wantsPerfReport) {
      const emit = () => {
        const el = containerRef.current;
        if (!el) return;
        let node = document.getElementById("go-debug-report");
        if (!node) {
          node = document.createElement("pre");
          node.id = "go-debug-report";
          document.body.appendChild(node);
        }
        const payload = {
          level: instance.rig.levelId,
          camera: [
            Number(instance.camera.position.x.toFixed(0)),
            Number(instance.camera.position.y.toFixed(0)),
            Number(instance.camera.position.z.toFixed(0)),
          ],
          // The camera's basis, read from its quaternion rather than assumed.
          //
          // Every projection I did by hand disagreed with the census, because I
          // modelled the camera from the level's authored height/focus instead
          // of reading where it actually ended up. This closes that gap: `fwd`
          // and `focus` between them fix the camera completely, so a reported
          // screen position can be recomputed and checked instead of trusted.
          basis: (() => {
            const c = instance.camera;
            const e = c.matrixWorld.elements;
            // matrixWorld's third column is the camera's local +Z in world
            // space; the view direction is -Z.
            return {
              fwd: [
                Number((-e[8]).toFixed(3)),
                Number((-e[9]).toFixed(3)),
                Number((-e[10]).toFixed(3)),
              ],
              up: [
                Number(e[4].toFixed(3)),
                Number(e[5].toFixed(3)),
                Number(e[6].toFixed(3)),
              ],
              right: [
                Number(e[0].toFixed(3)),
                Number(e[1].toFixed(3)),
                Number(e[2].toFixed(3)),
              ],
              focus: [
                Number(instance.rig.focus.x.toFixed(1)),
                Number(instance.rig.focus.y.toFixed(1)),
                Number(instance.rig.focus.z.toFixed(1)),
              ],
              fov: c.fov,
              yaw: Number(instance.rig.yaw.toFixed(4)),
              pitch: Number(instance.rig.pitch.toFixed(4)),
            };
          })(),
        };
        if (wantsWhaleReport) {
          payload.whales = [...instance.entries.values()]
            .filter((e) => e.whale)
            .map((e) => {
              const w = e.whale;
              return {
                repo: e.repo.name,
                species:
                  (e.repo.whaleSpecies && e.repo.whaleSpecies.id) || null,
                kind: w.sculptKind || "procedural",
                credit: w.sculptCredit || null,
                sculptSize: w.sculptSize
                  ? [
                      Number(w.sculptSize.x.toFixed(2)),
                      Number(w.sculptSize.y.toFixed(2)),
                      Number(w.sculptSize.z.toFixed(2)),
                    ]
                  : null,
                bodyLength: Number(w.length.toFixed(2)),
                girth: Number(w.girth.toFixed(2)),
                nodes: (() => {
                  let n = 0;
                  w.group.traverse(() => n++);
                  return n;
                })(),
                // Live placement, so a "whale is missing" report can be checked
                // against geometry instead of guessed from pixels.
                position: [
                  Number(w.group.position.x.toFixed(1)),
                  Number(w.group.position.y.toFixed(1)),
                  Number(w.group.position.z.toFixed(1)),
                ],
                visible: w.group.visible,
                // Baked world scale of the body. If this is far from 1 the
                // animal is being drawn at the wrong size and a "no whale"
                // report is a scale bug, not a position bug.
                worldScale: (() => {
                  const sc = new (w.group.position.constructor)();
                  w.group.getWorldScale(sc);
                  return [
                    Number(sc.x.toFixed(3)),
                    Number(sc.y.toFixed(3)),
                    Number(sc.z.toFixed(3)),
                  ];
                })(),
                worldQuat: (() => {
                  const q = w.group.quaternion.clone();
                  w.group.getWorldQuaternion(q);
                  return [
                    Number(q.x.toFixed(3)),
                    Number(q.y.toFixed(3)),
                    Number(q.z.toFixed(3)),
                    Number(q.w.toFixed(3)),
                  ];
                })(),

                // Whether the load-time re-centring actually ran, and what it
                // measured. Three different correction formulas produced byte-
                // identical rendered offsets, which is only possible if the
                // block never executed — so the census now reports it rather
                // than leaving it to be inferred from pixels.
                recentre: (() => {
                  const r = w.sculpt && w.sculpt.userData
                    ? w.sculpt.userData.recentre
                    : null;
                  if (!r) return null;
                  // The record's shape changed when the correction was
                  // rewritten to measure in world space and parent first.
                  // Both shapes are reported so a stale build cannot make the
                  // field silently vanish and be read as "the block never ran".
                  const n = (v) => (Array.isArray(v) ? v.map(Number) : v);
                  return {
                    sampled: r.sampled,
                    centre: n(r.centre) || null,
                    before: n(r.before) || null,
                    after: n(r.after) || null,
                    lo: n(r.lo) || null,
                    hi: n(r.hi) || null,
                    localCentre: n(r.localCentre) || null,
                  };
                })(),
                sculptChildWorld: (() => {
                  if (!w.sculpt) return null;
                  const sc = new (w.group.position.constructor)();
                  const pos = new (w.group.position.constructor)();
                  w.sculpt.getWorldScale(sc);
                  w.sculpt.getWorldPosition(pos);
                  // The node INSIDE the wrapper too. `sculpt` is the wrapper;
                  // the uniform normalization scale lives on its child. Reporting
                  // only the wrapper is what hid a 10.5x under-scaling for
                  // several passes: the wrapper read (1, 0.38, 1) and looked
                  // plausible, while the actual mesh child was never scaled up
                  // from its 4.6-unit native length.
                  const innerNode = w.sculpt.children && w.sculpt.children[0];
                  if (innerNode) {
                    innerNode.getWorldScale(sc);
                    innerNode.getWorldPosition(pos);
                  }
                  // The mesh's OWN scale, and its geometry's own bounds. A
                  // SkinnedMesh's vertices are displaced on the GPU by the
                  // bone matrices, so `getWorldScale` on the wrapper can look
                  // right while the animal on screen is a fraction of the size:
                  // on this asset the wrapper reported 1.0 where the length
                  // implied 10.5, and the drawn body came out 28 px long instead
                  // of 292. Reading the geometry and the mesh separately is what
                  // separates "scaled wrongly" from "skinned away".
                  // The skinned extent: the range the vertices actually occupy
                  // AFTER the bone matrices, sampled on the GPU's own terms.
                  // three.js computes this into `boundingBox` when asked and
                  // honours `computeBoundingBox()` on a SkinnedMesh, which
                  // applies the bone transforms — unlike a plain Box3 over the
                  // geometry, which stays in bind pose.
                  let skinnedBox = null;
                  w.sculpt.traverse((o) => {
                    if (!o.isSkinnedMesh || skinnedBox) return;
                    o.computeBoundingBox();
                    const bb = o.boundingBox;
                    if (!bb) return;
                    skinnedBox = {
                      min: [Number(bb.min.x.toFixed(2)), Number(bb.min.y.toFixed(2)), Number(bb.min.z.toFixed(2))],
                      max: [Number(bb.max.x.toFixed(2)), Number(bb.max.y.toFixed(2)), Number(bb.max.z.toFixed(2))],
                    };
                  });
                  let meshInfo = null;
                  w.sculpt.traverse((o) => {
                    if (!o.isMesh || meshInfo) return;
                    const g = o.geometry;
                    if (!g) return;
                    if (!g.boundingBox) g.computeBoundingBox();
                    const bb = g.boundingBox;
                    meshInfo = {
                      name: o.name,
                      scale: [
                        Number(o.scale.x.toFixed(3)),
                        Number(o.scale.y.toFixed(3)),
                        Number(o.scale.z.toFixed(3)),
                      ],
                      geomMin: bb
                        ? [Number(bb.min.x.toFixed(2)), Number(bb.min.y.toFixed(2)), Number(bb.min.z.toFixed(2))]
                        : null,
                      geomMax: bb
                        ? [Number(bb.max.x.toFixed(2)), Number(bb.max.y.toFixed(2)), Number(bb.max.z.toFixed(2))]
                        : null,
                    };
                  });
                  return {
                    scale: [Number(sc.x.toFixed(3)), Number(sc.y.toFixed(3)), Number(sc.z.toFixed(3))],
                    position: [
                      Number(pos.x.toFixed(1)),
                      Number(pos.y.toFixed(1)),
                      Number(pos.z.toFixed(1)),
                    ],
                    mesh: meshInfo,
                    skinnedBox,
                  };
                })(),
                // The DEFORMED body bounds, in wrapper space, read from the same
                // CPU skinning the pivot correction uses — not a Box3, which on
                // a SkinnedMesh reports the bind pose and on this rig the bind
                // pose splayed the animal 2.4x wider than the GPU draws it.
                //
                // This exists because `rect` (a projected Box3) and the pixels
                // disagreed for six passes: rect said w=15132 h=8908 behind:true
                // while the body was plainly elsewhere. Anything derived from a
                // Box3 on this asset is a bind-pose number and must not be used
                // to aim a camera or judge a silhouette.
                // World-space AABB of the DRAWN body, straight from three's own
                // skinned box. This replaced a hand-rolled CPU skinning pass
                // that got the spaces wrong three times (see the note in
                // WhaleAssets) and is the only number here that can be trusted
                // to describe what the GPU drew.
                //
                // It was previously named `deformedBounds`; the rename is
                // deliberate, because the old name referred to a record shape
                // that no longer exists and two other blocks still guarded on
                // `r.lo`, which is now undefined and threw
                // "Cannot read properties of undefined (reading '0')" once a
                // second from inside Vector3.fromArray.
                drawnBounds: (() => {
                  if (!w.sculpt) return null;
                  const b = new THREE.Box3();
                  w.sculpt.traverse((o) => {
                    if (!o.isSkinnedMesh || !o.geometry) return;
                    o.computeBoundingBox();
                    const bb = o.boundingBox;
                    if (!bb || !isFinite(bb.min.x)) return;
                    b.union(bb.clone().applyMatrix4(o.matrixWorld));
                  });
                  if (b.isEmpty()) return null;
                  const s = new THREE.Vector3();
                  b.getSize(s);
                  return [
                    Number(s.x.toFixed(2)),
                    Number(s.y.toFixed(2)),
                    Number(s.z.toFixed(2)),
                  ];
                })(),
                drawCalls: (() => {
                  // Renderer info is only meaningful right after a frame, so
                  // this is read from the last render rather than recomputed.
                  const info = instance.renderer && instance.renderer.info;
                  return info ? info.render.calls : null;
                })(),
                orbit: (() => {
                  const o = e.whaleOrbit;
                  if (!o) return null;
                  return {
                    cx: Number(o.cx.toFixed(1)),
                    cy: Number(o.y.toFixed(1)),
                    cz: Number(o.cz.toFixed(1)),
                    r: Number(o.r.toFixed(1)),
                    phase: Number(o.phase.toFixed(2)),
                  };
                })(),
                yaw: Number(instance.rig.yaw.toFixed(2)),
                // Where the body centre lands on screen right now.
                screen: (() => {
                  const v = w.group.position.clone();
                  v.y += w.bodyY || 0;
                  v.project(instance.camera);
                  return [
                    Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
                    Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
                    Number(v.z.toFixed(3)),
                  ];
                })(),
                // Authoritative on-screen rect of the sculpt.
                //
                // Measured from the CPU-skinned bounds recorded by
                // normalizeWhale(), NOT from Box3.setFromObject(). On a skinned
                // mesh Box3 reads the BIND pose: on this rig it reports a box
                // 0.19 x 0.39 x 0.10 units against a drawn body 2.18 x 2.71 x
                // 4.64, and a projected rect of w=15132 h=8908 behind:true while
                // the animal was plainly in frame. Six QA passes were sent to
                // inspect empty water because this field was believed.
                //
                // The CPU-skinned bounds are in the same local space as the
                // sculpt's own transform, so they are transformed by the
                // sculpt's matrixWorld and then projected — which is the chain
                // that was missing when the pivot was being fixed.
                rect: (() => {
                  const sculpt = w.sculpt || w.bodyMesh;
                  if (!sculpt) return null;
                  const r = sculpt.userData && sculpt.userData.recentre;
                  // Built from the DRAWN bounds, not from the pivot record.
                  //
                  // The old code reconstructed a box from the recentre record's
                  // `before`/`after` min/max and then translated it by the
                  // measured centre. That reproduced the box correctly in node
                  // and produced x0:-3533 behind:true in the browser, because
                  // the record describes the clone BEFORE it was parented into
                  // the scene — a frame that no longer exists by the time the
                  // census runs. Every number it produced was in dead space.
                  //
                  // The drawn bounds come from three's own skinned box taken
                  // after the clone is in the graph, so they describe the
                  // animal as it actually stands.
                  let b = null;
                  {
                    const bb = new THREE.Box3();
                    const sculpt = w.sculpt || w.bodyMesh;
                    if (sculpt) {
                      sculpt.updateWorldMatrix(true, true);
                      sculpt.traverse((o) => {
                        if (!o.isSkinnedMesh || !o.geometry) return;
                        o.computeBoundingBox();
                        const sb = o.boundingBox;
                        if (!sb || !isFinite(sb.min.x)) return;
                        bb.union(sb.clone().applyMatrix4(o.matrixWorld));
                      });
                      if (!bb.isEmpty()) b = bb;
                    }
                  }
                  if (!b) b = new THREE.Box3().setFromObject(sculpt);
                  if (!b || b.isEmpty()) return null;
                  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
                  for (let i = 0; i < 8; i++) {
                    const v = new THREE.Vector3(
                      i & 1 ? b.max.x : b.min.x,
                      i & 2 ? b.max.y : b.min.y,
                      i & 4 ? b.max.z : b.min.z
                    );
                    v.project(instance.camera);
                    if (v.z > 1) behind = true;
                    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
                    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
                    if (sx < x0) x0 = sx;
                    if (sx > x1) x1 = sx;
                    if (sy < y0) y0 = sy;
                    if (sy > y1) y1 = sy;
                  }
                  return {
                    x0: Math.round(x0), y0: Math.round(y0),
                    x1: Math.round(x1), y1: Math.round(y1),
                    w: Math.round(x1 - x0), h: Math.round(y1 - y0),
                    behind,
                  };
                })(),
                // Distance from the lens, which is what decides apparent size.
                distance: Number(
                  instance.camera.position.distanceTo(w.group.position).toFixed(1)
                ),
                // A QA pass needs one stable frame: the screenshot and the
                // census are separate page loads, and the orbit moves between
                // them, so the reported position would not be the pixels.
                childMeshes: (() => {
                  const out = [];
                  w.group.traverse((o) => {
                    if (!o.isMesh && !o.isSkinnedMesh) return;
                    const m = Array.isArray(o.material) ? o.material[0] : o.material;
                    out.push({
                      name: o.name || o.type,
                      visible: o.visible,
                      type: m ? m.type : null,
                      hasMap: !!(m && m.map),
                      opacity: m ? m.opacity : null,
                      transparent: m ? !!m.transparent : null,
                    });
                  });
                  return out;
                })(),
              };
            });
        } else if (wantsFaunaReport) {
          // Census of every tower that actually built Legacy fauna.
          payload.fauna = [...instance.entries.values()]
            .filter((e) => e.legacy)
            .map((e) => {
              const l = e.legacy;
              let nodes = 0;
              l.group.traverse(() => nodes++);
              return {
                repo: e.repo.name,
                creatures: [
                  l.brainCoral && "brainCoral",
                  l.anemone && "anemone",
                  l.isopod && "isopod",
                  (l.urchins || 0) > 0 && `urchins:${l.urchins}`,
                  (l.copepods || 0) > 0 && `copepods:${l.copepods}`,
                  l.featherStar && "featherStar",
                  (l.amphipods || 0) > 0 && `amphipods:${l.amphipods}`,
                  l.barnacleRing && "barnacleRing",
                  l.sponge && "sponge",
                  l.parrotfish && "parrotfish",
                  l.seahorse && "seahorse",
                  l.grouper && "grouper",
                  l.cleanerWrasse && "cleanerWrasse",
                  (l.coralPolyp || []).length > 0 && `coralPolyp:${l.coralPolyp.length}`,
                  (l.lanternfish || []).length > 0 && `lanternfish:${l.lanternfish.length}`,
                  (l.nudibranch || []).length > 0 && `nudibranch:${l.nudibranch.length}`,
                  l.baskingShark && "baskingShark",
                  l.anglerfish && "anglerfish",
                ].filter(Boolean),
                animated: l.animated.length,
                nodes,
              };
            });
        } else if (instance.floor) {
          // Guarded: `?only=whale` skips the seafloor entirely, so there is no
          // floor to report on. Unguarded this threw inside the census interval
          // and the report node came back empty — which reads exactly like a
          // world that failed to build, and cost a capture to diagnose.
          payload.rocks = instance.floor.rockReport(
            instance.camera,
            el.clientWidth,
            el.clientHeight
          );
        }
        // Frame budget. Only populated when the profiler was switched on, so
        // an ordinary census costs one property read.
        if (liveIssuesRef.current.length) {
          payload.liveIssues = liveIssuesRef.current.slice();
        }
        if (wantsPerfReport) {
          payload.perf = instance.profiler.report();
          // Without the renderer name a frame rate is unreadable: software
          // rasterisation and a real GPU differ by an order of magnitude, and
          // only one of them is the user's experience.
          payload.renderer = instance.rendererName || "unknown";
          // The governor's state, when it is running. Reporting it under the
          // same switch as the profiler is what makes "is this slow?" a single
          // answerable question: the interval, the renderer behind it, and what
          // the scene did about it.
          if (instance.governor) {
            payload.quality = instance.governor.report();
            payload.pixelRatio = instance.renderer.getPixelRatio();
            payload.shadowMap = instance.renderer.shadowMap.enabled;
          }
          // What the renderer actually drew, for the same frame.
          payload.render = {
            calls: instance.renderer.info.render.calls,
            triangles: instance.renderer.info.render.triangles,
            points: instance.renderer.info.render.points,
            lines: instance.renderer.info.render.lines,
            geometries: instance.renderer.info.memory.geometries,
            textures: instance.renderer.info.memory.textures,
            programs:
              (instance.renderer.info.programs || []).length,
          };
        }
        node.textContent = JSON.stringify(payload);
      };
      emit();
      debugTimer = setInterval(emit, 1000);
    }

    // --- the live pass -------------------------------------------------
    //
    // Deliberately not awaited by the effect. The world is already drawn from
    // mock data by the time this runs, so the user sees an ocean immediately and
    // the real numbers arrive into it — the reverse of blocking on a spinner.
    //
    // Gated on `?mock=1` for two reasons: the QA harness wants a reproducible
    // world with no network in it, and a screenshot pass that silently picked up
    // live data would not be comparable between runs.
    //
    // An unauthenticated request is the default. GitHub allows 60 an hour and
    // that is enough to prove the seam works; a signed-in user gets 5,000 and
    // the second pass, which costs six requests per repository.
    const params = new URLSearchParams(window.location.search);
    const skipLive = params.get("mock") === "1";

    // Failures worth seeing outside the devtools. The console is not readable in
    // a screenshot pass, and a failed fetch is invisible in the picture: the
    // world falls back to mock data and looks correct. Collected here and put in
    // the census when one is being emitted.
    window.__GO_REPORT = (line) => {
      const list = liveIssuesRef.current;
      list.push(line);
      if (list.length > 40) list.shift();
    };
    let cancelled = false;

    if (!skipLive) {
      const owner =
        params.get("owner") || instance.data.you.username || "anubhavaanand";
      const names = instance.data.yourRepos.map((r) => r.name);
      const enrich = params.get("enrich") !== "0";

      setDataState({ stage: "first", done: 0, total: names.length });

      loadProfile({
        owner,
        repos: names,
        enrich,
        onStage: (stage, detail) => {
          if (cancelled) return;
          setDataState({ stage, done: detail.done || 0, total: detail.total || names.length });
        },
      })
        .then((profile) => {
          if (cancelled) return;
          const result = instance.adoptProfile(profile.repos);
          // Reported, not hidden: a repository the API returned that the world
          // had no tower for is a real difference between the mock set and the
          // real profile, and it is the kind of thing that should be visible
          // rather than quietly dropped.
          setDataState({
            stage: "ready",
            updated: result.updated.length,
            skipped: result.skipped,
            errors: profile.errors || [],
            enriched: enrich,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          // A failed live pass is not a broken world. The ocean is still there
          // and still correct about what it knows; it is only mocked.
          console.warn("[git-ocean] live data failed, staying on the mock world", err);
          setDataState({ stage: "failed", error: String(err && err.message || err) });
        });
    }

    return () => {
      cancelled = true;
      if (debugTimer) clearInterval(debugTimer);
      if (window.__GO_REPORT) delete window.__GO_REPORT;
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
      instance.dispose();
      worldRef.current = null;
    };
  }, []);

  // --- HUD actions -------------------------------------------------------

  const handleLevelPick = useCallback((index) => {
    const w = worldRef.current;
    if (!w) return;
    w.rig.goTo(index);
    const level = w.rig.levels[index];
    if (level) setLevelId(level.id);
  }, []);

  const handleCloseCard = useCallback(() => {
    setSelectedRepo(null);
    const w = worldRef.current;
    if (w) w.select(null);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedRepo(null);
  }, []);

  /**
   * Fly to a repository, fetching its real numbers if it is not in the world yet.
   *
   * The mock set covers four of the user's repositories and three followed
   * accounts, so a fly-to from search or a deep link usually names something the
   * scene has never drawn. Selecting an id that is not in `entries` clears the
   * selection and moves nothing, which reads as a broken button. So the record is
   * fetched first and a tower is added for it.
   */
  const handleFlyTo = useCallback(async (repoId) => {
    const w = worldRef.current;
    if (!w) return;

    // Already standing: select and frame it. This is the common case and must
    // not wait on a network round trip.
    if (w.entries.has(repoId)) {
      w.select(repoId);
      w.focusSelected(3);
      setLevelId("tower");
      return;
    }

    // `repoId` is the world id, which the first pass builds as `owner/name` —
    // see `apiToWorldRepo`. Split on the first slash only, because a repository
    // name cannot contain one but an owner cannot either.
    const cut = String(repoId).indexOf("/");
    if (cut < 1) return;
    const owner = String(repoId).slice(0, cut);
    const name = String(repoId).slice(cut + 1);

    setDataState({ stage: "fetching", repo: `${owner}/${name}` });
    try {
      const record = await loadOne(owner, name, { enrich: false });
      if (!record) {
        setDataState({ stage: "failed", error: `${owner}/${name} could not be loaded` });
        return;
      }
      const added = w.addTower(record);
      if (!added) {
        // It arrived between the check and the fetch; selecting is correct now.
        w.select(record.id);
      } else {
        w.select(record.id);
      }
      w.focusSelected(3);
      setLevelId("tower");
      setDataState({ stage: "ready", added: `${owner}/${name}` });
    } catch (err) {
      setDataState({ stage: "failed", error: String((err && err.message) || err) });
    }
  }, []);

  return (
    <div className="go-root">
      <div ref={containerRef} className="go-canvas" />

      <HUD
        world={world}
        levels={ZOOM_LEVELS}
        activeLevelId={levelId}
        onLevelChange={handleLevelPick}
        selectedRepo={selectedRepo}
        dataState={dataState}
        onClearSelection={handleCloseCard}
        onDismiss={handleClearSelection}
        onFlyTo={handleFlyTo}
      />

      {loading && (
        <div className="go-loading" role="status" aria-live="polite">
          <div className="go-loading-mark" aria-hidden="true">
            ◈
          </div>
          <div className="go-loading-text">Flooding the basin…</div>
        </div>
      )}

      {error && (
        <div className="go-error" role="alert">
          <h2>WebGL could not start</h2>
          <p>{error}</p>
          <p className="go-hint">
            Git Ocean needs WebGL 2. Try a different browser, or enable hardware
            acceleration.
          </p>
        </div>
      )}
    </div>
  );
}