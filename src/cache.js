// Kurzzeit-Cache im Speicher für Halbserien und Saisonergebnisse (schneller Wechsel zwischen den Seiten).
const TTL_MS = 5 * 60 * 1000;
const memo = new Map();

/** Liefert das (Promise-)Ergebnis aus dem Cache oder lädt es neu; Fehler werden nicht gecacht. */
export const cached = (key, load) => {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = load().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), p });
  return p;
};

/** Verwirft den Cache (vor jedem Schreibzugriff auf Halbserien oder Ergebnisse). */
export const clearCache = () => memo.clear();
