/**
 * Git Ocean — Auth Service
 * GitHub OAuth2 flow for Phase 1 personal dashboard.
 *
 * OAuth flow:
 *   1. User clicks "Connect GitHub" → redirected to GitHub authorization URL
 *   2. GitHub redirects back with a code → /auth/callback
 *   3. Exchange code for access token (server-side, via Cloudflare Worker)
 *   4. Token stored in localStorage, used for API requests
 *
 * Per Constitution Principle: every element scientifically explainable.
 * OAuth is a standard, well-documented protocol — no magic here.
 */

import {
  getOAuthUrl,
  isAuthenticated,
  getToken,
  setToken,
  clearToken,
  GITHUB_AUTH_CONFIG,
} from "./github-api";

const TOKEN_KEY = "git-ocean:token";
const USER_KEY = "git-ocean:user";

/**
 * Auth state holder. In a real app this would be React context or a store.
 */
class AuthService {
  constructor() {
    this.token = getToken();
    this.user = null;
    this.listeners = [];
  }

  /**
   * Subscribe to auth state changes.
   */
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Notify all listeners of auth state change.
   */
  notify() {
    this.listeners.forEach((cb) => cb(this.isAuthenticated(), this.user));
  }

  /**
   * Check if the user is authenticated.
   */
  isAuthenticated() {
    return !!this.token;
  }

  /**
   * Get the current user profile (if loaded).
   */
  getUser() {
    return this.user;
  }

  /**
   * Get the OAuth authorization URL for redirecting the user.
   */
  getLoginUrl() {
    return getOAuthUrl();
  }

  /**
   * Initiate login by redirecting to GitHub OAuth.
   */
  login() {
    const url = this.getLoginUrl();
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
    return url;
  }

  /**
   * Handle OAuth callback — extract code from URL and exchange for token.
   * This is called on the /auth/callback route.
   *
   * @param code - The authorization code from GitHub
   * @returns Promise resolving to true if token was stored
   */
  async handleCallback(code) {
    if (!code) {
      throw new Error("No authorization code provided");
    }

    try {
      // Exchange code for token via our backend (Cloudflare Worker endpoint)
      // The backend handles CLIENT_SECRET securely — never expose it to the browser
      const token = await this.exchangeCodeForToken(code);

      this.token = token;
      setToken(token);
      localStorage.setItem(TOKEN_KEY, token);

      // Fetch user profile
      await this.loadUser();

      this.notify();
      return true;
    } catch (error) {
      console.error("OAuth callback failed:", error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token.
   * Calls the backend token exchange endpoint (keeps CLIENT_SECRET server-side).
   */
  async exchangeCodeForToken(code) {
    const tokenExchangeUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/auth/token`
        : "/api/auth/token";

    const response = await fetch(tokenExchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token exchange failed ${response.status}: ${errorText.slice(0, 200)}`
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error("No access token in response");
    }

    return data.access_token;
  }

  /**
   * Load the authenticated user's profile from GitHub API.
   */
  async loadUser() {
    if (!this.token) return null;

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub user API error ${response.status}`);
      }

      const userData = await response.json();

      this.user = {
        login: userData.login,
        name: userData.name,
        avatarUrl: userData.avatar_url,
        location: userData.location,
        bio: userData.bio,
        company: userData.company,
        publicRepos: userData.public_repos,
        followers: userData.followers,
        following: userData.following,
        createdAt: userData.created_at,
        htmlUrl: userData.html_url,
      };

      localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      return this.user;
    } catch (error) {
      console.error("Failed to load user profile:", error);
      return null;
    }
  }

  /**
   * Logout — clear token and user data.
   */
  logout() {
    this.token = null;
    this.user = null;
    clearToken();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.notify();

    // Redirect to home
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }

  /**
   * Initialize auth from stored state (called on app mount).
   */
  init() {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedToken) {
      this.token = storedToken;
    }
    if (storedUser) {
      try {
        this.user = JSON.parse(storedUser);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
}

// Singleton instance
export const auth = new AuthService();

/**
 * React hook-friendly auth state checker.
 * Returns { isAuthenticated, user, login, logout }.
 */
export function useAuth() {
  return {
    isAuthenticated: auth.isAuthenticated(),
    user: auth.getUser(),
    login: () => auth.login(),
    logout: () => auth.logout(),
    subscribe: auth.subscribe.bind(auth),
  };
}
