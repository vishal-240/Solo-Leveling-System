// Real-browser acceptance checks for P6 and P7 (full daily loop, populated screens) (rendered layout, focus, reduced motion, axe with colour contrast, SW/offline probe).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';

const require = createRequire(import.meta.url);
const PORT = 4173, URL = `http://localhost:${PORT}/`;
let browser: Browser, server: PreviewServer;
const VIEWPORTS = [{ name: '360 px', width: 360, height: 740 }, { name: '1440 px', width: 1440, height: 900 }] as const;

beforeAll(async () => {
  const exe = process.env.CHROMIUM_PATH ?? chromium.executablePath();
  if (!existsSync(exe)) throw new Error(`No Chromium found at ${exe}. Set CHROMIUM_PATH or run "npx playwright-core install chromium".`);
  server = await preview({ root: process.cwd(), preview: { port: PORT, strictPort: true, host: 'localhost' } });
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((r) => (server ? server.httpServer.close(() => r()) : r())); });

async function open(vp: { width: number; height: number }, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: opts.reducedMotion ?? 'no-preference', serviceWorkers: 'allow' });
  const page = await ctx.newPage(); await page.goto(URL); await page.getByRole('heading', { name: /player awakening/i }).waitFor(); return { ctx, page };
}
/** Wait for entry animations to finish so measurements and contrast are taken at rest (a fading panel has partial opacity). */
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime))).map((a) => a.finished.catch(() => undefined))).then(() => undefined)); // infinite decorative loops never finish
/** Layout problems measured in the rendered page. */
const layoutProblems = async (page: Page) => { await settle(page); return page.evaluate(() => {
  const out: string[] = []; const vw = window.innerWidth; const de = document.documentElement;
  window.scrollTo(0, 0);
  if (de.scrollWidth > vw + 1) {
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 20)}`);
    out.push(`horizontal overflow: scrollWidth ${de.scrollWidth} > ${vw} (${offenders.join(', ')})`);
  }
  const visible = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const ctl = [...document.querySelectorAll<HTMLElement>('button, a[href], select, input[type=text], input[type=time]')].filter(visible).filter((e) => !e.classList.contains('skip-link'));
  const name = (e: Element) => `${e.tagName.toLowerCase()}[${(e.textContent || (e as HTMLInputElement).id || '').trim().slice(0, 24)}]`;
  for (const e of ctl) {
    const r = e.getBoundingClientRect();
    if (r.left < -0.5 || r.right > vw + 0.5) out.push(`outside viewport: ${name(e)} (${Math.round(r.left)}..${Math.round(r.right)})`);
    if (r.height < 43.5 || r.width < 43.5) out.push(`target smaller than 44px: ${name(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const e of document.querySelectorAll<HTMLElement>('button, h1, h2, h3, p, dt, dd, label, .nav__item, .sysmsg, .badge')) if (visible(e) && e.scrollWidth > e.clientWidth + 1) out.push(`clipped text: ${name(e)} ${e.scrollWidth}>${e.clientWidth}`);
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i]!, b = ctl[j]!; if (a.contains(b) || b.contains(a)) continue;
    if (a.closest('.nav') !== b.closest('.nav') && getComputedStyle((a.closest('.nav') ?? b.closest('.nav'))!).position === 'fixed') continue; // content scrolls under a fixed bottom nav by design (obscuring is checked separately after scrolling into view)
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
    if (w > 2 && h > 2) out.push(`overlap: ${name(a)} and ${name(b)}`);
  }
  for (const e of ctl) { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== e && !e.contains(hit) && !(hit as HTMLElement).closest('label')?.contains(e)) out.push(`obscured: ${name(e)} by ${name(hit)}`); }
  window.scrollTo(0, 0); return out;
}); };
const axeViolations = async (page: Page) => {
  await settle(page);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }); // colour-contrast enabled (rendered pixels)
    return r.violations.filter((v: { impact: string }) => v.impact === 'serious' || v.impact === 'critical').map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  });
};
async function register(page: Page) {
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByLabel(/player name/i).fill('Vishal'); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /skip/i }).click(); // attributes
  await page.getByLabel(/study session/i).check(); await page.getByLabel(/^workout/i).check(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // reset (defaults)
  await page.getByRole('button', { name: 'Continue' }).click(); // rules
  await page.getByRole('button', { name: /confirm registration/i }).click();
  await page.getByText('PLAYER REGISTERED').waitFor();
}
const STEP_BUTTONS = ['Begin', 'Continue', 'Continue', 'Continue', 'Continue', 'Continue'];

