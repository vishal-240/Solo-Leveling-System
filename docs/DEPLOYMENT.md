# Deployment guide

## Before upload

1. Confirm the P10 candidate has passed all required commands in `P10-RELEASE-STATUS.md`.
2. Keep the frozen specification unchanged.
3. Keep `.github/workflows/deploy.yml` and all project files.
4. Do not upload `.git`, `node_modules`, `dist`, `.env*`, local browser binaries or machine-specific files.
5. Upload the project contents at the repository root on a dedicated branch, then open a pull request into `main`.

## GitHub Pages

- Repository: `vishal-240/Solo-Leveling-System`.
- Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- The workflow builds with `BASE_PATH=/<repository-name>/`, uploads `dist`, then deploys the Pages artifact.
- Merge to `main` or use the workflow's manual dispatch after the branch is ready.

## Verify deployment

1. Open Actions and inspect both `build` and `deploy`; both must be green.
2. Open the deployed site and confirm the version shown in Settings matches the release.
3. Confirm the app loads at the repository subpath, not the domain root.
4. Confirm the service worker controls the page and the offline-ready status appears.
5. Test a normal reload and an offline reload after first load.
6. Confirm existing IndexedDB player data remains after an app update.
7. Test export, wipe site data in a disposable browser profile, and restore from the exported backup.
8. Test on actual Windows Chrome/Edge, Android Chrome and iOS Safari before declaring the device matrix complete.

## Rollback

If a release breaks the app shell, revert the offending commit or redeploy the last known-good P9 commit through GitHub Actions. Do not clear the user's IndexedDB as a recovery step. The in-app cache reset is intended to clear only this app's service-worker registration and `sls-system-` caches; it must not touch game or media databases.
