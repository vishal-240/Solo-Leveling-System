// P10: storage status (spec 6.3) and friendly storage errors.
export interface StorageStatus { available: boolean; persisted: boolean | null; usage: number | null; quota: number | null }
export async function readStorageStatus(nav: Navigator = navigator): Promise<StorageStatus> {
  const s = nav.storage; if (!s) return { available: false, persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null, usage: number | null = null, quota: number | null = null;
  try { persisted = (await s.persisted?.()) ?? null; } catch { /* unknown */ }
  try { const e = await s.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* unknown */ }
  return { available: true, persisted, usage, quota };
}
export async function requestPersistence(nav: Navigator = navigator): Promise<boolean | null> { try { return (await nav.storage?.persist?.()) ?? null; } catch { return null; } }
export const formatBytes = (n: number | null) => (n === null ? 'unknown' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
/** Turns low-level storage failures into messages a player can act on. Nothing is silently dropped: the failed action reports it and the stored data is unchanged. */
export function describeStorageError(e: unknown): string {
  const name = e instanceof Error ? e.name : ''; const msg = e instanceof Error ? e.message : String(e);
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) return 'Storage is full, so this change was not saved. Export a backup, free some space on this device, and try again.';
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError' || /indexeddb|database.*(closed|unavailable)|backing store/i.test(msg)) return 'This browser is not allowing the app to store data (private browsing or blocked site data). Nothing was saved. Use a normal window and allow site data for this site.';
  if (name === 'VersionError' || /newer/i.test(msg)) return 'The stored data was written by a newer version of the app. Update the app or restore a backup; nothing was changed.';
  return msg;
}