for (const vp of VIEWPORTS) describe(`rendered application at ${vp.name}`, () => {
  it('onboarding: every step has no overflow, clipping, overlap or obscured controls, and no serious/critical axe violations (with colour contrast)', async () => {
    const { ctx, page } = await open(vp); const problems: string[] = [];
    for (let i = 0; i <= STEP_BUTTONS.length; i++) {
      const h = (await page.locator('.panel__title').first().textContent()) ?? `step ${i}`;
      for (const p of await layoutProblems(page)) problems.push(`[${h}] ${p}`);
      for (const v of await axeViolations(page)) problems.push(`[${h}] axe ${v}`);
      if (i < STEP_BUTTONS.length) await page.getByRole('button', { name: STEP_BUTTONS[i]! }).click();
    }
    expect(problems).toEqual([]); await ctx.close();
  });
  it('confirmation and shell render correctly, and the navigation never covers content', async () => {
    const { ctx, page } = await open(vp); await register(page);
    const problems = [...(await layoutProblems(page)).map((p) => `[confirmation] ${p}`), ...(await axeViolations(page)).map((v) => `[confirmation] axe ${v}`)];
    await page.getByRole('button', { name: 'Enter the System' }).click(); await page.getByRole('heading', { name: /^quests$/i }).waitFor();
    for (const dest of ['Quests', 'Status', 'History', 'Settings']) {
      await page.getByRole('navigation', { name: /primary/i }).getByRole('button', { name: dest }).click();
      await page.getByRole('heading', { name: new RegExp(`^${dest}$`, 'i'), level: 1 }).waitFor();
      problems.push(...(await layoutProblems(page)).map((p) => `[${dest}] ${p}`), ...(await axeViolations(page)).map((v) => `[${dest}] axe ${v}`));
    }
    const geo = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight); const nav = document.querySelector('.nav')!.getBoundingClientRect(); const main = document.querySelector('main')!.getBoundingClientRect();
      const last = [...document.querySelectorAll('main .panel')].pop()!.getBoundingClientRect(); return { nav: { l: nav.left, t: nav.top, r: nav.right, b: nav.bottom }, main: { l: main.left, r: main.right }, lastBottom: last.bottom, vh: innerHeight, vw: innerWidth };
    });
    if (vp.width < 768) { expect(geo.nav.b).toBeCloseTo(geo.vh, 0); expect(geo.nav.l).toBe(0); expect(geo.nav.r).toBeCloseTo(geo.vw, 0); if (geo.lastBottom > geo.nav.t + 1) problems.push(`last panel hidden behind bottom navigation (${geo.lastBottom} > ${geo.nav.t})`); }
    else { expect(geo.nav.l).toBe(0); if (geo.nav.r > geo.main.l + 1) problems.push(`left rail overlaps main content (${geo.nav.r} > ${geo.main.l})`); }
    expect(problems).toEqual([]); await ctx.close();
  });
  it('keyboard: focus is visible, in view and outlined; Enter advances and focus lands on the new step heading; Tab reaches every control in order', async () => {
    const { ctx, page } = await open(vp);
    const focused = () => page.evaluate(() => { const e = document.activeElement as HTMLElement; const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return { tag: e.tagName, text: (e.textContent || e.id).trim().slice(0, 24), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth) }; });
    const check = async (expectText: RegExp) => { const f = await focused(); expect(f.text, `focused ${f.tag}`).toMatch(expectText); expect(f.inView, `${f.text} in view`).toBe(true); expect(f.outlineStyle, `${f.text} outline`).not.toBe('none'); expect(f.outlineWidth, `${f.text} outline width`).toBeGreaterThanOrEqual(3); };
    await page.keyboard.press('Tab'); await check(/^Begin$/); await page.keyboard.press('Enter');
    await page.getByLabel(/player name/i).waitFor(); expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Player registration');
    await page.keyboard.press('Tab'); await check(/^name$/); // text input: focus reports its id
    for (const label of [/^title$/, /^Back$/, /^Skip/, /^Continue$/]) { await page.keyboard.press('Tab'); await check(label); }
    await page.keyboard.press('Shift+Tab'); await check(/^Skip/); await ctx.close();
  });
});
describe('reduced motion and effects (real browser)', () => {
  it('motion runs by default and is removed under prefers-reduced-motion; effects default to Reduced', async () => {
    const full = await open(VIEWPORTS[1]); await full.page.getByRole('button', { name: 'Begin' }).click();
    expect(await full.page.evaluate(() => getComputedStyle(document.querySelector('.panel')!).animationName)).toBe('scan'); await full.ctx.close();
    const reduced = await open(VIEWPORTS[1], { reducedMotion: 'reduce' }); await reduced.page.getByRole('button', { name: 'Begin' }).click();
    expect(await reduced.page.evaluate(() => getComputedStyle(document.querySelector('.panel')!).animationName)).toBe('none');
    expect(await reduced.page.evaluate(() => document.documentElement.dataset.effects)).toBe('reduced'); await reduced.ctx.close();
  });
});
describe('service worker and offline probe (Chromium on localhost only; not an installability or device test)', () => {
  it('registers a service worker, and a registered player can reload the app while offline', async () => {
    const { ctx, page } = await open(VIEWPORTS[1]); await register(page); await page.getByRole('button', { name: 'Enter the System' }).click();
    await page.getByRole('heading', { name: /^quests$/i }).waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.getByRole('heading', { name: /^quests$/i }).waitFor();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await ctx.setOffline(true); await page.reload();
    await page.getByRole('heading', { name: /^quests$/i }).waitFor({ timeout: 15_000 }); expect(await page.getByText(/Vishal/).first().isVisible()).toBe(true); await ctx.close();
  });
});

