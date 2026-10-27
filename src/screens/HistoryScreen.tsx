import { Component, useId, useMemo, useState, type ReactNode } from 'react';
import { ATTRS } from '../rewards/rewards';
import { Panel, SystemMessage } from '../ui/components';
import { KIND_LABEL, LOG_CATEGORIES, STATUS_GLYPH, STATUS_LABEL, WEEKDAY_NAMES, achievementGallery, attributeBreakdown, completionStats, formatInstant, indexHistory, ledgerRows,
  monthGrid, monthOf, shiftMonth, summaryFor, systemLog, todayOf, weekStartOf, xpBuckets, type Bucket, type HistoryIndex, type LogCategory } from '../history/history';
import type { ScreenProps } from './shared';

const NAME: Record<string, string> = { academics: 'Academics', fitness: 'Fitness', coding: 'Coding', discipline: 'Discipline', recovery: 'Recovery', player: 'Player' };
const longDate = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const VIEWS = ['Calendar', 'Charts', 'XP ledger', 'System log', 'Achievements'] as const;
type View = (typeof VIEWS)[number];
const PAGE = 50;

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <SystemMessage title="HISTORY UNAVAILABLE" kind="error">{' '}Could not read the stored history: {this.state.error.message}. Your data was not changed.</SystemMessage> : this.props.children; }
}
function BarChart({ buckets, caption }: { buckets: Bucket[]; caption: string }) {
  const id = useId(); const W = 320, H = 140, base = 90, n = Math.max(1, buckets.length), bw = W / n;
  const max = Math.max(1, ...buckets.map((b) => b.net)), min = Math.min(0, ...buckets.map((b) => b.net)), up = base - 10, down = H - base - 10;
  const summary = `${caption}: ${buckets.map((b) => `${b.label} ${signed(b.net)} XP`).join('; ')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ width: '100%', maxWidth: 640, height: 'auto' }}>
      <defs><pattern id={`${id}h`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--surface-2)" /><line x1="0" y1="0" x2="0" y2="4" stroke="var(--danger)" strokeWidth="2" /></pattern></defs>
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--edge-dim)" />
      {buckets.map((b, i) => { const h = b.net >= 0 ? (b.net / max) * up : (-b.net / Math.max(1, -min)) * down; const y = b.net >= 0 ? base - h : base;
        return <rect key={b.key} x={i * bw + bw * 0.15} y={y} width={bw * 0.7} height={Math.max(h, b.net === 0 ? 0 : 1)} fill={b.net >= 0 ? 'var(--accent)' : `url(#${id}h)`} stroke={b.net >= 0 ? 'none' : 'var(--danger)'}><title>{`${b.label}: ${signed(b.net)} XP`}</title></rect>; })}
    </svg>
  );
}
function BucketTable({ buckets, caption }: { buckets: Bucket[]; caption: string }) {
  return (
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}><caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Earned</th><th scope="col">Deducted</th><th scope="col">Net</th><th scope="col">Forfeited</th></tr></thead>
      <tbody>{[...buckets].reverse().map((b) => <tr key={b.key}><th scope="row">{b.label}</th><td>{b.earned}</td><td>{b.deducted}</td><td>{signed(b.net)}</td><td>{b.forfeited}</td></tr>)}</tbody></table></div>
  );
}
function ChartsView({ p, idx }: { p: Payload2; idx: HistoryIndex }) {
  const [unit, setUnit] = useState<'week' | 'month'>('week');
  const { buckets, total } = useMemo(() => xpBuckets(p, idx, unit), [p, idx, unit]);
  const shown = buckets.slice(-12), earlier = buckets.slice(0, Math.max(0, buckets.length - 12)).reduce((s, b) => s + b.net, 0);
  const attrs = useMemo(() => attributeBreakdown(p), [p]); const stats = useMemo(() => completionStats(p, idx.today), [p, idx]);
  const streak = p.streaks.find((s) => s.scope === 'daily');
  return (
    <>
      <Panel title="XP trend">
        <div role="group" aria-label="Chart range" className="actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn" aria-pressed={unit === 'week'} onClick={() => setUnit('week')}>Weekly</button>
          <button type="button" className="btn" aria-pressed={unit === 'month'} onClick={() => setUnit('month')}>Monthly</button></div>
        {shown.length === 0 ? <p className="hint">No XP has been recorded yet.</p> : <>
          <BarChart buckets={shown} caption={unit === 'week' ? 'Weekly net XP' : 'Monthly net XP'} />
          <p className="hint">Net XP per {unit} (earned minus deducted; undone completions are netted out). Hatched bars are negative. {earlier !== 0 ? `${signed(earlier)} XP from earlier periods is not drawn. ` : ''}All periods total {total} XP, which equals your ledger total.</p>
          <BucketTable buckets={shown} caption={`${unit === 'week' ? 'Weekly' : 'Monthly'} XP data`} /></>}
      </Panel>
      <Panel title="Attribute breakdown">
        <table style={{ width: '100%' }}><caption className="sr-only">XP by attribute</caption><thead><tr><th scope="col">Attribute</th><th scope="col">Level</th><th scope="col">Net XP</th><th scope="col">Share</th></tr></thead>
          <tbody>{attrs.map((a) => <tr key={a.id}><th scope="row">{NAME[a.id]}</th><td>{a.level}</td><td>{a.net}</td><td>{a.share === null ? 'n/a' : `${Math.round(a.share * 100)}%`}</td></tr>)}</tbody></table>
        <p className="hint">Share is each attribute's net XP divided by the sum of all attributes' net XP.</p>
      </Panel>
      <Panel title="Quest completion">
        <table style={{ width: '100%' }}><caption className="sr-only">Quest completion statistics</caption><thead><tr><th scope="col">Window</th><th scope="col">Completed</th><th scope="col">Missed</th><th scope="col">Rate</th><th scope="col">Days</th></tr></thead>
          <tbody>{stats.map((s) => <tr key={s.label}><th scope="row">{s.label}</th><td>{s.completed}</td><td>{s.missed + s.partial + s.lapsed}</td><td>{s.rate === null ? 'n/a' : `${Math.round(s.rate * 100)}% (${s.completed}/${s.denominator})`}</td><td>{s.days}</td></tr>)}</tbody></table>
        <p className="hint">Rate = completed ÷ (completed + missed + partially banked + lapsed) over processed days. Exempt, skipped, open, penalty and future quests are not counted.</p>
        <p>Daily streak: current {Number(streak?.current ?? 0)}, longest {Number(streak?.longest ?? 0)}. Streak history beyond these two stored values is not recorded.</p>
      </Panel>
    </>
  );
}
type Payload2 = ScreenProps['payload'];

