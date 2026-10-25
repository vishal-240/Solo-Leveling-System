# SYSTEM — Solo Leveling System PWA

Implements the approved **Solo Leveling System PWA Specification v1.0 (FROZEN)**. Product rules and numeric values are frozen; implementation must not change them without an explicit change request.

**Current implementation status: P0–P6 are implemented and the P6 acceptance checks have been run, including real-browser checks (headless Chromium 131). P7–P10 are not started.** The Quests, Status and Settings screens are still placeholders (P7); History is planned for P8. This is not yet the finished application.

## Run locally

```bash
npm ci
npm run dev
```

Verify the project:

```bash
npm run typecheck
npm test
npm run build
npm run preview
npm run test:browser   # real-browser suite (builds first); needs a Chromium
```

`npm run test:browser` uses Playwright (`playwright-core`) against the production build served by `vite preview`. Provide a browser with `CHROMIUM_PATH=/path/to/chromium`, or install one with `npx playwright-core install chromium`. It is deliberately not part of `npm test`.

## Latest verification

Checkpoint: branch `p6-browser-verification` (built on `p6-visual-onboarding`, commit `ba3ed34`). Results from a clean extraction of the delivered ZIP:

- `npm test`: **204/204 tests passed** (unit, domain, persistence and jsdom + axe).
- `npm run test:browser`: **8/8 real-browser tests passed** (headless Chromium 131 on Linux, against the production build).
- `npm run build`: successful.
- `npm audit`: 7 reported development-tooling vulnerabilities (4 moderate, 1 high, 2 critical), unchanged; `npm audit --omit=dev`: 0.

Do **not** use `npm audit fix --force` without reviewing breaking-version upgrades. The dev findings come from vitest/tinypool and the vite/esbuild dev server; clearing them needs a coordinated major upgrade (vitest 4 requires vite 6+, which requires newer vite-plugin-pwa and the React plugin).

**Verified in a real browser (Chromium 131 only):** rendered layouts at 360 px and 1440 px for every onboarding step, the confirmation and all four shell destinations (no horizontal overflow, clipped text, overlapping or obscured controls, 44 px targets, bottom navigation never covering content, left rail never overlapping content); axe with colour-contrast enabled (no serious/critical violations); keyboard focus order, visible 3 px focus outline and focus moving to the new step heading; `prefers-reduced-motion`; and a probe that the service worker registers and a registered player can reload offline on localhost.

