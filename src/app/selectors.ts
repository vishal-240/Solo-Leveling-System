// Read-only views derived from the stored ledger using the existing engine (the UI never recomputes progression independently).
import { attrLevelFromXp, attrTotalToReach, ATTR_CAP, levelFromXp, needAttr, needPlayer, rankForLevel, totalXpToReach } from '../engine/progression';
import type { Obj, Payload } from '../persist/backup';
import { ATTRIBUTE_TITLE_NAMES, ATTRS, RANK_TITLES } from '../rewards/rewards';

const sum = (p: Payload, scope: string) => Math.max(0, p.xpTransactions.filter((t) => t.scope === scope).reduce((s, t) => s + Number(t.appliedDelta), 0));
export function playerView(p: Payload) {
  const total = sum(p, 'player'), level = levelFromXp(total), start = totalXpToReach(level), need = needPlayer(level);
  const daily = p.streaks.find((s) => s.scope === 'daily');
  return { name: String(p.player.name ?? ''), total, level, rank: rankForLevel(level), into: total - start, need, nextLevelXp: need - (total - start),
    streak: { current: Number(daily?.current ?? 0), longest: Number(daily?.longest ?? 0) }, shields: Number(p.player.streakShields ?? 0), queued: Number(p.player.queuedShields ?? 0), unspent: Number(p.player.unspentPoints ?? 0) };
}
export function attributeViews(p: Payload) {
  return ATTRS.map((id) => { const xp = sum(p, id), level = attrLevelFromXp(xp), start = attrTotalToReach(level), capped = level >= ATTR_CAP;
    const row = p.attributes.find((a) => a.id === id) as Obj | undefined;
    return { id, xp, level, into: capped ? 0 : xp - start, need: capped ? 0 : needAttr(level), capped, stat: Number(row?.statPoints ?? 0), goal: row?.goal ? String(row.goal) : '' }; });
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function itemName(id: string): string {
  let m = id.match(/^title:rank-([A-Z])$/); if (m) return `${RANK_TITLES[m[1]!] ?? m[1]} (rank ${m[1]})`;
  m = id.match(/^title:attr-([a-z]+)-(\d+)$/); if (m) { const i = [10, 25, 50].indexOf(Number(m[2])); return `${ATTRIBUTE_TITLE_NAMES[m[1]!]?.[i] ?? id} (${cap(m[1]!)} ${m[2]})`; }
  m = id.match(/^badge:level-(\d+)$/); if (m) return `Level ${m[1]} badge`;
  m = id.match(/^frame:rank-([A-Z])$/); if (m) return `Rank ${m[1]} frame`;
  m = id.match(/^theme:(.+)$/); if (m) return `${cap(m[1]!.replace(/-/g, ' '))} theme`;
  m = id.match(/^cosmetic:([a-z]+):(\d+)$/); if (m) return `${cap(m[1]!)} cosmetic (level ${m[2]})`;
  m = id.match(/^levelmark:(\d+)$/); if (m) return `Level mark ${m[1]}`;
  return id;
}
export const grantedItems = (p: Payload, kind: string) => [...new Set(p.rewardGrants.filter((g) => g.kind === kind && g.itemId).map((g) => String(g.itemId)))];
