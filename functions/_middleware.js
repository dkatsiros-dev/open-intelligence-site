// Login gate for the whole site (static pages, assets and functions).
// Public: the login page, the login/logout/waitlist APIs, swarm.js (the login background),
// favicon and robots.txt.
// Everything else needs a valid oi_session cookie (see _shared/session.js): without one,
// /api/* answers 401 JSON and pages redirect to /login?next=<path>. Gated responses are
// marked private/no-store and noindex.

import { COOKIE, verify, readCookie, json } from "./_shared/session.js";

const PUBLIC = new Set(["/login", "/login.html", "/api/login", "/api/logout", "/api/waitlist", "/swarm.js", "/favicon.svg", "/robots.txt"]);

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (PUBLIC.has(url.pathname)) return next();

  const user = await verify(readCookie(request, COOKIE), env.SESSION_SECRET);
  if (!user) {
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "unauthorized" }, 401, { "x-robots-tag": "noindex" });
    }
    const to = "/login?next=" + encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { location: to, "cache-control": "private, no-store", "x-robots-tag": "noindex" }
    });
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "private, no-store");
  out.headers.set("x-robots-tag", "noindex");
  return out;
}
