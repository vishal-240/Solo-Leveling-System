# Implementation notes (Solo Leveling System PWA, Spec v1.0 frozen)

## Decisions taken where the spec is silent or ambiguous
- **Undo vs. level invariant (P4/P5).** Completion can be undone for 2 minutes via reversal entries, once per occurrence. The frozen rule that
  levels and ranks never decrease (3.7) takes precedence: an undo that would drop the player below the start of the current level is refused
  (`UNDO_BLOCKED`), even inside the window. Undo that stays inside the current level works, and re-completion never repeats rewards. No new mechanic
  was introduced; changing this needs an explicit spec decision (for example a reversible level-up). Tests: `timer.test.ts` (undo policy) and
  `scenarios.test.ts` (completion, undo, re-completion).
- **Attribute titles and messages (3.4).** Each attribute gets one title and one System message at attribute levels 10, 25 and 50 (all five attributes).
  Titles carry no points and no XP, are granted exactly once (deterministic ids), process every crossed threshold in one sync, and are never revoked by later
  undos or deductions. Messages are produced per threshold, not for every attribute level. Title display names are an implementation choice.
- **Achievements.** The spec requires visible and hidden achievements but does not list them; the catalogue in `src/rewards/rewards.ts` is an implementation choice
  (currently 16 visible and 5 hidden; counts are computed in the generated scenario report).
- **Schema version 3** per the spec's 6.5 example; older backups rejected. **Backup size limit 25 MB** (spec requires a limit, gives no number).
- **Gap prompt (3.9):** after the player answers, the session is paused (conservative; the spec does not say whether it keeps running).
- **Reward events are derived from the ledger** and applied by an idempotent reconciler (`syncProgressionInPlace`) after every award, undo and day close.

## P5 acceptance mapping
| Requirement | Evidence |
|---|---|
| Floor-limited deductions, per tier | `scenarios.test.ts` deduction and floor rows |
| Penalty quests: triggers, non-stacking, completion, expiry | penalty rows (P3 behaviour exercised through the P5 harness) |
| Daily/per-quest streaks, shields, D17 overflow | streak and shield rows |
| Rest-day and paused exemptions | rest-day and paused rows |
| Level and rank events; 174 points; 12 shield grants | level-crossing and full-run rows |
| Allocation modes, respec, equip | allocation rows |
| Attribute titles and messages at 10/25/50 | `attributes.test.ts` |
| Idempotency; undo/re-completion consistency | scenario and attribute tests |

## P5 checkpoint — not verified at that checkpoint
At the P5 checkpoint, real-browser behaviour, installed-PWA behaviour, offline use and the GitHub Pages workflow had not yet been verified, and no screens existed yet. The newer P6 browser evidence and current deployment status are documented below.

## P6 - Visual system and onboarding (branch `p6-visual-onboarding`)
Built: design tokens (`src/ui/tokens.css`), reusable components (`src/ui/components.tsx`: Panel, SystemMessage, Nav, Shell, Field), responsive shell (bottom nav under 768 px, left rail above),
Player Awakening (`src/onboarding/*`: model, atomic idempotent `registerPlayer`, step UI) and `App.tsx` (loading, error, onboarding, ready shell).
Decisions where the spec is silent: no starter quests are preselected (skipping gives zero quests); skip restores that step's defaults; the draft is kept in `localStorage`
(non-critical convenience, cleared on registration) while registration itself is one IndexedDB transaction; "timer behavior" and "penalty strictness" are shown as fixed rules,
because the spec defines no configurable options for them; the shell header shows real level/rank/XP from the ledger; Quests, Status, History and Settings are placeholders marked
"Not yet implemented" (P7/P8). Attribute goals are stored as an extra `goal` field on attribute rows; the optional starting title as `player.startingTitle`.