// ---------------- P7: populated screens and the full daily loop (real domain + persistence in a real browser) ----------------
/** Test-only clock: the page's Date follows localStorage.__e2e_now (seeded once), so day rollover is deterministic. No application code is involved. */
const CLOCK_SHIM = `(() => { const R = Date; if (!localStorage.getItem('__e2e_now')) localStorage.setItem('__e2e_now', '2026-10-20T10:00:00.000Z');
  const read = () => R.parse(localStorage.getItem('__e2e_now'));
  class F extends R { constructor(...a) { if (a.length === 0) super(read()); else super(...a); } static now() { return read(); } }
  globalThis.Date = F; })();`;
async function openClocked(vp: { width: number; height: number }, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, timezoneId: 'UTC', locale: 'en-US', reducedMotion: opts.reducedMotion ?? 'no-preference' });
  await ctx.addInitScript(CLOCK_SHIM); const page = await ctx.newPage(); await page.goto(URL); await page.getByRole('heading', { name: /player awakening/i }).waitFor(); return { ctx, page };
}
async function registerEmpty(page: Page) {
  await page.getByRole('button', { name: 'Begin' }).click(); await page.getByLabel(/player name/i).fill('Vishal');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /skip/i }).click();
  await page.getByRole('button', { name: /confirm registration/i }).click(); await page.getByText('NO QUESTS YET').waitFor();
  await page.getByRole('button', { name: 'Enter the System' }).click(); await page.getByRole('heading', { name: /^quests$/i, level: 1 }).waitFor();
}
/** Level-ups open a modal dialog (P9); flows that are not about it dismiss it with Skip. */
const dismissCinematic = async (page: Page) => { const d = page.getByRole('dialog'); await d.waitFor(); await d.getByRole('button', { name: 'Skip' }).click(); await d.waitFor({ state: 'detached' }); };
const goto = async (page: Page, dest: string) => { await page.getByRole('navigation', { name: /primary/i }).getByRole('button', { name: dest }).click(); await page.getByRole('heading', { name: new RegExp(`^${dest}$`, 'i'), level: 1 }).waitFor(); };
const quickCreate = async (page: Page, title: string, difficulty: string) => {
  await page.getByLabel('Quest title').fill(title); await page.getByLabel('Difficulty').selectOption(difficulty); await page.getByRole('button', { name: /create quest/i }).click();
  await page.getByText('QUEST CREATED').waitFor();
};
const setNow = (page: Page, iso: string) => page.evaluate((v) => { localStorage.setItem('__e2e_now', v); document.dispatchEvent(new Event('visibilitychange')); }, iso);
const statusLine = async (page: Page) => (await page.getByRole('main').getByText(/Total XP/).textContent()) ?? '';

