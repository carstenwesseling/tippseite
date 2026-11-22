import { getTippfete, getTippfeteCounts, currentMembers, hasVoted, voteTippfete } from '../db.js';
import { $ } from '../util.js';
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
      <div class="stub"><span>${stub[0]}</span><b>${stub[1]}</b><span>${stub[2]}</span></div></div></div>
    <div class="tf" id="poll"></div>`;
  await renderPoll(days >= 0);
}

const resultHtml = (c) => {
  const total = Math.max(1, c.k + c.n);
  return `<div class="pcnt"><div class="k"><b>${c.k}</b><span>${c.k === 1 ? 'kommt' : 'kommen'}</span></div><div class="n"><b>${c.n}</b><span>${c.n === 1 ? 'kommt nicht' : 'kommen nicht'}</span></div></div>
    <div class="pbar" role="img" aria-label="${c.k} kommen, ${c.n} kommen nicht"><i style="width:${c.k / total * 100}%"></i><i style="width:${c.n / total * 100}%"></i></div>`;
};

/** Umfrage: Name wählen, Komme / Komme nicht, einmal abstimmen. Angezeigt werden nur Anzahlen. */
async function renderPoll(open) {
  const el = $('#poll');
  let counts, names;
  try { [counts, names] = await Promise.all([getTippfeteCounts(), open ? currentMembers() : []]); }
  catch { el.innerHTML = ''; return; }
  const form = open && names.length ? `<div class="pform"><label for="pn">Name</label>
      <select id="pn"><option value="">Bitte wählen</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
      <div class="seg pseg"><button type="button" class="k" data-a="k" aria-pressed="false">Komme</button><button type="button" class="n" data-a="n" aria-pressed="false">Komme nicht</button></div>
      <button type="button" id="pgo" disabled>Abstimmen</button>
      <p class="muted pnote">Du kannst nur einmal abstimmen, danach ist die Antwort nicht mehr änderbar.</p><div id="pmsg"></div></div>` : '';
  el.innerHTML = `<div class="card pcard"><h3>Kommst du zur Tippfete?</h3>${form}<div id="pres">${resultHtml(counts)}</div></div>`;
  if (!form) return;
  let answer = null;
  const upd = () => { $('#pgo').disabled = !($('#pn').value && answer); };
  $('#pn').addEventListener('change', async () => {
    $('#pmsg').innerHTML = '';
    upd();
    if ($('#pn').value && await hasVoted($('#pn').value).catch(() => false)) {
      $('#pmsg').innerHTML = '<div class="msg warn">Für diesen Namen wurde schon abgestimmt. Die Antwort kann nicht mehr geändert werden.</div>';
      $('#pgo').disabled = true;
    }
  });
  el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    answer = b.dataset.a;
    el.querySelectorAll('[data-a]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (!$('#pmsg').textContent) upd();
  }));
  $('#pgo').addEventListener('click', async () => {
    const name = $('#pn').value;
    $('#pgo').disabled = true;
    try {
      await voteTippfete(name, answer);
      el.querySelector('.pform').innerHTML = `<div class="msg ok">Danke ${esc(name)}, ${answer === 'k' ? 'du kommst' : 'deine Absage'} ist gespeichert.</div>`;
      $('#pres').innerHTML = resultHtml(await getTippfeteCounts());
    } catch (e) {
      const denied = /permission/i.test(`${e?.code} ${e?.message}`);
      $('#pmsg').innerHTML = `<div class="msg err">${denied ? 'Die Abstimmung ist gerade nicht möglich.' : esc(e.message)}</div>`;
      upd();
    }
  });
}
