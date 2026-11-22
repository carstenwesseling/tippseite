import { getTippfete } from '../db.js';
import { esc } from '../util.js';

/** "2027-01-16" -> Date (lokal, Mitternacht) */
const parseDay = (d) => { const [y, m, t] = d.split('-').map(Number); return new Date(y, m - 1, t); };

/** Seite "Nächste Tippfete": Datum, Uhrzeit und Ort als Eintrittskarte. */
export async function renderTippfete(app) {
  const t = await getTippfete();
  if (!t) {
    app.innerHTML = '<h1>Nächste Tippfete</h1><div class="msg">Noch kein Termin. Sobald einer feststeht, steht er hier.</div>';
    return;
  }
  const day = parseDay(t.datum);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 864e5);
  const stub = days > 1 ? ['noch', days, 'Tage'] : days === 1 ? ['noch', 1, 'Tag'] : days === 0 ? ['', 'heute', ''] : ['', '–', 'vorbei'];
  const datum = day.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  app.innerHTML = `<h1>Nächste Tippfete</h1>
    <div class="tf"><div class="ticket"><div class="main"><div class="eyebrow">Einladung</div><h2>Tippfete</h2>
      <dl><div><dt>Datum</dt><dd>${esc(datum)}</dd></div>
      ${t.uhrzeit ? `<div><dt>Uhrzeit</dt><dd>${esc(t.uhrzeit)} Uhr</dd></div>` : ''}
      ${t.ort ? `<div><dt>Ort</dt><dd>${esc(t.ort)}</dd></div>` : ''}</dl></div>
      <div class="stub"><span>${stub[0]}</span><b>${stub[1]}</b><span>${stub[2]}</span></div></div></div>`;
}
