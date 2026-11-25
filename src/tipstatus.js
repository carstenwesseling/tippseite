// Prüfung der Tipps eines Mitspielers auf Gültigkeit und Vollständigkeit.
import { normName, samePerson } from './halbserie.js';

const valid = (v) => Number.isFinite(v?.h) && Number.isFinite(v?.g) && v.h >= 0 && v.g >= 0;

/** Anzahl gültiger Tipps (beide Tore als Zahl >= 0) für die Spiele der Tipprunde. */
export const validTipCount = (tips, order) => order.filter((m) => valid(tips?.[m.key])).length;

/** 'komplett' = alle Spiele getippt, 'teilweise' = mindestens ein Tipp, sonst 'keiner'. */
export const tipState = (count, total) => (total > 0 && count >= total ? 'komplett' : count > 0 ? 'teilweise' : 'keiner');

/** Spieler einer Halbserie (aus Excel-Upload oder Tippen-Runde) zu einem Namen finden. */
export const findPlayer = (players, name) => {
  const k = normName(samePerson(name));
  return (players ?? []).find((p) => normName(samePerson(p.name)) === k) ?? null;
};

/** Zeitpunkt (ms) des ersten Spiels der Tipprunde; null, wenn keine Anstoßzeiten bekannt sind. */
export const firstKickoff = (order) => {
  const t = order.map((m) => Date.parse(m.date)).filter(Number.isFinite);
  return t.length ? Math.min(...t) : null;
};
export const hasStarted = (order, now = Date.now()) => {
  const k = firstKickoff(order);
  return k !== null && now >= k;
};

/**
 * Bester gültiger Tippstand eines Mitspielers: abgeschickter Tipp in der Tipprunde oder Tipps aus der
 * Halbserie in der Datenbank (z. B. per Excel eingelesen), je nachdem, was vollständiger ist.
 * @returns {{count:number, total:number, state:string, source:'tippen'|'excel'|null}}
 */
export function tipStatus({ name, tippingTips, roundPlayers, order }) {
  const total = order.length;
  const a = validTipCount(tippingTips, order);
  const rp = findPlayer(roundPlayers, name);
  const b = rp ? validTipCount(rp.tips, order) : 0;
  const count = Math.max(a, b);
  return { count, total, state: tipState(count, total), source: count === 0 ? null : b > a ? 'excel' : 'tippen' };
}
