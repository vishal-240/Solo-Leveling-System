# SYSTEM (Solo Leveling System PWA)
Implements Spec v1.0 (FROZEN). **Status: P0, P1, and P2 persistence/backup code are present; the final P2 integrity corrections are applied in this checkpoint, and P3–P10 remain incomplete.** This is not yet the finished application.

Run locally: `npm ci`, `npm run dev` | Verify: `npm run typecheck`, `npm test`, `npm run build` | Preview: `npm run preview`.

Deploy: set Pages source to GitHub Actions; `.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>/`. The Pages workflow and real-browser installation/offline behavior have not yet been verified.

## P2 implementation notes
- Payload format: `meta`/`player`/`settings` are objects; all other data tables are arrays (spec §6.5).
- Current backup/database metadata schema version is 3, matching the frozen spec example. Schemas 1–2 were never released by this implementation and are rejected as `old_schema`.
- Backup size limit: 25 MB (`MAX_BACKUP_BYTES`). The spec requires a size limit but does not give a number; 25 MB is an implementation choice.
- Invariants are checked per occurrence and ledger scope, allowing a completion to be awarded, reversed once, and completed a second time once without permitting repeated reversal/recompletion cycles.
- The latest patch adds regression tests for schema-version agreement, day-close cursor presence, and award/undo/recompletion limits. A fresh test/build run is still required: dependency installation timed out in the editing environment, so these new tests have not been executed here. The previous checkpoint reported 76 passing tests; this patch adds 4 test cases (expected total: 80). The remaining known `npm audit` findings are in development tooling (Vitest/tinypool, Vite/esbuild development server, and vite-plugin-pwa). They need a coordinated compatibility review; do not run `npm audit fix --force` blindly.
