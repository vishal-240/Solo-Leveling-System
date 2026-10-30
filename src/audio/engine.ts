// P9 audio engine. All sounds are synthesised (original, no asset files). Nothing plays before a user gesture unlocks the AudioContext,
// and every failure is swallowed: audio can never block gameplay, navigation or persistence.
export interface AudioPrefs { master: number; sfx: number; music: number; muted: boolean; musicEnabled: boolean }
export const DEFAULT_AUDIO: AudioPrefs = { master: 1, sfx: 0.8, music: 0.5, muted: false, musicEnabled: false };
export type SoundName = 'click' | 'confirm' | 'error' | 'complete' | 'start' | 'pause' | 'level' | 'rank' | 'reward' | 'achievement';
interface Note { at: number; freq: number; dur: number; type?: OscillatorType; gain?: number; to?: number }
const n = (at: number, freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.5, to?: number): Note => ({ at, freq, dur, type, gain, to });
export const SOUNDS: Record<SoundName, Note[]> = {
  click: [n(0, 1200, 0.04, 'square', 0.15)], confirm: [n(0, 660, 0.07, 'triangle', 0.4), n(0.07, 990, 0.1, 'triangle', 0.4)], error: [n(0, 220, 0.14, 'sawtooth', 0.35), n(0.14, 165, 0.2, 'sawtooth', 0.35)],
  complete: [n(0, 523, 0.09, 'triangle'), n(0.09, 659, 0.09, 'triangle'), n(0.18, 784, 0.18, 'triangle')], start: [n(0, 440, 0.08, 'sine', 0.4, 880)], pause: [n(0, 660, 0.1, 'sine', 0.4, 330)],
  level: [n(0, 392, 0.12, 'triangle'), n(0.12, 523, 0.12, 'triangle'), n(0.24, 659, 0.12, 'triangle'), n(0.36, 784, 0.35, 'triangle', 0.55)],
  rank: [n(0, 196, 0.5, 'sawtooth', 0.25), n(0.2, 392, 0.2, 'triangle'), n(0.4, 523, 0.2, 'triangle'), n(0.6, 659, 0.2, 'triangle'), n(0.8, 1047, 0.6, 'triangle', 0.6)],
  reward: [n(0, 880, 0.08, 'sine', 0.4), n(0.08, 1175, 0.14, 'sine', 0.4)], achievement: [n(0, 740, 0.1, 'triangle', 0.45), n(0.1, 988, 0.1, 'triangle', 0.45), n(0.2, 1319, 0.25, 'triangle', 0.5)],
};
const MAX_VOICES = 8, THROTTLE_S = 0.06;
/** The small slice of the Web Audio API used here (also what the tests fake). */
export interface ParamLike { value: number; setValueAtTime?(v: number, t: number): unknown; linearRampToValueAtTime?(v: number, t: number): unknown; exponentialRampToValueAtTime?(v: number, t: number): unknown; setTargetAtTime?(v: number, t: number, c: number): unknown }
export interface NodeLike { connect(n: unknown): unknown; disconnect?(): unknown }
export interface GainLike extends NodeLike { gain: ParamLike }
export interface OscLike extends NodeLike { type: string; frequency: ParamLike; start(t?: number): void; stop(t?: number): void; onended: (() => void) | null }
export interface CtxLike { currentTime: number; state: string; destination: unknown; resume?(): Promise<void>; suspend?(): Promise<void>; createGain(): GainLike; createOscillator(): OscLike; createBiquadFilter?(): NodeLike & { frequency: ParamLike; type: string } }
export interface MediaLike { src: string; loop: boolean; volume: number; play(): Promise<void> | void; pause(): void }
const clamp = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d; };
export const sanitizePrefs = (p: Partial<AudioPrefs> | undefined, base: AudioPrefs = DEFAULT_AUDIO): AudioPrefs => ({ master: clamp(p?.master, base.master), sfx: clamp(p?.sfx, base.sfx), music: clamp(p?.music, base.music), muted: p?.muted === true, musicEnabled: p?.musicEnabled === true });

export class AudioEngine {
  private ctx: CtxLike | null = null; private master: GainLike | null = null; private sfxBus: GainLike | null = null; private musicBus: GainLike | null = null;
  private prefs: AudioPrefs = { ...DEFAULT_AUDIO }; private unlocked = false; private voices = 0; private last = new Map<SoundName, number>();
  private musicNodes: OscLike[] = []; private musicTimer: ReturnType<typeof setInterval> | null = null; private media: MediaLike | null = null; private mediaUrl: string | null = null;
  private wantMusic = false; private hidden = false; private listeners = new Set<() => void>();
  lastError: unknown = null; played: SoundName[] = []; // `played` is a small log for tests and diagnostics
  constructor(private factory: () => CtxLike | null, private mediaFactory: (src: string) => MediaLike | null = () => null) {}

