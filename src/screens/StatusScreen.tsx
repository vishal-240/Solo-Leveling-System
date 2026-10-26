import { allocate, distribute, equipFrameItem, equipTitleItem, respecPoints, setMode } from '../app/actions';
import { attributeViews, grantedItems, itemName, playerView } from '../app/selectors';
import { ACHIEVEMENTS, type AllocationMode } from '../rewards/rewards';
import { Panel } from '../ui/components';
import { Feedback, useAction, type ScreenProps } from './shared';

const NAME: Record<string, string> = { academics: 'Academics', fitness: 'Fitness', coding: 'Coding', discipline: 'Discipline', recovery: 'Recovery' };
function Radar({ values }: { values: { id: string; stat: number }[] }) {
  const R = 80, c = 100, max = Math.max(1, ...values.map((v) => v.stat));
  const pt = (i: number, r: number) => { const a = (-90 + (360 / values.length) * i) * (Math.PI / 180); return `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`; };
  const label = values.map((v) => `${NAME[v.id]} ${v.stat}`).join(', ');
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`Stat points radar: ${label}`} style={{ maxWidth: 260, width: '100%' }}>
      {[0.5, 1].map((k) => <polygon key={k} points={values.map((_, i) => pt(i, R * k)).join(' ')} fill="none" stroke="var(--edge-dim)" />)}
      {values.map((_, i) => <line key={i} x1={c} y1={c} x2={pt(i, R).split(',')[0]} y2={pt(i, R).split(',')[1]} stroke="var(--edge-dim)" />)}
      <polygon points={values.map((v, i) => pt(i, (R * v.stat) / max)).join(' ')} fill="rgba(47,208,255,.25)" stroke="var(--accent)" strokeWidth="2" />
      {values.map((v, i) => { const [x, y] = pt(i, R + 14).split(',').map(Number); return <text key={v.id} x={x} y={y} fill="var(--text)" fontSize="9" textAnchor="middle" dominantBaseline="middle">{NAME[v.id]!.slice(0, 4)}</text>; })}
    </svg>
  );
}
export function StatusScreen({ db, payload, refresh }: ScreenProps) {
  const { run, busy, msg } = useAction(refresh);
  const pv = playerView(payload), attrs = attributeViews(payload);
  const mode = (['balanced', 'momentum'].includes(String(payload.player.allocationMode)) ? payload.player.allocationMode : 'manual') as AllocationMode;
  const titles = grantedItems(payload, 'title'), badges = grantedItems(payload, 'badge'), cosmetics = grantedItems(payload, 'cosmetic'), frames = cosmetics.filter((c) => c.startsWith('frame:'));
  const equippedTitle = String(payload.player.equippedTitleId ?? ''), equippedFrame = String(payload.player.equippedFrameId ?? '');
  const unlocked = new Map(payload.achievements.filter((a) => a.unlockedAt).map((a) => [String(a.id), String(a.unlockedAt)]));
  return (
    <>
      <Feedback msg={msg} />
      <Panel title="Player">
        <p><strong>{pv.name}</strong>{equippedTitle ? ` · ${itemName(equippedTitle)}` : payload.player.startingTitle ? ` · ${String(payload.player.startingTitle)}` : ''}</p>
        <p>Rank <strong>{pv.rank}</strong> · Level <strong>{pv.level}</strong> · Total XP <strong>{pv.total.toLocaleString()}</strong></p>
        <div className="bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={pv.need} aria-valuenow={pv.into}><span style={{ width: `${Math.min(100, (pv.into / pv.need) * 100)}%` }} /></div>
        <p className="hint">{pv.into} / {pv.need} XP · {pv.nextLevelXp} to level {pv.level + 1}</p>
        <p>Daily streak {pv.streak.current} (longest {pv.streak.longest}) · Streak Shields {pv.shields}/3{pv.queued ? ` (+${pv.queued} queued)` : ''}</p>
      </Panel>
      <Panel title="Attributes">
        <table style={{ width: '100%' }}><caption className="sr-only">Attribute levels and stat points</caption>
          <thead><tr><th scope="col">Attribute</th><th scope="col">Level</th><th scope="col">XP</th><th scope="col">Stat points</th></tr></thead>
          <tbody>{attrs.map((a) => (
            <tr key={a.id}><th scope="row">{NAME[a.id]}{a.goal ? <span className="hint"> — {a.goal}</span> : null}</th><td>{a.level}{a.capped ? ' (max)' : ''}</td>
              <td>{a.capped ? `${a.xp.toLocaleString()}` : `${a.into} / ${a.need}`}</td><td>{a.stat}</td></tr>))}</tbody></table>
        <Radar values={attrs} />
        <p className="hint">Stat points are cosmetic: they never change XP, difficulty or penalties.</p>
      </Panel>
      <Panel title="Attribute points">
        <p>Unspent points: <strong>{pv.unspent}</strong></p>
        <div className="field"><label htmlFor="mode">Allocation mode</label>
          <select id="mode" value={mode} onChange={(e) => run('MODE CHANGED', `Allocation mode is now ${e.target.value}.`, () => setMode(db, e.target.value as AllocationMode))} disabled={busy}>
            <option value="manual">Manual</option><option value="balanced">Balanced</option><option value="momentum">Momentum</option></select>
          <span className="hint">Balanced and Momentum allocate future points automatically.</span></div>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {attrs.map((a) => <button key={a.id} type="button" className="btn" disabled={busy || pv.unspent < 1} onClick={() => run('POINT ALLOCATED', `+1 ${NAME[a.id]}.`, () => allocate(db, a.id, 1, new Date()))}>Add 1 point to {NAME[a.id]}</button>)}
        </div>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn" disabled={busy || pv.unspent < 1} onClick={() => run('POINTS DISTRIBUTED', 'Banked points distributed (Balanced).', () => distribute(db, 'balanced', new Date()))}>Distribute banked points (Balanced)</button>
          <button type="button" className="btn" disabled={busy || pv.unspent < 1} onClick={() => run('POINTS DISTRIBUTED', 'Banked points distributed (Momentum).', () => distribute(db, 'momentum', new Date()))}>Distribute banked points (Momentum)</button>
          <button type="button" className="btn" disabled={busy} onClick={() => run('POINTS RETURNED', 'All stat points returned to the bank.', () => respecPoints(db, new Date()))}>Respec (once a week)</button>
        </div>
      </Panel>
      <Panel title="Titles, badges and cosmetics">
        {titles.length + badges.length + cosmetics.length === 0 ? <p className="hint">No rewards yet. Rewards arrive as you level up.</p> : (<>
          {titles.length > 0 && <><h3>Titles</h3><ul>{titles.map((t) => <li key={t}>{itemName(t)}{equippedTitle === t ? ' (equipped)' : <>{' '}<button type="button" className="btn" disabled={busy} onClick={() => run('TITLE EQUIPPED', itemName(t), () => equipTitleItem(db, t))}>Equip {itemName(t)}</button></>}</li>)}</ul></>}
          {badges.length > 0 && <><h3>Badges</h3><ul>{badges.map((b) => <li key={b}>{itemName(b)}</li>)}</ul></>}
          {frames.length > 0 && <><h3>Profile frames</h3><ul>{frames.map((f) => <li key={f}>{itemName(f)}{equippedFrame === f ? ' (equipped)' : <>{' '}<button type="button" className="btn" disabled={busy} onClick={() => run('FRAME EQUIPPED', itemName(f), () => equipFrameItem(db, f))}>Equip {itemName(f)}</button></>}</li>)}</ul></>}
          {cosmetics.filter((c) => !c.startsWith('frame:')).length > 0 && <><h3>Other cosmetics</h3><ul>{cosmetics.filter((c) => !c.startsWith('frame:')).map((c) => <li key={c}>{itemName(c)}</li>)}</ul></>}
        </>)}
      </Panel>
      <Panel title="Achievements">
        <ul aria-label="Achievements">{ACHIEVEMENTS.map((a) => unlocked.has(a.id) ? <li key={a.id}>{a.name} <span className="hint">(unlocked)</span></li> : a.hidden ? null : <li key={a.id}><span className="hint">{a.name}: locked</span></li>)}</ul>
        <p className="hint">{ACHIEVEMENTS.filter((a) => a.hidden && !unlocked.has(a.id)).length} hidden achievement(s) not yet discovered.</p>
      </Panel>
    </>
  );
}
