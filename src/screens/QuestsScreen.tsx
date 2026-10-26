import { useEffect, useMemo, useState } from 'react';
import { createRecurringQuest, createOneOffQuest, editQuest, pauseQuest, removeQuest, resumeQuest, skipQuest, todayKey } from '../app/actions';
import { getTemplateDefinitions, type QuestOccurrence, type QuestVersion } from '../quests/domain';
import * as TR from '../timer/runtime';
import { UNDO_WINDOW_MS, timerViews, type TimerView } from '../timer/timer';
import { levelFromXp, totalXpToReach } from '../engine/progression';
import { playerView } from '../app/selectors';
import { SELF_REPORT_NOTICE, gapPrompt } from '../timer/text';
import { undoCompletionDb } from '../timer/runtime';
import { Panel, SystemMessage } from '../ui/components';
import { QuestForm } from './QuestForm';
import { formFromDefinition, scheduleLabel } from './questForm';
import { Feedback, useAction, type ScreenProps } from './shared';

const STATE_LABEL: Record<string, string> = { OPEN: 'Open', COMPLETED: 'Completed', PARTIAL: 'Partially banked', MISSED: 'Missed', LAPSED: 'Lapsed', SKIPPED: 'Skipped', EXEMPT: 'Protected (exempt)' };
const mmss = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rank = (o: QuestOccurrence) => (o.source === 'penalty' ? 0 : o.snapshot.important ? 1 : o.snapshot.mandatory ? 2 : 3) + (o.state === 'OPEN' ? 0 : 10);

