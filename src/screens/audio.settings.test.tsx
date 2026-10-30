// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { audio } from '../audio';
import { loadMusicFile, resetMediaDb } from '../audio/media';
import { exportBackupText, importBackupText } from '../app/actions';
import { defaultDraft } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb, loadPayload } from '../persist/store';

const made = { n: 0 };
class P { value = 0; linearRampToValueAtTime() { return undefined; } setTargetAtTime() { return undefined; } }
class N { connect() { return undefined; } disconnect() { return undefined; } }
class G extends N { gain = new P(); } class O extends N { type = 'sine'; frequency = new P(); onended: (() => void) | null = null; start() { return undefined; } stop() { return undefined; } }
class FakeCtx { currentTime = 0; state = 'running'; destination = {}; constructor() { made.n++; } createGain() { return new G(); } createOscillator() { return new O(); } createBiquadFilter() { return Object.assign(new N(), { frequency: new P(), type: '' }); } async resume() { return undefined; } async suspend() { return undefined; } }
let db: SlsDb;
beforeEach(async () => {
  window.localStorage.clear(); (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx; URL.createObjectURL = (() => 'blob:fake') as never; URL.revokeObjectURL = (() => undefined) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  resetMediaDb(`media-${Math.random()}`); db = new SlsDb(`as-${Math.random()}`); await db.open(); await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'V' }, new Date());
});
afterEach(() => { cleanup(); audio.stopMusic(); });
const open = async (dest = 'Settings') => { render(<App db={db} />); await userEvent.click(await within(await screen.findByRole('navigation', { name: /primary/i })).findByRole('button', { name: dest })); await screen.findByRole('heading', { name: new RegExp(`^${dest}$`, 'i'), level: 1 }); };
const stored = async () => (await loadPayload(db)).settings.audio as Record<string, unknown>;

