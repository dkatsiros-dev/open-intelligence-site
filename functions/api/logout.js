// POST /api/logout -> 204 and clears the session cookie. GET also works so a plain link can log out.

import { COOKIE } from "../_shared/session.js";

const CLEAR = COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

export function onRequestPost() {
  return new Response(null, { status: 204, headers: { "set-cookie": CLEAR, "cache-control": "no-store" } });
}

export function onRequestGet() {
  return new Response(null, { status: 302, headers: { location: "/login", "set-cookie": CLEAR, "cache-control": "no-store" } });
}
