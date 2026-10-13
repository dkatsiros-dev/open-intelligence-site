# Changelog

Notable changes to the public site, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style).
Every commit adds a line here (see README, "Changelog rule").

## Unreleased

### Security
- Login gate: `functions/_middleware.js` requires a signed `oi_session` cookie (HMAC-SHA256 over {u, exp}, 30 days) for every path except /login, /api/login, /api/logout, /api/waitlist, /favicon.svg and /robots.txt; pages redirect to /login, other /api/* paths answer 401; gated responses are `private, no-store` and `noindex`. `robots.txt` disallows everything.
- `POST /api/login` (PBKDF2-SHA256 user list from a Pages secret, constant-time compare, 10 attempts per IP per 15 min, 1 s delay on failure) and `/api/logout`.

### Added
- `login.html` (served at /login): sign-in form plus a waitlist form (email, honeypot, consent).
- Waitlist store fallback while KV is unbound: one issue per address in a private GitHub repo, deduped by title. `wrangler.toml` lists the secret names (values live only in Cloudflare).

### Fixed
- A failed waitlist write answers 503 JSON instead of 502 (Cloudflare replaced the 502 body with its own error page).

## 2026-10-13

### Added
- "Build it with us" closing call to action before the footer (nav: Contribute): connect a node (invite-only today, join the waitlist) and grow the project (source and open issues here), from open source to open source.
- Waitlist forms in Join and the CTA (email, optional hardware/model, honeypot, consent line), progressive enhancement in `waitlist.js` (no reload). Backend: Pages Function `functions/api/waitlist.js` (validation, 5 posts per IP per hour, same-origin only, KV `OI_WAITLIST`). KV is not bound yet, so the live page shows a "Request an invite" link to a prefilled issue (`.github/ISSUE_TEMPLATE/invite.md`).
- CHANGELOG.md, the changelog rule in README, and a versioned pre-commit hook (`scripts/git-hooks/pre-commit`, install with `scripts/install-hooks.sh`).

### Fixed
- Safari: crisp swarm. WebKit honoured `lineWidth(dpr)` (Chromium clamps to 1), drawing soft 2 device px edges, and the masked full-page WebGL layer was resampled when composited. Edges are 1 device px, the CSS mask is gone, and on wide screens the canvas is placed right of the text columns.
- Text is always readable: every text column sits on a near-opaque white backdrop above the canvas; below 1100px the swarm runs at opacity .35 behind whole content blocks.
- Fast scrolling: the swarm maps scrollY to its formation pair and mix every frame (40 ms smoothing, snaps across sections) instead of chasing it with a ~310 ms lag.

### Changed
- Swarm background drawn as a crisp graph: solid antialiased 2.2–3.4 px nodes at ~0.92 alpha, 1 px k-nearest-neighbour edges (k=3) at 0.42 alpha in every formation, morphing with the nodes; 1,000 points (was 2,400), soft glow removed.

## 2026-10-12

### Added
- Public site and whitepaper: landing page with live network stats, scroll-driven WebGL swarm confined to a right-hand box, whitepaper draft v0.1, Cloudflare Pages config (c42eb82).
