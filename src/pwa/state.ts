// P10: service-worker lifecycle, update prompt, install prompt and cache reset. The registration function is injected so tests never import the virtual PWA module.
import { useSyncExternalStore } from 'react';

export interface PwaState { registered: boolean; needRefresh: boolean; offlineReady: boolean; registerError: string | null; canInstall: boolean; installed: boolean }
type RegisterSW = (o: { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void; onRegisterError?: (e: unknown) => void; onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void }) => (reload?: boolean) => Promise<void>;
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const isStandalone = (w: Window) => !!w.matchMedia?.('(display-mode: standalone)').matches || (w.navigator as Navigator & { standalone?: boolean }).standalone === true;
let state: PwaState = { registered: false, needRefresh: false, offlineReady: false, registerError: null, canInstall: false, installed: false };
const listeners = new Set<() => void>(); let updater: ((reload?: boolean) => Promise<void>) | null = null; let deferred: InstallEvent | null = null; let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
const set = (p: Partial<PwaState>) => { state = { ...state, ...p }; for (const f of listeners) f(); };
export const getPwaState = () => state;
export const subscribePwa = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const usePwa = () => useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
export const resetPwaForTests = () => { if (updateCheckTimer !== null) clearInterval(updateCheckTimer); updateCheckTimer = null; state = { registered: false, needRefresh: false, offlineReady: false, registerError: null, canInstall: false, installed: false }; updater = null; deferred = null; };

export function initPwa(registerSW: RegisterSW, win: Window = window): () => void {
  set({ installed: isStandalone(win) });
  const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; set({ canInstall: true }); };
  const onInstalled = () => { deferred = null; set({ canInstall: false, installed: true }); };
  win.addEventListener('beforeinstallprompt', onPrompt); win.addEventListener('appinstalled', onInstalled);
  try {
    updater = registerSW({ immediate: true, onNeedRefresh: () => set({ needRefresh: true }), onOfflineReady: () => set({ offlineReady: true }),
      onRegisterError: (e) => set({ registerError: e instanceof Error ? e.message : String(e) }),
      onRegisteredSW: (_url, reg) => { set({ registered: true }); if (updateCheckTimer !== null) clearInterval(updateCheckTimer); updateCheckTimer = reg ? setInterval(() => { void reg.update().catch(() => undefined); }, 60 * 60 * 1000) : null; } });
  } catch (e) { set({ registerError: e instanceof Error ? e.message : String(e) }); }
  return () => { win.removeEventListener('beforeinstallprompt', onPrompt); win.removeEventListener('appinstalled', onInstalled); if (updateCheckTimer !== null) clearInterval(updateCheckTimer); updateCheckTimer = null; };
}
/** Activates the waiting version and reloads. User data lives in IndexedDB and is untouched. */
export const applyUpdate = async () => { await updater?.(true); };
export const dismissOfflineReady = () => set({ offlineReady: false });
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred; if (!e) return 'unavailable'; deferred = null; set({ canInstall: false });
  try { await e.prompt(); return (await e.userChoice).outcome; } catch { return 'dismissed'; }
}
/** Recovery: removes service workers and cached app files so the next load fetches a fresh copy. The player's data is never touched. */
export async function resetAppCache(win: Window = window): Promise<{ workers: number; caches: number }> {
  let workers = 0, cleared = 0;
  // GitHub Pages serves multiple repositories from one origin. Only unregister
  // the worker controlling this page; never remove another app's registration.
  try { const reg = await win.navigator.serviceWorker?.getRegistration?.(); if (reg && await reg.unregister()) workers++; } catch { /* nothing to remove */ }
  // Workbox caches are namespaced with cacheId in vite.config.ts. CacheStorage
  // is origin-wide, so deleting every key could break another Pages application.
  try { const keys = (await win.caches?.keys?.()) ?? []; for (const k of keys) if (k.startsWith('sls-system-') && await win.caches.delete(k)) cleared++; } catch { /* nothing to remove */ }
  return { workers, caches: cleared };
}
