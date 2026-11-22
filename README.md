# SYSTEM — Solo Leveling System PWA

A local-first, installable, offline-capable productivity RPG. Real-life quests become XP, levels, ranks (E→S), attributes, streaks, penalties, rewards and cinematics. There is no backend, account system or cloud sync. Player data is stored locally in IndexedDB and can be exported/imported as a JSON backup.

**The frozen Specification v1.0 is authoritative.** Do not change approved formulas, thresholds, quest rules, deductions, rewards, streaks, shields, penalties or timer behavior without an explicit user-approved specification change.

## Current release status

- **P0–P9:** completed. P9 was deployed to GitHub Pages and manually checked by the user; cinematics and music playback were observed working. The user noted the generated ambient sound is shrill and prefers custom uploads for now.
- **P10:** implementation and local automated verification are complete. The candidate passes typecheck, all 301 unit tests, all 42 Chromium browser tests and the production build. `npm audit --omit=dev` reports zero production vulnerabilities; `npm audit` reports four moderate findings in development/build dependencies. See the P10 release status and risk documents for qualifications.

## Run locally

Requirements: Node.js 20.19 or later and npm.

```bash
npm ci
npm run dev
```

Verification commands:

```bash
npm run typecheck
npm test
npm run build
npm run preview
npm run test:browser   # builds first; requires Chromium
npm audit
npm audit --omit=dev
```

The browser suite uses `playwright-core` against the production build served by `vite preview`. Set `CHROMIUM_PATH=/path/to/chromium` or install the matching browser with:

```bash
npx playwright-core install chromium
```

The browser suite is intentionally separate from `npm test`.

## P10 implementation included in this candidate

- PWA manifest and PNG icons (192, 512, maskable 512, Apple touch 180), standalone display, app scope and theme metadata.
- Workbox precaching of the app shell/assets, navigation fallback and outdated-cache cleanup.
- User-controlled update prompt; update is blocked while a timer is running. Offline-ready and registration-error messages are surfaced.
- Install prompt capture where the browser supports `beforeinstallprompt`, plus manual platform instructions.
- Storage status, usage/quota reporting and persistent-storage request.
- Backup preview, configurable 3/7/14/30-day reminders, rank-promotion reminders, one-day snooze and restore from the initial Awakening screen.
- Optional Chromium desktop file auto-save, only when a user-selected file handle already has permission; it never prompts by itself. Music/media database and backup remain separate.
- Storage error explanations, D16 transfer grace, and incremental writes in `mutatePayload` to avoid rewriting every row on each action.
- Performance fixture for roughly three years of history (5,475 occurrences and 10,950 ledger rows).
- P10 browser verification: all 42 Chromium browser tests pass, including manifest/icons, offline actions, update deployment, failed-release recovery, backup/wipe/restore, reminders, simulated timer throttling and large-history performance. Physical-device and normal-profile installation behavior remain to be verified.

## Phase status

| Phase                           | Status                                                                 | Scope                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P0 Foundations                  | Complete                                                               | Vite/React/TypeScript, PWA scaffold, CI and Pages workflow                                              |
| P1 Progression engine           | Complete                                                               | Frozen formulas, ranks, attributes and rewards tables                                                   |
| P2 Persistence and backup       | Complete                                                               | Dexie/IndexedDB, validation, checksums, snapshots, import/export and rollback                           |
| P3 Quests and day close         | Complete                                                               | Templates, recurrence, game days, absence handling and deductions                                       |
| P4 Timer                        | Complete                                                               | Timestamp-based sessions, gap prompt, banking, completion and undo                                      |
| P5 Consequences and rewards     | Complete                                                               | Deductions, penalties, streaks, shields, allocation, titles and achievements                            |
| P6 Visual system and onboarding | Complete                                                               | Responsive shell, System UI and Player Awakening                                                        |
| P7 Core screens                 | Complete                                                               | Quests, Status and Settings; full daily-loop browser test                                               |
| P8 History and analytics        | Complete                                                               | Calendar, charts, XP ledger, System log and achievements gallery                                        |
| P9 Audio and cinematics         | Complete                                                               | Web Audio cues, optional music, progression cinematics and effects tiers                                |
| P10 Release hardening           | **Implemented; local verification passed; release acceptance pending** | Offline/install lifecycle, storage/backup safety, performance, dependency audit and final device matrix |

## Frozen progression reference

- Player XP to next level: `round10(50 × L^1.2)`.
- Rank thresholds: D 10, C 25, B 45, A 70, S 100.
- Attribute XP curve: `round10(40 × L^1.25)`, attribute cap 50.
- Quest XP: Easy 50, Medium 100, Hard 200; timed quests 25 XP per full 15-minute block, maximum 200.
- Attribute point grant per level: normal 1, milestone 3, rank 10; total 174 through level 100.
- Streak Shields are awarded at exactly 12 levels; maximum 3 held, surplus queued.

Do not tune these values during P10.

## Important data and platform limitations

- Data is local to one browser profile/device. There is no sync or merge. Moving devices requires export then import.
- Clearing site data can permanently erase the live database. Internal snapshots share the same browser storage and do not protect against a full site-data wipe. Keep exported backups somewhere safe.
- Persistent-storage requests may be denied; browser storage can still be evicted. iOS Safari has additional storage lifecycle constraints.
- Backup reminders are in-app only and appear when the app is opened; there are no browser/push notifications.
- User-uploaded music is stored separately from game backups and is not transferred by backup export/import.
- Chromium desktop auto-save uses the File System Access API and is optional; permission must be re-granted when required. It is not available on iOS.
- A running timer is timestamp-based; device/background throttling can trigger the 10-minute honesty prompt. The app does not verify that the activity actually occurred.
- Generated sound output has not been acoustically measured. The user has manually confirmed playback, but quality is subjective.

## Deployment

GitHub Pages is configured for GitHub Actions in `.github/workflows/deploy.yml`. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The latest P10 workflow changes have not yet been run against the user's remote repository; verify the Actions run after merging.

## Further documentation

- [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md): phase decisions and implementation notes.
- [`docs/P5-scenario-report.md`](docs/P5-scenario-report.md): P5 scenario evidence.
- [`docs/P10-RELEASE-STATUS.md`](docs/P10-RELEASE-STATUS.md): exact P10 verification state and limitations.
- [`docs/RELEASE-RISKS.md`](docs/RELEASE-RISKS.md): unresolved release risks.
