// Vereinsnamen normalisieren: Excel-Kurzformen und OpenLigaDB-Langformen -> gemeinsamer Schlüssel.
const ALIASES = {
  bayern: ['bayern', 'fc bayern münchen', 'bayern münchen'],
  leipzig: ['leipzig', 'rb leipzig'],
  hoffenheim: ['hoffenheim', 'tsg hoffenheim', 'tsg 1899 hoffenheim'],
  leverkusen: ['leverkusen', 'bayer 04 leverkusen', 'bayer leverkusen'],
  bremen: ['bremen', 'sv werder bremen', 'werder bremen'],
  frankfurt: ['frankfurt', 'eintracht frankfurt'],
  augsburg: ['augsburg', 'fc augsburg'],
  freiburg: ['freiburg', 'sc freiburg'],
  koeln: ['köln', 'koeln', '1. fc köln', 'fc köln'],
  mainz: ['mainz', '1. fsv mainz 05', 'mainz 05'],
  hamburg: ['hamburg', 'hamburger sv', 'hsv'],
  gladbach: ['gladbach', 'borussia mönchengladbach', 'mönchengladbach'],
  stuttgart: ['stuttgart', 'vfb stuttgart'],
  union: ['union', '1. fc union berlin', 'union berlin'],
  dortmund: ['dortmund', 'borussia dortmund', 'bvb'],
  stpauli: ['st. pauli', 'st.pauli', 'fc st. pauli'],
  wolfsburg: ['wolfsburg', 'vfl wolfsburg'],
  heidenheim: ['heidenheim', '1. fc heidenheim 1846', '1. fc heidenheim'],
  // 2. Bundesliga / Auf- und Absteiger bei Bedarf ergänzen
  schalke: ['schalke', 'fc schalke 04'],
  hertha: ['hertha', 'hertha bsc'],
  bochum: ['bochum', 'vfl bochum', 'vfl bochum 1848'],
  darmstadt: ['darmstadt', 'sv darmstadt 98'],
  kiel: ['kiel', 'holstein kiel'],
};

const lookup = new Map();
for (const [key, names] of Object.entries(ALIASES)) for (const n of names) lookup.set(clean(n), key);

function clean(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
}

/** @returns {string} kanonischer Schlüssel; unbekannte Namen bleiben bereinigt erhalten */
export function teamKey(name) {
  const c = clean(name);
  return lookup.get(c) ?? c;
}

export const isKnownTeam = (name) => lookup.has(clean(name));

/** Schlüssel eines Spiels */
export const matchKey = (home, away) => `${teamKey(home)}|${teamKey(away)}`;
