import { useId, type ReactNode } from 'react';

export function Panel({ title, children, enter = false, as: H = 'h2' }: { title?: string; children: ReactNode; enter?: boolean; as?: 'h2' | 'h3' }) {
  const id = useId();
  return (
    <section className={`panel${enter ? ' panel--enter' : ''}`} aria-labelledby={title ? id : undefined}>
      {title ? <H id={id} className="panel__title">{title}</H> : null}
      {children}
    </section>
  );
}
export type SystemKind = 'info' | 'ok' | 'reward' | 'penalty' | 'error';
/** Terse System message. Penalties are announced assertively (role=alert); everything else politely (role=status). */
export function SystemMessage({ title, children, kind = 'info' }: { title: string; children?: ReactNode; kind?: SystemKind }) {
  return (
    <div className={`sysmsg${kind === 'info' ? '' : ` sysmsg--${kind === 'error' ? 'penalty' : kind}`}`} role={kind === 'penalty' || kind === 'error' ? 'alert' : 'status'}>
      <span className="sysmsg__kind">{title}</span>
      {children}
    </div>
  );
}
export const DESTINATIONS = [
  { id: 'quests', label: 'Quests', phase: 'P7' }, { id: 'status', label: 'Status', phase: 'P7' },
  { id: 'history', label: 'History', phase: 'P8' }, { id: 'settings', label: 'Settings', phase: 'P7' },
] as const;
export type DestinationId = (typeof DESTINATIONS)[number]['id'];
export function Nav({ current, onNavigate }: { current: DestinationId; onNavigate: (d: DestinationId) => void }) {
  return (
    <nav className="nav" aria-label="Primary">
      {DESTINATIONS.map((d) => (
        <button key={d.id} type="button" className="nav__item" aria-current={d.id === current ? 'page' : undefined} onClick={() => onNavigate(d.id)}>{d.label}</button>
      ))}
    </nav>
  );
}
export function Shell({ player, nav, children }: { player: ReactNode; nav: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="shell__head"><span className="brand">SYSTEM</span><span>{player}</span></header>
      {nav}
      <main id="main" className="shell__main" tabIndex={-1}>{children}</main>
    </div>
  );
}
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const d = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': d, 'aria-invalid': error ? true : undefined })}
      {hint ? <span id={`${id}-hint`} className="hint">{hint}</span> : null}
      {error ? <span id={`${id}-err`} className="error" role="alert">{error}</span> : null}
    </div>
  );
}
