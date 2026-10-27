import { useCallback, useEffect, useState } from 'react';
import { playerView } from './app/selectors';
import { runDayClose } from './app/actions';
import { HistoryScreen } from './screens/HistoryScreen';
import { QuestsScreen } from './screens/QuestsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatusScreen } from './screens/StatusScreen';
import { Onboarding } from './onboarding/Onboarding';
import { loadPayload, startupCheck, type SlsDb } from './persist/store';
import type { Payload } from './persist/backup';
import { DESTINATIONS, Nav, Panel, Shell, SystemMessage, type DestinationId } from './ui/components';

type State = { kind: 'loading' } | { kind: 'onboarding' } | { kind: 'error'; message: string } | { kind: 'ready'; payload: Payload };

export function App({ db }: { db: SlsDb }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [dest, setDest] = useState<DestinationId>('quests');
  const load = useCallback(async () => {
    try {
      const check = await startupCheck(db);
      if (check.errors.length) { setState({ kind: 'error', message: check.errors.join('; ') }); return; }
      setState(check.fresh ? { kind: 'onboarding' } : { kind: 'ready', payload: await loadPayload(db) });
    } catch (e) { setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }); }
  }, [db]);
  /** Processes any finished game days (idempotent), then re-reads stored state. Runs on open, on return to the tab and periodically. */
  const sync = useCallback(async () => { try { const c = await startupCheck(db); if (!c.fresh && !c.errors.length) await runDayClose(db, new Date()); } catch { /* surfaced by load() */ } await load(); }, [db, load]);
  useEffect(() => { void sync(); }, [sync]);
  const ready = state.kind === 'ready';
  useEffect(() => {
    if (!ready) return; const i = setInterval(() => void sync(), 30_000); const v = () => { if (document.visibilityState === 'visible') void sync(); };
    document.addEventListener('visibilitychange', v); return () => { clearInterval(i); document.removeEventListener('visibilitychange', v); };
  }, [ready, sync]);
  useEffect(() => { if (state.kind === 'ready') document.documentElement.dataset.effects = String(state.payload.settings.effects ?? 'full'); }, [state]);

  if (state.kind === 'loading') return <p role="status" className="shell__main">Loading</p>;
  if (state.kind === 'error') return <main className="shell__main"><h1>System</h1><SystemMessage title="STORAGE ERROR" kind="penalty">{state.message}</SystemMessage></main>;
  if (state.kind === 'onboarding') return <Onboarding db={db} onRegistered={() => { try { void navigator.storage?.persist?.(); } catch { /* optional */ } void sync(); }} />;
  const p = state.payload; const pv = playerView(p); const current = DESTINATIONS.find((d) => d.id === dest)!;
  const props = { db, payload: p, refresh: load };
  return (
    <Shell player={`${pv.name} | Rank ${pv.rank} | Level ${pv.level}`} nav={<Nav current={dest} onNavigate={setDest} />}>
      <h1>{current.label}</h1>
      {dest === 'quests' && <QuestsScreen {...props} />}
      {dest === 'status' && <StatusScreen {...props} />}
      {dest === 'settings' && <SettingsScreen {...props} />}
      {dest === 'history' && <HistoryScreen {...props} />}
    </Shell>
  );
}
