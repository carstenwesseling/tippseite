/* Gemeinsame Logik der Tipp-Vorschläge (Demo, speichert nur im Browser: localStorage).
   Beispielpaarungen – die echten kommen später aus OpenLigaDB. */
(function () {
  const TEAMS = [
    ['FC Bayern München', 'Bayern'], ['RB Leipzig', 'Leipzig'], ['TSG Hoffenheim', 'Hoffenheim'], ['Bayer 04 Leverkusen', 'Leverkusen'],
    ['SV Werder Bremen', 'Bremen'], ['Eintracht Frankfurt', 'Frankfurt'], ['FC Augsburg', 'Augsburg'], ['SC Freiburg', 'Freiburg'],
    ['1. FC Köln', 'Köln'], ['1. FSV Mainz 05', 'Mainz'], ['Hamburger SV', 'Hamburg'], ['Bor. Mönchengladbach', 'Gladbach'],
    ['VfB Stuttgart', 'Stuttgart'], ['1. FC Union Berlin', 'Union'], ['Borussia Dortmund', 'Dortmund'], ['FC St. Pauli', 'St. Pauli'],
    ['VfL Wolfsburg', 'Wolfsburg'], ['1. FC Heidenheim', 'Heidenheim'],
  ].map(([full, short]) => ({ full, short }));
  const FIRST = 18, COUNT = 17, PER = 9;

  // Spielplan nach dem Rundenturnier-Verfahren (nur für die Demo)
  function schedule() {
    const arr = TEAMS.map((_, i) => i), days = [];
    for (let r = 0; r < COUNT; r++) {
      const ms = [];
      for (let i = 0; i < PER; i++) {
        const a = arr[i], b = arr[arr.length - 1 - i];
        const flip = (r + i) % 2;
        ms.push({ id: `${FIRST + r}-${i}`, home: TEAMS[flip ? b : a], away: TEAMS[flip ? a : b] });
      }
      days.push({ day: FIRST + r, matches: ms });
      arr.splice(1, 0, arr.pop());
    }
    return days;
  }
  const DAYS = schedule();
  const TOTAL = COUNT * PER;

  // Wer hat in der aktuellen Halbserie mitgetippt (-> Haken vorbelegt)? Die anderen sind frühere Mitglieder.
  const AKTUELL = ['Andreas', 'Bernd', 'Carsten', 'Dirk', 'Frank', 'Jürgen', 'Klaus', 'Markus', 'Michael', 'Peter', 'Ralf', 'Stefan', 'Thomas', 'Uwe'];
  const FRUEHER = ['Hans', 'Jörg', 'Rolf', 'Wolfgang'];

  const K_MEM = 'tipp-mitglieder-v1', K_WHO = 'tipp-wer-v1', K_TIPS = (n) => 'tipp-tipps-v1-' + n;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* optional */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch { /* optional */ } };
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    defaults: () => [...AKTUELL.map((name) => ({ name, aktiv: true, aktuell: true })), ...FRUEHER.map((name) => ({ name, aktiv: false, aktuell: false }))].sort(byName),
    members() { return get(K_MEM, null) || this.defaults(); },
    saveMembers(list) { set(K_MEM, list); },
    resetMembers() { del(K_MEM); },
    tips: (n) => get(K_TIPS(n), {}),
    saveTips: (n, t) => set(K_TIPS(n), t),
    who: () => get(K_WHO, ''),
    saveWho: (n) => set(K_WHO, n),
  };

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600);
  }

  const dayName = (d) => `Spieltag ${d}`;

  function rowLine(m) {
    const lab = `${m.home.full} gegen ${m.away.full}`;
    return `<div class="m"><span class="t h" title="${esc(m.home.full)}">${esc(m.home.short)}</span>
      <input class="tip" data-m="${m.id}" data-s="h" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(m.home.short)}, ${esc(lab)}">
      <span class="col" aria-hidden="true">:</span>
      <input class="tip" data-m="${m.id}" data-s="g" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(m.away.short)}, ${esc(lab)}">
      <span class="t g" title="${esc(m.away.full)}">${esc(m.away.short)}</span></div>`;
  }
  function rowStack(m) {
    const lab = `${m.home.full} gegen ${m.away.full}`;
    return `<div class="m"><div class="names"><span class="t">${esc(m.home.full)}</span><span class="t">${esc(m.away.full)}</span></div>
      <div class="ins"><input class="tip" data-m="${m.id}" data-s="h" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(m.home.short)}, ${esc(lab)}">
      <input class="tip" data-m="${m.id}" data-s="g" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" aria-label="Tipp ${esc(m.away.short)}, ${esc(lab)}"></div></div>`;
  }

  /** root: Container; variant: 'a' | 'b' | 'c'; layout: welche Bausteine oben/unten stehen */
  function mount({ root, variant, layout }) {
    const row = variant === 'c' ? rowStack : rowLine;
    const active = store.members().filter((m) => m.aktiv).sort(byName);
    let who = store.who();
    if (!active.some((m) => m.name === who)) who = '';
    let tips = who ? store.tips(who) : {};

    const parts = {
      who: `<div class="who"><label for="wer">Wer tippt?</label>
        <select id="wer"><option value="">– Name wählen –</option>${active.map((m) => `<option${m.name === who ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <a class="mlink" href="tippen-mitglieder.html">Mitglieder</a></div>`,
      chips: `<nav class="chips" aria-label="Spieltag wählen">${DAYS.map((d) => `<button type="button" data-go="${d.day}">${d.day}</button>`).join('')}</nav>`,
      prog: `<div class="prog"><span class="pbar" aria-hidden="true"><i></i></span><span class="pnum"><b>0</b>/${TOTAL}</span><button type="button" class="send primary">Abschicken</button></div>`,
    };
    root.className = `tp tp-${variant}`;
    root.innerHTML = `
      <div class="topbox gut">${layout.top.map((p) => parts[p]).join('')}</div>
      <div class="need gut" hidden>Wähle oben zuerst deinen Namen, dann kannst du tippen.</div>
      <div class="daysbox">${DAYS.map((d) => `<section class="sp" id="d${d.day}" data-day="${d.day}">
        <h2 class="dh gut"><span>${dayName(d.day)}</span><span class="cnt" data-cnt="${d.day}">0/${PER}</span></h2>
        <div class="ms">${d.matches.map(row).join('')}</div></section>`).join('')}</div>
      <div class="endsend gut"><button type="button" class="send primary big">Tipps abschicken</button></div>
      ${layout.dock.length ? `<div class="dock gut">${layout.dock.map((p) => parts[p]).join('')}</div>` : ''}`;

    const inputs = [...root.querySelectorAll('.tip')];
    const sel = root.querySelector('#wer');
    const need = root.querySelector('.need');

    function paint() {
      const locked = !who;
      need.hidden = !locked;
      inputs.forEach((i) => { i.disabled = locked; i.value = tips[i.dataset.m]?.[i.dataset.s] ?? ''; });
      refresh();
    }
    function refresh() {
      let done = 0;
      DAYS.forEach((d) => {
        const n = d.matches.filter((m) => tips[m.id]?.h !== undefined && tips[m.id]?.h !== '' && tips[m.id]?.g !== undefined && tips[m.id]?.g !== '').length;
        done += n;
        root.querySelector(`[data-cnt="${d.day}"]`).textContent = `${n}/${PER}`;
        root.querySelector(`#d${d.day}`).classList.toggle('full', n === PER);
        const chip = root.querySelector(`[data-go="${d.day}"]`);
        if (chip) { chip.classList.toggle('full', n === PER); chip.classList.toggle('part', n > 0 && n < PER); }
      });
      root.querySelectorAll('.pnum b').forEach((b) => { b.textContent = done; });
      root.querySelectorAll('.pbar i').forEach((i) => { i.style.width = (done / TOTAL * 100) + '%'; });
      root.querySelectorAll('.send').forEach((b) => { b.disabled = !who; });
      root.dataset.done = done;
    }

    sel.addEventListener('change', () => {
      who = sel.value; store.saveWho(who); tips = who ? store.tips(who) : {}; paint();
    });

    root.addEventListener('input', (e) => {
      const el = e.target.closest('.tip'); if (!el) return;
      el.value = el.value.replace(/\D/g, '').slice(0, 1);
      (tips[el.dataset.m] ||= {})[el.dataset.s] = el.value;
      store.saveTips(who, tips); refresh();
      if (el.value !== '') { const n = inputs[inputs.indexOf(el) + 1]; n ? n.focus() : el.blur(); }
    });
    root.addEventListener('keydown', (e) => {
      const el = e.target.closest?.('.tip'); if (!el) return;
      if (e.key === 'Backspace' && el.value === '') { const p = inputs[inputs.indexOf(el) - 1]; if (p) { e.preventDefault(); p.focus(); } }
      if (e.key === 'Enter') { e.preventDefault(); const n = inputs[inputs.indexOf(el) + 1]; n ? n.focus() : el.blur(); }
    });
    root.addEventListener('focusin', (e) => { if (e.target.classList?.contains('sc')) setTimeout(() => e.target.select(), 0); });
    root.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { root.querySelector(`#d${go.dataset.go}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (e.target.closest('.send')) {
        const missing = TOTAL - Number(root.dataset.done);
        if (missing && !confirm(`Es fehlen noch ${missing} Tipps. Trotzdem abschicken?`)) return;
        toast(`Tipps von ${who} gespeichert (Demo – noch nicht mit Firebase verbunden)`);
      }
    });
    paint();
  }

  window.Tippen = { mount, store, toast, esc, byName, DAYS, TOTAL, PER, AKTUELL };
})();
