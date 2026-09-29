/* main.js — app state, playback, timeline editor, telemetry and cards. */
(function (SB) {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sb.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const fmt = SB.fmt;

  const app = {
    scn: null, ship: null, ref: null, run: null, actions: [],
    i: 0, t: 0, playing: false, speed: 1, rudAge: 0, mode: 'intro', tab: 'throttle',
    endTimer: null, lastTelemetryI: -1, dragging: false, seen: store.get('seen', {}), stars: store.get('stars', {}),
    rcsSel: new Set(), liveTrim: null, thrDragging: false, queued: null,
  };

  /* ---------------- scenario loading ---------------- */
  function loadScenario(id, opts) {
    opts = opts || {};
    const scn = SB.scenarioById(id) || SB.SCENARIOS[0];
    app.scn = scn;
    app.ref = SB.buildReference(scn);
    app.ship = app.ref.ship;
    app.actions = opts.actions || store.get('actions.' + scn.id, []);
    app.speed = 1; $$('.speed button').forEach(b => b.classList.toggle('on', b.dataset.speed === '1'));
    recompute();
    seek(0);
    $('#scnTitle').textContent = scn.title;
    $('#scnTag').textContent = 'MISSION ' + scn.order + ' · ' + scn.tag;
    store.set('current', scn.id);
    if (!app.seen[scn.id] && !opts.skipBriefing) { app.mode = 'intro'; showBriefing(); }
    else { app.mode = app.seen[scn.id] ? 'edit' : 'watch'; hideCard(); }
    updateMode();
  }

  function recompute() {
    app.actions.sort((a, b) => a.t - b.t);
    app.run = SB.runPlayer(app.scn, app.ref, app.actions);
    store.set('actions.' + app.scn.id, app.actions);
    if (app.i > app.run.frames.length - 1) app.i = app.run.frames.length - 1;
    app.lastTelemetryI = -1;
    renderChips(); renderEngineButtons(); drawTimeline();
  }

  /* ---------------- playback ---------------- */
  function frameAt(i) { return app.run.frames[Math.max(0, Math.min(i, app.run.frames.length - 1))]; }
  function seek(t) {
    const dt = app.run.dt;
    app.t = SB.clamp(t, 0, app.run.duration);
    app.i = Math.round(app.t / dt);
    app.rudAge = 0;
    if (app.endTimer) { clearTimeout(app.endTimer); app.endTimer = null; }
    updateAtLabels();
  }
  function setPlaying(p) {
    if (p && app.i >= app.run.frames.length - 1) seek(0);
    app.playing = p;
    $('#btnPlay').textContent = p ? '❚❚' : '▶';
    if (!p && app.endTimer) { clearTimeout(app.endTimer); app.endTimer = null; }
  }
  let lastTs = 0;
  function loop(ts) {
    const dtReal = Math.min(0.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
    const last = app.run.frames.length - 1;
    if (app.playing) {
      app.t += dtReal * app.speed;
      app.i = Math.round(app.t / app.run.dt);
      if (app.i >= last) {
        app.i = last; app.t = app.run.duration; app.playing = false; $('#btnPlay').textContent = '▶';
        app.endTimer = setTimeout(() => { app.endTimer = null; showResults(); }, 1400);
      }
      updateAtLabels();
    }
    if (app.i >= last) app.rudAge += dtReal; else app.rudAge = 0;
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------------- drawing ---------------- */
  function draw() {
    const fNow = frameAt(app.i);
    SB.drawScene($('#scene'), { scn: app.scn, ship: app.ship, ref: app.ref, run: app.run, i: app.i, rudAge: app.rudAge, log: app.run.log.filter(l => l.t <= fNow.t + 1e-6).slice(-3) });
    if (app.i !== app.lastTelemetryI) {
      app.lastTelemetryI = app.i;
      const f = frameAt(app.i), rf = app.ref.frames[Math.min(app.i, app.ref.frames.length - 1)];
      updateTelemetry(f, rf);
      drawTimeline();
      renderEngineButtons();
      syncControls(f);
    }
  }
  function syncControls(f) {
    if (!app.thrDragging) { $('#thrSlider').value = Math.round(f.throttle * 100); $('#thrVal').textContent = Math.round(f.throttle * 100) + '%'; }
    const running = f.engines.filter(e => e.level > 0.5).length;
    $('#thrReadout').innerHTML = `<b>${running}/6 engines</b> · ${(f.thrust / 1e6).toFixed(1)} MN · <b>${f.gLoad.toFixed(1)} g</b> <span class="dim">· plan ${Math.round(f.throttleRef * 100)}% · limit ${app.ship.gLimit} g</span>`;
    const trim = app.liveTrim != null ? app.liveTrim : f.trim;
    SB.drawGimbalPad($('#gimbalPad'), app.ship, f, trim);
    const ahead = frameAt(app.i + Math.round(5 / app.run.dt));
    const satNote = f.sasSat ? ' <span class="bad">SAT</span>' : '';
    $('#trimReadout').innerHTML = `<span class="dim">Trim</span> <b>${fmt.sn(f.trim, 1)}°</b> <span class="dim">+ SAS</span> ${fmt.sn(f.sas, 1)}° <span class="dim">+ plan</span> ${fmt.sn(f.gimbalRef, 1)}° <span class="dim">=</span> <b>${fmt.sn(f.gimbalAct, 1)}°</b>${satNote} ` +
      `<span class="dim">· in 5 s:</span> err <b class="${Math.abs(ahead.pitchErr) > 10 ? 'bad' : Math.abs(ahead.pitchErr) > 3 ? 'warn' : 'good'}">${fmt.sn(ahead.pitchErr, 1)}°</b>, rate <b class="${Math.abs(ahead.rateErr) > 8 ? 'bad' : Math.abs(ahead.rateErr) > 2 ? 'warn' : 'good'}">${fmt.sn(ahead.rateErr, 1)}°/s</b>, recovery ${Math.round(ahead.recovery * 100)}%`;
    SB.drawRcsPad($('#rcsPad'), app.ship, f, app.rcsSel, +$('#rcsPower').value / 100);
    const bl = SB.rcsEffect(app.ship, SB.massProps(app.ship, f.prop), Array.from(app.rcsSel), +$('#rcsPower').value / 100);
    const dur = +$('#rcsDur').value;
    $('#rcsReadout').innerHTML = app.rcsSel.size
      ? `<b class="blue">${Array.from(app.rcsSel).map(id => app.ship.rcs.thrusters[id].name).join(' + ')}</b> for ${dur.toFixed(1)} s: ` +
        `rate change about <b>${fmt.sn(bl.tau / f.I * SB.RAD * dur, 1)}°/s</b>, costs ${(bl.mdot * dur).toFixed(0)} kg of propellant.`
      : '<span class="dim">Select one or more thrusters on the ship.</span>';
    $('#engReadout').innerHTML = `<span class="dim">Sum of engine moments:</span> <b class="${Math.abs(f.tq.asym) > 1e6 ? 'bad' : 'good'}">${(f.tq.asym / 1e6).toFixed(1)} MN·m</b> <span class="dim">· gimbal is countering ${(f.tq.gimbal / 1e6).toFixed(1)}</span>`;
    $('#addRcs').disabled = app.rcsSel.size === 0;
  }

  const TILES = [['alt', 'ALT'], ['vel', 'VEL m/s'], ['vspd', 'V.SPD m/s'], ['hspd', 'H.SPD m/s'], ['pitch', 'PITCH °'], ['rate', 'RATE °/s'],
    ['gimbal', 'GIMBAL °'], ['thr', 'THR %'], ['dv', 'Δv m/s'], ['g', 'G LOAD'], ['dev', 'OFF LINE'], ['rec', 'RECOV %']];
  function buildTelemetry() {
    const box = $('#telemetry'); box.innerHTML = '';
    TILES.forEach(([k, label]) => {
      const t = el('div', 'tile', `<div class="l" id="l-${k}">${label}</div><div class="v" id="v-${k}">—</div><div class="s" id="s-${k}"></div>`);
      t.id = 'tile-' + k; box.appendChild(t);
    });
  }
  function tile(k, v, s, cls, label) {
    $('#v-' + k).textContent = v; $('#s-' + k).textContent = s || '';
    if (label) $('#l-' + k).textContent = label;
    const t = $('#tile-' + k); t.className = 'tile' + (cls ? ' ' + cls : '');
  }
  const spd = v => Math.abs(v) >= 100 ? fmt.n(v, 0) : fmt.n(v, 1);
  const sspd = v => Math.abs(v) >= 100 ? fmt.sn(v, 0) : fmt.sn(v, 1);
  const altKm = m => Math.abs(m) >= 10000;
  function updateTelemetry(f, rf) {
    const ship = app.ship;
    const running = f.engines.filter(e => e.level > 0.5).length;
    if (app.scn.tower) tile('alt', fmt.n(Math.max(0, f.pinAlt - app.scn.tower.armHeight)), 'pins to arms', '', 'ALT m');
    else if (altKm(f.alt)) tile('alt', (f.alt / 1000).toFixed(1), 'vs ' + (rf.alt / 1000).toFixed(1), '', 'ALT km');
    else tile('alt', fmt.n(f.alt), 'vs ' + fmt.n(rf.alt), '', 'ALT m');
    tile('vel', spd(f.speed), app.scn.target ? 'SECO ' + app.scn.target.speed : 'vs ' + spd(rf.speed));
    tile('vspd', sspd(f.vUp), 'vs ' + sspd(rf.vUp));
    tile('hspd', spd(f.vEast), app.scn.tower ? 'arms ' + fmt.sn(app.ref.frames[app.ref.frames.length - 1].dr - f.dr, 1) + ' m' : 'vs ' + spd(rf.vEast));
    const pe = Math.abs(f.pitchErr);
    tile('pitch', fmt.n(f.pitch, 1), 'err ' + fmt.sn(f.pitchErr, 1) + '°', pe > 10 ? 'bad' : pe > 3 ? 'warn' : '');
    const re = Math.abs(f.rateErr);
    tile('rate', fmt.sn(f.rate, 1), 'err ' + fmt.sn(f.rateErr, 1), re > 8 ? 'bad' : re > 2 ? 'warn' : '');
    tile('gimbal', fmt.sn(f.gimbalAct, 1), f.sasSat ? 'SAS SAT' : 'SAS ' + fmt.sn(f.sas, 1), f.sasSat ? 'bad' : Math.abs(f.sas) > 2 ? 'warn' : '');
    tile('thr', Math.round(f.throttle * 100), running + '/6 eng');
    tile('dv', fmt.n(f.dv), Math.round(f.prop / ship.prop * 100) + '% prop', f.dv < 30 ? 'bad' : f.dv < 80 ? 'warn' : '');
    tile('g', fmt.n(f.gLoad, 1), 'limit ' + ship.gLimit.toFixed(1), f.gLoad > ship.gLimit ? 'bad' : f.gLoad > ship.gLimit - 0.5 ? 'warn' : '');
    const devBad = app.scn.view === 'landing' ? 40 : 400, devWarn = devBad / 4;
    if (altKm(f.dev)) tile('dev', (f.dev / 1000).toFixed(1), f.devSign > 0 ? 'above' : 'below', 'bad', 'OFF LINE km');
    else tile('dev', fmt.n(f.dev), f.dev > 1 ? (f.devSign > 0 ? 'above' : 'below') : 'on line', f.dev > devBad ? 'bad' : f.dev > devWarn ? 'warn' : 'good', 'OFF LINE m');
    tile('rec', Math.round(f.recovery * 100), f.fts > 0 ? 'FTS ' + f.fts.toFixed(1) + ' s' : 'FTS at 15', f.recovery < 0.3 ? 'bad' : f.recovery < 0.7 ? 'warn' : 'good');
    $('#met').textContent = fmt.t(f.t);
    const recent = app.run.log.filter(l => l.t <= f.t + 1e-6 && l.t > f.t - 3 && l.kind !== 'info');
    const b = $('#banner');
    if (recent.length) { const l = recent[recent.length - 1]; b.textContent = l.msg; b.className = 'banner ' + l.kind; }
    else { b.textContent = ''; b.className = 'banner'; }
  }

  /* ---------------- timeline ---------------- */
  function drawTimeline() {
    const c = $('#timeline'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const T = app.scn.duration, x = t => 10 + (W - 20) * t / T;
    // flown span
    const ok = app.run.eval && app.run.eval.success, lostR = ['rud', 'structural', 'recontact', 'ground', 'tower'].indexOf(app.run.end.reason) >= 0 || (app.run.eval && app.run.eval.stars === 0);
    ctx.fillStyle = ok ? 'rgba(94,227,154,0.12)' : lostR ? 'rgba(255,93,93,0.12)' : 'rgba(255,209,102,0.10)';
    ctx.fillRect(x(0), 14, x(app.run.duration) - x(0), H - 26);
    // ticks
    const step = T > 40 ? 10 : 5;
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    for (let t = 0; t <= T + 1e-6; t += step) { ctx.beginPath(); ctx.moveTo(x(t), H - 12); ctx.lineTo(x(t), H - 6); ctx.stroke(); ctx.fillText(t % 60 === 0 && t >= 60 ? (t / 60) + 'm' : t + 's', x(t), H - 1); }
    // baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(x(0), H - 12); ctx.lineTo(x(T), H - 12); ctx.stroke();
    // end marker
    const xe = x(app.run.duration);
    ctx.fillStyle = ok ? SB.COL.good : lostR ? SB.COL.bad : SB.COL.warn;
    ctx.fillRect(xe - 1, 12, 2, H - 24);
    ctx.textAlign = xe > W - 60 ? 'right' : 'left';
    const endName = { rud: 'RUD', structural: 'BREAKUP', recontact: 'RECONTACT', seco: 'SECO', touchdown: 'TOUCHDOWN', catch: 'ARMS', ground: 'IMPACT', tower: 'TOWER', complete: 'HANDOFF', timeout: 'END', depleted: 'DRY' }[app.run.end.reason] || '';
    ctx.fillText(endName, xe + (xe > W - 60 ? -4 : 4), 20);
    // failures
    ctx.fillStyle = SB.COL.bad;
    (app.scn.failures || []).forEach(fl => { const fx = x(fl.t); ctx.beginPath(); ctx.moveTo(fx - 5, 2); ctx.lineTo(fx + 5, 2); ctx.lineTo(fx, 9); ctx.closePath(); ctx.fill(); ctx.textAlign = 'left'; ctx.fillText(fl.engine, fx + 7, 9); });
    // actions
    const rowY = { throttle: 24, engine: 32, trim: 40, rcs: 48 }, col = { throttle: SB.COL.warn, engine: '#ffd166', trim: SB.COL.good, rcs: SB.COL.ref };
    col.engine = '#ffe08a';
    app.actions.forEach(a => {
      ctx.fillStyle = col[a.type]; ctx.beginPath(); ctx.arc(x(a.t), rowY[a.type], 3.2, 0, Math.PI * 2); ctx.fill();
      if (a.type === 'rcs') { ctx.fillStyle = 'rgba(90,205,255,0.35)'; ctx.fillRect(x(a.t), rowY.rcs - 2, Math.max(2, x(a.t + a.duration) - x(a.t)), 4); }
    });
    // playhead
    const xp = x(app.t);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xp, 0); ctx.lineTo(xp, H - 12); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(xp - 6, H - 12); ctx.lineTo(xp + 6, H - 12); ctx.lineTo(xp, H - 5); ctx.closePath(); ctx.fill();
  }
  function timelinePointer(e) {
    const c = $('#timeline'), r = c.getBoundingClientRect();
    const W = r.width, T = app.scn.duration;
    const t = SB.clamp((e.clientX - r.left - 10) / (W - 20) * T, 0, T);
    setPlaying(false);
    seek(Math.min(t, app.run.duration));
    app.lastTelemetryI = -1;
    if (app.mode === 'intro') { app.mode = 'edit'; updateMode(); }
  }

  /* ---------------- actions editor ---------------- */
  function round1(t) { return Math.round(t * 10) / 10; }
  function queueAction(a) {
    app.queued = a;
    if (app.queuedRaf) return;
    app.queuedRaf = requestAnimationFrame(() => { app.queuedRaf = null; const q = app.queued; app.queued = null; if (q) addAction(q); });
  }
  function addAction(a) {
    a.t = round1(app.t);
    a.id = fmt.uid();
    app.actions = app.actions.filter(b => !(b.type === a.type && Math.abs(b.t - a.t) < 0.05 && (a.type !== 'engine' || b.engine === a.engine)));
    app.actions.push(a);
    if (app.mode !== 'edit') { app.mode = 'edit'; updateMode(); }
    recompute();
    app.lastTelemetryI = -1;
  }
  function describe(a) {
    switch (a.type) {
      case 'throttle': return 'THR ' + (a.value == null ? 'PLAN' : Math.round(a.value * 100) + '%');
      case 'trim': return 'TRIM ' + fmt.sn(a.value, 1) + '°';
      case 'engine': return a.engine + ' ' + (a.cmd === 'on' ? 'RELIGHT' : 'OFF');
      case 'rcs': return 'RCS ' + (a.thrusters ? a.thrusters.join('+') : (a.dir > 0 ? 'NR' : 'NL')) + ' ' + Math.round((a.power || 1) * 100) + '% ' + a.duration.toFixed(1) + 's';
    }
    return a.type;
  }
  function renderChips() {
    const box = $('#chips'); box.innerHTML = '';
    if (!app.actions.length) { box.appendChild(el('span', 'empty', 'No actions yet: scrub to a moment and use a control.')); return; }
    const clr = el('button', 'link clear', 'clear all');
    clr.addEventListener('click', () => { app.actions = []; recompute(); app.lastTelemetryI = -1; });
    box.appendChild(clr);
    app.actions.forEach(a => {
      const ch = el('div', 'chip ' + a.type, `<span>${fmt.t(a.t)}</span><b>${describe(a)}</b><button class="x" title="remove">×</button>`);
      ch.addEventListener('click', ev => { if (ev.target.classList.contains('x')) return; setPlaying(false); seek(a.t); app.lastTelemetryI = -1; });
      ch.querySelector('.x').addEventListener('click', () => { app.actions = app.actions.filter(b => b !== a); recompute(); app.lastTelemetryI = -1; });
      box.appendChild(ch);
    });
  }
  function renderEngineButtons() {
    const box = $('#engineButtons'); if (!box) return;
    const f = frameAt(app.i);
    box.innerHTML = '';
    app.ship.engines.forEach((e, k) => {
      const es = f.engines[k];
      let cls = 'off', label = 'OFF · tap to relight', cmd = 'on';
      if (es.state === 'failed') { cls = 'failed'; label = 'FAILED'; cmd = null; }
      else if (es.state === 'on' || es.state === 'spool') { cls = 'on'; label = (es.state === 'spool' ? 'SPOOLING' : 'ON') + ' · tap to cut'; cmd = 'off'; }
      else if (es.state === 'shutdown') { cls = 'off'; label = 'SPOOLING DOWN'; cmd = 'on'; }
      const tq = f.engTq ? f.engTq[k] / 1e6 : 0;
      const b = el('button', cls, `<b>${e.id}</b>${label}<br><span class="${Math.abs(tq) > 0.05 ? (Math.abs(tq) > 1 ? 'bad' : 'warn') : 'dim'}">${tq >= 0 ? '+' : '−'}${Math.abs(tq).toFixed(1)} MN·m</span>`);
      b.disabled = !cmd;
      b.title = e.kind === 'vac' ? 'Raptor Vacuum (fixed)' : 'Raptor centre (gimbals)';
      if (cmd) b.addEventListener('click', () => addAction({ type: 'engine', engine: e.id, cmd }));
      box.appendChild(b);
    });
  }
  function updateAtLabels() { $$('.at').forEach(s => s.textContent = fmt.t(round1(app.t))); drawTimeline(); }
  function updateMode() {
    $('#modeLabel').textContent = app.mode === 'edit' ? 'REWIND & FIX' : app.mode === 'watch' ? 'WATCHING' : '';
  }

  /* ---------------- cards ---------------- */
  function showCard(html) { $('#card').innerHTML = html; $('#overlay').classList.remove('hidden'); }
  function hideCard() { $('#overlay').classList.add('hidden'); }
  function starsHtml(n) { return '<div class="stars">' + [0, 1, 2].map(k => `<span class="${k < n ? '' : 'off'}">★</span>`).join('') + '</div>'; }

  function showBriefing() {
    const s = app.scn;
    showCard(`<div class="tag">MISSION ${s.order} · ${s.tag}</div><h1>${s.title}</h1>
      <p>${s.brief}</p>
      <p class="muted">You are the flight software. The plan is loaded and will fly itself — until something breaks. Watch it once, then rewind, place corrections on the timeline and press play.</p>
      <div class="btns"><button class="primary" id="cardWatch">WATCH IT PLAY OUT ▶</button><button class="secondary" id="cardMissions">Other missions</button></div>`);
    $('#cardWatch').addEventListener('click', () => { hideCard(); app.mode = 'watch'; updateMode(); seek(0); app.lastTelemetryI = -1; setPlaying(true); });
    $('#cardMissions').addEventListener('click', showMissions);
  }
  function showResults() {
    const s = app.scn, ev = app.run.eval, r = app.run.end.reason;
    const first = !app.seen[s.id];
    app.seen[s.id] = true; store.set('seen', app.seen);
    if ((app.stars[s.id] || 0) < ev.stars) { app.stars[s.id] = ev.stars; store.set('stars', app.stars); }
    const cls = ev.stars === 0 ? 'bad' : ev.success ? 'good' : 'warn';
    const rows = ev.rows.map(x => `<tr><td>${x.label}</td><td class="${x.ok ? 'ok' : 'no'}">${x.value}</td></tr>`).join('');
    const next = SB.SCENARIOS.find(z => z.order === s.order + 1);
    showCard(`<div class="tag">${fmt.t(app.run.duration)} · ${first ? 'FIRST RUN' : 'ATTEMPT WITH ' + app.actions.length + ' ACTION' + (app.actions.length === 1 ? '' : 'S')}</div>
      <h1 class="${cls}">${ev.outcome}</h1>${starsHtml(ev.stars)}
      ${first || !ev.success ? `<p>${s.failureNote}</p>` : '<p>Clean recovery. Fewer, earlier, smaller corrections score higher: the line is judged on RMS deviation and the terminal state.</p>'}
      <table>${rows}</table>
      <div class="btns">
        <button class="primary" id="cardFix">${ev.success ? 'REFINE THE FIX' : 'REWIND & FIX'} ⏮</button>
        ${next ? `<button class="secondary" id="cardNext">Next mission: ${next.title} →</button>` : '<button class="secondary" id="cardMissionsR">Mission list</button>'}
        <button class="secondary" id="cardHints">Hints</button>
      </div>`);
    $('#cardFix').addEventListener('click', () => {
      hideCard(); app.mode = 'edit'; updateMode();
      const tf = (s.failures && s.failures.length) ? s.failures[0].t : 0;
      seek(Math.max(0, Math.min(tf + 0.3, app.run.duration))); app.lastTelemetryI = -1;
    });
    if (next) $('#cardNext').addEventListener('click', () => loadScenario(next.id));
    else $('#cardMissionsR').addEventListener('click', showMissions);
    $('#cardHints').addEventListener('click', showHints);
  }
  function showHints() {
    const s = app.scn;
    showCard(`<button class="close" id="cardClose">×</button><div class="tag">HINTS · ${s.title}</div>
      <p>${s.failureNote}</p><ul>${s.hints.map(h => `<li>${h}</li>`).join('')}</ul>
      <div class="btns"><button class="secondary" id="cardSolution">Load an example fix onto the timeline</button><button class="primary" id="cardBack">Back to the timeline</button></div>`);
    $('#cardClose').addEventListener('click', hideCard);
    $('#cardBack').addEventListener('click', hideCard);
    $('#cardSolution').addEventListener('click', () => {
      app.actions = (s.solution || []).map(a => Object.assign({ id: fmt.uid() }, a));
      app.mode = 'edit'; updateMode(); recompute(); hideCard(); seek(0); app.lastTelemetryI = -1; setPlaying(true);
    });
  }
  function showMissions() {
    const list = SB.SCENARIOS.slice().sort((a, b) => a.order - b.order).map(s =>
      `<div class="mission" data-id="${s.id}"><div class="n">${s.order}</div><div class="t">${s.title}<small>${s.tag} · ${s.duration}s window</small></div><div class="st">${'★'.repeat(app.stars[s.id] || 0)}<span style="color:#3a4358">${'★'.repeat(3 - (app.stars[s.id] || 0))}</span></div></div>`).join('');
    showCard(`<button class="close" id="cardClose">×</button><div class="tag">BURN DIRECTOR</div><h1>Missions</h1>
      <p class="muted">Each mission is a short burn that goes wrong. Keep Starship on the planned line and finish the job.</p>${list}
      <div class="btns"><button class="secondary" id="cardReset">Reset progress</button></div>`);
    $('#cardClose').addEventListener('click', hideCard);
    $$('.mission').forEach(m => m.addEventListener('click', () => loadScenario(m.dataset.id)));
    $('#cardReset').addEventListener('click', function () {
      if (this.dataset.armed) { try { localStorage.clear(); } catch (e) { /* ignore */ } app.seen = {}; app.stars = {}; loadScenario(SB.SCENARIOS[0].id); }
      else { this.dataset.armed = '1'; this.textContent = 'Tap again to clear stars and saved timelines'; }
    });
  }
  function showHelp() {
    showCard(`<button class="close" id="cardClose">×</button><div class="tag">HOW TO PLAY</div><h1>Stay on the line</h1>
      <p>The dashed line is the trajectory the flight plan would fly. The ghost ship is where the plan says you should be right now. Orange is what you actually flew.</p>
      <ul>
        <li><b>Timeline</b>: drag to scrub. Every action you add applies from that moment on, and the whole flight is re-simulated instantly, so you can rewind and try again as often as you like.</li>
        <li><b>Throttle</b> sets all running engines (40–100%). <b>Engines</b> shut down or relight individual Raptors; relights can fail for good. <b>Gimbal</b> is a drag pad: point the centre-engine flame, read the moment it makes against the engine imbalance, and match it. The SAS adds up to ±3° on top to hold the plan. <b>RCS</b>: pick thrusters on the ship and fire a timed burst.</li>
        <li><b>Gimbal pad</b>: red arc is the moment from the engine imbalance, green the moment your gimbal makes, white what is left. The yellow tick on the protractor is the trim that cancels the imbalance (MATCH sets it, CENTER zeroes it). SAT means the SAS has used all of its ±3°.</li>
        <li><b>RCS pad</b>: tap thrusters on the ship, set power and burst length, fire. A nose and an aft thruster on opposite sides make a pure couple.</li>
        <li><b>Recovery</b> falls as body rate and attitude error grow. Below 15% for one second the flight termination system fires and the ship is lost.</li>
        <li>The result is judged on the terminal state (orbit, handoff or touchdown), deviation from the line, Δv margin and structural load.</li>
      </ul>
      <p class="muted">Every control acts from the playhead onward and the rest of the flight is re-flown instantly; the dotted line shows where you are now headed. Everything is deterministic: the same actions always give the same flight.</p>
      <div class="btns"><button class="primary" id="cardBack">Got it</button></div>`);
    $('#cardClose').addEventListener('click', hideCard);
    $('#cardBack').addEventListener('click', hideCard);
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    buildTelemetry();
    $('#btnPlay').addEventListener('click', () => { if (app.mode === 'intro') { app.mode = 'watch'; updateMode(); } setPlaying(!app.playing); });
    $('#btnRewind').addEventListener('click', () => { setPlaying(false); seek(0); app.lastTelemetryI = -1; });
    $('#btnEnd').addEventListener('click', () => { setPlaying(false); seek(app.run.duration); app.lastTelemetryI = -1; app.endTimer = setTimeout(() => { app.endTimer = null; showResults(); }, 900); });
    $('#btnBack').addEventListener('click', () => { setPlaying(false); seek(app.t - 1); app.lastTelemetryI = -1; });
    $('#btnFwd').addEventListener('click', () => { setPlaying(false); seek(app.t + 1); app.lastTelemetryI = -1; });
    $$('.speed button').forEach(b => b.addEventListener('click', () => { app.speed = +b.dataset.speed; $$('.speed button').forEach(x => x.classList.toggle('on', x === b)); }));
    $$('.tabs button').forEach(b => b.addEventListener('click', () => {
      app.tab = b.dataset.tab; $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + app.tab));
      app.lastTelemetryI = -1;   // instruments in the newly shown pane need a draw
    }));
    const tl = $('#timeline');
    tl.addEventListener('pointerdown', e => { app.dragging = true; tl.setPointerCapture(e.pointerId); timelinePointer(e); });
    tl.addEventListener('pointermove', e => { if (app.dragging) timelinePointer(e); });
    tl.addEventListener('pointerup', () => { app.dragging = false; });
    tl.addEventListener('pointercancel', () => { app.dragging = false; });
    // throttle: live, from the playhead onward
    const thr = $('#thrSlider');
    thr.addEventListener('input', () => { $('#thrVal').textContent = thr.value + '%'; queueAction({ type: 'throttle', value: +thr.value / 100 }); });
    thr.addEventListener('pointerdown', () => { app.thrDragging = true; });
    window.addEventListener('pointerup', () => { app.thrDragging = false; });
    $$('#pane-throttle .quick button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.thr === 'plan') addAction({ type: 'throttle', value: null });
      else { thr.value = Math.round(+b.dataset.thr * 100); $('#thrVal').textContent = thr.value + '%'; addAction({ type: 'throttle', value: +b.dataset.thr }); }
    }));
    // gimbal pad: drag left/right to trim
    const gp = $('#gimbalPad');
    let gpDrag = null;
    gp.addEventListener('pointerdown', e => { gp.setPointerCapture(e.pointerId); gpDrag = { x0: e.clientX, t0: frameAt(app.i).trim }; app.liveTrim = gpDrag.t0; e.preventDefault(); });
    gp.addEventListener('pointermove', e => {
      if (!gpDrag) return;
      const g = gp._geom || { width: gp.clientWidth * 0.56 };
      const v = Math.round(SB.clamp(gpDrag.t0 - (e.clientX - gpDrag.x0) / g.width * 20, -10, 10) * 10) / 10;
      if (v !== app.liveTrim) { app.liveTrim = v; queueAction({ type: 'trim', value: v }); }
    });
    const gpEnd = () => { if (!gpDrag) return; const v = app.liveTrim; gpDrag = null; app.liveTrim = null; if (v !== frameAt(app.i).trim) addAction({ type: 'trim', value: v }); app.lastTelemetryI = -1; };
    gp.addEventListener('pointerup', gpEnd); gp.addEventListener('pointercancel', gpEnd);
    $$('#pane-trim .quick button[data-trim]').forEach(b => b.addEventListener('click', () => {
      const v = SB.clamp(Math.round((frameAt(app.i).trim + parseFloat(b.dataset.trim)) * 10) / 10, -10, 10);
      addAction({ type: 'trim', value: v });
    }));
    $('#trimCenter').addEventListener('click', () => addAction({ type: 'trim', value: 0 }));
    $('#trimMatch').addEventListener('click', () => {
      const f = frameAt(app.i);
      if (f.trimBalance == null) return;
      addAction({ type: 'trim', value: SB.clamp(Math.round(f.trimBalance * 10) / 10, -10, 10) });
    });
    // rcs pad: tap thrusters
    const rp = $('#rcsPad');
    rp.addEventListener('pointerdown', e => {
      const r = rp.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = (rp._hits || []).find(h => Math.hypot(h.x - x, h.y - y) <= h.r);
      if (!hit) return;
      if (app.rcsSel.has(hit.id)) app.rcsSel.delete(hit.id); else app.rcsSel.add(hit.id);
      app.lastTelemetryI = -1;
    });
    const rcsPower = $('#rcsPower'), dur = $('#rcsDur');
    rcsPower.addEventListener('input', () => { $('#rcsPowerVal').textContent = rcsPower.value + '%'; app.lastTelemetryI = -1; });
    dur.addEventListener('input', () => { $('#rcsDurVal').textContent = (+dur.value).toFixed(1) + ' s'; app.lastTelemetryI = -1; });
    $('#addRcs').addEventListener('click', () => { if (app.rcsSel.size) addAction({ type: 'rcs', thrusters: Array.from(app.rcsSel), power: +rcsPower.value / 100, duration: +dur.value }); });
    $('#btnMissions').addEventListener('click', showMissions);
    $('#btnHelp').addEventListener('click', showHelp);
    $('#overlay').addEventListener('click', e => { if (e.target === e.currentTarget && app.mode !== 'intro') hideCard(); });
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!app.playing); }
      else if (e.code === 'ArrowLeft') { setPlaying(false); seek(app.t - (e.shiftKey ? 5 : 0.5)); app.lastTelemetryI = -1; }
      else if (e.code === 'ArrowRight') { setPlaying(false); seek(app.t + (e.shiftKey ? 5 : 0.5)); app.lastTelemetryI = -1; }
    });
    window.addEventListener('resize', () => { app.lastTelemetryI = -1; });
  }

  function boot() {
    wire();
    const params = new URLSearchParams(location.search);
    loadScenario(params.get('m') || store.get('current', SB.SCENARIOS[0].id));
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
  SB.app = app;
  SB.ui = { loadScenario, addAction, seek, setPlaying, showResults, recompute };
})(globalThis.SB = globalThis.SB || {});
