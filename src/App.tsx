import { useCallback, useEffect, useState } from 'react';
import { audio, applyMusicSource, installAudioLifecycle, prefsFromSettings } from './audio';
import { CinematicHost } from './cinematics/CinematicHost';
import { effectiveTier } from './cinematics/model';
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
  useEffect(() => installAudioLifecycle(), []);
  const settings = state.kind === 'ready' ? state.payload.settings : null;
  const prefersReduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const tier = effectiveTier(settings ?? {}, prefersReduced);
  const audioKey = JSON.stringify((settings?.audio ?? {}) as object);
  useEffect(() => { if (state.kind === 'ready') document.documentElement.dataset.effects = tier; }, [state.kind, tier]);
  useEffect(() => { if (settings) audio.configure(prefsFromSettings(settings)); }, [audioKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const musicSource = (settings?.audio as { musicSource?: string } | undefined)?.musicSource;
  useEffect(() => { if (state.kind === 'ready') void applyMusicSource(musicSource); }, [state.kind, musicSource]);

  if (state.kind === 'loading') return <p role="status" className="shell__main">Loading</p>;
  if (state.kind === 'error') return <main className="shell__main"><h1>System</h1><SystemMessage title="STORAGE ERROR" kind="penalty">{state.message}</SystemMessage></main>;
  if (state.kind === 'onboarding') return <Onboarding db={db} onRegistered={() => { try { void navigator.storage?.persist?.(); } catch { /* optional */ } void sync(); }} />;
  const p = state.payload; const pv = playerView(p); const current = DESTINATIONS.find((d) => d.id === dest)!;
  const props = { db, payload: p, refresh: load };
  return (
    <Shell player={<>{`${pv.name} | Rank ${pv.rank} | Level ${pv.level}`} <MusicToggle allowed={prefsFromSettings(p.settings).musicEnabled} /></>} nav={<Nav current={dest} onNavigate={setDest} />}>
      <CinematicHost db={db} payload={p} refresh={load} tier={tier} />
      <h1>{current.label}</h1>
      {dest === 'quests' && <QuestsScreen {...props} />}
      {dest === 'status' && <StatusScreen {...props} />}
      {dest === 'settings' && <SettingsScreen {...props} />}
      {dest === 'history' && <HistoryScreen {...props} />}
    </Shell>
  );
}

/** Starts or stops ambient music. Music never starts by itself: it needs this button (a user gesture) each session, and only when music is allowed in Settings. */
function MusicToggle({ allowed }: { allowed: boolean }) {
  const [playing, setPlaying] = useState(audio.musicPlaying);
  useEffect(() => audio.subscribe(() => setPlaying(audio.musicPlaying)), []);
  if (!allowed) return null;
  return <button type="button" className="btn" aria-pressed={playing} data-silent="true" onClick={() => { audio.unlock(); if (playing) audio.stopMusic(); else audio.startMusic(); setPlaying(audio.musicPlaying); }}>{playing ? 'Stop music' : 'Play music'}</button>;
}
