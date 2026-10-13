// Cloudflare Pages Function: /api/waitlist (public; the login gate lets it through)
//   GET  -> {open: bool}  (true when the KV namespace is bound)
//   POST {email, note?, website?} -> {ok: true, status: "added" | "already"} | {ok: false, error}
// Store: KV namespace bound as OI_WAITLIST (wrangler.toml).
//   "email:<lowercased address>"         -> {email, note, ts, ua, ip_hash}  (first sign-up wins)
//   "by_ts:<iso ts>:<sha256(email) 12>"  -> address  (time-ordered index for export)
// Delete an entry: remove both keys (scripts/waitlist_export.sh prints them).
// Rate limit: MAX_PER_HOUR posts per IP per hour, counted in KV under "rl:<sha256(ip) 16>:<hour>"
// with a TTL (so it holds across isolates) and per isolate as a fast path. IPs are not stored.
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
  if (body.website) return json({ ok: true, status: "added" }); // honeypot: look successful, store nothing

  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  const note = String(body.note || "").trim().slice(0, 500);

  const ipHash = (await sha256(request.headers.get("cf-connecting-ip") || "unknown")).slice(0, 16);
  try {
    if (await limited(kv, ipHash)) return json({ ok: false, error: "rate_limited" }, 429);

    const key = "email:" + email;
    if (await kv.get(key)) return json({ ok: true, status: "already" });
    const ts = new Date().toISOString();
    const ua = (request.headers.get("user-agent") || "").slice(0, 300);
    await kv.put(key, JSON.stringify({ email, note, ts, ua, ip_hash: ipHash }));
    await kv.put("by_ts:" + ts + ":" + (await sha256(email)).slice(0, 12), email);
  } catch {
    return json({ ok: false, error: "unavailable" }, 503);
  }
  return json({ ok: true, status: "added" });
}

async function limited(kv, ipHash) {
  const key = "rl:" + ipHash + ":" + Math.floor(Date.now() / 3600000);
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
