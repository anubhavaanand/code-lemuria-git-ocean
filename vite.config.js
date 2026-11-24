import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Relative base is required, not cosmetic.
 *
 * The app is served from a GitHub Pages project path
 * (/code-lemuria-git-ocean/), not a domain root. Vite defaults to absolute
 * asset URLs ("/assets/..."), which resolve against the host root and 404 on
 * a project path. "./" makes the built index.html reference its own siblings,
 * so the same dist/ works at a domain root, a project path, or from the
 * filesystem.
 */
/**
 * Where the OAuth worker runs during development.
 *
 * In production the SPA and the worker share an origin (a Pages function or a
 * Cloudflare route), so `fetch("/api/auth/token")` is a relative call. In dev
 * they do not: Vite serves the app on :3000 and `wrangler dev` serves the
 * worker on :8787, so that same relative path 404s and sign-in cannot be tested
 * locally at all. Proxying `/api` is what makes the dev path the same shape as
 * the deployed one, rather than a second code path that only exists in dev.
 *
 * Override with `VITE_WORKER_URL` if wrangler lands on another port.
 */
const WORKER_URL = process.env.VITE_WORKER_URL || "http://127.0.0.1:8787";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: WORKER_URL,
        changeOrigin: false,
        // The auth cookie is HttpOnly and scoped to /auth on the worker. The
        // browser only sends it back on a path it can see, so the proxy must not
        // rewrite the path — it forwards /api/auth/* verbatim.
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    // Sourcemaps are useful for debugging the visual work (shader errors in
    // particular are painful to trace without them) but they are ~3.5 MB of
    // noise on Pages. Ship them only when explicitly asked for.
    sourcemap: process.env.SOURCE_MAP === "1",
    // three.js is most of the bundle and does not split usefully — the whole
    // scene graph is needed on first paint. Raise the warning threshold rather
    // than pretending the chunk can be hidden.
    chunkSizeWarningLimit: 900,
  },
});