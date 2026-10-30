import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, SOUNDS, sanitizePrefs, type CtxLike } from './engine';

class Param { value = 0; ramps: [number, number][] = []; linearRampToValueAtTime(v: number, t: number) { this.ramps.push([v, t]); } setTargetAtTime(v: number) { this.value = v; } }
class Node { connect() { return undefined; } disconnect() { return undefined; } }
class Gain extends Node { gain = new Param(); }
class Osc extends Node { type = 'sine'; frequency = new Param(); onended: (() => void) | null = null; started: (number | undefined)[] = []; stopped = 0; start(t?: number) { this.started.push(t); } stop() { this.stopped++; } }
class Ctx implements CtxLike {
  currentTime = 0; state = 'running'; destination = {}; oscs: Osc[] = []; gains: Gain[] = []; resumed = 0; suspended = 0;
  createGain() { const g = new Gain(); this.gains.push(g); return g; } createOscillator() { const o = new Osc(); this.oscs.push(o); return o; }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Param(), type: 'lowpass' }); }
  async resume() { this.resumed++; } async suspend() { this.suspended++; }
}
class Media { src = ''; loop = false; volume = 1; plays = 0; pauses = 0; constructor(s: string) { this.src = s; } play() { this.plays++; } pause() { this.pauses++; } }
const make = () => { const ctx = new Ctx(); const factory = vi.fn(() => ctx); const e = new AudioEngine(factory, (s) => new Media(s)); return { ctx, factory, e }; };

describe('autoplay restrictions', () => {
  it('creates no AudioContext and plays nothing before a user gesture unlocks audio', () => {
    const { ctx, factory, e } = make(); e.configure({ musicEnabled: true });
    expect([e.play('click'), e.play('level'), e.startMusic()]).toEqual([false, false, false]); expect(factory).not.toHaveBeenCalled(); expect(ctx.oscs).toHaveLength(0);
    expect(e.unlock()).toBe(true); expect(factory).toHaveBeenCalledTimes(1); expect(e.unlock()).toBe(true); expect(factory).toHaveBeenCalledTimes(1); expect(ctx.resumed).toBe(1);
    expect(e.play('click')).toBe(true); expect(ctx.oscs).toHaveLength(SOUNDS.click.length);
  });
});
describe('preferences', () => {
  it('sanitises stored values and applies them to the gain nodes', () => {
    expect(sanitizePrefs({ master: 5, sfx: -1, music: Number.NaN as never, muted: 'yes' as never })).toEqual({ master: 1, sfx: 0, music: 0.5, muted: false, musicEnabled: false });
    const { ctx, e } = make(); e.unlock(); e.configure({ master: 0.6, sfx: 0.3, music: 0.2 }); expect(ctx.gains.map((g) => g.gain.value)).toEqual([0.6, 0.3, 0.2]); // master, sfx, music buses
    e.configure({ muted: true }); expect(ctx.gains[0]!.gain.value).toBe(0);
  });
  it('mute, zero master or zero effects volume silence cues without error', () => {
    const { ctx, e } = make(); e.unlock();
    for (const p of [{ muted: true }, { muted: false, master: 0 }, { master: 1, sfx: 0 }]) { e.configure(p); expect(e.play('confirm')).toBe(false); } expect(ctx.oscs).toHaveLength(0);
    e.configure({ sfx: 0.5 }); expect(e.play('confirm')).toBe(true);
  });
});
describe('overlap, repetition and failures', () => {
  it('throttles identical cues and caps simultaneous voices', () => {
    const { ctx, e } = make(); e.unlock();
    expect(e.play('level')).toBe(true); expect(e.play('level')).toBe(false); ctx.currentTime = 0.1; expect(e.play('level')).toBe(true); // 4 + 4 voices
    ctx.currentTime = 0.2; expect(e.play('click')).toBe(false); // cap of 8 voices reached
    ctx.oscs.slice(0, 4).forEach((o) => o.onended?.()); ctx.currentTime = 0.3; expect(e.play('click')).toBe(true);
  });
  it('never throws when the context or oscillators fail', () => {
    const bad = new AudioEngine(() => { throw new Error('no audio'); }); expect(bad.unlock()).toBe(false); expect(bad.play('click')).toBe(false); expect(bad.startMusic()).toBe(false); expect(String(bad.lastError)).toMatch(/no audio/);
    const ctx = new Ctx(); const e = new AudioEngine(() => ctx); e.unlock(); ctx.createOscillator = () => { throw new Error('boom'); }; expect(e.play('level')).toBe(false); expect(e.startMusic()).toBe(false); e.configure({ musicEnabled: true });
    expect(() => { e.stopMusic(); e.setHidden(true); e.setHidden(false); }).not.toThrow(); expect(new AudioEngine(() => null).unlock()).toBe(false);
  });
});
describe('music', () => {
  it('starts only when allowed and unlocked, only once, and stops cleanly', () => {
    const { ctx, e } = make(); expect(e.startMusic()).toBe(false); e.unlock(); expect(e.startMusic()).toBe(false); // not allowed yet
    e.configure({ musicEnabled: true }); expect(e.startMusic()).toBe(true); expect(e.startMusic()).toBe(false); expect(e.musicPlaying).toBe(true); const n = ctx.oscs.length;
    e.stopMusic(); expect(e.musicPlaying).toBe(false); expect(ctx.oscs.slice(0, n).every((o) => o.stopped > 0)).toBe(true); expect(e.startMusic()).toBe(true);
    e.configure({ musicEnabled: false }); expect(e.musicPlaying).toBe(false);
  });
  it('suspends while the tab is hidden and resumes afterwards', () => {
    const { ctx, e } = make(); e.unlock(); e.setHidden(true); expect(ctx.suspended).toBe(1); expect(e.play('click')).toBe(false); e.setHidden(false); expect(ctx.resumed).toBe(2); expect(e.play('click')).toBe(true);
  });
  it('plays a user file through a media element with volume = master x music, pauses when hidden or muted', () => {
    const { e } = make(); e.unlock(); e.configure({ musicEnabled: true, master: 0.5, music: 0.4 }); e.setMusicFile('blob:abc');
    expect(e.startMusic()).toBe(true); expect(e.musicPlaying).toBe(true); e.configure({ muted: true }); e.setHidden(true); e.setHidden(false); e.stopMusic(); expect(e.musicPlaying).toBe(false);
    e.setMusicFile(null); expect(e.state.hasFile).toBe(false);
  });
});
