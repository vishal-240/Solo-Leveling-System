import { useCallback, useEffect, useState } from 'react';
import { levelFromXp, rankForLevel, totalXpToReach, needPlayer } from './engine/progression';
import { Onboarding } from './onboarding/Onboarding';
import { loadPayload, startupCheck, type SlsDb } from './persist/store';
import type { Payload } from './persist/backup';
import { DESTINATIONS, Nav, Panel, Shell, SystemMessage, type DestinationId } from './ui/components';

type State = { kind: 'loading' } | { kind: 'onboarding' } | { kind: 'error'; message: string } | { kind: 'ready'; payload: Payload };

export function App({ db }: { db: SlsDb }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [dest, setDest] = useState<DestinationId>('quests');
  const refresh = useCallback(async () => {
    try {
      const check = await startupCheck(db);
      if (check.errors.length) { setState({ kind: 'error', message: check.errors.join('; ') }); return; }
      setState(check.fresh ? { kind: 'onboarding' } : { kind: 'ready', payload: await loadPayload(db) });
    } catch (e) { setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }); }
  }, [db]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (state.kind === 'ready') document.documentElement.dataset.effects = String(state.payload.settings.effects ?? 'full'); }, [state]);

  if (state.kind === 'loading') return <p role="status" className="shell__main">Loading</p>;
  if (state.kind === 'error') return <main className="shell__main"><h1>System</h1><SystemMessage title="STORAGE ERROR" kind="penalty">{state.message}</SystemMessage></main>;
  if (state.kind === 'onboarding') return <Onboarding db={db} onRegistered={() => { try { void navigator.storage?.persist?.(); } catch { /* optional */ } void refresh(); }} />;
  const p = state.payload;
  const total = p.xpTransactions.filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta), 0);
  const level = levelFromXp(total), into = total - totalXpToReach(level), need = needPlayer(level);
  const current = DESTINATIONS.find((d) => d.id === dest)!;
  return (
    <Shell player={`${String(p.player.name)} | Rank ${rankForLevel(level)} | Level ${level}`} nav={<Nav current={dest} onNavigate={setDest} />}>
      <h1>{current.label}</h1>
      <Panel title="Player status">
        <div className="bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={need} aria-valuenow={into}><span style={{ width: `${Math.min(100, (into / need) * 100)}%` }} /></div>
        <p className="hint">{into} / {need} XP to level {level + 1}</p>
      </Panel>
      <Panel title="Screen status"><p><span className="badge">Not yet implemented</span></p><p className="hint">The {current.label} screen is part of phase {current.phase} and does not exist yet.</p></Panel>
      <Panel title="System messages">
        {p.systemMessages.length === 0 ? <p className="hint">No messages.</p> : [...p.systemMessages].slice(-3).reverse().map((m) => <SystemMessage key={String(m.id)} title={String(m.kind)}>{' '}{String(m.text)}</SystemMessage>)}
      </Panel>
    </Shell>
  );
}
