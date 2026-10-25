import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { validatePayload } from '../persist/backup';
import { SlsDb, loadPayload, startupCheck } from '../persist/store';
import * as M from './model';
import { OnboardingError, buildRegistration, registerPlayer } from './register';

const now = new Date('2026-10-20T10:00:00Z');
const draft = (o: Partial<M.Draft> = {}): M.Draft => ({ ...M.defaultDraft({ timezone: 'Asia/Kolkata' }), ...o });
const fresh = async () => { const db = new SlsDb(`reg-${Math.random()}`); await db.open(); return db; };

describe('onboarding model', () => {
  it('seven steps; the first and last are not skippable; defaults match the spec', () => {
    expect(M.STEPS).toHaveLength(7); expect(M.SKIPPABLE).not.toContain('awakening'); expect(M.SKIPPABLE).not.toContain('confirm');
    expect(M.defaultDraft({ timezone: 'Asia/Kolkata' })).toMatchObject({ resetTime: '04:00', timezone: 'Asia/Kolkata', allocationMode: 'manual', musicEnabled: false, effects: 'full' });
    expect(M.defaultDraft({ timezone: 'Nope/Zone' }).timezone).toBe('UTC'); expect(M.defaultDraft({ reducedMotion: true }).effects).toBe('reduced');
  });
  it('validation errors per step', () => {
    expect(M.validateStep('player', draft({ name: 'x'.repeat(25) })).name).toMatch(/24/);
    expect(M.validateStep('player', draft({ name: 'bad\u0007' })).name).toBeDefined();
    expect(M.validateStep('player', draft({ title: 'y'.repeat(33) })).title).toBeDefined();
    expect(M.validateStep('attributes', draft({ goals: { ...draft().goals, coding: 'g'.repeat(81) } }))['goal-coding']).toBeDefined();
    expect(M.validateStep('quests', draft({ custom: [{ title: ' ', category: 'coding', difficulty: 'easy', mandatory: false }] }))['custom-0']).toBeDefined();
    expect(M.validateStep('reset', draft({ timezone: 'Mars/Base', resetTime: '25:61' }))).toMatchObject({ timezone: expect.any(String), resetTime: expect.any(String) });
    expect(M.validateStep('reset', draft())).toEqual({}); expect(M.validateStep('player', draft({ name: 'Vishal' }))).toEqual({});
  });
  it('skipping restores that step to defaults', () => {
    const base = draft(); const d = draft({ name: 'V', timezone: 'UTC', resetTime: '09:00', starters: ['study'], allocationMode: 'momentum', effects: 'minimal', musicEnabled: true });
    expect(M.skipStep('player', d, base)).toMatchObject({ name: '', title: '' });
    expect(M.skipStep('quests', d, base).starters).toEqual([]);
    expect(M.skipStep('reset', d, base)).toMatchObject({ timezone: 'Asia/Kolkata', resetTime: '04:00' });
    expect(M.skipStep('rules', d, base)).toMatchObject({ allocationMode: 'manual', effects: 'full', musicEnabled: false });
  });
  it('draft persistence tolerates missing, corrupt and out-of-range data', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(M.loadDraft(store(null), draft())).toEqual(draft());
    for (const bad of ['{nope', '{"step":99}', '{"step":-1}', '{"step":1,"starters":"x"}']) expect(M.loadDraft(store(bad), draft())).toEqual(draft());
    expect(M.loadDraft(store(JSON.stringify({ step: 3, name: 'A' })), draft())).toMatchObject({ step: 3, name: 'A' });
    expect(M.loadDraft({ getItem: () => { throw new Error('denied'); } }, draft())).toEqual(draft());
  });
});
describe('registration', () => {
  it('builds a valid payload with settings, goals, templates and today\'s quests, and no XP, rewards or events', () => {
    const d = draft({ name: 'Vishal', title: 'Awakened', timezone: 'Asia/Kolkata', resetTime: '05:30', starters: ['study', 'workout'], effects: 'reduced', allocationMode: 'balanced',
      custom: [{ title: 'Read', category: 'academics', difficulty: 'hard', mandatory: true }], goals: { ...draft().goals, coding: 'Ship the SoC project' } });
    const r = buildRegistration(d, now); const p = r.payload;
    expect(validatePayload(p).errors).toEqual([]);
    expect([r.quests, r.generated, p.templates.length, p.occurrences.length]).toEqual([3, 3, 3, 3]);
    expect(p.player).toMatchObject({ name: 'Vishal', startingTitle: 'Awakened', allocationMode: 'balanced' });
    expect(p.settings).toMatchObject({ timezone: 'Asia/Kolkata', resetTime: '05:30', effects: 'reduced', penaltyStrictness: 'strict' });
    expect(p.attributes.map((a) => a.id)).toEqual(['academics', 'fitness', 'coding', 'discipline', 'recovery']);
    expect(p.attributes.find((a) => a.id === 'coding')!.goal).toBe('Ship the SoC project');
    for (const k of ['xpTransactions', 'rewardGrants', 'levelEvents', 'rankEvents', 'penaltyEvents'] as const) expect(p[k]).toHaveLength(0);
    expect(p.systemMessages.map((m) => m.kind)).toContain('DAILY QUEST UPDATED');
  });
  it('an all-skipped registration uses defaults', () => {
    const r = buildRegistration(draft(), now); expect(r.payload.player.name).toBe('Player'); expect(r.quests).toBe(0); expect(r.payload.settings.resetTime).toBe('04:00');
  });
  it('persists once; a second or concurrent registration is rejected without changing stored data', async () => {
    const db = await fresh(); expect((await startupCheck(db)).fresh).toBe(true);
    const results = await Promise.allSettled([registerPlayer(db, draft({ name: 'A', starters: ['study'] }), now), registerPlayer(db, draft({ name: 'B', starters: ['study', 'workout'] }), now)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult; expect(rejected.reason).toBeInstanceOf(OnboardingError);
    const stored = await loadPayload(db); expect(['A', 'B']).toContain(stored.player.name);
    await expect(registerPlayer(db, draft({ name: 'C' }), now)).rejects.toMatchObject({ code: 'ALREADY_REGISTERED' });
    expect(await loadPayload(db)).toEqual(stored); expect(await startupCheck(db)).toEqual({ fresh: false, errors: [] });
    expect(stored.templates.length).toBe(stored.player.name === 'A' ? 1 : 2);
  });
});
