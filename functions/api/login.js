// POST /api/login {username, password} -> 204 + oi_session cookie | 401 | 429.
// Users come from the AUTH_USERS secret: JSON [{u, salt, hash}], salt/hash base64,
// hash = PBKDF2-SHA256(password, salt, 100000 iterations, 32 bytes). Unknown users still pay
// for one derivation, and every failure waits 1 s. Rate limit: MAX_TRIES attempts per IP per
// 15 minutes, counted per isolate (good enough for two accounts).

import { COOKIE, MAX_AGE, sign, unb64url, equalBytes, json } from "../_shared/session.js";

const ITERATIONS = 100000;
const MAX_TRIES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const DUMMY_SALT = new Uint8Array(16);
const tries = new Map();

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "forbidden" }, 403);
  if (!env.AUTH_USERS || !env.SESSION_SECRET) return json({ ok: false, error: "not_configured" }, 503);

  if (limited(request.headers.get("cf-connecting-ip") || "unknown")) {
    return json({ ok: false, error: "rate_limited" }, 429, { "retry-after": "900" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const username = String((body && body.username) || "").trim().toLowerCase().slice(0, 64);
  const password = String((body && body.password) || "").slice(0, 256);

  let users;
  try {
    users = JSON.parse(env.AUTH_USERS);
  } catch {
    return json({ ok: false, error: "not_configured" }, 503);
  }
  const user = Array.isArray(users) ? users.find((x) => x && x.u === username) : null;
  const salt = user ? unb64(user.salt) : DUMMY_SALT;
  const derived = await pbkdf2(password, salt);
  const ok = Boolean(user) && password.length > 0 && equalBytes(derived, unb64(user.hash));

  if (!ok) {
    await new Promise((r) => setTimeout(r, 1000));
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  const token = await sign(user.u, env.SESSION_SECRET);
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`,
      "cache-control": "no-store"
    }
  });
}

function limited(ip) {
  const now = Date.now();
  if (tries.size > 5000) tries.clear();
  const recent = (tries.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  tries.set(ip, recent);
  return recent.length > MAX_TRIES;
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return new Uint8Array(bits);
}

// Standard base64 (python's base64.b64encode); unb64url accepts it after the +/ mapping.
function unb64(s) {
  return unb64url(String(s || "").replace(/=+$/, ""));
}
