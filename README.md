# ⚔️ SOLO LEVELING SYSTEM

### `SYSTEM INITIALIZED` · `VERSION 1.0.0` · `RELEASE COMPLETE`

<p align="center">
  <strong>ARISE. LEVEL UP. SURPASS YOUR LIMITS.</strong>
</p>

<p align="center">
  A real-life productivity RPG inspired by <em>Solo Leveling</em>.
  <br/>
  Turn your daily goals into quests, earn XP, strengthen your attributes,
  climb the ranks and build your own path to becoming an S-Rank Hunter.
</p>

<p align="center">
  <a href="https://vishal-240.github.io/Solo-Leveling-System/"><strong>▶ LAUNCH SYSTEM</strong></a>
</p>

---

## ▣ SYSTEM STATUS

| System Parameter | Status |
|---|---|
| Release Version | **v1.0.0** |
| Release Status | 🟢 **RELEASED** |
| Development Phases | **P0 – P10 COMPLETE** |
| Deployment | **GitHub Pages** |
| Application Type | Installable PWA |
| Persistence | Local IndexedDB |
| Offline Support | Enabled |
| Backend | None |
| Account Required | No |

> **SYSTEM MESSAGE**
>
> All ten development phases have been completed. Version 1.0.0 is released and deployed. The System is ready for use.

---

## ◈ WHAT IS THE SYSTEM?

The Solo Leveling System transforms productivity into a progression-based RPG.

Instead of simply maintaining a to-do list, you become the player character.

- Register real-life tasks as **Quests**.
- Complete quests to earn **XP**.
- Level up your Player and individual **Attributes**.
- Progress through Hunter **Ranks**, from E to S.
- Maintain streaks and earn Streak Shields.
- Face consequences for missed mandatory quests.
- Unlock achievements, rewards and progression cinematics.
- Track your journey through detailed history and analytics.

Your progress is tied to your actions. Every completed quest contributes to your growth.

**The objective: become stronger every day.**

---

## ⚔️ CORE FEATURES

### 01 — PLAYER PROGRESSION

- XP-based player leveling.
- Hunter ranks: E, D, C, B, A and S.
- Rank promotion milestones.
- Attribute points and milestone rewards.
- Progression cinematics and visual feedback.

### 02 — ATTRIBUTE SYSTEM

Develop five independent attributes:

| Attribute | Focus |
|---|---|
| 📚 Academics | Learning and studying |
| 💪 Fitness | Physical health and exercise |
| 💻 Coding | Programming and technical development |
| 🎯 Discipline | Consistency and execution |
| 🌙 Recovery | Rest and recovery |

Each attribute has its own XP, level and progression curve.

### 03 — QUEST SYSTEM

- Easy, Medium and Hard quests.
- One-off and recurring quests.
- Mandatory and optional objectives.
- Custom quest creation.
- Quest templates.
- Game-day tracking and daily closure.

### 04 — TIMED QUESTS

- Timestamp-based sessions.
- XP awarded for completed time blocks.
- Interruption and inactivity detection.
- Honesty confirmation after significant interruptions.
- Completion and undo handling.

### 05 — CONSEQUENCES & REWARDS

- XP deductions for missed mandatory quests.
- Penalty quests for repeated or important failures.
- Streak tracking.
- Streak Shields.
- Reward allocation and achievements.
- Titles and progression milestones.

### 06 — HISTORY & ANALYTICS

- XP history and ledger.
- Progression charts.
- Calendar view.
- System activity log.
- Achievements gallery.
- Historical performance tracking.

### 07 — AUDIO & CINEMATICS

- Web Audio sound effects.
- Optional background music.
- Custom music uploads.
- Progression and rank-up cinematics.
- Full, Reduced and Minimal visual effects modes.
- Reduced-motion accessibility support.

### 08 — PWA & OFFLINE SUPPORT

- Installable Progressive Web App.
- Offline application shell and asset caching.
- Service-worker update handling.
- User-controlled application updates.
- Storage usage and persistence information.
- Cache recovery controls.

### 09 — BACKUP & RESTORE

- JSON backup export and import.
- Backup validation and integrity checks.
- Backup preview.
- Configurable backup reminders.
- Rank-promotion backup reminders.
- Restore access from the initial Awakening screen.

### 10 — LOCAL-FIRST ARCHITECTURE

- IndexedDB persistence.
- No account registration.
- No backend.
- No cloud synchronization.
- No remote player-data storage.
- Incremental persistence writes.
- Optional Chromium desktop file auto-save.

---

## ◆ HUNTER PROGRESSION REFERENCE

The progression system uses fixed formulas and thresholds.