function OccurrenceRow({ o, view, now, onRun, busy, db, total }: { o: QuestOccurrence; view?: TimerView; now: Date; onRun: ReturnType<typeof useAction>['run']; busy: boolean; db: ScreenProps['db']; total: number }) {
  const s = o.snapshot, timed = s.kind === 'timed', open = o.state === 'OPEN', penalty = o.source === 'penalty';
  const [gapMin, setGapMin] = useState('0');
  const [armed, setArmed] = useState<string | null>(null);
  const inWindow = o.state === 'COMPLETED' && !!o.completedAt && now.getTime() - Date.parse(o.completedAt) <= UNDO_WINDOW_MS && !penalty;
  const undoBlocked = inWindow && o.awardedXp > 0 && total - o.awardedXp < totalXpToReach(levelFromXp(total)); // levels are never lost (spec 3.7)
  const canUndo = inWindow && !undoBlocked;
  const go = (title: string, text: string | ((r: never) => string), f: (t: Date) => Promise<unknown>) => { setArmed(null); return onRun(title, text as never, () => f(new Date())); };
  const gap = view?.pendingGapMs ?? 0;
  return (
    <li className="panel" style={{ listStyle: 'none' }} aria-label={s.title}>
      <h3 style={{ marginBottom: 'var(--s2)' }}>{s.title}</h3>
      <p className="hint">
        {penalty && <span className="badge">Penalty quest</span>} {o.source === 'oneoff' && <span className="badge">One-off</span>} {o.source === 'rest' && <span className="badge">Rest day</span>}{' '}
        {s.important ? <span className="badge">Important</span> : s.mandatory ? <span className="badge">Mandatory</span> : null}{' '}
        {s.category} · {timed ? `Timed ${s.targetBlocks} × 15 min` : (s.difficulty ?? 'standard')} · {penalty ? 'No XP (clears the penalty)' : `${s.potentialXp} XP`}
        {o.state === 'COMPLETED' || o.state === 'PARTIAL' ? ` · ${o.awardedXp} XP awarded` : ''}
      </p>
      <p><strong>{STATE_LABEL[o.state]}</strong>{o.dueDayKey !== o.dayKey ? ` · due ${o.dueDayKey}` : ''}</p>
      {open && timed && (
        <div>
          <p aria-live="off">Active time {mmss(view?.activeMs ?? 0)} · blocks {view?.blocks ?? 0} / {s.targetBlocks}{view ? ` · ${view.status}` : ' · not started'}</p>
          <p className="hint">{SELF_REPORT_NOTICE}</p>
          {gap > 0 && (
            <SystemMessage title="TIMER INTERRUPTED" kind="reward">
              <p>{gapPrompt(gap)}</p>
              <label htmlFor={`gap-${o.id}`}>Minutes of the gap that count (0 to {Math.floor(gap / 60000)})</label>{' '}
              <input id={`gap-${o.id}`} type="number" min={0} max={Math.floor(gap / 60000)} value={gapMin} onChange={(e) => setGapMin(e.target.value)} style={{ minHeight: 44, width: 90 }} />{' '}
              <button type="button" className="btn" disabled={busy} onClick={() => go('TIME RECORDED', 'The session is paused. Resume when you are ready.', (t) => TR.resolveGapDb(db, o.id, Math.min(gap, Math.max(0, Math.floor(Number(gapMin) || 0)) * 60000), t))}>Record answer</button>
            </SystemMessage>
          )}
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            {!view && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => go('TIMER STARTED', 'Timer running.', (t) => TR.startTimerDb(db, o.id, t))}>Start {s.title}</button>}
            {view?.status === 'running' && gap === 0 && <button type="button" className="btn" disabled={busy} onClick={() => go('TIMER PAUSED', 'Timer paused.', (t) => TR.pauseTimerDb(db, o.id, t))}>Pause {s.title}</button>}
            {view?.status === 'paused' && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => go('TIMER RESUMED', 'Timer running.', (t) => TR.resumeTimerDb(db, o.id, t))}>Resume {s.title}</button>}
            {view && gap === 0 && view.blocks >= (s.targetBlocks ?? 99) && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => setArmed('complete')}>Complete {s.title}</button>}
            {view && gap === 0 && !penalty && view.blocks >= 1 && view.blocks < (s.targetBlocks ?? 0) && <button type="button" className="btn" disabled={busy} onClick={() => go('PROGRESS BANKED', (r: number) => `${r} XP banked for the full blocks; the quest stays unfinished.`, (t) => TR.bankPartialDb(db, o.id, t))}>Bank {view.blocks} block{view.blocks === 1 ? '' : 's'} of {s.title}</button>}
          </div>
          {armed === 'complete' && (
            <div role="group" aria-label={`Confirm ${s.title}`}>
              <p>I performed this activity for the recorded time.</p>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => go('QUEST COMPLETED', (r: number) => (penalty ? 'Penalty cleared.' : `+${r} XP awarded.`), (t) => TR.completeTimerDb(db, o.id, true, t))}>Confirm completion</button>{' '}
              <button type="button" className="btn" onClick={() => setArmed(null)}>Not yet</button>
            </div>
          )}
        </div>
      )}
      {open && !timed && (
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => go('QUEST COMPLETED', (r: number) => (penalty ? 'Penalty cleared.' : `+${r} XP awarded.`), (t) => TR.completeStandardDb(db, o.id, true, t))}>Complete {s.title}</button>
        </div>
      )}
      {open && !penalty && (
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {armed === 'skip'
            ? <><span>{s.mandatory ? 'Skipping a mandatory quest counts as a miss.' : 'Skipping an optional quest has no consequence.'}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => go('QUEST SKIPPED', 'Skipped.', (t) => skipQuest(db, o.id, t))}>Confirm skip {s.title}</button>
              <button type="button" className="btn" onClick={() => setArmed(null)}>Cancel</button></>
            : <button type="button" className="btn" disabled={busy} onClick={() => setArmed('skip')}>Skip {s.title}</button>}
        </div>
      )}
      {undoBlocked && <p className="hint">Undo is unavailable: this completion reached a new level, and levels are never lost.</p>}
      {canUndo && <button type="button" className="btn" disabled={busy} onClick={() => go('COMPLETION UNDONE', 'The quest is open again.', (t) => undoCompletionDb(db, o.id, t))}>Undo {s.title} (2 minutes)</button>}
    </li>
  );
}

