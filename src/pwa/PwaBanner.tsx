import { useEffect, useState } from 'react';
import { SystemMessage } from '../ui/components';
import { applyUpdate, dismissOfflineReady, usePwa } from './state';

/** Update prompt (spec 6.6): the new version waits until the player reloads, and never while a timer is running. */
export function PwaBanner({ timerRunning }: { timerRunning: boolean }) {
  const s = usePwa(); const [later, setLater] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (!s.offlineReady) return; const t = setTimeout(dismissOfflineReady, 12_000); return () => clearTimeout(t); }, [s.offlineReady]); // a transient confirmation, not a permanent banner
  return (
    <>
      {s.needRefresh && !later && (
        <SystemMessage title="SYSTEM UPDATE AVAILABLE" kind="reward">
          {' '}A new version is ready. Your data is kept. {timerRunning ? 'Pause or finish your running timer first; updating reloads the app.' : 'Reloading applies it.'}{err ? ` Update failed: ${err}` : ''}{' '}
          <button type="button" className="btn btn--primary" disabled={timerRunning} onClick={() => { applyUpdate().catch((e) => setErr(String(e))); }}>Reload to update</button>{' '}
          <button type="button" className="btn" onClick={() => setLater(true)}>Later</button>
        </SystemMessage>
      )}
      {s.offlineReady && <SystemMessage title="OFFLINE READY" kind="ok">{' '}The app is saved on this device and can start without a network.{' '}<button type="button" className="btn" onClick={dismissOfflineReady}>Dismiss</button></SystemMessage>}
      {s.registerError && <SystemMessage title="OFFLINE START UNAVAILABLE" kind="error">{' '}The app still works while you are online, but it could not be saved for offline use ({s.registerError}). Settings has an option to reset the app cache.</SystemMessage>}
    </>
  );
}
