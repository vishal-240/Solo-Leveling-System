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
Firefox/WebKit/mobile browsers, real devices, PWA installation, device lock and offline beyond the localhost probe. The existing main/P5 checkpoint is deployed, but this P6 branch has not yet been deployed; the live site still shows the older placeholder shell.
