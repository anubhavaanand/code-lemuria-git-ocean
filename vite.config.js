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
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 3000,
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