describe('autoplay restrictions and unlocking', () => {
  it('creates no audio context and plays nothing until the first user gesture', async () => {
    render(<App db={db} />); await screen.findByRole('navigation', { name: /primary/i }); expect(made.n).toBe(0); expect(audio.state.unlocked).toBe(false); expect(audio.play('click')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Status' })); expect(made.n).toBe(1); expect(audio.state.unlocked).toBe(true); expect(audio.played).toContain('click');
    await userEvent.click(screen.getByRole('button', { name: 'Quests' })); expect(made.n).toBe(1); // one context only
  });
  it('plays the quest-complete cue only after the completion succeeds', async () => {
    await open('Quests'); await userEvent.type(screen.getByLabelText(/quest title/i), 'Read'); await userEvent.click(screen.getByRole('button', { name: /create quest/i })); await screen.findByText('QUEST CREATED');
    const before = audio.played.filter((s) => s === 'complete').length; await userEvent.click(await screen.findByRole('button', { name: 'Complete Read' })); await screen.findByText('QUEST COMPLETED');
    expect(audio.played.filter((s) => s === 'complete').length).toBe(before + 1);
  });
});
describe('Sound and music settings', () => {
  it('previews immediately, persists on save, restores after a reload and respects mute', async () => {
    await open(); fireEvent.change(screen.getByLabelText(/master volume/i), { target: { value: '40' } }); fireEvent.change(screen.getByLabelText(/sound effects volume/i), { target: { value: '30' } }); fireEvent.change(screen.getByLabelText(/music volume/i), { target: { value: '20' } });
    expect(audio.state.prefs).toMatchObject({ master: 0.4, sfx: 0.3, music: 0.2 }); await userEvent.click(screen.getByLabelText(/mute all sound/i)); expect(audio.state.prefs.muted).toBe(true); expect(audio.play('confirm')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /save sound settings/i })); await screen.findByText('SOUND SETTINGS SAVED'); expect(await stored()).toMatchObject({ master: 0.4, sfx: 0.3, music: 0.2, muted: true, musicEnabled: false, musicSource: 'generated' });
    cleanup(); await open(); expect((screen.getByLabelText(/master volume/i) as HTMLInputElement).value).toBe('40'); expect((screen.getByLabelText(/mute all sound/i) as HTMLInputElement).checked).toBe(true); expect(audio.state.prefs).toMatchObject({ master: 0.4, muted: true });
    await userEvent.click(screen.getByLabelText(/mute all sound/i)); expect(audio.state.prefs.muted).toBe(false);
  });
  it('music is off until allowed and then only starts from an explicit Play music press', async () => {
    await open(); expect(screen.queryByRole('button', { name: 'Play music', description: undefined })).not.toBeNull(); // panel button always exists
    expect(within(document.querySelector('header')!).queryByRole('button', { name: /music/i })).toBeNull(); // header toggle hidden while music is not allowed
    await userEvent.click(screen.getByRole('button', { name: 'Play music' })); expect(await screen.findByText(/tick "allow ambient music" first/i)).toBeTruthy(); expect(audio.musicPlaying).toBe(false);
    await userEvent.click(screen.getByLabelText(/allow ambient music/i)); await userEvent.click(screen.getByRole('button', { name: /save sound settings/i })); await screen.findByText('SOUND SETTINGS SAVED');
    expect(audio.musicPlaying).toBe(false); const header = within(document.querySelector('header')!); expect(header.getByRole('button', { name: 'Play music' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(header.getByRole('button', { name: 'Play music' })); expect(audio.musicPlaying).toBe(true); expect(header.getByRole('button', { name: 'Stop music' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(header.getByRole('button', { name: 'Stop music' })); expect(audio.musicPlaying).toBe(false);
  });
  it('validates and stores a user music file outside the player data, and can remove it', async () => {
    await open(); const input = screen.getByLabelText(/choose a music file/i);
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false }); expect(await screen.findByText(/choose an audio file/i)).toBeTruthy(); expect(await loadMusicFile()).toBeNull();
    const big = new File(['x'], 'big.mp3', { type: 'audio/mpeg' }); Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 }); await userEvent.upload(input, big); expect(await screen.findByText(/larger than 10 MB/i)).toBeTruthy();
    await userEvent.upload(input, new File(['abc'], 'theme.mp3', { type: 'audio/mpeg' })); await screen.findByText('MUSIC FILE SAVED'); expect((await loadMusicFile())?.name).toBe('theme.mp3'); expect(await stored()).toMatchObject({ musicSource: 'file', musicFileName: 'theme.mp3' });
    expect(JSON.stringify(await loadPayload(db))).not.toContain('abc'); // the file itself is not part of the player data or backups
    await userEvent.click(screen.getByRole('button', { name: /remove my music file/i })); await screen.findByText('MUSIC FILE REMOVED'); expect(await loadMusicFile()).toBeNull(); expect(await stored()).toMatchObject({ musicSource: 'generated' });
  });
  it('reports honestly when no sound can be played', async () => {
    await open(); await userEvent.click(screen.getByLabelText(/mute all sound/i)); await userEvent.click(screen.getByRole('button', { name: /play test sound/i })); expect(await screen.findByText(/sound is muted/i)).toBeTruthy();
  });
});
describe('preferences and playback state survive backup and restore', () => {
  it('exports and imports audio settings and the acknowledged-event list unchanged', async () => {
    await open(); fireEvent.change(screen.getByLabelText(/master volume/i), { target: { value: '55' } }); await userEvent.click(screen.getByRole('button', { name: /save sound settings/i })); await screen.findByText('SOUND SETTINGS SAVED');
    await waitFor(async () => expect(Array.isArray((await loadPayload(db)).meta.seenEvents)).toBe(true)); const before = await loadPayload(db); const text = await exportBackupText(db, new Date());
    const other = new SlsDb(`as2-${Math.random()}`); await other.open(); const r = await importBackupText(other, text, new Date()); expect(r.ok).toBe(true); const after = await loadPayload(other);
    expect(after.settings.audio).toEqual(before.settings.audio); expect(after.meta.seenEvents).toEqual(before.meta.seenEvents); expect(vi.isMockFunction(audio.play)).toBe(false);
  });
});
