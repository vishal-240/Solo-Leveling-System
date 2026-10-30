import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acknowledgeEvents, baselineEvents } from '../app/actions';
import { audio as defaultAudio } from '../audio';
import type { AudioEngine } from '../audio/engine';
import type { Payload } from '../persist/backup';
import type { SlsDb } from '../persist/store';
import { allEventIds, buildSteps, needsBaseline, pendingIds, stepText, stepTitle, type Note, type Step, type Tier } from './model';

interface Banner extends Note { sound: 'achievement' | 'level' | 'rank' }
const RINGS: Record<string, number> = { D: 1, C: 2, B: 3, A: 4, S: 5 };
/** Presents newly committed level, rank and achievement events. Full/Reduced: a skippable modal dialog for level and rank events; Minimal: text banners only.
 *  Events are acknowledged when they are presented, so a reload never replays them; the grants themselves are already committed and are never touched here. */
export function CinematicHost({ db, payload, refresh, tier, engine = defaultAudio }: { db: SlsDb; payload: Payload; refresh: () => Promise<void>; tier: Tier; engine?: AudioEngine }) {
  const shown = useRef(new Set<string>()); const opener = useRef<HTMLElement | null>(null); const dlg = useRef<HTMLDivElement>(null); const primary = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<{ steps: Step[]; index: number } | null>(null); const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    if (needsBaseline(payload)) { void baselineEvents(db, allEventIds(payload)).then(refresh).catch(() => undefined); return; } // pre-existing events are history, never played
    const ids = pendingIds(payload).filter((i) => !shown.current.has(i)); if (!ids.length) return;
    ids.forEach((i) => shown.current.add(i));
    const { steps, notes } = buildSteps(payload, ids); const text = (s: Step) => `${stepText(s)}${s.rewards.length ? `. ${s.rewards.join(', ')}` : ''}`;
    void acknowledgeEvents(db, ids).then(refresh).catch(() => undefined);
    const ach: Banner[] = notes.map((n) => ({ ...n, sound: 'achievement' }));
    if (tier === 'minimal') setBanners((b) => [...b, ...steps.map((s): Banner => ({ id: `step:${s.ids[0]}`, title: stepTitle(s), text: text(s), sound: s.kind === 'rank' ? 'rank' : 'level' })), ...ach]);
    else { if (steps.length) { opener.current = document.activeElement as HTMLElement | null; setActive((a) => (a ? { steps: [...a.steps.slice(a.index), ...steps], index: 0 } : { steps, index: 0 })); } setBanners((b) => [...b, ...ach]); }
  }, [payload, db, refresh, tier]);

  const step = active?.steps[active.index];
  useEffect(() => { if (step) engine.play(step.kind === 'rank' ? 'rank' : 'level'); }, [step, engine]);
  const soundedBanners = useRef(new Set<string>());
  useEffect(() => { for (const b of banners) if (!soundedBanners.current.has(b.id)) { soundedBanners.current.add(b.id); engine.play(b.sound); } }, [banners, engine]);
  useEffect(() => {
    if (!active) return; primary.current?.focus(); const shell = document.querySelector('.shell'); shell?.setAttribute('inert', ''); shell?.setAttribute('aria-hidden', 'true');
    return () => { shell?.removeAttribute('inert'); shell?.removeAttribute('aria-hidden'); };
  }, [active === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) primary.current?.focus(); }, [active?.index]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shell is un-inerted before focus moves, otherwise focusing an element inside it would silently fail.
  const close = () => { setActive(null); const o = opener.current; opener.current = null; const shell = document.querySelector('.shell'); shell?.removeAttribute('inert'); shell?.removeAttribute('aria-hidden'); setTimeout(() => { if (o && o !== document.body && document.contains(o)) o.focus(); else document.getElementById('main')?.focus(); }, 0); };
  const next = () => { if (active && active.index + 1 < active.steps.length) setActive({ ...active, index: active.index + 1 }); else close(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab' || !dlg.current) return; const f = [...dlg.current.querySelectorAll<HTMLElement>('button:not([disabled])')]; if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <>
      {banners.length > 0 && (
        <div className="banners" role="region" aria-label="Notifications">
          {banners.map((b) => (
            <div key={b.id} className="sysmsg sysmsg--reward" role="status"><span className="sysmsg__kind">{b.title}</span> {b.text}{' '}
              <button type="button" className="btn" onClick={() => setBanners((x) => x.filter((y) => y.id !== b.id))} aria-label={`Dismiss ${b.title}: ${b.text}`}>Dismiss</button></div>))}
        </div>
      )}
      {active && step && createPortal(
        <div className={`cine cine--${tier}${step.kind === 'rank' ? ` cine--rank-${step.rank}` : ''}`} data-testid="cinematic">
          <div ref={dlg} className="cine__panel panel" role="dialog" aria-modal="true" aria-labelledby="cine-title" aria-describedby="cine-desc" onKeyDown={onKey}>
            {tier === 'full' && step.kind === 'rank' && <div aria-hidden="true" className="cine__rings">{Array.from({ length: RINGS[step.rank ?? 'D'] ?? 1 }, (_, i) => <span key={i} className="cine__ring" style={{ animationDelay: `${i * 0.4}s` }} />)}</div>}
            <h2 id="cine-title" className="cine__title">{stepTitle(step)}</h2>
            <p id="cine-desc" className="cine__text">{stepText(step)}</p>
            {step.rewards.length > 0 && <ul aria-label="Rewards earned" className="cine__rewards">{step.rewards.map((r) => <li key={r}>{r}</li>)}</ul>}
            <p className="hint" aria-live="polite">Event {active.index + 1} of {active.steps.length}</p>
            <div className="actions"><button type="button" className="btn" data-silent="true" onClick={close}>Skip</button>
              <button type="button" className="btn btn--primary" ref={primary} onClick={next}>{active.index + 1 < active.steps.length ? 'Continue' : 'Close'}</button></div>
          </div>
        </div>
      , document.body)}
    </>
  );
}