| Rank | Player Level |
|---|---:|
| E | Starting rank |
| D | 10 |
| C | 25 |
| B | 45 |
| A | 70 |
| S | 100 |

**Player XP requirement**

\[
XP_{\text{next}} = \operatorname{round10}(50L^{1.2})
\]

**Attribute XP requirement**

\[
XP_{\text{attribute}} = \operatorname{round10}(40L^{1.25})
\]

Attribute level cap: **50**

**Quest XP**

| Difficulty | XP |
|---|---:|
| Easy | 50 |
| Medium | 100 |
| Hard | 200 |

Timed quests award 25 XP per completed 15-minute block, capped at 200 XP.

The progression mechanics are governed by the frozen Specification v1.0.

---

## ▣ TECHNOLOGY STACK

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Type safety |
| Vite | Development and production builds |
| Dexie | IndexedDB persistence |
| Zod | Data validation |
| Vitest | Unit and integration testing |
| Playwright | Browser automation |
| Workbox | PWA and service-worker support |
| GitHub Actions | Automated deployment |
| GitHub Pages | Application hosting |

---

## ◈ QUALITY & VERIFICATION

Version 1.0.0 completed its local automated verification and deployment checks.

| Verification | Result |
|---|---:|
| TypeScript typecheck | ✅ Passed |
| Unit tests | ✅ 301 passed |
| Chromium browser tests | ✅ 42 passed |
| Production build | ✅ Passed |
| Production dependency audit | ✅ 0 vulnerabilities |
| GitHub Pages deployment | ✅ Live |
| Manual application checks | ✅ Passed |

The browser suite covers responsive layouts, onboarding, progression, offline operation, PWA behavior, updates, backup and restore, reminders, timer interruption handling, audio-engine behavior and large-history scenarios.

The full development dependency audit reports four moderate findings in build tooling (`glob` / `minimatch`). The production dependency audit reports zero vulnerabilities.

---

## ◇ DATA & PRIVACY

The System is designed around local-first data storage.

- Player data remains in the browser's local IndexedDB database.
- There is no account system or backend.
- There is no cloud synchronization.
- Backups are exported as JSON files under the user's control.
- Uploaded music is stored separately from game backups.

**Important:** Clearing browser site data can permanently erase local player data. Export backups regularly and store them somewhere safe.

Browser storage can still be evicted, even when persistent storage is requested. Moving to another device requires exporting and importing a backup.

---

## ▣ RUN THE SYSTEM LOCALLY

### Requirements

- Node.js 20.19 or later
- npm

### Installation

```bash
git clone https://github.com/vishal-240/Solo-Leveling-System.git
cd Solo-Leveling-System
npm ci
npm run dev
```

### Verification

```bash
npm run typecheck
npm test
npm run build
npm run preview
npm run test:browser
```

The browser test suite requires Chromium. Install it using:

```bash
npx playwright-core install chromium
```

---

## ◆ PROJECT DEVELOPMENT

The project was developed across ten structured phases.

| Phase | Development Area | Status |
|---|---|---|
| P0 | Foundations and PWA scaffold | ✅ Complete |
| P1 | Progression engine | ✅ Complete |
| P2 | Persistence and backup | ✅ Complete |
| P3 | Quests and game-day handling | ✅ Complete |
| P4 | Timer system | ✅ Complete |
| P5 | Consequences and rewards | ✅ Complete |
| P6 | Visual system and onboarding | ✅ Complete |
| P7 | Core application screens | ✅ Complete |
| P8 | History and analytics | ✅ Complete |
| P9 | Audio and cinematics | ✅ Complete |
| P10 | Release hardening | ✅ Complete |

**All planned v1.0.0 development phases are complete.**

---

## ⚔️ RELEASE HISTORY

### v1.0.0 — THE SYSTEM AWAKENS

**Status: RELEASED**

The first complete release of the Solo Leveling System.

- Complete player progression and Hunter rank system.
- Five independent attributes.
- Quest creation, completion and recurrence.
- Timed quests and interruption handling.
- Penalties, streaks and rewards.
- History, charts and achievements.
- Audio, music and progression cinematics.
- Installable offline-capable PWA.
- Backup, restore and storage management.
- PWA update and recovery controls.
- Expanded automated testing and release hardening.

---

<p align="center">
  <strong>「 ARISE 」</strong>
  <br/><br/>
  <em>The System does not reward intentions. It rewards action.</em>
  <br/><br/>
  <strong>VERSION 1.0.0 — RELEASE COMPLETE</strong>
  <br/>
  <a href="https://vishal-240.github.io/Solo-Leveling-System/">ENTER THE SYSTEM</a>
</p>