**Still unverified:** Firefox, Safari/WebKit and mobile browsers; real devices; PWA installation on Windows/Android/iOS; device lock/background throttling; offline use beyond the localhost probe; and deployment of this P6 branch. The existing `main`/P5 checkpoint has deployed successfully (GitHub Actions Deploy #6) and the site loads, but it still shows the older shell stating Player Awakening is not yet implemented. Verify the live site again after P6 is merged.

## Implementation by phase

### P0 — Foundations

- Vite + React + strict TypeScript project scaffold.
- PWA manifest, service-worker generation and install-related configuration.
- Production build and GitHub Actions deployment workflow, configured to support a repository subpath through `BASE_PATH`.
- GitHub Actions Deploy #6 succeeded for the existing `main`/P5 checkpoint, and the GitHub Pages site loads. That deployed page still shows the older shell stating Player Awakening is not yet implemented; this P6 branch has not yet been deployed. Recheck Pages after P6 is merged.

### P1 — Progression engine

- Pure TypeScript progression engine and tests.
- Player Level curve uses the frozen coefficient **50**; rank thresholds are levels **10, 25, 45, 70 and 100**.
- Includes attribute progression, approved level/reference values, quest/timed XP rules, floor-limited deductions and reward trigger tables.
- Regression coverage checks the full level 1–100 table, 174 attribute points, exactly 12 shield-award levels and D17 queue behavior.

### P2 — Persistence and backup

- Dexie/IndexedDB storage, typed validation, schema and invariant checks, import/export, checksum validation, snapshots, restore and rollback.
- Backup payload uses `meta`, `player` and `settings` objects, with the remaining tables represented as arrays.
- Backup/database schema version is **3**; older schemas are rejected. Backup size limit is **25 MB** (`MAX_BACKUP_BYTES`), an implementation choice because the specification requires a limit but does not set the number.
- See [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md) for decisions and known limitations.

### P3 — Quests and day close

- Immutable quest-template versions; prospective edit, pause, resume and archive behavior.
- Daily, selected-weekday, weekly and every-N-days recurrence; one-off quests; frozen occurrence snapshots and idempotent generation.
- Game-day/timezone calculations, DST gap/overlap handling and effective-dated reset policies.
- Chronological day-close catch-up, absence handling, bounded deductions, rest-day/pause exemptions and penalty-trigger logging.

### P4 — Timer

- Timestamp-based timer sessions; pause/resume accumulation; one globally running timer; interrupted-gap honesty prompt; partial banking; completion and undo.
- Day-end settlement respects the 10-minute heartbeat gap rule and does not count unattended time beyond the allowed boundary.
- Timer logic is automated-tested with a fake clock. Real browser behavior, device lock/background throttling and installed-PWA behavior remain unverified.

### P5 — Consequences and rewards

- Deductions, penalty-quest behavior, streaks, Streak Shields, rest-day/pause exemptions and D17 shield overflow queue.
- Deterministic level/rank/reward events; attribute-point grants and manual, Balanced and Momentum allocation; titles, badges, cosmetics and achievements.
- Attribute titles and System messages are granted at attribute levels 10, 25 and 50 for all five attributes, with idempotency checks.
- The P5 scenario report covers deduction floors, rest days, pauses, penalty triggers, streaks, shields, level/rank progression, allocation, achievements, attribute titles and undo behavior. See [`docs/P5-scenario-report.md`](docs/P5-scenario-report.md).

### P6 — Visual system and onboarding

- Design tokens and reusable `Panel`, `SystemMessage`, `Nav`, `Shell` and `Field` components.
- Responsive application shell with bottom navigation on narrow screens and a left navigation rail on wider screens, plus a skip link and player status header.
- Seven-step Player Awakening flow with validation, skippable optional steps, draft resume, atomic/idempotent registration, initial quest generation and confirmation messages.
- Automated jsdom + axe-core tests cover onboarding flows, keyboard navigation, System-message roles and serious/critical axe violations; CSS-token contrast is computed in tests.
- A real-browser suite (`tests/browser/browser.test.ts`, Playwright + Chromium) renders the app at 360 px and 1440 px and checks layout, focus, reduced motion and axe with colour contrast. It found and fixed one genuine defect: at 360 px the four-item bottom navigation overflowed the viewport (the Settings button extended past the right edge); the navigation items now shrink to fit. Other browsers, installation, real-device and deployment checks remain unverified (see above).

## Phase status

| Phase | Status | Scope |
|---|---|---|
| P0 Foundations | Done (main/P5 deploy succeeded; P6 deployment pending) | Vite/React/TypeScript, PWA config, CI/deploy workflow |
| P1 Progression engine | Done | Formulas, ranks, rewards tables, D17 queue |
| P2 Persistence and backup | Done | Dexie, validation, import/export, snapshots |
| P3 Quests and day close | Done | Templates, recurrence, game days, absence handling |
| P4 Timer | Done | Sessions, gap prompt, banking, completion, undo |
| P5 Consequences and rewards | Done | Deductions, penalties, streaks, shields, rewards, achievements |
| P6 Visual system and onboarding | Done; browser-verified in Chromium only | Tokens, components, shell, Player Awakening |
| P7 Core screens | Not started | Quests, Status and Settings screens; timer UI; full daily workflow |
| P8 History and analytics | Not started | Calendar, ledger views, charts, System log |
| P9 Audio and cinematics | Not started | UI sounds, optional music, level-up/rank cinematics, effects tiers |
| P10 Release hardening | Not started | Backup reminders, storage status, offline/device matrix, full acceptance |

## Important implementation decisions and unverified behavior

- A completion undo that would decrease the player's level is rejected as `UNDO_BLOCKED`, preserving the frozen rule that levels/ranks never decrease. See `docs/IMPLEMENTATION_NOTES.md`.
- Achievements are an implementation-defined catalogue because the specification requires visible and hidden achievements but does not prescribe their names; the current catalogue has 16 visible and 5 hidden.
- The current UI includes a visual shell and Player Awakening, but full Quests, Status and Settings screens are not implemented yet.
- Rendered layout, focus, reduced motion and axe were verified in headless Chromium 131 only. Other browsers, installability on Windows/Android/iOS, real offline use beyond a localhost probe and actual device-lock behavior remain unverified. The main/P5 deployment succeeded, but P6 is not yet confirmed live; the current site still shows the older placeholder shell.

## Deployment

The deployment workflow is in `.github/workflows/deploy.yml` and builds with `BASE_PATH=/<repo>/`. GitHub Pages must be enabled and configured for GitHub Actions. Do not make a private repository public solely to clear a deployment check; choose hosting based on the privacy requirements.