### Verified here (automated, jsdom + axe-core)
Onboarding end to end (validation, skip, resume after reload, corrupt draft, confirmation, double submit, no duplicate registration), axe (serious/critical = none) on every step, the
confirmation and the shell, keyboard navigation, skip link, focus moved to the step heading, System-message roles, effects tier attribute, token contrast (computed from the CSS).
### Real-browser verification (branch `p6-browser-verification`)
A Chromium 131 binary was obtained from the npm package `@sparticuz/chromium` (Playwright's own download host is blocked in the build environment) and driven with `playwright-core`; `tests/browser/browser.test.ts`
(`npm run test:browser`, outside `npm test`) passed 8/8 against the production build. At 360 px and 1440 px it checks: horizontal overflow, clipped text, overlapping and obscured controls, 44 px targets,
navigation versus content geometry, axe with colour contrast enabled, keyboard focus order/visibility/outline, focus moving to the step heading, reduced motion, and a service-worker/offline-reload probe.
**Defect found and fixed:** the four-item bottom navigation overflowed a 360 px viewport. Tests wait for entry animations to finish before measuring (a fading panel has partial opacity and fails contrast otherwise).
### Still not verified
Firefox/WebKit/mobile browsers, real devices, PWA installation, device lock and offline beyond the localhost probe. P6 was subsequently confirmed visually on GitHub Pages; this P7 checkpoint has not yet been deployed.

## P7 - Core screens (branch `p7-core-screens`)
Built from the supplied P6 checkpoint (no Git history in the ZIP; a local baseline commit was created and the remote was not touched). Screens live in `src/screens/*`, the thin atomic action layer in `src/app/actions.ts`,
ledger-derived read models in `src/app/selectors.ts`; business rules stay in the existing domain/timer/rewards/persistence modules.
Decisions where the spec is silent:
- **Quick create** makes a one-off for today (or a daily recurring quest with "Repeat"). **Timed quests must repeat**, because the existing one-off model supports difficulty only; the form says so.
- **Edit, pause, resume and remove take effect from tomorrow** (effective-dated template versions), so today's generated occurrence is never rewritten; the UI states this.
- **Undo** is offered for 2 minutes after completion but hidden, with an explanation, when reversing it would remove a level already reached (the P5 `UNDO_BLOCKED` rule). The player's first-ever completion reaches level 2 at 50 XP, so it cannot be undone.
- **Timer UI** derives elapsed time from stored timestamps on a 1 s render tick and sends a keep-alive heartbeat every 15 s while a timer runs; the gap prompt takes whole minutes (0 to the gap). Actions use click-time timestamps.
- **Export** downloads `system-backup-YYYY-MM-DD.json` and records `meta.lastExportAt`; **import** requires ticking an explicit replace confirmation, uses the existing validated/atomic importer and keeps its snapshot.
- **Settings**: timezone/reset changes use the existing effective-dated policy (next game day); effects and the music preference are stored but no audio exists until P9; "timer behavior" and "penalty strictness" are shown as fixed rules.
- **Day close** runs on open, on tab visibility and every 30 s; its System message now states the real quest count ("no quests are scheduled" when there are none); the onboarding confirmation says "NO QUESTS YET" when none were created.
- **Test clock:** the end-to-end rollover test installs a Date shim from the test (localStorage-backed); no clock override exists in production code.
- **Accessibility fix found by tests:** schedule buttons are named "Pause schedule of X" so they cannot be confused with the timer's "Pause X".
Real-browser defects found and fixed in P7: the Settings page overflowed a 360 px viewport (file input intrinsic width). The overlap check ignores content scrolling beneath the fixed bottom navigation (checked separately by the obscured-control test).
Known limitations: History is a placeholder; no audio or cinematics; real-time 15-minute timer blocks are unit-tested with a fake clock but not waited out in a browser; Chromium-only browser evidence; installability, devices and Pages deployment unverified.

## P8 - History and analytics (branch `p8-history-analytics`)
Built from the deployed P7 checkpoint (no Git history in the ZIP; a local baseline commit was created and the remote was not touched). Read models are pure functions in `src/history/history.ts`
(unit-tested against a real-domain fixture, `src/history/testFixture.ts`); the UI is `src/screens/HistoryScreen.tsx`. Nothing is stored for history: every view is derived from the ledger, occurrences, day records and event records.
Decisions where the spec is silent:
- **Day status** is derived from occurrence outcomes: all completed = clear; completed plus missed/partial/lapsed = mixed; none completed with misses = missed; the day-record rest flag = rest; open quests = in progress; days after today and days with no records are "no data", never missed.
- **Chart values are net XP** (earned, with undone completions netted out, minus deductions) so the buckets always sum to the player ledger total. Earned, deducted and forfeited are shown in the data table. Weeks start on the configured week start (Monday by default). The chart draws the last 12 periods and reports the XP from earlier periods.
- **Completion rate** = completed ÷ (completed + missed + partially banked + lapsed) over processed days; exempt, skipped, open, penalty and future quests are excluded, and so is the rest-day affordance quest when it lapses (the spec says a protected rest day must never count against you).
- **Deductions** are applied equally to Player and attribute XP but limited by the stricter level floor, so the applied amount can be smaller than requested; the log and ledger say so. The Penalties log lists each player-scope deduction once (the attribute mirror is not listed) plus penalty-quest triggers.
- **System log** lists one entry per persisted record; level and rank events come from their own records, so the redundant LEVEL UP / RANK PROMOTION notifications are not listed again. Event times are shown in the configured timezone (the current setting, even for events recorded under an earlier policy).
- **Month navigation** stops at the first month with data and the current month; "streak history" is limited to the stored current/longest values.
Real-browser defects found and fixed in P8: calendar day buttons were 43 px wide at 360 px (now 44 px+, with smaller panel padding on narrow screens); the selected-day style overrode the focus ring (now a box-shadow); visible button text was not contained in the accessible name (WCAG label-in-name; the calendar and month buttons now use matching names); and the daily-loop tests waited on the header date instead of on day close finishing (a race, now waits for the generated quest).
Known limitations: Chromium-only browser evidence; no export of history; long ledgers/logs are paged 50 at a time; installability, devices and Pages deployment unverified.
