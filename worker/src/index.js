/**
 * Git Ocean — the token exchange
 *
 * The browser can start an OAuth flow but it cannot finish one. GitHub's token
 * endpoint requires the app's client secret, and a client secret that ships in a
 * Vite bundle is not a secret — `VITE_*` variables are inlined into the JS that
 * every visitor downloads.
 *
 * So this worker exists to hold the one thing the browser must not have. It sees
 * a code, it swaps the code for a token, it hands the token back. It never sees
 * the user's password, it never sees the token again after responding, and it
 * stores nothing.
 *
 * Deployment: `wrangler deploy` (or paste this into the Cloudflare dashboard).
 * Secrets are set with
 *
 *     wrangler secret put GITHUB_CLIENT_ID
 *     wrangler secret put GITHUB_CLIENT_SECRET
 *
 * not by committing them, and not through Vite. In local development the same
 * names come from `.dev.vars`, which is gitignored.
 *
 * Why a worker and not a function in the SPA: the SPA has no server. It is a
 * folder of static files on GitHub Pages. Anything that needs a secret needs a
 * machine that is not the user's browser, and this is the smallest such machine
 * that can exist.
 */

/** Where a browser goes to ask GitHub for permission. */
const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";

/** Where the code is swapped for a token. */
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";

/**
 * CORS: the SPA is on Pages today and on a Cloudflare host after Phase 2.
 *
 * The allow-list is a worker secret, not a literal, because the Pages host and
 * any preview branch get their own origin and hard-coding today's would break
 * every one of them tomorrow.
 *
 * When no list is configured the request's own origin is echoed. That is
 * permissive, and it is deliberate only because this endpoint carries no
 * credentials — the response is a token for a code the caller already holds, and
 * there is no cookie or session for another origin to ride on. If this ever
 * grows a cookie, that fallback must go.
 */
function corsHeaders(origin, env) {
  const allowed = (env && env.ALLOWED_ORIGINS) || "";
  const allow = allowed ? allowed.split(",").map((o) => o.trim()) : [];
  const allowOrigin = allow.length === 0 ? origin : allow.includes(origin) ? origin : allow[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Read one cookie value.
 *
 * Parsed rather than matched with a regex: the value is a UUID and a regex would
 * work, but a cookie header is a list of `k=v` pairs and the next person to add
 * a second cookie should not have to reason about why the regex has a lookahead.
 */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function json(body, status = 200, origin = "", env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin, env) },
  });
}

/**
 * Handle the OAuth callback: POST { code } -> { access_token }.
 *
 * The response is passed through verbatim in shape, because that is the contract
 * src/services/auth.js already codes against (`if (!data.access_token) throw`).
 * Anything extra GitHub returns (scope, token_type) is forwarded rather than
 * dropped, so the client can read what it was actually granted.
 */
async function exchangeCode(request, env, origin) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json", error_description: "Body must be JSON" }, 400, origin, env);
  }

  const code = payload && payload.code;
  if (!code || typeof code !== "string") {
    return json({ error: "invalid_request", error_description: "Missing code" }, 400, origin, env);
  }

  // `state` is the whole CSRF defence. /api/auth/start minted one and set it as
  // an HttpOnly cookie on /auth; the callback must present the same value. Skipping
  // this check makes the endpoint a code-injection oracle: anyone who can get a
  // victim to POST a code they chose can bind an account to that code.
  const expected = readCookie(request.headers.get("Cookie"), "go_state");
  const presented = payload.state;
  if (!expected || !presented || expected !== presented) {
    return json(
      { error: "invalid_state", error_description: "OAuth state missing or mismatched" },
      400,
      origin,
      env
    );
  }

  // The redirect_uri must match the one sent in the authorize request exactly,
  // or GitHub rejects the exchange. It is therefore derived from the request
  // origin rather than hard-coded: the same worker serves localhost and the
  // deployed host.
  const redirectUri = `${origin}/auth/callback`;

  const body = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  // GitHub answers 200 with { error: "bad_verification_code" } for a bad code,
  // so the status alone cannot be trusted. Pass the body through and let the
  // client see the real reason.
  const data = await res.json().catch(() => null);
  if (!data) {
    return json({ error: "bad_gateway", error_description: "GitHub returned a non-JSON response" }, 502, origin, env);
  }
  if (!res.ok || data.error) {
    return json(data, res.ok ? 400 : res.status, origin, env);
  }

  // The state cookie has done its job. Clearing it means a captured response
  // cannot be replayed, and a second tab starting its own flow gets its own.
  const headers = new Headers({
    "Content-Type": "application/json",
    ...corsHeaders(origin, env),
  });
  headers.append("Set-Cookie", "go_state=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(JSON.stringify(data), { status: 200, headers });
}

/**
 * Start the flow: 302 to GitHub with the client id and a state value.
 *
 * `state` is a CSRF token: it is echoed back on the callback and must be checked
 * against what the browser stored. It is stored in a cookie here rather than in
 * the SPA because the SPA cannot set a cookie on this origin.
 */
function beginAuth(request, env, origin) {
  const url = new URL(request.url);
  const redirectPath = url.searchParams.get("redirect") || "/auth/callback";
  const state = crypto.randomUUID();

  const authorize = new URL(GITHUB_AUTHORIZE);
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${origin}${redirectPath}`);
  authorize.searchParams.set("scope", env.GITHUB_SCOPES || "read:user read:org repo");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "true");

  const headers = new Headers({ Location: authorize.toString(), ...corsHeaders(origin, env) });
  // Short-lived, HttpOnly, and scoped to the path the callback lives on. Not
  // SameSite=None: this cookie is only ever read on this origin.
  headers.append(
    "Set-Cookie",
    `go_state=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request, env) {
    const origin = new URL(request.url).origin;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    const url = new URL(request.url);

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return json(
        {
          error: "not_configured",
          error_description:
            "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set as worker secrets",
        },
        500,
        origin,
        env
      );
    }

    if (url.pathname === "/api/auth/start" && request.method === "GET") {
      return beginAuth(request, env, origin);
    }

    if (url.pathname === "/api/auth/token" && request.method === "POST") {
      return exchangeCode(request, env, origin);
    }

    if (url.pathname === "/healthz" && request.method === "GET") {
      // Deliberately does not report whether the secrets are present: an
      // unauthenticated endpoint that confirms a deployment is fully configured
      // is a free reconnaissance result.
      return json({ ok: true }, 200, origin, env);
    }

    return json({ error: "not_found", error_description: url.pathname }, 404, origin, env);
  },
};