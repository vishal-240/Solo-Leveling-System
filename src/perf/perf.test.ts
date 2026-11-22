import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as H from '../history/history';
import { validatePayload } from '../persist/backup';
import { SlsDb, loadPayload, replaceAll } from '../persist/store';
import { snoozeReminder } from '../app/actions';
import { bigPayload } from './dataset';

const time = <T,>(f: () => T) => { const t = performance.now(); const r = f(); return { ms: performance.now() - t, r }; };
describe('large datasets (about 3 years of play: 5,475 quests, ~8,700 ledger rows)', () => {
  const p = bigPayload(); const idx = H.indexHistory(p, '2025-12-31');
  it('has the expected size', () => { expect([p.occurrences.length, p.xpTransactions.length, p.dayRecords.length]).toEqual([5475, 10950, 1095]); });
  it('history read models stay fast', () => {
    const r = { index: time(() => H.indexHistory(p, '2025-12-31')).ms, week: time(() => H.xpBuckets(p, idx, 'week')).ms, month: time(() => H.xpBuckets(p, idx, 'month')).ms, attrs: time(() => H.attributeBreakdown(p)).ms, stats: time(() => H.completionStats(p, '2025-12-31')).ms,
      ledger: time(() => H.ledgerRows(p, {})).ms, log: time(() => H.systemLog(p)).ms, dayLog: time(() => H.systemLog(p, { dayKey: '2025-06-01' })).ms };
    console.log('PERF read models (ms)', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])))); for (const [k, v] of Object.entries(r)) expect(v, k).toBeLessThan(500);
    expect(H.xpBuckets(p, idx, 'week').total).toBe(p.xpTransactions.filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta), 0));
  });
  it('validation, storage round trip and a single write stay within a practical budget', async () => {
    const v = time(() => validatePayload(p)); console.log('PERF validate (ms)', Math.round(v.ms)); expect(v.r.errors).toEqual([]); expect(v.ms).toBeLessThan(3000);
    const db = new SlsDb(`perf-${Math.random()}`); await db.open(); let t = performance.now(); await replaceAll(db, p); const write = performance.now() - t; t = performance.now(); await loadPayload(db); const read = performance.now() - t;
    t = performance.now(); await snoozeReminder(db, new Date()); const action = performance.now() - t; console.log('PERF db write/read/one-action (ms)', Math.round(write), Math.round(read), Math.round(action));
    expect(write).toBeLessThan(8000); expect(read).toBeLessThan(5000); expect(action).toBeLessThan(5000);
  });
});
