# Open Intelligence — public site

Static site and whitepaper for **Open Intelligence**, a distributed network where volunteers run nodes that
lease work, solve it locally, check it with a deterministic verifier and return signed results.

Live at **https://open-intelligence.space** (whitepaper: [/whitepaper.html](https://open-intelligence.space/whitepaper.html)).

## Contents

- `index.html`, `styles.css`, `app.js` — landing page; `app.js` reads live network stats from
  `https://api.open-intelligence.space`.
- `swarm.js` — WebGL background animation (disabled for reduced motion).
- `whitepaper.html` — the whitepaper.
- `login.html`, `functions/` — the login gate and the waitlist (Cloudflare Pages Functions).
- `scripts/waitlist_export.sh` — prints the waitlist as CSV.

No build step and no external assets: the files are served as-is.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy (Cloudflare Pages)

Hosted on Cloudflare Pages, project `open-intelligence` (config in `wrangler.toml`).

```sh
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy . --project-name open-intelligence --branch main
```

## How the waitlist works

The login page (`/login`) is public and has a waitlist form that posts to a Pages Function,
`functions/api/waitlist.js`. The function checks the email address, drops bots that fill the hidden
honeypot field, refuses requests from other origins and allows at most 5 sign-ups per IP per hour
(counted in KV under a hashed IP that expires after two hours; IPs themselves are never stored).
Each address is stored once in the Cloudflare KV namespace `OI_WAITLIST` under the key
`email:<address>`, with the sign-up time, the optional note, the browser user agent and a short IP
hash; signing up again changes nothing and answers `{"status": "already"}`. A second key,
`by_ts:<time>:<hash>`, keeps the list in sign-up order. `scripts/waitlist_export.sh` prints the
whole list as CSV through the Cloudflare API (it reads `CF_API_TOKEN` and `CF_ACCOUNT_ID` from the
environment). No third-party service sees the addresses. To delete an entry, remove both of its keys,
e.g. `npx wrangler kv key delete --namespace-id <id> "email:<address>" --remote` and the same for
the `index_key` column of the export.

## Changelog rule

Every commit updates [CHANGELOG.md](CHANGELOG.md): one bullet per change under `## Unreleased` (or
today's dated section), with the short hash where known. The pre-commit hook in
`scripts/git-hooks/pre-commit` rejects commits that stage files without touching CHANGELOG.md; install it
once per clone with `sh scripts/install-hooks.sh`.

## Related

- Main project (coordinator, node library and CLI): `github.com/dkatsiros-dev/open-intelligence`
  (private during Phase A).
- Questions and feedback: [issues](https://github.com/dkatsiros-dev/open-intelligence-site/issues).

## License

MIT — see [LICENSE](LICENSE).
