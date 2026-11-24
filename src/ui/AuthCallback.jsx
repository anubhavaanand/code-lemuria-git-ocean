/**
 * Git Ocean — the OAuth redirect target
 *
 * GitHub sends the browser back here with `?code=...&state=...` after the user
 * approves. This page's only job is to hand that code to the worker, store the
 * token and leave.
 *
 * It is deliberately its own screen rather than part of the ocean: the exchange
 * is one round trip that either works or does not, and dressing it as a loading
 * ocean would be a lie the moment it failed. The failure state says what failed
 * and gives a way back, because a dead end after granting access is worse than
 * not having a button.
 */

import React, { useEffect, useState } from "react";
import { auth } from "../services/auth";

const STATUS = {
  WORKING: "working",
  DONE: "done",
  FAILED: "failed",
};

export default function AuthCallback() {
  const [status, setStatus] = useState(STATUS.WORKING);
  const [detail, setDetail] = useState("Exchanging the code for a token…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const denied = params.get("error");

    // The user pressed Cancel on GitHub's consent screen. That is a decision,
    // not an error, and it must not read as a broken app.
    if (denied) {
      setStatus(STATUS.FAILED);
      setDetail(
        params.get("error_description") || "Access was cancelled on GitHub."
      );
      return;
    }

    if (!code) {
      setStatus(STATUS.FAILED);
      setDetail("This page was reached without an authorization code.");
      return;
    }

    let cancelled = false;
    auth
      .handleCallback(code)
      .then(() => {
        if (cancelled) return;
        setStatus(STATUS.DONE);
        setDetail("Signed in. Returning to the ocean…");
        // `replace`, not `assign`: the callback URL carries a spent code, and
        // leaving it in the history means Back returns to a page that can only
        // fail the exchange a second time. The query is dropped with the path —
        // `?code=` and `?state=` are both dead once the token is stored.
        //
        // The root is the app's base, which on Pages is the project path. It is
        // derived from the path rather than written as "/" so the same build
        // works at a domain root and under `/code-lemuria-git-ocean/`.
        const home =
          window.location.pathname.replace(/\/auth\/callback\/?$/, "") || "/";
        window.location.replace(home);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(STATUS.FAILED);
        setDetail(err && err.message ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="go-authpage">
      <div className="go-authcard" role="status" aria-live="polite">
        <div className="go-brand">
          <span className="go-brand-mark" aria-hidden="true">
            ◈
          </span>
          <span className="go-brand-text">
            Git<span>Ocean</span>
          </span>
        </div>

        <h1 className="go-auth-title">
          {status === STATUS.WORKING && "Signing in"}
          {status === STATUS.DONE && "Signed in"}
          {status === STATUS.FAILED && "Could not sign in"}
        </h1>

        <p className="go-auth-detail">{detail}</p>

        {status === STATUS.FAILED && (
          <a className="go-btn" href="./">
            Return to the ocean
          </a>
        )}

        {status === STATUS.WORKING && (
          <div className="go-auth-spinner" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
