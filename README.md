# Open Intelligence — public site

Static site and whitepaper for **Open Intelligence**, a distributed network where volunteers run nodes that
lease work, solve it locally, check it with a deterministic verifier and return signed results.

Live at **https://open-intelligence.space** (whitepaper: [/whitepaper.html](https://open-intelligence.space/whitepaper.html)).

## Contents

- `index.html`, `styles.css`, `app.js` — landing page; `app.js` reads live network stats from
  `https://api.open-intelligence.space`.
- `swarm.js` — WebGL background animation (disabled for reduced motion).
- `whitepaper.html` — the whitepaper.

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

## Related

- Main project (coordinator, node library and CLI): `github.com/dkatsiros-dev/open-intelligence`
  (private during Phase A).
- Questions and feedback: [issues](https://github.com/dkatsiros-dev/open-intelligence-site/issues).

## License

MIT — see [LICENSE](LICENSE).
