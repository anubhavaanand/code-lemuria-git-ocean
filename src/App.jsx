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
import { OceanWorld } from "./world/OceanWorld";
import { ZOOM_LEVELS } from "./world/constants";
import HUD from "./ui/HUD";
import "./index.css";

export default function App() {
  const containerRef = useRef(null);
  const worldRef = useRef(null);

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

  useEffect(() => {
    if (!containerRef.current) return;

    let instance;
    try {
      instance = new OceanWorld(containerRef.current, {
        onSelect: (repo) => setSelectedRepo(repo),
        onLevelChange: (level) => setLevelId(level.id),
        onReady: () => setLoading(false),
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
      instance.rig.t = start;
      instance.rig.apply(0, true, null);
    }

    // Debug/QA handle: lets a headless browser drive zoom levels and read the
    // camera state so visual regressions can be caught without a human.
    if (typeof window !== "undefined") {
      window.__GO = {
        world: instance,
        rig: instance.rig,
        goTo: (i) => instance.rig.goTo(i),
        select: (id) => instance.select(id),
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
    const wantsRockReport =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "rocks";
    if (wantsRockReport) {
      const emit = () => {
        const el = containerRef.current;
        if (!el) return;
        const rep = instance.floor.rockReport(
          instance.camera,
          el.clientWidth,
          el.clientHeight
        );
        let node = document.getElementById("go-rock-report");
        if (!node) {
          node = document.createElement("pre");
          node.id = "go-rock-report";
          document.body.appendChild(node);
        }
        node.textContent = JSON.stringify({
          level: instance.rig.levelId,
          camera: [
            Number(instance.camera.position.x.toFixed(0)),
            Number(instance.camera.position.y.toFixed(0)),
            Number(instance.camera.position.z.toFixed(0)),
          ],
          rocks: rep,
        });
      };
      emit();
      debugTimer = setInterval(emit, 1000);
    }

    return () => {
      if (debugTimer) clearInterval(debugTimer);
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

  const handleFlyTo = useCallback((repoId) => {
    const w = worldRef.current;
    if (!w) return;
    w.select(repoId);
    w.focusSelected(3); // tower level
    setLevelId("tower");
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