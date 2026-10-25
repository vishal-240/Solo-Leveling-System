# SYSTEM — Solo Leveling System PWA

Implements the approved **Solo Leveling System PWA Specification v1.0 (FROZEN)**. Product rules and numeric values are frozen; implementation must not change them without an explicit change request.

**Current implementation status: P0–P5 are implemented at the domain/logic level. P6–P10 remain incomplete. This is not yet the finished application.** The only UI is still the placeholder shell; real-browser, installed-PWA and offline behavior have not yet been verified.

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
```

## Latest reported verification

The latest reported clean-extraction run for the P5 checkpoint (`p5-consequences-rewards`, commit `c57438a`) produced:

- `npm test`: **186/186 tests passed**.
- `npm run build`: successful.
- `npm audit`: 7 reported development-tooling vulnerabilities (4 moderate, 1 high, 2 critical).
- `npm audit --omit=dev`: 0 reported vulnerabilities.

These are the latest reported results, not a guarantee that browser/device testing has passed. Re-run the commands above after changing dependencies or source files. Do **not** use `npm audit fix --force` without reviewing breaking-version upgrades.

## Implementation by phase

### P0 — Foundations

- Vite + React + strict TypeScript project scaffold.
- PWA manifest, service-worker generation and install-related configuration.
- Production build and GitHub Actions deployment workflow, configured to support a repository subpath through `BASE_PATH`.
- Deployment workflow has not yet been verified as successful; GitHub Pages previously failed because Pages was not enabled/configured. This hosting issue is separate from local test/build results.

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

## Remaining phases

| Phase | Status | Scope |
|---|---|---|
| P6 | Not started | Visual system, reusable components, responsive navigation and Player Awakening onboarding |
| P7 | Not started | Core Quests, Status and Settings screens; full daily workflow |
| P8 | Not started | Calendar, history, XP ledger views, analytics and System log |
| P9 | Not started | UI sounds, optional music, level-up/rank cinematics, effects and reduced motion |
| P10 | Not started | Release hardening, backup reminders, storage status, offline/device matrix and full acceptance testing |

## Important implementation decisions and unverified behavior

- A completion undo that would decrease the player's level is rejected as `UNDO_BLOCKED`, preserving the frozen rule that levels/ranks never decrease. See `docs/IMPLEMENTATION_NOTES.md`.
- Achievements are an implementation-defined catalogue because the specification requires visible and hidden achievements but does not prescribe their names; the current catalogue has 16 visible and 5 hidden.
- The project currently has no complete usable UI beyond the placeholder shell. P0–P5 completion means the underlying foundations/domain work is present, not that the end-user application is finished.
- Real-browser tests, installability on Windows/Android/iOS, real offline use, actual device-lock behavior and a successful GitHub Pages deployment remain unverified.

## Deployment

The deployment workflow is in `.github/workflows/deploy.yml` and builds with `BASE_PATH=/<repo>/`. GitHub Pages must be enabled and configured for GitHub Actions. Do not make a private repository public solely to clear a deployment check; choose hosting based on the privacy requirements.
