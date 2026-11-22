# P10 release status — candidate, not accepted

## Scope

P10 is the final release-hardening phase. The source includes install/offline lifecycle handling, backup reminders, storage status, restore-on-awakening, optional Chromium desktop auto-save, D16 transfer grace, incremental persistence writes, PWA update/recovery controls, and expanded browser tests.

## Locally verified results

The following checks were run successfully by the user against the extracted P10 candidate on Windows:

| Check                  |                     Result | Qualification                                             |
| ---------------------- | -------------------------: | --------------------------------------------------------- |
| `npm ci`               |                     Passed | 431 packages installed; 432 audited                       |
| `npm run typecheck`    |                     Passed | Local Windows environment                                 |
| `npm test`             |                 301 passed | 23 test files; 0 failures                                 |
| `npm run build`        |                     Passed | Production Vite build and PWA generation completed        |
| Chromium browser suite |                  42 passed | Full suite; 1 test file; 0 failures                       |
| `npm audit --omit=dev` |          0 vulnerabilities | Production dependencies                                   |
| `npm audit`            | 4 moderate vulnerabilities | Development/build dependency tree; see `RELEASE-RISKS.md` |

The 42 browser tests cover onboarding and responsive layouts, reduced motion, offline behavior, PWA manifest and icons, update deployment, failed-release recovery, backup/wipe/restore, reminders, simulated timer throttling, audio-engine behavior, and large-history scenarios.

### Large-history browser measurements

Synthetic three-year dataset:

| Operation    | Measured time |
| ------------ | ------------: |
| Preview      |        243 ms |
| Restore      |      6,206 ms |
| Charts view  |        307 ms |
| XP ledger    |        100 ms |
| System log   |        276 ms |
| Achievements |        101 ms |
| Calendar     |        274 ms |
| Create quest |      1,032 ms |

Synthetic backup size: approximately 5.8 MB.

These are measurements from the tested Chromium environment, not guarantees for mobile or lower-powered devices.

## Build and test qualifications

- The production build emits a warning that the main JavaScript chunk is approximately 509 kB before gzip, slightly above Vite's 500 kB warning threshold.
- Vite also reports that `backup.ts` is both statically and dynamically imported, so the dynamic import does not create a separate chunk.
- Zod emits misplaced pure-annotation warnings.
- Unit tests produce some expected jsdom environment noise around canvas, media playback, and malformed history data. The test suite nevertheless passes.
- Browser audio testing instruments the Web Audio API; it does not measure acoustic quality or prove sound quality on physical devices.
- The PWA installability test runs in a Playwright Chromium context. Its assertion filters the incognito-only issue; a normal-profile install prompt has not been independently verified.

## Dependency audit

- Production dependency audit: zero vulnerabilities.
- Full audit: four moderate findings in development/build tooling, involving `glob` and `minimatch` through the Vite PWA/Workbox build dependency tree.
- `npm audit fix --force` is not an acceptable mitigation: the proposed fix would downgrade `vite-plugin-pwa` to a breaking older major version.
- Do not force-upgrade or downgrade dependencies merely to make the audit report clean. Record and review the exact dependency paths before changing the toolchain.

## Still outstanding before release acceptance

- Run the GitHub Actions workflow against the remote repository and verify a successful Pages deployment.
- Verify the deployed HTTPS site, including an actual release update and offline behavior.
- Manually test Windows Chrome and Edge, Android Chrome, and iOS Safari.
- Check real device-lock/background timer behavior and mobile performance.
- Test Chromium desktop auto-save with an actual user-selected file and persistent permission.
- Verify the final distributable ZIP from a fresh extraction, including its contents and absence of `.git`, `node_modules`, `dist`, and environment files.
- Review the four moderate development/build dependency findings and document the accepted mitigation.
- Review repository history and GitHub Actions secrets separately; no remote repository scan is claimed.

## Acceptance decision

**P10 is not release-accepted yet.**

The extracted candidate has passed local typecheck, unit tests, production build, the full 42-test Chromium browser suite, and the production dependency audit. These results do not establish successful GitHub Actions deployment or real-device compatibility.

Keep this as a candidate until the outstanding checks in [`RELEASE-RISKS.md`](RELEASE-RISKS.md) are closed.
