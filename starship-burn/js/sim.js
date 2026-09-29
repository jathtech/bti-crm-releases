/* sim.js — runs a scenario.
   mode 'ref'    : the ideal flight computer flies the nominal plan; every step's
                   gimbal/throttle command and attitude is recorded. This is the
                   "line" the player has to stay on.
   mode 'player' : the recorded schedule is replayed open-loop with the scenario's
                   failure(s) injected, plus the player's timeline actions, plus a
                   limited-authority SAS. Deterministic: same actions, same result. */
(function (SB) {
  'use strict';
  const DEG = SB.DEG, RAD = SB.RAD;

  SB.initialState = function (scn, ship) {
    const E = SB.EARTH, ini = scn.initial;
    const gam = ini.gamma * DEG, v = ini.speed;
    return {
      x: 0, y: E.R + ini.alt,
      vx: v * Math.cos(gam), vy: v * Math.sin(gam),
      theta: Math.PI / 2 - ini.pitch * DEG,
      omega: (ini.rate || 0) * DEG,
      prop: ship.prop, gimbal: 0,
      engines: SB.makeEngineStates(ship, ini.enginesOn || []),
    };
  };

  /* distance from point p to segment ab, plus the sign of the cross product */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = SB.clamp(t, 0, 1);
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    const cross = dx * (py - ay) - dy * (px - ax);
    return { d, sign: cross >= 0 ? 1 : -1 };
  }

  SB.simulate = function (scn, opts) {
    opts = opts || {};
    const mode = opts.mode || 'player';
    const ref = opts.ref || null;
    if (mode === 'player' && !ref) throw new Error('player run needs a reference');
    const ship = SB.makeShip(scn.ship);
    const dt = scn.dt || 0.01;
    const st = SB.initialState(scn, ship);
    const seed = SB.strHash(scn.id) ^ (opts.seed | 0);
    const actions = (opts.actions || []).slice().sort((a, b) => a.t - b.t);
    const failures = mode === 'player' ? (scn.failures || []).slice().sort((a, b) => a.t - b.t) : [];
    const planEvents = (scn.plan.events || []).concat(mode === 'player' && ref ? ref.recordedEvents : [])
      .slice().sort((a, b) => a.t - b.t);
    const log = [], frames = [], path = [], recordedEvents = [];
    const hasBooster = !!scn.booster;
    const bst = hasBooster ? { x: 0, y: 0, vx: 0, vy: 0, theta: st.theta, mass: scn.booster.mass, thrustNow: 0 } : null;
    const ctx = {
      t: 0, ship, st, scn, mode, log, throttleOverride: null, trim: 0, rcsDir: 0, rcsUntil: -1,
      ftsTimer: 0, gTimer: 0, released: !hasBooster, tRelease: -1, end: null, depleted: false,
      lastThrottle: scn.plan.throttle0 || 1, mem: {}, ref,
      towerX: (scn.tower && ref) ? ref.frames[ref.frames.length - 1].dr : null,
    };
    const say = (msg, kind) => log.push({ t: ctx.t, msg, kind: kind || 'info' });
    ctx.say = say;

    const idx = id => ship.engines.findIndex(e => e.id === id);
    function ignite(id, why) {
      const i = idx(id); if (i < 0) return;
      const es = st.engines[i];
      if (es.state === 'on' || es.state === 'spool') return;
      if (es.dead) { es.state = 'failed'; say(id + ' NO IGNITION', 'bad'); return; }
      if (why === 'player') {
        es.relights++;
        const p = ship.relightP[ship.engines[i].kind];
        if (SB.hash01(seed, i, es.relights) >= p) {
          es.dead = true; es.state = 'failed';
          say(id + ' RELIGHT FAILED — no ignition', 'bad'); return;
        }
        say(id + ' relight OK, spooling up', 'good');
      } else say(id + ' ignition', 'info');
      es.state = 'spool';
    }
    function shutdown(id, why) {
      const i = idx(id); if (i < 0) return;
      const es = st.engines[i];
      if (es.state === 'on' || es.state === 'spool') {
        es.state = 'shutdown';
        say(id + ' shutdown' + (why === 'player' ? ' (commanded)' : ''), why === 'player' ? 'player' : 'info');
      }
    }
    function fail(id, type) {
      const i = idx(id); if (i < 0) return;
      const es = st.engines[i];
      es.dead = true;
      if (type === 'flameout') {
        if (es.level > 0 || es.state === 'spool') { es.state = 'failed'; say(id + ' FLAMEOUT', 'bad'); }
      }
      // 'nolight' is revealed when the ignition is attempted
    }
    ctx.cutoff = function (ids) {
      // dynamic plan event issued by the reference flight computer; baked into the recording
      ids.forEach(id => shutdown(id, 'plan'));
      recordedEvents.push({ t: ctx.t, type: 'cutoff', engines: ids.slice() });
    };
    function applyPlanEvent(ev) {
      if (ev.type === 'ignite') ev.engines.forEach(id => ignite(id, 'plan'));
      else if (ev.type === 'cutoff') ev.engines.forEach(id => shutdown(id, 'plan'));
      else if (ev.type === 'release') { ctx.released = true; ctx.tRelease = ctx.t; say('Stage separation — clamps released', 'info'); }
    }
    function applyAction(a) {
      switch (a.type) {
        case 'throttle': ctx.throttleOverride = a.value; say('Throttle → ' + (a.value == null ? 'plan schedule' : Math.round(a.value * 100) + '%'), 'player'); break;
        case 'trim': ctx.trim = a.value; say('Gimbal trim → ' + SB.fmt.sn(a.value, 1) + '°', 'player'); break;
        case 'engine': if (a.cmd === 'on') ignite(a.engine, 'player'); else shutdown(a.engine, 'player'); break;
        case 'rcs': ctx.rcsDir = a.dir; ctx.rcsUntil = ctx.t + a.duration;
          say('RCS ' + (a.dir > 0 ? 'CCW' : 'CW') + ' for ' + a.duration.toFixed(1) + ' s', 'player'); break;
      }
    }

    const refPath = ref ? ref.path : null;
    let devIdx = 0, maxDev = 0, sumDev2 = 0, nDev = 0;
    function deviation(dr, alt) {
      if (!refPath || refPath.length < 2) return { d: 0, sign: 1 };
      const n = refPath.length;
      const lo = Math.max(0, devIdx - 30), hi = Math.min(n - 2, devIdx + 80);
      let best = null;
      for (let k = lo; k <= hi; k++) {
        const a = refPath[k], b = refPath[k + 1];
        const r = segDist(dr, alt, a[0], a[1], b[0], b[1]);
        if (!best || r.d < best.d) { best = r; best.k = k; }
      }
      devIdx = best.k;
      return best;
    }

    const maxSteps = Math.round(scn.duration / dt);
    let ai = 0, fi = 0, pi = 0, info = null, saidSat = false, saidFts = false;
    for (let i = 0; i <= maxSteps; i++) {
      const t = i * dt; ctx.t = t;
      while (fi < failures.length && failures[fi].t <= t + 1e-9) { fail(failures[fi].engine, failures[fi].type); fi++; }
      while (pi < planEvents.length && planEvents[pi].t <= t + 1e-9) applyPlanEvent(planEvents[pi++]);
      while (ai < actions.length && actions[ai].t <= t + 1e-9) applyAction(actions[ai++]);
      if (st.prop <= 0 && !ctx.depleted) {
        ctx.depleted = true;
        st.engines.forEach(es => { if (es.level > 0 || es.state === 'spool') es.state = 'failed'; es.dead = true; });
        say('PROPELLANT DEPLETED', 'bad');
      }

      const g = SB.geom(st);
      const atm = SB.atmo(g.alt);
      let throttle, throttleRef, gimbalRef, gimbalCmd, sasOut = 0, sasSat = false, thetaRef, omegaRef, rcs = 0, pitchRef;
      if (mode === 'ref') {
        const ci0 = SB.controlInfo(st, ship, ctx.lastThrottle, atm.p);
        throttle = SB.clamp(scn.plan.throttle(t, st, g, ctx, ship, ci0), ship.minThrottle, 1);
        const ci = SB.controlInfo(st, ship, throttle, atm.p);
        const cmd = scn.plan.pitch(t, st, g, ctx);
        gimbalCmd = ctx.released ? SB.idealGimbal(st, g, ship, ci.ceff, cmd) : 0;
        throttleRef = throttle; gimbalRef = gimbalCmd; thetaRef = st.theta; omegaRef = st.omega;
        pitchRef = g.pitch * RAD;
      } else {
        const rf = ref.frames[Math.min(i, ref.frames.length - 1)];
        thetaRef = rf.theta; omegaRef = rf.omega; throttleRef = rf.throttle; gimbalRef = rf.gimbalCmd;
        throttle = ctx.throttleOverride != null ? ctx.throttleOverride : throttleRef;
        const s = SB.sas(st, ship, thetaRef, omegaRef);
        sasOut = s.out; sasSat = s.sat && ctx.released;
        gimbalCmd = ctx.released ? gimbalRef + ctx.trim + sasOut : 0;
        rcs = t < ctx.rcsUntil ? ctx.rcsDir : 0;
        pitchRef = rf.pitch;
        if (sasSat && !saidSat) { saidSat = true; say('SAS SATURATED — gimbal authority exceeded', 'warn'); }
        if (!sasSat) saidSat = false;
      }
      ctx.lastThrottle = throttle;

      // hazards, judged on the current state
      const eTh = SB.wrapPi(st.theta - thetaRef) * RAD;
      const eOm = (st.omega - omegaRef) * RAD;
      const anyCenter = st.engines.some((es, k) => ship.engines[k].gimbal && es.level > 0.3);
      const wCrit = anyCenter ? 25 : 8, thCrit = 60;
      const recovery = SB.clamp(1 - (eOm / wCrit) * (eOm / wCrit) - (eTh / thCrit) * (eTh / thCrit), 0, 1);
      if (ctx.released && mode === 'player') {
        if (recovery < 0.15) { ctx.ftsTimer += dt; if (!saidFts) { saidFts = true; say('FTS ARMED — recovery unlikely', 'bad'); } }
        else { ctx.ftsTimer = Math.max(0, ctx.ftsTimer - dt); saidFts = false; }
      }
      const mp = SB.massProps(ship, st.prop);
      const baseAlt = g.alt - mp.com * Math.cos(g.pitch);
      const pinAlt = g.alt + (ship.catchPinU - mp.com) * Math.cos(g.pitch);

      let recontact = false, sep = 0;
      if (hasBooster) {
        const ubx = Math.cos(bst.theta), uby = Math.sin(bst.theta);
        const bx = st.x - mp.com * g.ux, by = st.y - mp.com * g.uy;
        const tx = bst.x + (scn.booster.length - scn.booster.com) * ubx, ty = bst.y + (scn.booster.length - scn.booster.com) * uby;
        const dx = bx - tx, dy = by - ty;
        sep = dx * ubx + dy * uby;
        const lat = Math.abs(ubx * dy - uby * dx);
        if (ctx.released && (sep < -0.3 || (sep < 2.5 && lat > 1.0))) recontact = true;
      }

      let dev = 0, devSign = 1;
      if (mode === 'player') {
        const dv = deviation(g.dr, g.alt);
        dev = dv.d; devSign = dv.sign;
        if (dev > maxDev) maxDev = dev;
        sumDev2 += dev * dev; nDev++;
      }
      if (mode === 'ref' && (i % 5 === 0 || i === maxSteps)) path.push([g.dr, g.alt]);

      frames.push({
        t, x: st.x, y: st.y, vx: st.vx, vy: st.vy, theta: st.theta, omega: st.omega, prop: st.prop,
        alt: g.alt, baseAlt, pinAlt, dr: g.dr, speed: g.speed, vUp: g.vUp, vEast: g.vEast, gamma: g.gamma * RAD,
        pitch: g.pitch * RAD, pitchRef, pitchErr: eTh, rate: st.omega * RAD, rateErr: eOm,
        gimbalCmd, gimbalAct: st.gimbal, gimbalRef, trim: ctx.trim, sas: sasOut, sasSat,
        throttle, throttleRef, engines: st.engines.map(es => ({ state: es.state, level: es.level })),
        thrust: info ? info.thrust : 0, gLoad: info ? info.gLoad : 0, mass: mp.m,
        dv: SB.deltaV(ship, st), rcs, recovery, fts: ctx.ftsTimer, dev, devSign, released: ctx.released, sep,
        booster: bst ? { x: bst.x, y: bst.y, theta: bst.theta, thrust: bst.thrustNow } : null,
      });

      let end = null;
      if (mode === 'player' && ctx.released && ctx.ftsTimer >= 1.0) end = { reason: 'rud' };
      else if (ctx.gTimer > 0.5) end = { reason: 'structural' };
      else if (recontact) end = { reason: 'recontact' };
      else end = scn.end(t, st, g, ctx, frames[frames.length - 1]);
      if (end) {
        ctx.end = end;
        if (mode === 'ref' && i % 5 !== 0) path.push([g.dr, g.alt]);
        const names = { rud: 'FTS TRIGGERED — RUD', structural: 'STRUCTURAL FAILURE (g-limit)', recontact: 'RECONTACT WITH BOOSTER',
          seco: 'SECO', touchdown: 'TOUCHDOWN', catch: 'ARMS CONTACT', ground: 'GROUND IMPACT', tower: 'TOWER STRIKE', timeout: 'END OF WINDOW', complete: 'HANDOFF', depleted: 'PROPELLANT DEPLETED' };
        say(names[end.reason] || end.reason.toUpperCase(), (['rud', 'structural', 'recontact', 'ground', 'tower'].indexOf(end.reason) >= 0) ? 'bad' : 'info');
        break;
      }

      const ctrl = { throttle, gimbalCmd, rcs };
      if (hasBooster && !ctx.released) {
        info = SB.stepStack(st, bst, ctrl, ship, scn.booster, dt, -1);
      } else {
        info = SB.stepVehicle(st, ctrl, ship, dt, { aero: !!scn.aero });
        if (hasBooster) SB.stepBooster(bst, scn.booster, dt, t - ctx.tRelease);
      }
      if (info.gLoad > ship.gLimit) ctx.gTimer += dt; else ctx.gTimer = 0;
    }
    if (!ctx.end) ctx.end = { reason: 'timeout' };
    const run = {
      mode, frames, log, end: ctx.end, path, recordedEvents, ship, dt,
      duration: frames[frames.length - 1].t,
      maxDev, rmsDev: nDev ? Math.sqrt(sumDev2 / nDev) : 0,
    };
    if (mode === 'player') run.eval = scn.evaluate(run, ref);
    return run;
  };

  SB.buildReference = function (scn) { return SB.simulate(scn, { mode: 'ref' }); };
  SB.runPlayer = function (scn, ref, actions) { return SB.simulate(scn, { mode: 'player', ref, actions }); };
})(globalThis.SB = globalThis.SB || {});
