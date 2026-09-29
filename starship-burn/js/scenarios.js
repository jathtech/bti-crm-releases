/* scenarios.js — mission definitions: initial state, the nominal plan the ideal
   flight computer flies, the failure(s) injected into the player's run, the end
   condition and how the round is scored. */
(function (SB) {
  'use strict';
  const G0 = SB.G0, RAD = SB.RAD, DEG = SB.DEG;
  const ALL = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'];
  const last = run => run.frames[run.frames.length - 1];
  const lost = r => r === 'rud' || r === 'structural' || r === 'recontact';
  const peak = (run, key) => run.frames.reduce((m, f) => Math.max(m, Math.abs(f[key])), 0);

  function row(label, value, ok) { return { label, value, ok }; }

  /* ------------------------------------------------------------------ */
  const hotstage = {
    id: 'hotstage', order: 1, tag: 'TUTORIAL', title: 'Hot Stage',
    brief: 'T+0: Ship lights all six Raptors while still bolted to the booster. At T+1.5 the clamps release and Ship has to push cleanly away, hold the pitch program and hand off to the ascent guidance at T+25.',
    failureNote: 'RVac 3 (outboard, starboard) never ignites. The remaining outboard engine now pushes off-centre and the stability system runs out of gimbal authority trying to hold the nose.',
    hints: [
      'Watch the GIMBAL tile: SAT means the SAS has used all ±3° it is allowed. Give it more with a gimbal TRIM right after separation.',
      'The failed engine sits on the +side, so the ship wants to roll its nose to the right. Positive trim pushes it back.',
      'Alternative: shut down the opposite RVac (V1) so thrust is symmetric again. You lose a third of the thrust but need no trim.',
      'Do not trim before the clamps release: the gimbal does nothing while attached, but a big trim at release can kick the tail into the interstage.',
    ],
    ship: { dryMass: 130e3, prop: 1170e3 },
    initial: { alt: 66e3, speed: 1750, gamma: 22, pitch: 68, enginesOn: [] },
    booster: {
      mass: 250e3, length: 71, com: 28, cda: 80,
      thrust: tRel => tRel < 0 ? 1.5e6 : (tRel < 1.0 ? 1.5e6 * (1 - tRel) : 0),
    },
    duration: 25, dt: 0.01, aero: true, view: 'stage',
    plan: {
      throttle0: 1,
      events: [{ t: 0, type: 'ignite', engines: ALL }, { t: 1.5, type: 'release' }],
      pitch: (function () { const pp = SB.pitchProgram([[0, 68], [4, 68], [25, 75]]); return t => pp(t); })(),
      throttle: () => 1.0,
    },
    failures: [{ t: 0, engine: 'V3', type: 'nolight' }],
    end: (t, st, g, ctx) => t >= 25 - 1e-9 ? { reason: 'complete' } : null,
    evaluate(run, ref) {
      const f = last(run), r = run.end.reason;
      const rows = [];
      let success = false, precise = false, outcome;
      if (lost(r)) {
        outcome = r === 'recontact' ? 'RECONTACT — VEHICLE LOST' : r === 'rud' ? 'RUD — FLIGHT TERMINATED' : 'STRUCTURAL FAILURE';
      } else {
        const attOk = Math.abs(f.pitchErr) <= 3, rateOk = Math.abs(f.rateErr) <= 1.0, sepOk = f.sep >= 150;
        success = attOk && rateOk && sepOk;
        precise = success && Math.abs(f.pitchErr) <= 1.5 && run.rmsDev <= 120 && run.maxDev <= 250;
        outcome = success ? 'CLEAN HANDOFF' : 'HANDOFF REJECTED';
        rows.push(row('Attitude error at handoff', SB.fmt.n(f.pitchErr, 1) + '°  (limit 3°)', attOk));
        rows.push(row('Rate error at handoff', SB.fmt.n(f.rateErr, 2) + '°/s  (limit 1°/s)', rateOk));
        rows.push(row('Separation from booster', SB.fmt.km(f.sep) + '  (min 150 m)', sepOk));
      }
      rows.push(row('Max deviation from line', SB.fmt.km(run.maxDev), run.maxDev <= 250));
      rows.push(row('Peak body rate', SB.fmt.n(peak(run, 'rate'), 1) + '°/s', true));
      rows.push(row('Δv remaining', SB.fmt.n(f.dv) + ' m/s', true));
      return { success, outcome, stars: lost(r) ? 0 : success ? (precise ? 3 : 2) : 1, rows };
    },
    solution: [{ t: 2.0, type: 'trim', value: 4.0 }],
  };

  /* ------------------------------------------------------------------ */
  const ascent = {
    id: 'rvac-out', order: 2, tag: 'ASCENT', title: 'RVac Out',
    brief: 'Final push to orbit. Six engines burning, guidance throttling to hold 3.2 g. SECO is commanded when Ship reaches orbital speed: it must arrive at the right altitude and flight-path angle to make the target orbit.',
    failureNote: 'RVac 3 flames out at T+12. Thrust drops by a sixth, so Ship falls below the planned line, and the off-centre thrust from the surviving outboard engine starts a roll the SAS cannot hold.',
    hints: [
      'First stop the rotation: add gimbal TRIM (about +4 to +5°) a moment after the flameout.',
      'Then fix the thrust: the remaining five engines can run at 100% to recover the planned acceleration. Watch the G tile: the structure fails above 5.5 g, so step the throttle back down as the tanks empty.',
      'Trim beyond the balance point makes the SAS hold a small pitch offset. Use that to bring Ship back up to the line.',
      'Shutting down V1 restores symmetry with no trim, but with four engines the burn is long and gravity losses eat your Δv margin.',
      'Δv margin is thin. Venting propellant through the RCS costs you orbit.',
    ],
    ship: { dryMass: 200e3, prop: 178e3 },
    initial: { alt: 145e3, speed: 5750, gamma: 0.8, pitch: 82, enginesOn: ALL },
    duration: 100, dt: 0.01, aero: false, view: 'ascent',
    target: { speed: 7830 },
    plan: {
      throttle0: 0.8,
      events: [],
      pitch: (function () {
        const pp = SB.pitchProgram([[0, 82], [66, 91]]);
        // flight-path-angle guidance: bleed gamma from the initial climb to ~0 at SECO
        return (t, st, g) => {
          const p = pp(t);
          const gTgt = SB.lerp(0.8, 0.1, SB.clamp(t / 66, 0, 1));
          p.pitch -= SB.clamp(10 * (gTgt - g.gamma * RAD), -8, 8) * DEG;
          return p;
        };
      })(),
      throttle: (t, st, g, ctx, ship, ci) => SB.clamp(3.2 * G0 * ci.mp.m / Math.max(ci.favail, 1), ship.minThrottle, 1),
    },
    failures: [{ t: 12, engine: 'V3', type: 'flameout' }],
    end(t, st, g, ctx) {
      if (g.speed >= this.target.speed) return { reason: 'seco' };
      if (ctx.depleted) return { reason: 'depleted' };
      if (t >= this.duration - 1e-9) return { reason: 'timeout' };
      return null;
    },
    evaluate(run, ref) {
      const f = last(run), r = run.end.reason;
      const orb = SB.orbitOf(f), tgt = SB.orbitOf(last(ref));
      const rows = [];
      let success = false, precise = false, outcome;
      const fmtOrb = o => (o.bound ? Math.round(o.perigee / 1000) + ' × ' + Math.round(o.apogee / 1000) + ' km' : 'escape');
      if (lost(r)) {
        outcome = r === 'rud' ? 'RUD — FLIGHT TERMINATED' : 'STRUCTURAL FAILURE — OVER G';
      } else {
        const dp = orb.perigee - tgt.perigee, da = orb.apogee - tgt.apogee;
        const inOrbit = orb.perigee >= 120e3;
        success = inOrbit && Math.abs(dp) <= 20e3 && Math.abs(da) <= 40e3;
        precise = success && Math.abs(dp) <= 8e3 && Math.abs(da) <= 15e3 && run.rmsDev <= 150;
        outcome = success ? 'ORBIT ACHIEVED' : inOrbit ? 'WRONG ORBIT' : r === 'depleted' ? 'PROPELLANT DEPLETED — SUBORBITAL' : 'SUBORBITAL';
        rows.push(row('Orbit', fmtOrb(orb) + '  (target ' + fmtOrb(tgt) + ')', success));
      }
      rows.push(row('Max deviation from line', SB.fmt.km(run.maxDev), run.maxDev <= 1500));
      rows.push(row('RMS deviation', SB.fmt.km(run.rmsDev), run.rmsDev <= 150));
      rows.push(row('Δv margin at end', SB.fmt.n(f.dv) + ' m/s', f.dv > 0));
      rows.push(row('Peak load', SB.fmt.n(peak(run, 'gLoad'), 1) + ' g  (limit 5.5)', true));
      rows.push(row('Peak body rate', SB.fmt.n(peak(run, 'rate'), 1) + '°/s', true));
      return { success, outcome, stars: lost(r) ? 0 : success ? (precise ? 3 : 2) : 1, rows };
    },
    solution: [
      { t: 12.4, type: 'trim', value: 4.6 },
      { t: 12.4, type: 'throttle', value: 1.0 },
      { t: 30, type: 'throttle', value: 0.8 },
      { t: 45, type: 'throttle', value: 0.62 },
    ],
  };

  /* ------------------------------------------------------------------ */
  const landing = {
    id: 'landing', order: 3, tag: 'FLIP & CATCH', title: 'Tower Catch',
    brief: 'Ship is falling belly-first at terminal velocity next to the launch site. Plan: light the three centre engines, flip to tail-down, shut down the middle engine and fly the hover-slam so the catch pins arrive at the tower arms with zero velocity. There is no pad: the chopsticks catch the ship by its pins, so it has to stop exactly there.',
    failureNote: 'Centre engine C3 fails to ignite. Two engines have to do the flip with a third less torque and an off-centre thrust line, and the recorded throttle schedule was computed for three.',
    hints: [
      'The flip is late and lopsided. Two engines at about 65% match the thrust the plan expected from three at 45%, so the flip and the deceleration stay close to the recording.',
      'The surviving off-centre engine (C1) rolls the nose; a couple of degrees of positive TRIM balances it during the flip.',
      'The plan shuts down C2 after the flip, which leaves you a single off-centre engine. Its recorded throttle was meant for two engines: one engine needs roughly double, around 90%.',
      'On one engine, watch H.SPEED and the offset from the catch point: a gimballed engine pushes sideways as well as up. Trim well past the balance point (about 5°) so the SAS leans the ship into the tilt and the thrust points straight down. Too much and the SAS saturates the other way.',
      'The arms only catch a ship that arrives within a few metres, slower than 1.5 m/s down and 1 m/s sideways, standing within 3°. Use the last seconds to feather the throttle and steer with small trim changes.',
    ],
    ship: { dryMass: 120e3, prop: 25e3, propComFixed: 39, propTankHeight: 4 },
    initial: { alt: 650, speed: 85, gamma: -90, pitch: 90, enginesOn: [] },
    duration: 30, dt: 0.01, aero: true, view: 'landing',
    /* Mechazilla: the catch point is where the plan ends; the tower stands dx metres
       beyond it with the arms reaching back over the catch point at armHeight. */
    tower: { armHeight: 58, dx: 13, halfWidth: 4.5, height: 146, armReach: 8 },
    plan: {
      throttle0: 0.45,
      events: [{ t: 0, type: 'ignite', engines: ['C1', 'C2', 'C3'] }],
      flipEnd: 5.5,
      aProf: 3.5,
      profile(h) { return -Math.sqrt(1.0 + 2 * this.aProf * Math.max(h, 0)); }, // constant-decel descent profile (m/s)
      pitch: (function () {
        const pp = SB.pitchProgram([[0, 90], [0.4, 90], [5.5, 0], [30, 0]]);
        return (t, st, g, ctx) => {
          const p = pp(t);
          // lean into the horizontal velocity picked up during the flip and cancel it
          if (t > 2.5) p.pitch += SB.clamp(-1.3 * g.vEast, -25, 25) * DEG;
          return p;
        };
      })(),
      throttle(t, st, g, ctx, ship, ci) {
        if (t < this.flipEnd) return 0.45;
        const gl = SB.EARTH.mu / (g.r * g.r);
        const h = Math.max(g.alt + (ship.catchPinU - ci.mp.com) * Math.cos(g.pitch) - ctx.scn.tower.armHeight, 0);
        const vz = g.vUp, vDes = this.profile(h);
        const running = st.engines.filter(e => e.level > 0).length;
        if (running > 2 && vz >= vDes - 1.5 && !ctx.mem.cut) { ctx.mem.cut = true; ctx.cutoff(['C2']); }
        const aCmd = gl + this.aProf * (vz < -1 ? 1 : 0) + 1.2 * (vDes - vz);
        return aCmd * ci.mp.m / Math.max(ci.favail * Math.max(Math.cos(g.pitch), 0.3), 1);
      },
    },
    failures: [{ t: 0, engine: 'C3', type: 'nolight' }],
    end(t, st, g, ctx, fr) {
      const tw = this.tower;
      if (ctx.towerX != null && g.dr > ctx.towerX + tw.dx - tw.halfWidth - 2 && g.alt < tw.height + 20) return { reason: 'tower' };
      if (fr.pinAlt <= tw.armHeight && g.vUp < 0 && (ctx.towerX == null || Math.abs(g.dr - ctx.towerX) <= tw.armReach)) return { reason: 'catch' };
      if (fr.baseAlt <= 0) return { reason: 'ground' };
      if (t >= this.duration - 1e-9) return { reason: 'timeout' };
      return null;
    },
    evaluate(run, ref) {
      const f = last(run), r = run.end.reason, rf = last(ref);
      const rows = [];
      let success = false, precise = false, outcome, stars;
      if (lost(r)) { outcome = 'RUD — FLIGHT TERMINATED'; stars = 0; }
      else if (r === 'tower') { outcome = 'STRUCK THE TOWER'; stars = 0; }
      else if (r === 'ground') { outcome = 'MISSED THE ARMS — GROUND IMPACT'; stars = 0; }
      else if (r !== 'catch') { outcome = f.prop <= 0 ? 'PROPELLANT DEPLETED' : 'NEVER REACHED THE ARMS'; stars = 1; }
      else {
        const vz = -f.vUp, vx = f.vEast, pitch = f.pitch, rate = f.rate, dx = f.dr - rf.dr;
        const vzOk = vz <= 1.5, vxOk = Math.abs(vx) <= 1.0, dxOk = Math.abs(dx) <= 3.5, attOk = Math.abs(pitch) <= 3, rateOk = Math.abs(rate) <= 2;
        success = vzOk && vxOk && dxOk && attOk && rateOk;
        precise = success && vz <= 0.8 && Math.abs(vx) <= 0.5 && Math.abs(dx) <= 1.5 && Math.abs(pitch) <= 1.5 && run.rmsDev <= 20;
        outcome = success ? 'CAUGHT' : (!dxOk || !attOk) ? 'MISSED THE ARMS' : 'HIT THE ARMS TOO HARD';
        stars = success ? (precise ? 3 : 2) : 0;
        rows.push(row('Vertical speed at the arms', SB.fmt.n(vz, 1) + ' m/s  (max 1.5)', vzOk));
        rows.push(row('Horizontal speed', SB.fmt.n(Math.abs(vx), 1) + ' m/s  (max 1)', vxOk));
        rows.push(row('Offset from catch point', SB.fmt.n(dx, 1) + ' m  (max ±3.5)', dxOk));
        rows.push(row('Attitude', SB.fmt.n(pitch, 1) + '° from vertical  (max 3°)', attOk));
        rows.push(row('Body rate', SB.fmt.n(rate, 1) + '°/s  (max 2)', rateOk));
      }
      rows.push(row('Max deviation from line', SB.fmt.km(run.maxDev), run.maxDev <= 60));
      rows.push(row('Δv remaining', SB.fmt.n(f.dv) + ' m/s', f.dv > 0));
      rows.push(row('Peak body rate', SB.fmt.n(peak(run, 'rate'), 1) + '°/s', true));
      return { success, outcome, stars, rows };
    },
    solution: [
      { t: 0.2, type: 'throttle', value: 0.65 },
      { t: 0.2, type: 'trim', value: 2.0 },
      { t: 6.4, type: 'throttle', value: 0.91 },
      { t: 6.4, type: 'trim', value: 4.7 },
      { t: 13.2, type: 'throttle', value: 1.0 },
      { t: 14.5, type: 'throttle', value: 0.64 },
      { t: 15.8, type: 'throttle', value: 0.61 },
    ],
  };

  SB.SCENARIOS = [hotstage, ascent, landing];
  SB.scenarioById = id => SB.SCENARIOS.find(s => s.id === id);
})(globalThis.SB = globalThis.SB || {});
