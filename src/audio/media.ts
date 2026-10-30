// User-supplied music is stored in its own small IndexedDB database (not in the player's data, so backups stay small and the schema is unchanged).
import Dexie from 'dexie';
export const MAX_MUSIC_BYTES = 10 * 1024 * 1024;
interface FileRow { id: 'music'; name: string; type: string; blob: Blob }
class MediaDb extends Dexie { files!: Dexie.Table<FileRow, string>; constructor(name = 'sls-media-v1') { super(name); this.version(1).stores({ files: 'id' }); } }
let db: MediaDb | null = null; const get = () => (db ??= new MediaDb());
export const resetMediaDb = (name?: string) => { db = name ? new MediaDb(name) : null; };
export function validateMusicFile(f: { size: number; type: string; name: string }): string | undefined {
  if (!/^audio\//.test(f.type) && !/\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(f.name)) return 'Choose an audio file (MP3, OGG, WAV, M4A, AAC or FLAC).';
  if (f.size > MAX_MUSIC_BYTES) return 'The file is larger than 10 MB.'; if (f.size === 0) return 'The file is empty.'; return undefined;
}
export async function saveMusicFile(f: File) { const e = validateMusicFile(f); if (e) throw new Error(e); await get().files.put({ id: 'music', name: f.name, type: f.type, blob: f }); }
export async function loadMusicFile(): Promise<{ name: string; blob: Blob } | null> { const r = await get().files.get('music'); return r ? { name: r.name, blob: r.blob } : null; }
export async function clearMusicFile() { await get().files.delete('music'); }
