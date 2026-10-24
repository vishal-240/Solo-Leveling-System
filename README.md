# SYSTEM (Solo Leveling System PWA)
Implements Spec v1.0 (FROZEN). **Status: P0–P2 are implemented; P3 quest-domain and day-close logic has now been added, with focused tests. P4–P10 remain incomplete.** This is not yet the finished application.

Run locally: `npm ci`, `npm run dev` | Verify: `npm run typecheck`, `npm test`, `npm run build` | Preview: `npm run preview`.

Deploy: set Pages source to GitHub Actions; `.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>/`. The Pages workflow and real-browser installation/offline behavior have not yet been verified.

## P3 implementation notes
- Added immutable quest-template versions and prospective edit/pause/resume/archive behavior.
- Added recurring schedule expansion (daily, weekdays, weekly, every N days), frozen occurrence snapshots, one-off deadlines, idempotent generation, skip semantics, and protected rest-day declarations.
- Added game-day/timezone calculations with DST-gap/overlap handling and effective-dated reset policies.
- Added ordered day-close catch-up, absence reporting, bounded mandatory-miss deductions, streak/shield updates, penalty-trigger logging, and a single-writer lock adapter.
- Focused P3 tests cover timezone/DST, template/version behavior, recurrence, rest days, multi-day absence, bounded deductions, and idempotency. The P3 tests/build have not yet been run in this environment because dependency installation timed out; run `npm ci`, `npm test`, and `npm run build` before merging this checkpoint.

## P2 implementation notes
- Payload format: `meta`/`player`/`settings` are objects; all other data tables are arrays (spec §6.5).
- Current backup/database metadata schema version is 3, matching the frozen spec example. Schemas 1–2 were never released by this implementation and are rejected as `old_schema`.
- Backup size limit: 25 MB (`MAX_BACKUP_BYTES`). The spec requires a size limit but does not give a number; 25 MB is an implementation choice.
- Invariants are checked per occurrence and ledger scope, allowing a completion to be awarded, reversed once, and completed a second time once without permitting repeated reversal/recompletion cycles.
- The latest P2 integrity patch adds regression tests for schema-version agreement, day-close cursor presence, and award/undo/recompletion limits. The user verified 80/80 tests passing and a successful production build on the P2 checkpoint before P3 was added. The remaining known `npm audit` findings are in development tooling (Vitest/tinypool, Vite/esbuild development server, and vite-plugin-pwa). They need a coordinated compatibility review; do not run `npm audit fix --force` blindly.
