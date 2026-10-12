// Cloudflare Pages Function: /api/waitlist
//   GET  -> {open: bool}  (the page shows the form only when storage is bound)
//   POST {email, note?, website?} -> {ok: true} | {ok: false, error}
// Storage: KV namespace bound as OI_WAITLIST (wrangler.toml), one key per address,
// "email:<address>" -> {email, note, ts, ua}. Rate limit: MAX_PER_HOUR posts per IP per
// hour, counted per isolate and in KV under "rl:<sha256(ip) prefix>:<hour>" (IPs are not stored).
// Same-origin only: no CORS headers, and a foreign Origin is refused.

const MAX_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const hits = new Map();

export function onRequestGet({ env }) {
  return json({ open: Boolean(env.OI_WAITLIST) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "forbidden" }, 403);
  const kv = env.OI_WAITLIST;
  if (!kv) return json({ ok: false, error: "closed" }, 503);

  let body;
  try {
    body = (request.headers.get("content-type") || "").includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "bad_request" }, 400);
  if (body.website) return json({ ok: true }); // honeypot: look successful, store nothing

  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  const note = String(body.note || "").trim().slice(0, 500);

  if (await limited(kv, request.headers.get("cf-connecting-ip") || "unknown")) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const key = "email:" + email;
  if (!(await kv.get(key))) { // first sign-up wins; repeats get the same answer
    const ua = (request.headers.get("user-agent") || "").slice(0, 300);
    await kv.put(key, JSON.stringify({ email, note, ts: new Date().toISOString(), ua }));
  }
  return json({ ok: true });
}

async function limited(kv, ip) {
  const hour = Math.floor(Date.now() / 3600000);
  const key = "rl:" + (await sha256(ip)).slice(0, 16) + ":" + hour;
  if (hits.size > 5000) hits.clear();
  const local = (hits.get(key) || 0) + 1;
  hits.set(key, local);
  if (local > MAX_PER_HOUR) return true;
  const n = parseInt((await kv.get(key)) || "0", 10) + 1;
  if (n > MAX_PER_HOUR) return true;
  await kv.put(key, String(n), { expirationTtl: 7200 });
  return false;
}

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