for (const vp of VIEWPORTS) describe(`populated Quests, Status and Settings at ${vp.name}`, () => {
  it('no overflow, clipped, overlapping or obscured controls and no serious/critical axe violations (colour contrast on) with real data', async () => {
    const { ctx, page } = await openClocked(vp); await registerEmpty(page); const problems: string[] = [];
    await quickCreate(page, 'Read a paper', 'medium');
    await page.getByRole('button', { name: 'Advanced' }).click(); await page.getByLabel('Quest title').fill('Deep work');
    await page.getByLabel('Type').selectOption('timed'); await page.getByLabel(/^Important/).check(); await page.getByRole('button', { name: /create quest/i }).click(); await page.getByText('QUEST CREATED').first().waitFor();
    await page.getByRole('button', { name: 'Start Deep work' }).click(); await page.getByText('TIMER STARTED').waitFor();
    await page.getByRole('button', { name: 'Complete Read a paper' }).click(); await page.getByText(/\+100 XP awarded/).first().waitFor(); await dismissCinematic(page);
    await page.getByRole('button', { name: 'Edit Deep work' }).click(); await page.getByRole('button', { name: /save changes/i }).waitFor();
    for (const dest of ['Quests', 'Status', 'Settings']) {
      await goto(page, dest);
      problems.push(...(await layoutProblems(page)).map((p) => `[${dest}] ${p}`), ...(await axeViolations(page)).map((v) => `[${dest}] axe ${v}`));
    }
    expect(problems).toEqual([]); await ctx.close();
  });
});
describe('P7 acceptance: create quest -> complete quest -> level up -> game-day rollover (real browser, production build)', () => {
  it('runs the whole daily loop against the real domain and persistence layers', async () => {
    const { ctx, page } = await openClocked(VIEWPORTS[1]); await registerEmpty(page);
    // honest empty state
    expect(await page.getByText('NO QUESTS FOR TODAY').isVisible()).toBe(true); expect(await page.getByText(/quests are ready/i).count()).toBe(0);
    // create: a hard one-off and a mandatory daily recurring quest (advanced form)
    await quickCreate(page, 'Hard focus', 'hard');
    await page.getByRole('button', { name: 'Advanced' }).click(); await page.getByLabel('Quest title').fill('Daily drill'); await page.getByLabel('Repeat', { exact: true }).check();
    await page.getByLabel(/^Mandatory/).check(); await page.getByRole('button', { name: /create quest/i }).click(); await page.getByText(/"Daily drill" repeats daily/).waitFor();
    const list = page.getByRole('list', { name: /today's quests/i });
    expect(await list.getByRole('listitem').count()).toBe(2); expect(await list.getByText('200 XP').count()).toBe(1); expect(await list.getByText('Mandatory').count()).toBe(1);
    // complete once only: a double click must not award twice
    await page.getByRole('button', { name: 'Complete Hard focus' }).dblclick(); await page.getByText(/\+200 XP awarded/).first().waitFor();
    const cine = page.getByRole('dialog'); await cine.waitFor(); expect(await cine.getByRole('heading').textContent()).toBe('LEVEL UP'); expect(await cine.textContent()).toMatch(/Levels 2 to 3 \(2 levels\)/); await dismissCinematic(page);
    // level up: 200 XP crosses level 2 (50) and level 3 (160) in one award
    await goto(page, 'Status'); let line = await statusLine(page);
    expect(line).toMatch(/Level 3/); expect(line).toContain('200'); expect(line).toMatch(/Rank E/);
    expect((await page.getByText(/Unspent points/).textContent()) ?? '').toContain('2');
    await goto(page, 'Quests'); await page.getByText('LEVEL UP').first().waitFor(); expect(await page.getByText('LEVEL UP: 3').count()).toBeGreaterThan(0);
    // reload preserves the state and never re-awards
    await page.reload(); await page.getByRole('heading', { name: /^quests$/i, level: 1 }).waitFor(); await goto(page, 'Status'); expect(await statusLine(page)).toMatch(/Total XP[^0-9]*200\b/);
    await goto(page, 'Quests'); expect(await page.getByRole('list', { name: /today's quests/i }).getByText('Completed').count()).toBe(1);
    // game-day rollover: the mandatory quest was missed on day 1 (13 XP deduction, floored at the level start), day 2 is generated
    await setNow(page, '2026-10-21T10:00:00.000Z'); await page.getByText("Today's quests (2026-10-21)").waitFor(); await page.getByRole('button', { name: 'Complete Daily drill' }).waitFor();
    expect(await page.getByRole('list', { name: /today's quests/i }).getByRole('listitem').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Complete Daily drill' }).isVisible()).toBe(true);
    await goto(page, 'Status'); line = await statusLine(page); expect(line).toMatch(/Level 3/); expect(line).toContain('187');
    // reload after rollover: idempotent (no second deduction, no duplicate occurrence)
    await page.reload(); await page.getByRole('heading', { name: /^status$/i, level: 1 }).or(page.getByRole('heading', { name: /^quests$/i, level: 1 })).waitFor();
    await goto(page, 'Status'); expect(await statusLine(page)).toContain('187'); await goto(page, 'Quests');
    expect(await page.getByRole('list', { name: /today's quests/i }).getByRole('listitem').count()).toBe(1);
    // completing today's quest the next day works and adds exactly its XP
    await page.getByRole('button', { name: 'Complete Daily drill' }).click(); await page.getByText(/\+50 XP awarded/).first().waitFor(); await goto(page, 'Status'); expect(await statusLine(page)).toContain('237');
    await ctx.close();
  });
});

// ---------------- P8: History screen in a real browser ----------------
const HISTORY_VIEWS = ['Calendar', 'Charts', 'XP ledger', 'System log', 'Achievements'];
async function twoGameDays(page: Page) {
  await registerEmpty(page); await quickCreate(page, 'Hard focus', 'hard');
  await page.getByRole('button', { name: 'Advanced' }).click(); await page.getByLabel('Quest title').fill('Daily drill'); await page.getByLabel('Repeat', { exact: true }).check();
  await page.getByLabel(/^Mandatory/).check(); await page.getByRole('button', { name: /create quest/i }).click(); await page.getByText(/"Daily drill" repeats daily/).waitFor();
  await page.getByRole('button', { name: 'Complete Hard focus' }).click(); await page.getByText(/\+200 XP awarded/).first().waitFor(); await dismissCinematic(page);
  await setNow(page, '2026-10-21T10:00:00.000Z'); await page.getByText("Today's quests (2026-10-21)").waitFor();
  await page.getByRole('button', { name: 'Complete Daily drill' }).waitFor(); // day close for day 1 has finished once day 2's quest exists
}
for (const vp of VIEWPORTS) describe(`History screen at ${vp.name}`, () => {
  it('every view has no overflow, clipping, overlap or obscured controls and no serious/critical axe violations (colour contrast on)', async () => {
    const { ctx, page } = await openClocked(vp); await twoGameDays(page); await goto(page, 'History'); const problems: string[] = [];
    for (const v of HISTORY_VIEWS) {
      await page.getByRole('group', { name: /history views/i }).getByRole('button', { name: v }).click();
      await page.getByRole('button', { name: v, pressed: true }).waitFor();
      problems.push(...(await layoutProblems(page)).map((p) => `[${v}] ${p}`), ...(await axeViolations(page)).map((x) => `[${v}] axe ${x}`));
    }
    expect(problems).toEqual([]); await ctx.close();
  });
  it('calendar, day detail, filters and keyboard operation work on real recorded days', async () => {
    const { ctx, page } = await openClocked(vp); await twoGameDays(page); await goto(page, 'History');
    const cal = page.getByRole('table', { name: /october 2026/i });
    await cal.getByRole('button', { name: /^20 October 2026:/ }).waitFor(); expect(await cal.getByRole('button', { name: /^20 October 2026:/ }).getAttribute('aria-label')).toMatch(/Some completed, some missed, 1 completed, 1 missed, net \+187 XP$|net \+187 XP|net \+/);
    expect(await cal.getByRole('button', { name: /^21 October 2026:/ }).getAttribute('aria-current')).toBe('date'); expect(await cal.getByRole('button', { name: /^22 October 2026:/ }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Previous month' }).isDisabled()).toBe(true); expect(await page.getByRole('button', { name: 'Next month' }).isDisabled()).toBe(true);
    // keyboard: focus a day, select with Enter, focus ring stays visible on the selected day
    const day = cal.getByRole('button', { name: /^20 October 2026:/ }); await day.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Day 2026-10-20' }).waitFor(); expect(await day.getAttribute('aria-pressed')).toBe('true');
    const ring = await day.evaluate((e) => { const s = getComputedStyle(e); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; }); expect(ring.style).not.toBe('none'); expect(ring.width).toBeGreaterThanOrEqual(3);
    const detail = page.getByRole('heading', { name: 'Day 2026-10-20' }).locator('xpath=ancestor::section[1]'); expect(await detail.textContent()).toMatch(/Some completed, some missed/); expect(await detail.textContent()).toMatch(/deducted 13/);
    // ledger filter
    await page.getByRole('button', { name: 'XP ledger' }).click(); await page.getByLabel('Kind').selectOption('penalty_deduction');
    const rows = page.getByRole('table', { name: /xp ledger entries/i }).locator('tbody tr'); expect(await rows.count()).toBe(2); expect(await rows.first().textContent()).toMatch(/Penalty deduction/);
    await page.getByLabel('Kind').selectOption(''); await page.getByLabel(/only the selected day/i).check(); expect(await rows.count()).toBeGreaterThan(0);
    for (let i = 0; i < await rows.count(); i++) expect(await rows.nth(i).textContent()).toContain('2026-10-20');
    // system log filter
    await page.getByRole('button', { name: 'System log' }).click(); await page.getByLabel('Category').selectOption('Penalties');
    const items = page.getByRole('list', { name: /system events/i }).getByRole('listitem'); expect(await items.count()).toBe(1); expect(await items.first().textContent()).toMatch(/XP DEDUCTED/);
    await page.getByLabel('Category').selectOption('Progression'); expect(await items.count()).toBe(2);
    // charts: accessible chart plus a data table whose total matches the ledger
    await page.getByRole('button', { name: 'Charts' }).click(); await page.getByRole('img', { name: /weekly net xp/i }).waitFor(); expect(await page.getByText(/equals your ledger total/i).isVisible()).toBe(true);
    expect(await page.getByRole('table', { name: /weekly xp data/i }).locator('tbody tr').count()).toBe(1);
    // reload keeps the history
    await page.reload(); await page.getByRole('heading', { name: /^quests$/i, level: 1 }).waitFor(); await goto(page, 'History'); await cal.getByRole('button', { name: /^20 October 2026:/ }).waitFor();
    await ctx.close();
  });
});

// ---------------- P9: audio and cinematics in a real browser ----------------
/** Test-only instrumentation: counts AudioContext constructions and oscillator starts so autoplay can be checked. Sound output itself cannot be heard here. */
const AUDIO_SPY = `(() => { const w = window; w.__audio = { created: 0, started: 0 }; const Real = w.AudioContext; if (!Real) return;
  w.AudioContext = class extends Real { constructor(...a) { super(...a); w.__audio.created++; } };
  const st = w.OscillatorNode.prototype.start; w.OscillatorNode.prototype.start = function (...a) { w.__audio.started++; return st.apply(this, a); }; })();`;
const counters = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { created: number; started: number } }).__audio);
describe('audio autoplay and music control (instrumented Web Audio; no acoustic verification)', () => {
  it('creates no audio context and starts no sound before a gesture, plays cues after one, and never starts music by itself', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'UTC' }); await ctx.addInitScript(AUDIO_SPY);
    const page = await ctx.newPage(); await page.goto(URL); await page.getByRole('heading', { name: /player awakening/i }).waitFor(); await page.waitForTimeout(1200);
    expect(await counters(page)).toEqual({ created: 0, started: 0 });
    await page.getByRole('button', { name: 'Begin' }).click(); const afterClick = await counters(page); expect(afterClick.created).toBe(1); expect(afterClick.started).toBeGreaterThan(0);
    await page.getByLabel(/player name/i).fill('Vishal'); for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /skip/i }).click(); await page.getByRole('button', { name: /confirm registration/i }).click();
    await page.getByRole('button', { name: 'Enter the System' }).click(); await page.getByRole('heading', { name: /^quests$/i, level: 1 }).waitFor();
    expect(await page.getByRole('banner').getByRole('button', { name: /music/i }).count()).toBe(0); // no music control while music is not allowed
    await goto(page, 'Settings'); await page.getByLabel(/allow ambient music/i).check(); await page.getByRole('button', { name: /save sound settings/i }).click(); await page.getByText('SOUND SETTINGS SAVED').waitFor();
    const toggle = page.getByRole('banner').getByRole('button', { name: /^(Play|Stop) music$/ }); await toggle.waitFor(); expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    const idle = (await counters(page)).started; await page.waitForTimeout(1500); expect((await counters(page)).started).toBe(idle); // allowed is not playing
    await toggle.click(); expect(await toggle.getAttribute('aria-pressed')).toBe('true'); expect((await counters(page)).started).toBeGreaterThan(idle);
    await toggle.click(); expect(await toggle.getAttribute('aria-pressed')).toBe('false'); await toggle.click(); expect(await toggle.getAttribute('aria-pressed')).toBe('true');
    await page.reload(); await page.getByRole('banner').getByRole('button', { name: /^(Play|Stop) music$/ }).waitFor(); await page.waitForTimeout(800);
    expect(await counters(page)).toEqual({ created: 0, started: 0 }); // a reload plays nothing and does not resume music
    expect(await page.getByRole('banner').getByRole('button', { name: /^(Play|Stop) music$/ }).getAttribute('aria-pressed')).toBe('false'); await ctx.close();
  });
});
for (const vp of VIEWPORTS) describe(`level-up cinematic at ${vp.name}`, () => {
  it('opens once for a new level-up, traps focus, is skippable, fits the screen, passes axe, and never replays after a reload', async () => {
    const { ctx, page } = await openClocked(vp); await registerEmpty(page); await quickCreate(page, 'Hard focus', 'hard');
    await page.getByRole('button', { name: 'Complete Hard focus' }).click(); const d = page.getByRole('dialog'); await d.waitFor();
    expect(await d.getAttribute('aria-modal')).toBe('true'); expect(await d.getByRole('heading').textContent()).toBe('LEVEL UP'); expect(await d.textContent()).toMatch(/Levels 2 to 3 \(2 levels\)/); expect(await d.textContent()).toMatch(/\+2 attribute points/);
    expect(await page.evaluate(() => (document.querySelector('.shell') as HTMLElement & { inert: boolean }).inert)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Close');
    await settle(page); // measure at rest, not mid-way through the entry animation
    const geo = await page.evaluate(() => { const r = document.querySelector('[role=dialog]')!.getBoundingClientRect(); const bs = [...document.querySelectorAll<HTMLElement>('[role=dialog] button')].map((b) => { const x = b.getBoundingClientRect(); return [x.width, x.height, x.left, x.right]; });
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, bs }; });
    expect(geo.l).toBeGreaterThanOrEqual(0); expect(geo.r).toBeLessThanOrEqual(geo.vw + 0.5); expect(geo.t).toBeGreaterThanOrEqual(0); expect(geo.b).toBeLessThanOrEqual(geo.vh + 0.5); expect(geo.sw).toBeLessThanOrEqual(geo.vw + 1);
    for (const [w, h, l, r] of geo.bs as number[][]) { expect(w).toBeGreaterThanOrEqual(43.5); expect(h).toBeGreaterThanOrEqual(43.5); expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(geo.vw + 0.5); }
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true); }
    await page.waitForTimeout(700); expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press('Escape'); await d.waitFor({ state: 'detached' }); expect(await page.evaluate(() => (document.querySelector('.shell') as HTMLElement & { inert: boolean }).inert)).toBe(false);
    await page.waitForTimeout(100); expect(await page.evaluate(() => document.activeElement?.id)).toBe('main'); // the completed quest's button is gone, so focus returns to the page content
    await page.reload(); await page.getByRole('heading', { name: /^quests$/i, level: 1 }).waitFor(); await page.waitForTimeout(1000); expect(await page.getByRole('dialog').count()).toBe(0);
    await goto(page, 'Status'); expect(await statusLine(page)).toMatch(/Level 3/); expect((await page.getByText(/Unspent points/).textContent()) ?? '').toContain('2'); // rewards were granted exactly once
    await goto(page, 'History'); await page.getByRole('button', { name: 'System log' }).click(); expect(await page.getByRole('list', { name: /system events/i }).getByText('LEVEL UP', { exact: true }).count()).toBe(2);
    await ctx.close();
  });
});
describe('effects tiers (real browser)', () => {
  it('Reduced motion shows the same readable dialog with no animation; Minimal shows text banners instead of a dialog', async () => {
    const reduced = await openClocked(VIEWPORTS[1], { reducedMotion: 'reduce' }); await registerEmpty(reduced.page); await quickCreate(reduced.page, 'Hard focus', 'hard'); await reduced.page.getByRole('button', { name: 'Complete Hard focus' }).click();
    const d = reduced.page.getByRole('dialog'); await d.waitFor(); const info = await reduced.page.evaluate(() => { const panel = document.querySelector('.cine__panel') as HTMLElement; return { anim: getComputedStyle(panel).animationName, tier: document.querySelector('.cine')!.className, vis: getComputedStyle(panel).visibility }; });
    expect(info.anim).toBe('none'); expect(info.tier).toMatch(/cine--reduced/); expect(info.vis).toBe('visible'); expect(await d.textContent()).toMatch(/LEVEL UP.*Levels 2 to 3/); await reduced.ctx.close();
    const { ctx, page } = await openClocked(VIEWPORTS[1]); await registerEmpty(page); await quickCreate(page, 'One', 'hard'); await page.getByRole('button', { name: 'Complete One' }).click(); await dismissCinematic(page);
    await goto(page, 'Settings'); await page.getByLabel(/^Effects/).selectOption('minimal'); await page.getByRole('button', { name: /save preferences/i }).click(); await page.getByText('PREFERENCES SAVED').waitFor();
    await setNow(page, '2026-10-21T10:00:00.000Z'); await goto(page, 'Quests'); await page.getByText(/Today's quests \(2026-10-21\)/).waitFor(); // a new game day, so the 300 XP one-off cap does not apply
    await quickCreate(page, 'Two', 'hard'); await page.getByRole('button', { name: 'Complete Two' }).click(); await page.getByText(/\+200 XP awarded/).first().waitFor();
    const region = page.getByRole('region', { name: /notifications/i }); await page.waitForFunction(() => /LEVEL UP\s*Level 4/.test(document.querySelector('[aria-label=Notifications]')?.textContent ?? '')); expect(await region.textContent()).toMatch(/LEVEL UP.*Level 4/); expect(await page.getByRole('dialog').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.effects)).toBe('minimal'); await region.getByRole('button', { name: /dismiss level up/i }).click(); expect(await region.textContent()).not.toMatch(/Level 4/); await ctx.close();
  });
});
