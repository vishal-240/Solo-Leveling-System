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

## Not verified
Real browsers, installed-PWA behaviour, offline use and the GitHub Pages workflow; no screens exist yet (P6+).