function Calendar({ p, idx, month, setMonth, selected, setSelected, tz }: { p: Payload2; idx: HistoryIndex; month: string; setMonth: (m: string) => void; selected: string; setSelected: (d: string) => void; tz: string }) {
  const ws = weekStartOf(p), grid = monthGrid(month, ws), cur = monthOf(idx.today), floor = monthOf(idx.first ?? idx.today);
  const head = Array.from({ length: 7 }, (_, i) => WEEKDAY_NAMES[(ws + i) % 7]!);
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const s = summaryFor(idx, selected);
  const occ = p.occurrences.filter((o) => o.dayKey === selected);
  return (
    <>
      <Panel title="Calendar">
        <p><strong aria-live="polite" id="cal-label">{label}</strong></p>
        <div className="actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
          <button type="button" className="btn" disabled={month <= floor} onClick={() => setMonth(shiftMonth(month, -1))}>Previous month</button>
          <button type="button" className="btn" disabled={month >= cur} onClick={() => setMonth(shiftMonth(month, 1))}>Next month</button>
        </div>
        <table className="cal" aria-labelledby="cal-label"><thead><tr>{head.map((d) => <th key={d} scope="col" abbr={d}>{d.slice(0, 2)}</th>)}</tr></thead>
          <tbody>{grid.map((week, i) => <tr key={i}>{week.map((k, j) => { if (!k) return <td key={j} />; const d = summaryFor(idx, k), future = k > idx.today;
            return <td key={k}><button type="button" className="cal__day" data-status={d.status} aria-pressed={k === selected} aria-current={k === idx.today ? 'date' : undefined} disabled={future}
              aria-label={`${longDate(k)}: ${future ? 'future day' : STATUS_LABEL[d.status]}${d.status === 'nodata' || future ? '' : `, ${d.completed} completed, ${d.missed + d.partial + d.lapsed} missed, net ${signed(d.xpNet)} XP`}`} onClick={() => setSelected(k)}>
              <span>{+k.slice(8)}</span><span aria-hidden="true" className="cal__glyph">{future ? '' : STATUS_GLYPH[d.status]}</span></button></td>; })}</tr>)}</tbody></table>
        <ul className="legend" aria-label="Legend">{(['clear', 'mixed', 'missed', 'rest', 'in-progress', 'exempt', 'empty'] as const).map((k) => <li key={k}><span aria-hidden="true">{STATUS_GLYPH[k]}</span> {STATUS_LABEL[k]}</li>)}</ul>
        {idx.first === null && <SystemMessage title="NO HISTORY YET">History appears here after your first game day. Nothing is shown until quests exist.</SystemMessage>}
      </Panel>
      <Panel title={`Day ${selected}`}>
        {s.status === 'nodata' ? <p className="hint">No data was recorded for this day.</p> : (<>
          <p><strong>{STATUS_LABEL[s.status]}</strong>{s.processed ? '' : ' (day not closed yet)'}</p>
          <p>{s.completed} completed · {s.missed} missed · {s.partial} partially banked · {s.lapsed} lapsed · {s.skipped} skipped · {s.exempt} exempt · {s.open} open</p>
          <p>XP earned {s.xpEarned} · deducted {s.xpDeducted} · net {signed(s.xpNet)} · forfeited {s.xpForfeited}</p>
          {occ.length > 0 && <><h3>Quests</h3><ul aria-label={`Quests on ${selected}`}>{occ.map((o) => <li key={String(o.id)}>{String((o.snapshot as { title: string }).title)}: {String(o.state).toLowerCase()}{Number(o.awardedXp) ? `, ${o.awardedXp} XP awarded` : ''}{o.source === 'penalty' ? ' (penalty quest)' : ''}</li>)}</ul></>}
          {(() => { const log = systemLog(p, { dayKey: selected }); return log.length > 0 && <><h3>Events</h3><ul aria-label={`Events on ${selected}`}>{log.map((e) => <li key={e.id}>{formatInstant(e.at, tz)} · {e.title}: {e.detail}</li>)}</ul></>; })()}
        </>)}
      </Panel>
    </>
  );
}
function Ledger({ p, selected, tz }: { p: Payload2; selected: string; tz: string }) {
  const [scope, setScope] = useState(''); const [kind, setKind] = useState(''); const [day, setDay] = useState(false); const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => ledgerRows(p, { scope, kind, dayKey: day ? selected : undefined }), [p, scope, kind, day, selected]);
  const total = p.xpTransactions.filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta), 0);
  return (
    <Panel title="XP ledger">
      <div className="filters">
        <div className="field"><label htmlFor="lf-scope">Scope</label><select id="lf-scope" value={scope} onChange={(e) => { setScope(e.target.value); setLimit(PAGE); }}><option value="">All</option><option value="player">Player</option>{ATTRS.map((a) => <option key={a} value={a}>{NAME[a]}</option>)}</select></div>
        <div className="field"><label htmlFor="lf-kind">Kind</label><select id="lf-kind" value={kind} onChange={(e) => { setKind(e.target.value); setLimit(PAGE); }}><option value="">All</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={day} onChange={(e) => { setDay(e.target.checked); setLimit(PAGE); }} />Only the selected day ({selected})</label>
      </div>
      {rows.length === 0 ? <p className="hint">{p.xpTransactions.length === 0 ? 'No XP has been recorded yet.' : 'No ledger entries match these filters.'}</p> : (<>
        <p className="hint" role="status">Showing {Math.min(limit, rows.length)} of {rows.length} entries, newest first. Player ledger total: {total} XP (same as Status).</p>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}><caption className="sr-only">XP ledger entries</caption>
          <thead><tr><th scope="col">Time</th><th scope="col">Day</th><th scope="col">Scope</th><th scope="col">Kind</th><th scope="col">Quest</th><th scope="col">Requested</th><th scope="col">Applied</th></tr></thead>
          <tbody>{rows.slice(0, limit).map((r) => <tr key={r.id}><td>{formatInstant(r.at, tz)}</td><td>{r.dayKey}</td><td>{NAME[r.scope] ?? r.scope}</td><td>{KIND_LABEL[r.kind] ?? r.kind}</td><td>{r.quest || '–'}</td><td>{signed(r.requested)}</td><td>{signed(r.applied)}{r.clamped ? ' (limited by level floor)' : ''}</td></tr>)}</tbody></table></div>
        {limit < rows.length && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}</>)}
    </Panel>
  );
}
function Log({ p, selected, tz }: { p: Payload2; selected: string; tz: string }) {
  const [cat, setCat] = useState<LogCategory | ''>(''); const [day, setDay] = useState(false); const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => systemLog(p, { category: cat || undefined, dayKey: day ? selected : undefined }), [p, cat, day, selected]);
  return (
    <Panel title="System log">
      <div className="filters">
        <div className="field"><label htmlFor="lg-cat">Category</label><select id="lg-cat" value={cat} onChange={(e) => { setCat(e.target.value as LogCategory | ''); setLimit(PAGE); }}><option value="">All</option>{LOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <label className="check"><input type="checkbox" checked={day} onChange={(e) => { setDay(e.target.checked); setLimit(PAGE); }} />Only the selected day ({selected})</label>
      </div>
      {rows.length === 0 ? <p className="hint">{p.systemMessages.length + p.levelEvents.length + p.rewardGrants.length + p.penaltyEvents.length === 0 ? 'No events yet.' : 'No events match these filters.'}</p> : (<>
        <p className="hint" role="status">Showing {Math.min(limit, rows.length)} of {rows.length} events, newest first.</p>
        <ol className="log" aria-label="System events">{rows.slice(0, limit).map((e) => <li key={e.id}><span className="badge">{e.category}</span> <strong>{e.title}</strong> <span className="hint">{formatInstant(e.at, tz)} · game day {e.dayKey}</span><br />{e.detail}</li>)}</ol>
        {limit < rows.length && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}</>)}
    </Panel>
  );
}
function Achievements({ p, tz }: { p: Payload2; tz: string }) {
  const items = achievementGallery(p), got = items.filter((i) => i.unlocked).length;
  return (
    <Panel title="Achievements">
      <p>{got} of {items.length} unlocked. Hidden achievements stay hidden until you unlock them.</p>
      <ul className="gallery" aria-label="Achievements">{items.map((i) => (
        <li key={i.id} data-unlocked={i.unlocked}>
          <strong>{i.hidden && !i.unlocked ? 'Hidden achievement' : i.name}</strong>{' '}<span className="badge">{i.unlocked ? 'Unlocked' : i.hidden ? 'Hidden' : 'Locked'}</span><br />
          {i.unlocked ? <span className="hint">Unlocked {formatInstant(i.unlockedAt!, tz)}</span> : i.hidden ? <span className="hint">Keep progressing to discover it.</span> : <span className="hint">Progress {i.progress} / {i.target}</span>}
        </li>))}</ul>
    </Panel>
  );
}
function HistoryBody({ payload: p }: ScreenProps) {
  const now = new Date(); const today = todayOf(p, now); const tz = String(p.settings.timezone ?? 'UTC');
  const idx = useMemo(() => indexHistory(p, today), [p, today]);
  const [view, setView] = useState<View>('Calendar'); const [month, setMonth] = useState(monthOf(today)); const [selected, setSelected] = useState(today);
  return (
    <>
      <div role="group" aria-label="History views" className="actions" style={{ justifyContent: 'flex-start' }}>
        {VIEWS.map((v) => <button key={v} type="button" className="btn" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
      </div>
      {view === 'Calendar' && <Calendar p={p} idx={idx} month={month} setMonth={setMonth} selected={selected} setSelected={setSelected} tz={tz} />}
      {view === 'Charts' && <ChartsView p={p} idx={idx} />}
      {view === 'XP ledger' && <Ledger p={p} selected={selected} tz={tz} />}
      {view === 'System log' && <Log p={p} selected={selected} tz={tz} />}
      {view === 'Achievements' && <Achievements p={p} tz={tz} />}
    </>
  );
}
export const HistoryScreen = (props: ScreenProps) => <Boundary><HistoryBody {...props} /></Boundary>;
