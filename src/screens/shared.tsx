import { useCallback, useRef, useState } from 'react';
import { audio, soundForTitle } from '../audio';
import { SystemMessage } from '../ui/components';

export interface Msg { kind: 'ok' | 'error'; title: string; text: string }
/** Runs one action at a time (duplicate clicks are ignored), reports success only after the domain call resolves, and always re-reads stored state. */
export function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg | null>(null); const lock = useRef(false);
  const run = useCallback(async <T,>(okTitle: string, okText: string | ((r: T) => string), f: () => Promise<T>): Promise<boolean> => {
    if (lock.current) return false; lock.current = true; setBusy(true);
    try { const r = await f(); await refresh(); audio.play(soundForTitle(okTitle)); setMsg({ kind: 'ok', title: okTitle, text: typeof okText === 'function' ? okText(r) : okText }); return true; }
    catch (e) { await refresh().catch(() => undefined); audio.play('error'); setMsg({ kind: 'error', title: 'ACTION FAILED', text: e instanceof Error ? e.message : String(e) }); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [refresh]);
  return { run, busy, msg, clear: () => setMsg(null) };
}
export const Feedback = ({ msg }: { msg: Msg | null }) => (msg ? <SystemMessage title={msg.title} kind={msg.kind === 'ok' ? 'ok' : 'error'}>{' '}{msg.text}</SystemMessage> : null);
export interface ScreenProps { db: import('../persist/store').SlsDb; payload: import('../persist/backup').Payload; refresh: () => Promise<void> }