  get state() { return { unlocked: this.unlocked, musicPlaying: this.musicPlaying, voices: this.voices, prefs: { ...this.prefs }, hasFile: !!this.mediaUrl }; }
  get musicPlaying() { return this.musicNodes.length > 0 || (!!this.media && this.wantMusic); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit() { for (const f of this.listeners) { try { f(); } catch { /* listener errors never matter */ } } }
  private fail(e: unknown) { this.lastError = e; }
  private silent() { return this.prefs.muted || this.prefs.master <= 0 || this.hidden; }

  /** Must be called from a real user gesture. Creates the AudioContext; before this call nothing can play. */
  unlock(): boolean {
    if (this.unlocked) return true;
    try {
      const ctx = this.factory(); if (!ctx) return false; this.ctx = ctx; void ctx.resume?.()?.catch?.(() => undefined);
      this.master = ctx.createGain(); this.sfxBus = ctx.createGain(); this.musicBus = ctx.createGain(); this.sfxBus.connect(this.master); this.musicBus.connect(this.master); this.master.connect(ctx.destination);
      this.unlocked = true; this.applyGains(); this.emit(); return true;
    } catch (e) { this.fail(e); this.ctx = null; return false; }
  }
  configure(p: Partial<AudioPrefs>) {
    this.prefs = sanitizePrefs({ ...this.prefs, ...p }, this.prefs); this.applyGains();
    if (!this.prefs.musicEnabled) this.stopMusic(); this.emit();
  }
  private applyGains() {
    try {
      if (this.master) this.master.gain.value = this.prefs.muted ? 0 : this.prefs.master; if (this.sfxBus) this.sfxBus.gain.value = this.prefs.sfx; if (this.musicBus) this.musicBus.gain.value = this.prefs.music;
      if (this.media) this.media.volume = this.prefs.muted ? 0 : this.prefs.master * this.prefs.music;
    } catch (e) { this.fail(e); }
  }
  /** Plays a short synthesised cue. Returns whether a sound was actually scheduled. Never throws. */
  play(name: SoundName): boolean {
    try {
      const ctx = this.ctx; if (!this.unlocked || !ctx || !this.sfxBus || this.silent() || this.prefs.sfx <= 0) return false;
      const t0 = ctx.currentTime, prev = this.last.get(name); if (prev !== undefined && t0 - prev < THROTTLE_S) return false; if (this.voices >= MAX_VOICES) return false;
      this.last.set(name, t0);
      for (const note of SOUNDS[name]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), s = t0 + note.at, e = s + note.dur; o.type = note.type ?? 'sine'; o.frequency.value = note.freq;
        if (note.to) o.frequency.linearRampToValueAtTime?.(note.to, e);
        g.gain.value = note.gain ?? 0.5; g.gain.linearRampToValueAtTime?.(0.0001, e); o.connect(g); g.connect(this.sfxBus);
        this.voices++; o.onended = () => { this.voices = Math.max(0, this.voices - 1); try { g.disconnect?.(); } catch { /* ignore */ } }; o.start(s); o.stop(e + 0.02);
      }
      this.played.push(name); if (this.played.length > 50) this.played.shift(); return true;
    } catch (e) { this.fail(e); return false; }
  }
  /** Starts ambient music only if it is allowed, the context is unlocked and nothing is already playing. */
  startMusic(): boolean {
    try {
      if (!this.unlocked || !this.ctx || !this.prefs.musicEnabled || this.musicPlaying) return false;
      this.wantMusic = true;
      if (this.media) { this.applyGains(); void Promise.resolve(this.media.play()).catch((e) => { this.fail(e); this.wantMusic = false; this.emit(); }); this.emit(); return true; }
      if (!this.musicBus) return false; const ctx = this.ctx, bus = this.musicBus; const chords = [[110, 165, 220], [98, 147, 196], [87.3, 131, 175], [98, 147, 196]]; let i = 0;
      const lp = ctx.createBiquadFilter?.(); if (lp) { lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(bus); }
      for (let k = 0; k < 3; k++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = k === 0 ? 'sine' : 'triangle'; o.frequency.value = chords[0]![k]!; g.gain.value = 0.12; o.connect(g); g.connect(lp ?? bus); o.start(); this.musicNodes.push(o); }
      this.musicTimer = setInterval(() => { try { i = (i + 1) % chords.length; this.musicNodes.forEach((o, k) => { o.frequency.setTargetAtTime?.(chords[i]![k]!, ctx.currentTime, 1.5) ?? (o.frequency.value = chords[i]![k]!); }); } catch (e) { this.fail(e); } }, 8000);
      this.emit(); return true;
    } catch (e) { this.fail(e); this.stopMusic(); return false; }
  }
  stopMusic() {
    try { for (const o of this.musicNodes) { try { o.stop(); o.disconnect?.(); } catch { /* already stopped */ } } this.musicNodes = []; if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; this.media?.pause(); } catch (e) { this.fail(e); }
    if (this.wantMusic || this.musicNodes.length) this.emit(); this.wantMusic = false; this.emit();
  }
  /** Switch between the generated loop (null) and a user-supplied file URL. */
  setMusicFile(url: string | null) {
    const was = this.musicPlaying; this.stopMusic(); this.media = null; this.mediaUrl = url;
    if (url) { try { const m = this.mediaFactory(url); if (m) { m.loop = true; this.media = m; } } catch (e) { this.fail(e); } }
    this.applyGains(); this.emit(); if (was) this.startMusic();
  }
  /** Tab visibility: suspend everything while hidden, resume when visible again (music only if it was playing). */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    try { if (hidden) { void this.ctx?.suspend?.()?.catch?.(() => undefined); this.media?.pause(); } else if (this.unlocked) { void this.ctx?.resume?.()?.catch?.(() => undefined); if (this.wantMusic && this.media) void Promise.resolve(this.media.play()).catch((e) => this.fail(e)); } } catch (e) { this.fail(e); }
  }
}
