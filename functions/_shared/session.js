// Session cookie shared by _middleware.js and api/login.js.
// oi_session = base64url(JSON {u, exp}) "." base64url(HMAC-SHA256(payload, SESSION_SECRET)).
// exp is a unix time in seconds, 30 days after login (not rolling). Rotating SESSION_SECRET
// logs everyone out.

export const COOKIE = "oi_session";
export const MAX_AGE = 30 * 24 * 3600;

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function sign(user, secret) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })));
  return payload + "." + b64url(await hmac(secret, payload));
}

// Returns the user name for a valid, unexpired token, else null.
export async function verify(token, secret) {
  if (!token || !secret) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    if (!equalBytes(unb64url(sig), await hmac(secret, payload))) return null;
    const { u, exp } = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (typeof u !== "string" || typeof exp !== "number" || exp * 1000 < Date.now()) return null;
    return u;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
