# SYSTEM — Solo Leveling System PWA

Implements the approved **Solo Leveling System PWA Specification v1.0 (FROZEN)**. Product rules and numeric values are frozen; implementation must not change them without an explicit change request.

**Current implementation status: P0–P8 are implemented and tested, including real-browser (headless Chromium 131) tests of the full daily loop and the History screen. Audio/cinematics (P9) and release hardening (P10) are not started.** Quests, Status, History and Settings are all working screens. This is not yet the finished application.

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

Checkpoint: branch `p8-history-analytics`, built from the deployed P7 checkpoint supplied as `Solo-Leveling-System-main_e39e09.zip` (no Git history was included, so a local baseline commit was created; the remote was not fetched or updated). Results from a clean extraction of the delivered ZIP:

- `npm ci`: succeeded.
- `npm run typecheck`: passed.
- `npm test`: **237/237 tests passed** (domain, persistence, history read models, jsdom screens + axe).
- `npm run test:browser`: **15/15 real-browser tests passed** (headless Chromium 131, production build; includes the P7 daily loop and the P8 History tests at 360 px and 1440 px).
- `npm run build`: successful.
- `npm audit`: 7 reported development-tooling vulnerabilities (4 moderate, 1 high, 2 critical), unchanged; `npm audit --omit=dev`: 0 vulnerabilities.

Do **not** use `npm audit fix --force` without reviewing breaking-version upgrades. The dev findings come from vitest/tinypool and the vite/esbuild dev server; clearing them needs a coordinated major upgrade (vitest 4 requires vite 6+, which requires newer vite-plugin-pwa and the React plugin).

**Verified in a real browser (Chromium 131 only):** rendered layouts at 360 px and 1440 px for onboarding, the shell, populated Quests/Status/Settings and all five History views (no horizontal overflow, clipped text, overlapping or obscured controls, 44 px targets); axe with colour contrast enabled (no serious/critical violations); keyboard focus and selection on the calendar; ledger and log filters; `prefers-reduced-motion`; a service-worker/offline-reload probe on localhost; and the full daily loop. Date-dependent tests use a Date shim installed by the test, not application code.

**Still unverified:** Firefox, Safari/WebKit and mobile browsers; real devices; PWA installation on Windows/Android/iOS; device lock/background throttling; offline use beyond the localhost probe; a real-time 15-minute timer block in a browser; and the GitHub Pages deployment.

## Implementation by phase

### P0 — Foundations

- Vite + React + strict TypeScript project scaffold.
- PWA manifest, service-worker generation and install-related configuration.
- Production build and GitHub Actions deployment workflow, configured to support a repository subpath through `BASE_PATH`.
- GitHub Actions Deploy #6 succeeded for the earlier `main`/P5 checkpoint. P6 and P7 were subsequently confirmed visually on GitHub Pages, including the Player Awakening and the Quests, Status and Settings screens. This P8 checkpoint has not yet been deployed; verify the History screen after P8 is merged.

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

### P7 — Core screens

- **Quests:** today's occurrences with state, difficulty/timed type, category, expected and awarded XP, mandatory/important/penalty/one-off badges; honest empty state; quick creation (one-off today, or repeating daily) and advanced creation (timed or standard, daily / selected weekdays / weekly / every N days, mandatory, important, deadline time, one-off deadline date); editing through versioned templates (applies from tomorrow, today's occurrence unchanged); pause, resume and remove (from tomorrow); complete, skip (with confirmation and miss warning) and 2-minute undo (hidden with an explanation when it would remove a level already reached); timer start/pause/resume, elapsed active time, completed blocks, 10-minute gap honesty prompt, bank partial, confirmed completion. Duplicate clicks are ignored while an action runs, and success is only shown after the domain call succeeds.
- **Status:** ledger-derived rank, level, XP progress, streaks, shields (with D17 queue), five attributes with levels/progress/stat points, an accessible radar chart, unspent points, Manual/Balanced/Momentum modes, per-attribute allocation, bank distribution, weekly respec, titles/badges/frames/cosmetics with equip, and achievements (hidden ones stay hidden until unlocked).
- **Settings:** profile, timezone and reset time (effective from the next game day), protected rest days (domain quota and declare-ahead rules surface as errors), allocation mode, effects tier and music preference (stored only; no audio yet), fixed rules, backup export (downloads a JSON file and records the export time) and import (explicit replace confirmation; invalid files change nothing), and version/schema information.
- **Day close** now also runs when the app is opened, when the tab becomes visible and every 30 seconds; System-message text reflects the real number of quests.
- **History** is implemented in P8 with a game-day calendar, selected-day details, net-XP charts, completion rates, XP ledger, System log and achievements gallery.

### P8 — History and analytics

- **Calendar:** a month grid built from game-day keys (reset time and timezone, never raw midnight), each day showing a text label and glyph (not colour alone): all completed, mixed, missed, protected rest day, in progress, exempt/no quests, or no data. Future days are disabled and never shown as missed; month navigation is limited to months that can contain data. Selecting a day shows its quests, XP earned/deducted/net/forfeited and that day's events.
- **Charts:** weekly and monthly net-XP bar charts (hatched bars for negatives) with an equivalent data table, a statement that all periods sum to the ledger total, an attribute breakdown, and quest-completion rates for the last 7 days, last 30 days and all time with the denominator stated. Streak history beyond the stored current and longest values is not shown because it is not recorded.
- **XP ledger:** every ledger entry, newest first, filterable by scope, kind and selected day; reversals appear as their own rows and amounts limited by a level floor are flagged.
- **System log:** one entry per persisted record in four categories (Progression, Rewards, Penalties, Notifications), newest first, filterable by category and selected day.
- **Achievements gallery:** unlocked, locked with progress, and hidden achievements that stay hidden until unlocked.
- Loading, empty and error states are handled (an unreadable store shows `HISTORY UNAVAILABLE` without changing data).

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
| P7 Core screens | Done; browser-verified in Chromium only | Quests, Status and Settings screens; timer UI; full daily workflow |
| P8 History and analytics | Done; browser-verified in Chromium only | Calendar, ledger view, charts, System log, achievements gallery |
| P9 Audio and cinematics | Not started | UI sounds, optional music, level-up/rank cinematics, effects tiers |
| P10 Release hardening | Not started | Backup reminders, storage status, offline/device matrix, full acceptance |

## Important implementation decisions and unverified behavior

- A completion undo that would decrease the player's level is rejected as `UNDO_BLOCKED`, preserving the frozen rule that levels/ranks never decrease. See `docs/IMPLEMENTATION_NOTES.md`.
- Achievements are an implementation-defined catalogue because the specification requires visible and hidden achievements but does not prescribe their names; the current catalogue has 16 visible and 5 hidden.
- Quests, Status, History and Settings are implemented (P7–P8); audio/cinematics, backup reminders and storage status are not (P9–P10). See `docs/IMPLEMENTATION_NOTES.md` for P7 and P8 decisions.
- Rendered layout, focus, reduced motion and axe were verified in headless Chromium 131 only. Other browsers, installability on Windows/Android/iOS, real offline use beyond a localhost probe and actual device-lock behavior remain unverified. P6 and P7 were confirmed visually on GitHub Pages; the P8 checkpoint itself has not yet been deployed.

## Deployment

The deployment workflow is in `.github/workflows/deploy.yml` and builds with `BASE_PATH=/<repo>/`. GitHub Pages must be enabled and configured for GitHub Actions. Do not make a private repository public solely to clear a deployment check; choose hosting based on the privacy requirements.
