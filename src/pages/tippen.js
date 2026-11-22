import { getTipping, listMembers, getTips, saveTips, queueExcelMail, memberId } from '../db.js';
import { buildTipWorkbook, tipFileName, toBase64 } from '../tipsheet.js';
import { shortName } from '../teams.js';
import { esc, $ } from '../util.js';

const K_WHO = 'tipp-wer-v1';
const K_DRAFT = (id) => `tipp-entwurf-v1-${id}`;
const K_MAIL = (id) => `tipp-mail-v1-${id}`;
const lget = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* optional */ } };

const done = (t) => Object.values(t).filter((v) => v?.h !== '' && v?.g !== '' && v?.h != null && v?.g != null).length;

function row(m) {
  const lab = `${m.home} gegen ${m.away}`;
  return `<div class="m"><span class="t h" title="${esc(m.home)}">${esc(shortName(m.home))}</span>
    <input class="tip" data-k="${esc(m.key)}" data-s="h" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(shortName(m.home))}, ${esc(lab)}">
    <span class="col" aria-hidden="true">:</span>
    <input class="tip" data-k="${esc(m.key)}" data-s="g" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(shortName(m.away))}, ${esc(lab)}">
    <span class="t g" title="${esc(m.away)}">${esc(shortName(m.away))}</span></div>`;
}

