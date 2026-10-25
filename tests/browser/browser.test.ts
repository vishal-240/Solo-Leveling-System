// Real-browser acceptance checks for P6 (rendered layout, focus, reduced motion, axe with colour contrast, SW/offline probe).
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
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => undefined));
/** Layout problems measured in the rendered page. */
const layoutProblems = async (page: Page) => { await settle(page); return page.evaluate(() => {
  const out: string[] = []; const vw = window.innerWidth; const de = document.documentElement;
  if (de.scrollWidth > vw + 1) out.push(`horizontal overflow: scrollWidth ${de.scrollWidth} > ${vw}`);
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
