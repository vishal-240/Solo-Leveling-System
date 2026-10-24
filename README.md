# SYSTEM (Solo Leveling System PWA)
Implements Spec v1.0 (FROZEN). Status: P0 (foundations) and P1 (domain engine) only.
Run: `npm install`, `npm run dev` | Verify: `npm run typecheck && npm test && npm run build` | Preview PWA: `npm run preview`.
Deploy: set Pages source to GitHub Actions; `.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>/` (untested until pushed).
Decisions: SVG-only manifest icon for now; `registerType: 'prompt'` per spec 6.6; engine is pure TypeScript in `src/engine`.
