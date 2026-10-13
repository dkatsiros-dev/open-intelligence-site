// Cloudflare Pages Function: /api/waitlist (public; the login gate lets it through)
//   GET  -> {open: bool}  (true when a store is configured)
//   POST {email, note?, website?} -> {ok: true} | {ok: false, error}
// Stores, first one configured wins:
//   - KV namespace bound as OI_WAITLIST (wrangler.toml), one key per address,
//     "email:<address>" -> {email, note, ts, ua}.
//   - GitHub issues in the private repo WAITLIST_REPO, created with the WAITLIST_GH_TOKEN secret:
//     title "waitlist: <address>", body = note, ts, ua, ip hash. Deduped by a title search first.
// Rate limit: MAX_PER_HOUR posts per IP per hour, counted per isolate and (with KV) in KV under
// "rl:<sha256(ip) prefix>:<hour>" (IPs are not stored).
// Same-origin only: no CORS headers, and a foreign Origin is refused.

const WAITLIST_REPO = "dkatsiros-dev/open-intelligence-waitlist";
const MAX_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const hits = new Map();

export function onRequestGet({ env }) {
  return json({ open: Boolean(env.OI_WAITLIST || env.WAITLIST_GH_TOKEN) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "forbidden" }, 403);
  const kv = env.OI_WAITLIST;
  const ghToken = env.WAITLIST_GH_TOKEN;
  if (!kv && !ghToken) return json({ ok: false, error: "closed" }, 503);

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

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await limited(kv, ip)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const ua = (request.headers.get("user-agent") || "").slice(0, 300);
  const ts = new Date().toISOString();
  if (kv) {
    const key = "email:" + email;
    if (!(await kv.get(key))) { // first sign-up wins; repeats get the same answer
      await kv.put(key, JSON.stringify({ email, note, ts, ua }));
    }
    return json({ ok: true });
  }
  try {
    await githubAdd(ghToken, email, { note, ts, ua, ip: (await sha256(ip)).slice(0, 16) });
  } catch {
    return json({ ok: false, error: "unavailable" }, 502);
  }
  return json({ ok: true });
}

async function githubAdd(token, email, meta) {
  const title = "waitlist: " + email;
  const q = encodeURIComponent(`repo:${WAITLIST_REPO} is:issue in:title "${email}"`);
  const found = await gh(token, "GET", "/search/issues?per_page=20&q=" + q);
  if ((found.items || []).some((i) => i.title === title)) return; // already on the list
  const body = [
    "note: " + (meta.note || "-"),
    "ts: " + meta.ts,
    "ua: " + (meta.ua || "-"),
    "ip_hash: " + meta.ip
  ].join("\n");
  await gh(token, "POST", `/repos/${WAITLIST_REPO}/issues`, { title, body });
}

async function gh(token, method, path, body) {
  const res = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "open-intelligence-site-waitlist",
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error("github " + res.status);
  return res.json();
}

async function limited(kv, ip) {
  const hour = Math.floor(Date.now() / 3600000);
  const key = "rl:" + (await sha256(ip)).slice(0, 16) + ":" + hour;
  if (hits.size > 5000) hits.clear();
  const local = (hits.get(key) || 0) + 1;
  hits.set(key, local);
  if (local > MAX_PER_HOUR) return true;
  if (!kv) return false;
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
