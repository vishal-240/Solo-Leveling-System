# P10 unresolved release risks

| Risk / gap                                   | Current evidence                                                                                                                                               | Required closure                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions deployment                    | Workflow action versions were upgraded; no remote run has been verified                                                                                        | Push/merge and inspect a successful Actions build and GitHub Pages deployment                                                                             |
| Deployed offline/update behavior             | Local Chromium browser tests pass, including offline operation, update deployment and failed-release recovery                                                  | Verify on the deployed HTTPS origin and after an actual update                                                                                            |
| Device/platform support                      | 42 Chromium browser tests pass; no physical-device matrix or Firefox/Safari verification                                                                       | Manually test Windows Chrome/Edge, Android Chrome and iOS Safari                                                                                          |
| Background timer throttling/device lock      | Simulated timer-throttling browser test passes                                                                                                                 | Test real background and device-lock behavior; confirm the honesty prompt is clear                                                                        |
| Storage eviction                             | Persistent-storage request and warning are implemented                                                                                                         | Explain that browser storage can still be evicted; test backup and restore after clearing site data                                                       |
| Optional auto-save                           | Logic is tested with fake file handles; real file picker and persistent permission are not automated                                                           | Manually select a file, grant permission, verify saving and re-prompt behavior                                                                            |
| Mobile performance                           | Synthetic desktop Chromium measurements are available; no mid-range mobile measurement                                                                         | Measure on ordinary/mid-range mobile hardware                                                                                                             |
| Generated audio quality                      | Browser test exercises the Web Audio API; user has observed playback but described the generated ambient sound as shrill                                       | Keep custom uploads as a workaround; acoustic quality measurement and sound-design polish are separate from P10 correctness                               |
| Development/build dependency vulnerabilities | `npm audit` reports four moderate findings involving `glob` and `minimatch` in the Vite PWA/Workbox build dependency tree; `npm audit --omit=dev` reports zero | Review exact dependency paths and available non-breaking fixes. Do not use `npm audit fix --force`, which proposes a breaking `vite-plugin-pwa` downgrade |
| Main bundle size                             | Production build succeeds; main JavaScript chunk is approximately 509 kB before gzip, above Vite's 500 kB warning threshold                                    | Review whether code splitting is worthwhile; this warning does not currently fail the build                                                               |
| Remote Git history and GitHub secrets        | Static review covered the supplied candidate ZIP only                                                                                                          | User may separately review remote history and repository Actions secrets; no remote scan is claimed                                                       |
| Final distributable integrity                | Local checks passed against the extracted candidate; a final fresh-extraction ZIP verification is not yet recorded                                             | Create/verify the final ZIP, inspect its contents, extract it into a clean directory and rerun the required checks                                        |

## Verified local checks

The user ran these checks successfully against the extracted P10 candidate:

| Check                  | Result                                                |
| ---------------------- | ----------------------------------------------------- |
| `npm ci`               | Passed; 431 packages installed                        |
| `npm run typecheck`    | Passed                                                |
| `npm test`             | 301 passed; 23 test files                             |
| `npm run build`        | Passed                                                |
| Chromium browser suite | 42 passed                                             |
| `npm audit --omit=dev` | 0 vulnerabilities                                     |
| `npm audit`            | 4 moderate findings in development/build dependencies |

The full browser suite includes responsive layouts, onboarding, reduced motion, offline operation, PWA manifest/icons, update deployment, failed-release recovery, backup/wipe/restore, reminders, simulated timer throttling and large-history scenarios.

Large-history test measurements are documented in [`P10-RELEASE-STATUS.md`](P10-RELEASE-STATUS.md). They are synthetic Chromium measurements, not mobile performance guarantees.

## Required final command checklist

Run from a fresh extraction of the final candidate ZIP:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:browser
npm audit
npm audit --omit=dev
```

Then:

1. Verify the final ZIP contains the intended source and documentation, and excludes `.git`, `node_modules`, `dist`, and environment files.
2. Verify the GitHub Actions build and Pages deployment.
3. Test the deployed HTTPS site, including an actual update and offline behavior.
4. Complete the physical-device matrix: Windows Chrome/Edge, Android Chrome and iOS Safari.
5. Test real background/device-lock timer behavior and the optional file auto-save flow.
6. Record any accepted dependency vulnerability mitigations.

A localhost/headless Chromium pass does not establish installation or offline reliability on iOS/Android devices.

**P10 remains a candidate until these outstanding checks are completed.**