export async function renderTippen(app) {
  const [tipping, members] = await Promise.all([getTipping().catch(() => null), listMembers({ onlyActive: true })]);
  if (!tipping) { app.innerHTML = '<h1>Tippen</h1><div class="msg">Zurzeit ist keine Tipprunde geöffnet.</div>'; return; }

  const order = tipping.order;
  const total = order.length;
  const days = [...new Set(order.map((m) => m.spieltag))].sort((a, b) => a - b);
  let who = lget(K_WHO) || '';
  if (!members.some((m) => m.id === who)) who = '';
  let tips = {};
  let savedAt = null;

  app.innerHTML = `<div class="tp">
    <div class="tp-head gut"><h1>${esc(tipping.title)} tippen</h1></div>
    <div class="tp-body">
    <div class="topbox gut">
      <div class="who"><label for="wer">Wer tippt?</label>
        <select id="wer"><option value="">– Name wählen –</option>${members.map((m) => `<option value="${esc(m.id)}"${m.id === who ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="prog"><span class="pbar" aria-hidden="true"><i></i></span><span class="pnum"><b>0</b>/${total}</span><button type="button" class="send primary">Abschicken</button></div>
    </div>
    <div class="need gut" id="need"></div>
    ${days.map((d) => { const ms = order.filter((m) => m.spieltag === d);
      return `<section class="sp" id="d${d}"><h2 class="dh gut"><span>${d}. Spieltag</span><span class="cnt" data-cnt="${d}">0/${ms.length}</span></h2><div class="ms">${ms.map(row).join('')}</div></section>`; }).join('')}
    <div class="endsend gut">
      <div class="mailbox" id="mailbox" hidden>
        <label class="chk"><input type="checkbox" id="mailon" checked> Tippschein als Excel per Mail an mich senden</label>
        <input type="email" id="mailto" inputmode="email" autocomplete="email" placeholder="Deine E-Mail-Adresse" aria-label="E-Mail-Adresse für den Excel-Tippschein">
        <div class="muted">Es zählt die Adresse, die in der Verwaltung für dich hinterlegt ist.</div>
      </div>
      <button type="button" class="send primary big">Tipps abschicken</button>
      <button type="button" class="big ghost" id="dl">Excel-Tippschein herunterladen</button>
    </div></div></div>`;

  const inputs = [...app.querySelectorAll('.tip')];
  const sel = $('#wer'), need = $('#need');
  const member = () => members.find((m) => m.id === who);
  const msg = (html) => { need.innerHTML = html; };

  function refresh() {
    const n = done(tips);
    days.forEach((d) => {
      const ms = order.filter((m) => m.spieltag === d);
      const c = ms.filter((m) => tips[m.key] && tips[m.key].h !== '' && tips[m.key].g !== '' && tips[m.key].h != null && tips[m.key].g != null).length;
      $(`[data-cnt="${d}"]`).textContent = `${c}/${ms.length}`;
      $(`#d${d}`).classList.toggle('full', c === ms.length);
    });
    app.querySelector('.pnum b').textContent = n;
    app.querySelector('.pbar i').style.width = (n / total * 100) + '%';
    app.querySelectorAll('.send, #dl').forEach((b) => { b.disabled = !who || !tipping.open; });
    const m = member();
    $('#mailbox').hidden = !(m?.sendExcel);
    if (m?.sendExcel) $('#mailto').value ||= lget(K_MAIL(who)) || '';
  }

  async function load() {
    tips = {}; savedAt = null;
    if (who) {
      const draft = lget(K_DRAFT(who));
      const remote = await getTips(who).catch(() => null);
      if (remote) { tips = Object.fromEntries(Object.entries(remote.tips ?? {}).map(([k, v]) => [k, { h: String(v.h), g: String(v.g) }])); savedAt = remote.updatedAt; }
      if (draft) { try { tips = { ...tips, ...JSON.parse(draft) }; } catch { /* kaputter Entwurf */ } }
    }
    const open = tipping.open;
    inputs.forEach((i) => { i.disabled = !who || !open; i.value = tips[i.dataset.k]?.[i.dataset.s] ?? ''; });
    msg(!open ? '<span class="warnline">Die Tipprunde ist geschlossen. Es kann nicht mehr getippt werden.</span>'
      : !who ? 'Wähle oben zuerst deinen Namen, dann kannst du tippen.'
      : savedAt ? `Zuletzt abgeschickt am ${new Date(savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.${lget(K_DRAFT(who)) ? ' Änderungen sind noch nicht abgeschickt.' : ''}`
      : 'Noch nichts abgeschickt. Deine Eingaben bleiben auf diesem Gerät erhalten, bis du abschickst.');
    refresh();
  }

  sel.addEventListener('change', () => { who = sel.value; lset(K_WHO, who); load(); });

  app.addEventListener('input', (e) => {
    const el = e.target.closest('.tip'); if (!el) return;
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    (tips[el.dataset.k] ||= {})[el.dataset.s] = el.value;
    lset(K_DRAFT(who), JSON.stringify(tips));
    refresh();
    if (el.value !== '') { const n = inputs[inputs.indexOf(el) + 1]; n ? n.focus() : el.blur(); }
  });
  app.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('.tip'); if (!el) return;
    if (e.key === 'Backspace' && el.value === '') { const p = inputs[inputs.indexOf(el) - 1]; if (p) { e.preventDefault(); p.focus(); } }
    if (e.key === 'Enter') { e.preventDefault(); const n = inputs[inputs.indexOf(el) + 1]; n ? n.focus() : el.blur(); }
  });
  app.addEventListener('focusin', (e) => { if (e.target.classList?.contains('tip')) setTimeout(() => e.target.select(), 0); });

  const numericTips = () => Object.fromEntries(Object.entries(tips)
    .filter(([, v]) => v?.h !== '' && v?.g !== '' && v?.h != null && v?.g != null)
    .map(([k, v]) => [k, { h: Number(v.h), g: Number(v.g) }]));

  const sheet = () => buildTipWorkbook({ title: tipping.title, playerName: member().name, order, tips: numericTips() });

  $('#dl').addEventListener('click', async () => {
    const buf = await sheet();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = tipFileName(tipping.title, member().name);
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  async function submit() {
    const m = member(); if (!m) return;
    const missing = total - done(tips);
    if (missing && !confirm(`Es fehlen noch ${missing} Tipps. Trotzdem abschicken?`)) return;
    const wantMail = m.sendExcel && $('#mailon').checked;
    const to = $('#mailto').value.trim();
    if (wantMail && !/^\S+@\S+\.\S+$/.test(to)) {
      $('#mailbox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      msg('<span class="warnline">Bitte deine E-Mail-Adresse für den Excel-Tippschein eintragen (oder den Haken entfernen).</span>');
      $('#mailto').focus(); return;
    }
    app.querySelectorAll('.send').forEach((b) => { b.disabled = true; });
    try {
      await saveTips(who, m.name, numericTips());
      lset(K_DRAFT(who), null); savedAt = Date.now();
      let text = 'Tipps abgeschickt.';
      if (wantMail) {
        lset(K_MAIL(who), to);
        try {
          await queueExcelMail({
            memberId: who, to, subject: `Dein Tippschein: ${tipping.title}`,
            text: `Hallo ${m.name},\n\nanbei dein Tippschein für ${tipping.title} als Excel-Datei.\n\nViel Erfolg!`,
            filename: tipFileName(tipping.title, m.name), base64: toBase64(await sheet()),
          });
          text += ` Der Excel-Tippschein geht an ${to}.`;
        } catch (e) {
          text += ' Die Mail konnte nicht gesendet werden (Adresse stimmt nicht mit der hinterlegten überein oder Mailversand nicht eingerichtet). Du kannst den Tippschein oben herunterladen.';
        }
      }
      msg(`<span class="okline">${esc(text)}</span>`);
    } catch (e) {
      msg(`<span class="warnline">Speichern fehlgeschlagen: ${esc(e.message)}</span>`);
    }
    refresh();
  }
  app.querySelectorAll('.send').forEach((b) => b.addEventListener('click', submit));
  load();
}
