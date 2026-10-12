# Changelog

Notable changes to the public site, newest first ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style).
Every commit adds a line here (see README, "Changelog rule").

## Unreleased

## 2026-10-13

### Changed
- Swarm background drawn as a crisp graph: solid antialiased 2.2–3.4 px nodes at ~0.92 alpha, 1 px k-nearest-neighbour edges (k=3) at 0.42 alpha in every formation, morphing with the nodes; 1,000 points (was 2,400), soft glow removed.

### Added
- CHANGELOG.md, the changelog rule in README, and a versioned pre-commit hook (`scripts/git-hooks/pre-commit`, install with `scripts/install-hooks.sh`).

## 2026-10-12

### Added
- Public site and whitepaper: landing page with live network stats, scroll-driven WebGL swarm confined to a right-hand box, whitepaper draft v0.1, Cloudflare Pages config (c42eb82).