export function QuestsScreen({ db, payload, refresh }: ScreenProps) {
  const { run, busy, msg } = useAction(refresh);
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const views = useMemo(() => new Map(timerViews(payload, now).map((v) => [v.occurrenceId, v])), [payload, now]);
  const runningIds = [...views.values()].filter((v) => v.status === 'running').map((v) => v.occurrenceId).join(',');
  useEffect(() => { // keep-alive signal: a running timer is only trusted while the app keeps reporting in
    if (!runningIds) return; const i = setInterval(() => { for (const id of runningIds.split(',')) TR.heartbeatDb(db, id, new Date()).catch(() => undefined); }, 15_000);
    return () => clearInterval(i);
  }, [runningIds, db]);
  const today = todayKey(payload, now); const total = playerView(payload).total;
  const occurrences = (payload.occurrences as unknown as QuestOccurrence[]).filter((o) => o.dayKey === today || (o.state === 'OPEN' && o.dueDayKey >= today && o.dayKey <= today)).sort((a, b) => rank(a) - rank(b));
  const templates = payload.templates.filter((t) => t.status !== 'archived' || !t.archivedFromDayKey || String(t.archivedFromDayKey) > today);
  const latest = (id: string): QuestVersion | undefined => getTemplateDefinitions(payload, id).slice(-1)[0];
  return (
    <>
      <Feedback msg={msg} />
      <Panel title={`Today's quests (${today})`}>
        {occurrences.length === 0
          ? <SystemMessage title="NO QUESTS FOR TODAY">No quests are scheduled for the current game day. Create one below.</SystemMessage>
          : <ul style={{ padding: 0, margin: 0 }} aria-label="Today's quests">{occurrences.map((o) => <OccurrenceRow key={o.id} o={o} view={views.get(o.id)} now={now} onRun={run} busy={busy} db={db} total={total} />)}</ul>}
      </Panel>
      <Panel title="Create a quest">
        <QuestForm mode="create" today={today} busy={busy} onSubmit={(b) => run('QUEST CREATED', b.kind === 'oneoff' ? `"${b.input.title}" was added for today.` : `"${b.def.title}" repeats ${scheduleLabel(b.def.schedule).toLowerCase()} and is on today's list.`,
          () => (b.kind === 'oneoff' ? createOneOffQuest(db, b.input, new Date()) : createRecurringQuest(db, b.def, new Date())) as Promise<unknown>)} />
      </Panel>
      <Panel title="Recurring quests">
        {templates.length === 0 ? <p className="hint">No recurring quests yet.</p> : (
          <ul style={{ padding: 0, margin: 0 }} aria-label="Recurring quests">{templates.map((t) => { const v = latest(String(t.id)); if (!v) return null; const paused = !!v.pausedFromDayKey && (!v.resumeDayKey || v.resumeDayKey > today);
            return (
              <li key={String(t.id)} className="panel" style={{ listStyle: 'none' }}>
                <h3>{v.title}</h3><p className="hint">{scheduleLabel(v.schedule)} · {v.kind === 'timed' ? `${v.targetBlocks} blocks` : v.difficulty} · {v.category}{v.important ? ' · important' : v.mandatory ? ' · mandatory' : ''}{paused ? ' · paused' : ''}{t.status === 'archived' ? ' · removed from tomorrow' : ''}</p>
                {editing === t.id ? <QuestForm mode="edit" today={today} busy={busy} initial={formFromDefinition(v)} onCancel={() => setEditing(null)}
                  onSubmit={async (b) => { if (b.kind !== 'recurring') return false; const ok = await run('QUEST UPDATED', 'Changes apply from tomorrow; today\'s quest is unchanged.', () => editQuest(db, String(t.id), b.def, new Date())); if (ok) setEditing(null); return ok; }} />
                  : t.status !== 'archived' && <div className="actions" style={{ justifyContent: 'flex-start' }}>
                    <button type="button" className="btn" onClick={() => setEditing(String(t.id))}>Edit {v.title}</button>
                    {paused ? <button type="button" className="btn" disabled={busy} onClick={() => run('QUEST RESUMED', 'Resumes from tomorrow.', () => resumeQuest(db, String(t.id), new Date()))}>Resume schedule of {v.title}</button>
                      : <button type="button" className="btn" disabled={busy} onClick={() => run('QUEST PAUSED', 'Paused from tomorrow; paused days are exempt.', () => pauseQuest(db, String(t.id), new Date()))}>Pause schedule of {v.title}</button>}
                    <button type="button" className="btn" disabled={busy} onClick={() => run('QUEST REMOVED', 'Removed from tomorrow; history is kept.', () => removeQuest(db, String(t.id), new Date()))}>Remove {v.title}</button>
                  </div>}
              </li>); })}</ul>)}
      </Panel>
      <Panel title="Recent System messages">
        {payload.systemMessages.length === 0 ? <p className="hint">No messages.</p> : [...payload.systemMessages].slice(-4).reverse().map((m) => <SystemMessage key={String(m.id)} title={String(m.kind)}>{' '}{String(m.text)}</SystemMessage>)}
      </Panel>
    </>
  );
}
