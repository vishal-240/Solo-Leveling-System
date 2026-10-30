import { AudioEngine, sanitizePrefs, type AudioPrefs, type CtxLike, type SoundName } from './engine';
import { loadMusicFile } from './media';

type W = Window & { webkitAudioContext?: new () => CtxLike };
export const audio = new AudioEngine(
  () => { const w = window as W; const C = (window.AudioContext as unknown as (new () => CtxLike) | undefined) ?? w.webkitAudioContext; return C ? new C() : null; },
  (src) => { const a = new Audio(src); return a as never; },
);
export const prefsFromSettings = (settings: Record<string, unknown>): AudioPrefs => sanitizePrefs((settings.audio ?? {}) as Partial<AudioPrefs>);
/** Gesture unlock + tab-visibility handling. Returns a cleanup function. */
export function installAudioLifecycle(engine: AudioEngine = audio): () => void {
  const unlock = () => { engine.unlock(); };
  const vis = () => engine.setHidden(document.visibilityState === 'hidden');
  const click = (e: Event) => { const b = (e.target as HTMLElement | null)?.closest?.('button'); if (b && !b.disabled && !b.dataset.silent) engine.play('click'); };
  const opts = { capture: true } as const;
  window.addEventListener('pointerdown', unlock, opts); window.addEventListener('keydown', unlock, opts); window.addEventListener('touchend', unlock, opts); document.addEventListener('visibilitychange', vis); document.addEventListener('click', click, opts);
  return () => { document.removeEventListener('click', click, opts); window.removeEventListener('pointerdown', unlock, opts); window.removeEventListener('keydown', unlock, opts); window.removeEventListener('touchend', unlock, opts); document.removeEventListener('visibilitychange', vis); };
}
let fileUrl: string | null = null;
/** Applies the stored music source: the generated loop, or the user's file from the media database (silently falls back if it is missing). */
export async function applyMusicSource(source: unknown, engine: AudioEngine = audio) {
  if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
  if (source === 'file') { try { const f = await loadMusicFile(); if (f) { fileUrl = URL.createObjectURL(f.blob); engine.setMusicFile(fileUrl); return; } } catch { /* fall back */ } }
  engine.setMusicFile(null);
}
const TITLE_SOUND: Record<string, SoundName> = { 'QUEST COMPLETED': 'complete', 'TIMER STARTED': 'start', 'TIMER RESUMED': 'start', 'TIMER PAUSED': 'pause', 'PROGRESS BANKED': 'confirm', 'COMPLETION UNDONE': 'pause' };
export const soundForTitle = (title: string): SoundName => TITLE_SOUND[title] ?? 'confirm';
