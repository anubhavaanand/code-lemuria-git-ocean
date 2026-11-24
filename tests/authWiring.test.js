import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The sign-in flow has to be reachable and has to be safe.
 *
 * `auth.js` implemented the whole OAuth exchange and nothing called it — no
 * button, no callback route, no dev proxy for the worker — so the ocean was
 * anonymous-only and the API layer looked finished while being unreachable. The
 * tests here pin the two things the wiring got wrong before this branch:
 *
 *   1. Sign-in went straight to GitHub with a **constant** `state`, which is
 *      not a CSRF token. It must go through the worker, which mints a real one.
 *   2. Only the mock repository names were ever requested, so a signed-in user
 *      was shown their own numbers for whatever names this repo happened to
 *      mock and a 404 for everything else.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { startSignIn } = await import("../src/services/auth");
const { isAuthenticated, getToken, setToken, clearToken } = await import(
  "../src/services/github-api"
);

describe("sign-in wiring", () => {
  beforeEach(() => {
    store.clear();
    globalThis.window = { location: { pathname: "/", search: "" } };
  });

  it("routes sign-in through the worker, not straight to GitHub", () => {
    const url = startSignIn();
    expect(url).toContain("/api/auth/start");
    // The dead path: a direct authorize URL carries a hard-coded state, which
    // the exchange must reject and which protects nothing.
    expect(url).not.toContain("github.com/login/oauth/authorize");
  });

  it("asks for the callback as the redirect back", () => {
    const url = startSignIn();
    expect(url).toContain("redirect=");
    expect(decodeURIComponent(url)).toContain("/auth/callback");
  });

  it("keeps the app's base path, so Pages and a domain root both work", () => {
    globalThis.window = { location: { pathname: "/code-lemuria-git-ocean/", search: "" } };
    const url = startSignIn();
    expect(url.startsWith("/code-lemuria-git-ocean/api/auth/start")).toBe(true);
  });

  it("refuses to build a URL where there is no window", () => {
    const win = globalThis.window;
    delete globalThis.window;
    expect(startSignIn()).toBeNull();
    globalThis.window = win;
  });

  it("reports signed-out until a token is stored, and signed-in after", () => {
    expect(isAuthenticated()).toBe(false);
    setToken("gho_test_token");
    expect(isAuthenticated()).toBe(true);
    expect(getToken()).toBe("gho_test_token");
    clearToken();
    expect(isAuthenticated()).toBe(false);
  });

  it("treats blocked storage as signed-out instead of throwing", () => {
    // A private window or a sandboxed iframe: reading the token throws. That is
    // not a reason to fail the load, only to draw the anonymous world.
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => isAuthenticated()).not.toThrow();
    expect(isAuthenticated()).toBe(false);
    globalThis.localStorage = real;
  });
});
