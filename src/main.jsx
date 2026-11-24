import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AuthCallback from "./ui/AuthCallback.jsx";
import "./index.css";

/**
 * Two routes on one page.
 *
 * `/auth/callback` is the OAuth redirect target. It has to exist as a real route
 * and not just as a handler inside the app: GitHub redirects the browser there
 * with `?code=...`, and if nothing claims that path the visitor lands on the
 * normal ocean with a stray query string and never gets signed in — which is
 * exactly what happened while `auth.js` had no caller at all.
 *
 * A hand-rolled path check rather than a router: the app has two routes and a
 * dependency whose only job is to pick between them would be larger than the
 * logic it replaces.
 */
const isCallbackRoute =
  typeof window !== "undefined" &&
  window.location.pathname.replace(/\/+$/, "").endsWith("/auth/callback");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isCallbackRoute ? <AuthCallback /> : <App />}
  </React.StrictMode>
);
