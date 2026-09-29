/* render.js — draws the scene (reference line, flown path, ghost, ship, plumes,
   booster, ground) and the engine-ring / attitude inset. Pure canvas 2D. */
(function (SB) {
  'use strict';
  const DEG = SB.DEG, RADS = SB.RAD, clamp = SB.clamp;
  const COL = {
    ref: 'rgba(90,205,255,0.85)', path: '#ffb347', ghost: 'rgba(150,200,255,0.5)',
    hull: '#d3d7de', hullShade: '#9aa1ab', flap: '#aeb4bd', nozzle: '#3a3f47',
    plume: 'rgba(255,170,70,0.9)', plumeCore: 'rgba(255,245,200,0.95)', rcs: 'rgba(190,230,255,0.85)',
    booster: '#c3c7ce', boosterShade: '#8d939c', ring: '#5c6169', ground: '#1b1a17', groundLine: '#8d7d58', pad: '#ffd166',
    text: '#e8ecf2', dim: 'rgba(232,236,242,0.55)', bad: '#ff5d5d', good: '#5ee39a', warn: '#ffd166',
  };
  SB.COL = COL;

  function stars(W, H, seedShift) {
    const pts = [];
    for (let i = 0; i < 90; i++) {
      const x = (SB.hash01(i, 1) * (W + 200) + seedShift) % (W + 200) - 100;
      pts.push([x, SB.hash01(i, 2) * H, 0.4 + SB.hash01(i, 3) * 1.3]);
    }
    return pts;
  }

  function camera(view, f, W, H) {
    if (view === 'ascent') return { dr: f.dr, alt: f.alt, sx: 0.0045, sy: 0.085, cx: W * 0.5, cy: H * 0.5, sprite: 1.15, iso: false };
    if (view === 'landing') {
      const s = clamp((H - 90) / (Math.max(f.alt, 0) + 70), 0.22, 2.4);
      return { dr: f.dr, alt: 0, sx: s, sy: s, cx: W * 0.5, cy: H - 34, sprite: s, iso: true };
    }
    const s = clamp(210 / (Math.max(f.sep || 0, 0) + 140), 0.11, 1.5);
    return { dr: f.dr, alt: f.alt, sx: s, sy: s, cx: W * 0.55, cy: H * 0.42, sprite: Math.max(s, 0.5), iso: true };
  }
  function toScreen(cam, dr, alt) { return [cam.cx + (dr - cam.dr) * cam.sx, cam.cy - (alt - cam.alt) * cam.sy]; }

  function polyline(ctx, cam, pts, color, width, dash) {
    if (!pts || pts.length < 2) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = toScreen(cam, pts[i][0], pts[i][1]);
      if (x < -2000 || x > 4000) { started = false; continue; }
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }

  /* Draw the ship in body units: after this transform (n,u) -> (n, com-u). */
  function drawShip(ctx, ship, f, sx, sy, scale, opts) {
    opts = opts || {};
    const R = ship.radius, L = ship.length;
    const mp = SB.massProps(ship, f.prop);
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(f.pitch * DEG); ctx.scale(scale, scale);
    ctx.globalAlpha = opts.ghost ? 0.45 : 1;
    const P = (n, u) => [n, mp.com - u];
    const poly = (pts, fill, stroke) => {
      ctx.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.35; ctx.stroke(); }
    };
    // plumes first (behind the hull)
    if (!opts.ghost) {
      const flick = 1 + 0.12 * Math.sin(f.t * 47) + 0.08 * Math.sin(f.t * 31 + 1);
      f.engines.forEach((es, i) => {
        if (es.level <= 0.02) return;
        const e = ship.engines[i];
        const pwr = es.level * (f.throttle || 1);
        const len = (5 + 26 * pwr) * flick, w = 1.4 + 0.8 * es.level;
        ctx.save();
        const q = P(e.lateral, 0); ctx.translate(q[0], q[1]);
        if (e.gimbal) ctx.rotate(f.gimbalAct * DEG);
        const grd = ctx.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, COL.plumeCore); grd.addColorStop(0.35, COL.plume); grd.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.lineTo(w * 0.35, len); ctx.lineTo(-w * 0.35, len); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      if (f.rcs && f.rcs.thrusters) {
        f.rcs.thrusters.forEach(id => {
          const th = ship.rcs.thrusters[id]; if (!th) return;
          const q = P(th.side * R * 0.9, th.u), len = 5 + 8 * (f.rcs.power || 1);
          ctx.save(); ctx.translate(q[0], q[1]);
          ctx.fillStyle = COL.rcs; ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(th.side * len, -2.2); ctx.lineTo(th.side * len, 2.2); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      }
    }
    // flaps
    const flap = (n0, u0, n1, u1) => poly([[n0, u0], [n1, u0 + 1.5], [n1, u1 - 1], [n0 * 0.95, u1]], opts.ghost ? 'rgba(150,200,255,0.5)' : COL.flap, opts.ghost ? COL.ghost : COL.hullShade);
    flap(R, 3, R + 3.4, 17); flap(-R, 3, -R - 3.4, 17);
    flap(R * 0.85, L - 12, R * 0.85 + 2.4, L - 5.5); flap(-R * 0.85, L - 12, -R * 0.85 - 2.4, L - 5.5);
    // catch pins
    const pu = ship.catchPinU || L - 11;
    poly([[R, pu], [R + 1.1, pu], [R + 1.1, pu + 1.4], [R, pu + 1.4]], opts.ghost ? COL.ghost : '#6b7280', null);
    poly([[-R, pu], [-R - 1.1, pu], [-R - 1.1, pu + 1.4], [-R, pu + 1.4]], opts.ghost ? COL.ghost : '#6b7280', null);
    // hull
    const hull = [[-R, 0], [R, 0], [R, L - 9], [R * 0.72, L - 4.5], [R * 0.35, L - 1.2], [0, L], [-R * 0.35, L - 1.2], [-R * 0.72, L - 4.5], [-R, L - 9]];
    if (opts.ghost) poly(hull, 'rgba(150,200,255,0.18)', COL.ghost);
    else {
      const g = ctx.createLinearGradient(-R, 0, R, 0);
      g.addColorStop(0, COL.hullShade); g.addColorStop(0.45, COL.hull); g.addColorStop(1, COL.hullShade);
      poly(hull, g, 'rgba(0,0,0,0.35)');
      // nozzles
      f.engines.forEach((es, i) => {
        const e = ship.engines[i];
        ctx.save(); const q = P(e.lateral, 0); ctx.translate(q[0], q[1]); if (e.gimbal) ctx.rotate(f.gimbalAct * DEG);
        ctx.fillStyle = es.state === 'failed' ? '#7a2b2b' : COL.nozzle;
        ctx.beginPath(); ctx.moveTo(-0.8, 0); ctx.lineTo(0.8, 0); ctx.lineTo(1.2, 2.2); ctx.lineTo(-1.2, 2.2); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }
    ctx.restore();
  }

  function drawBooster(ctx, b, sx, sy, pitch, scale) {
    const R = 4.5, L = b.length, com = b.com;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(pitch * DEG); ctx.scale(scale, scale);
    const P = (n, u) => [n, com - u];
    const poly = (pts, fill, stroke) => {
      ctx.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.35; ctx.stroke(); }
    };
    if (b.thrust > 0) {
      const len = 8 + 30 * b.thrust / 1.5e6;
      [-2.2, 0, 2.2].forEach(n => {
        ctx.save(); const q = P(n, 0); ctx.translate(q[0], q[1]);
        const grd = ctx.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, COL.plumeCore); grd.addColorStop(0.4, COL.plume); grd.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(-1.4, 0); ctx.lineTo(1.4, 0); ctx.lineTo(0.5, len); ctx.lineTo(-0.5, len); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }
    // grid fins
    poly([[R, L - 12], [R + 3.5, L - 12], [R + 3.5, L - 9], [R, L - 9]], COL.boosterShade);
    poly([[-R, L - 12], [-R - 3.5, L - 12], [-R - 3.5, L - 9], [-R, L - 9]], COL.boosterShade);
    const g = ctx.createLinearGradient(-R, 0, R, 0);
    g.addColorStop(0, COL.boosterShade); g.addColorStop(0.45, COL.booster); g.addColorStop(1, COL.boosterShade);
    poly([[-R, 0], [R, 0], [R, L - 2], [-R, L - 2]], g, 'rgba(0,0,0,0.35)');
    // hot-stage ring (vented)
    poly([[-R, L - 2], [R, L - 2], [R, L], [-R, L]], COL.ring);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let n = -R + 0.8; n < R - 0.5; n += 1.4) { const q = P(n, L - 1.6); ctx.fillRect(q[0], q[1], 0.7, 1.2); }
    ctx.restore();
  }

  function explosion(ctx, x, y, age, scale) {
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = SB.hash01(i, 7) * Math.PI * 2, sp = (20 + 60 * SB.hash01(i, 8)) * scale;
      const r = (2 + 5 * SB.hash01(i, 9)) * Math.max(scale, 0.6) * (1 + age);
      const px = x + Math.cos(a) * sp * age, py = y + Math.sin(a) * sp * age + 30 * scale * age * age;
      ctx.fillStyle = `rgba(255,${120 + 100 * SB.hash01(i, 10) | 0},60,${Math.max(0, 1 - age / 2.5)})`;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = `rgba(255,220,150,${Math.max(0, 0.8 - age / 1.5)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, (10 + 140 * age) * Math.max(scale, 0.5), 0, Math.PI * 2); ctx.stroke();
  }

  /* Engine ring and attitude dial drawn into any context at (x, y) with the given
     dial diameter; used as an overlay on the scene. */
  SB.drawDials = function (ctx, x, y, d, ship, f) {
    const r = d / 2;
    // backdrop
    ctx.fillStyle = 'rgba(5,7,13,0.55)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 4, y - 4, d * 2 + 20, d + 22, 8) : ctx.rect(x - 4, y - 4, d * 2 + 20, d + 22); ctx.fill();
    // --- engine ring
    const cx = x + r, cy = y + r;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const k = r / 4.6;
    ship.engines.forEach((e, i) => {
      const es = f.engines[i];
      const ex = cx + e.r * Math.cos(e.az * DEG) * k, ey = cy - e.r * Math.sin(e.az * DEG) * k;
      const er = e.kind === 'vac' ? 0.95 * k : 0.62 * k;
      let fill = '#3a3f47', glow = null;
      if (es.state === 'failed') fill = '#7a2b2b';
      else if (es.level > 0.02) { fill = es.state === 'shutdown' ? '#a86a2a' : es.state === 'spool' ? '#d9a13a' : '#ffb04a'; glow = es.level; }
      if (glow) { ctx.fillStyle = `rgba(255,170,70,${0.25 * glow})`; ctx.beginPath(); ctx.arc(ex, ey, er + 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
      if (es.state === 'failed') {
        ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ex - er * 0.6, ey - er * 0.6); ctx.lineTo(ex + er * 0.6, ey + er * 0.6); ctx.moveTo(ex + er * 0.6, ey - er * 0.6); ctx.lineTo(ex - er * 0.6, ey + er * 0.6); ctx.stroke(); ctx.lineWidth = 1;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = (d > 56 ? 8 : 7) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.id, ex, ey);
    });
    ctx.textBaseline = 'alphabetic';
    const gl = f.gimbalAct * DEG;
    ctx.strokeStyle = Math.abs(f.gimbalAct) > 0.3 ? '#5ee39a' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(gl) * r * 0.9, cy); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ENGINES', cx, y + d + 12);
    // --- attitude vs plan
    const ax = x + d + 12 + r, ay = cy, ar = r;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();
    const rocket = (ang, color, fill) => {
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, -ar * 0.8); ctx.lineTo(ar * 0.22, -ar * 0.35); ctx.lineTo(ar * 0.22, ar * 0.6); ctx.lineTo(-ar * 0.22, ar * 0.6); ctx.lineTo(-ar * 0.22, -ar * 0.35); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    };
    rocket(0, 'rgba(120,190,255,0.8)', null);
    rocket(-f.pitchErr * DEG, Math.abs(f.pitchErr) > 10 ? COL.bad : Math.abs(f.pitchErr) > 3 ? COL.warn : COL.good, 'rgba(210,220,235,0.25)');
    const rate = clamp(f.rateErr / 15, -1, 1);
    if (Math.abs(rate) > 0.02) {
      ctx.strokeStyle = Math.abs(f.rateErr) > 8 ? COL.bad : COL.warn; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax, ay, ar * 0.9, -Math.PI / 2, -Math.PI / 2 - rate * Math.PI * 0.6, rate > 0); ctx.stroke();
    }
    ctx.fillStyle = COL.dim; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE', ax, y + d + 12);
  };

  /* Main scene draw. s = { scn, ship, ref, run, i (frame index), rudAge, log } */
  SB.drawScene = function (canvas, s) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { scn, ship, ref, run } = s;
    const i = Math.min(s.i, run.frames.length - 1);
    const f = run.frames[i];
    const rf = ref.frames[Math.min(i, ref.frames.length - 1)];
    const view = scn.view;
    const cam = camera(view, f, W, H);

    // background
    const altKm = f.alt / 1000;
    const spaceness = clamp((altKm - 20) / 60, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (view === 'landing') { g.addColorStop(0, '#1e3556'); g.addColorStop(1, '#6a8db8'); }
    else { g.addColorStop(0, '#04060c'); g.addColorStop(1, spaceness > 0.9 ? '#0a1224' : '#16264a'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (view !== 'landing') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      stars(W, H, -(f.dr * cam.sx * 0.05)).forEach(([x, y, r]) => { ctx.globalAlpha = 0.3 + 0.5 * spaceness; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
      // horizon glow (Earth below)
      const hg = ctx.createLinearGradient(0, H * 0.6, 0, H);
      hg.addColorStop(0, 'rgba(60,120,220,0)'); hg.addColorStop(1, 'rgba(70,140,230,0.28)');
      ctx.fillStyle = hg; ctx.fillRect(0, H * 0.6, W, H * 0.4);
    }
    // ground
    if (view === 'landing') {
      const [, gy] = toScreen(cam, f.dr, 0);
      ctx.fillStyle = COL.ground; ctx.fillRect(0, gy, W, H - gy);
      ctx.strokeStyle = COL.groundLine; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      const catchDr = ref.frames[ref.frames.length - 1].dr;
      if (scn.tower) {
        const tw = scn.tower;
        const [tx0, tyTop] = toScreen(cam, catchDr + tw.dx - tw.halfWidth, tw.height);
        const [tx1] = toScreen(cam, catchDr + tw.dx + tw.halfWidth, 0);
        // tower lattice
        ctx.fillStyle = '#20242c'; ctx.fillRect(tx0, tyTop, tx1 - tx0, gy - tyTop);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        const bay = 9 * cam.sy;
        if (bay > 6) for (let y = gy; y > tyTop; y -= bay) {
          ctx.beginPath(); ctx.moveTo(tx0, y); ctx.lineTo(tx1, y - bay); ctx.moveTo(tx1, y); ctx.lineTo(tx0, y - bay); ctx.stroke();
        }
        ctx.strokeStyle = '#3a404b'; ctx.lineWidth = 2; ctx.strokeRect(tx0, tyTop, tx1 - tx0, gy - tyTop);
        // chopstick arms: two beams (near/far) reaching back over the catch point
        const [ax0, ay] = toScreen(cam, catchDr - tw.armReach, tw.armHeight);
        const armT = Math.max(3, 2.2 * cam.sy);
        ctx.fillStyle = '#2f3540'; ctx.fillRect(ax0, ay + armT * 0.6, tx0 - ax0, armT);
        ctx.fillStyle = '#4b5261'; ctx.fillRect(ax0, ay - armT * 0.4, tx0 - ax0, armT);
        ctx.fillStyle = COL.pad; ctx.fillRect(ax0, ay - armT * 0.4 - 2, tx0 - ax0, 2);   // rails
        // catch marker
        const [cx0] = toScreen(cam, catchDr, tw.armHeight);
        ctx.strokeStyle = 'rgba(255,209,102,0.6)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx0, ay - 18); ctx.lineTo(cx0, ay + 18); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COL.pad; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('CATCH ' + tw.armHeight + ' m', cx0 - 6, ay - 8);
        // orbital launch mount, for scale
        const [mx0, my0] = toScreen(cam, catchDr + tw.dx + tw.halfWidth + 6, 20), [mx1] = toScreen(cam, catchDr + tw.dx + tw.halfWidth + 30, 0);
        ctx.fillStyle = '#23272f'; ctx.fillRect(mx0, my0, mx1 - mx0, gy - my0);
      } else {
        const [px] = toScreen(cam, catchDr, 0);
        const pw = Math.max(12, 30 * cam.sx);
        ctx.fillStyle = COL.pad; ctx.fillRect(px - pw / 2, gy - 3, pw, 4);
        ctx.fillStyle = COL.dim; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PAD', px, gy + 14);
      }
      const px = toScreen(cam, catchDr, 0)[0];
      // scale ticks every 100 m
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      const step = 100 * cam.sx;
      if (step > 25) for (let x = ((px % step) + step) % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - 6); ctx.stroke(); }
    }
    // reference line and flown path
    polyline(ctx, cam, ref.path, COL.ref, 1.5, [6, 5]);
    const flown = [];
    for (let k = 0; k <= i; k += 4) flown.push([run.frames[k].dr, run.frames[k].alt]);
    flown.push([f.dr, f.alt]);
    polyline(ctx, cam, flown, COL.path, 2, []);
    if (i < run.frames.length - 1) {
      const future = [[f.dr, f.alt]];
      for (let k = i + 6; k < run.frames.length; k += 6) future.push([run.frames[k].dr, run.frames[k].alt]);
      const lf = run.frames[run.frames.length - 1]; future.push([lf.dr, lf.alt]);
      polyline(ctx, cam, future, 'rgba(255,179,71,0.42)', 1.5, [2, 5]);
    }

    // booster
    if (f.booster && scn.booster) {
      const b = f.booster;
      const r = Math.hypot(b.x, b.y), upx = b.x / r, upy = b.y / r, ex = upy, ey = -upx;
      const ux = Math.cos(b.theta), uy = Math.sin(b.theta);
      const pitch = Math.atan2(ux * ex + uy * ey, ux * upx + uy * upy) / DEG;
      const bdr = SB.EARTH.R * Math.atan2(b.x, b.y), balt = r - SB.EARTH.R;
      const [bx, by] = toScreen(cam, bdr, balt);
      drawBooster(ctx, Object.assign({}, scn.booster, { thrust: b.thrust }), bx, by, pitch, cam.sprite);
    }
    // ghost (where the plan would be now)
    if (i < ref.frames.length) {
      const [gx, gy] = toScreen(cam, rf.dr, rf.alt);
      drawShip(ctx, ship, rf, gx, gy, cam.sprite, { ghost: true });
    }
    // the ship
    const [sx, sy] = toScreen(cam, f.dr, f.alt);
    const ended = i >= run.frames.length - 1;
    const boom = ended && (run.end.reason === 'rud' || run.end.reason === 'structural' || run.end.reason === 'recontact' || run.end.reason === 'ground' || run.end.reason === 'tower' || ((run.end.reason === 'touchdown' || run.end.reason === 'catch') && run.eval && !run.eval.success));
    if (!(boom && s.rudAge > 0.25)) drawShip(ctx, ship, f, sx, sy, cam.sprite, {});
    if (boom) explosion(ctx, sx, sy, s.rudAge, cam.sprite);

    // deviation callout
    if (f.dev > (view === 'landing' ? 8 : 60)) {
      ctx.fillStyle = f.dev > (view === 'landing' ? 40 : 400) ? COL.bad : COL.warn;
      ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText((f.devSign > 0 ? '▲ ' : '▼ ') + SB.fmt.km(f.dev) + ' off line', sx + 26, sy - 18);
    }
    // dials (bottom-left) and recent log lines (top-right)
    const dd = clamp(Math.round(H * 0.2), 44, 64);
    SB.drawDials(ctx, 10, H - dd - 26, dd, ship, f);
    if (s.log && s.log.length) {
      ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
      s.log.forEach((l, k) => {
        ctx.fillStyle = l.kind === 'bad' ? COL.bad : l.kind === 'warn' ? COL.warn : l.kind === 'good' ? COL.good : l.kind === 'player' ? COL.ref : COL.dim;
        ctx.fillText(SB.fmt.t(l.t) + ' ' + l.msg, W - 8, 16 + k * 13);
      });
    }
    // scale note
    ctx.fillStyle = COL.dim; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(view === 'ascent' ? 'vertical scale ×19 · blue = plan · orange = flown · dotted = ahead' : 'blue = plan · orange = flown · dotted = ahead', W - 8, H - 8);
  };

  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, hidden: W < 10 || H < 10 };
  }
  const MNm = v => (v >= 0 ? '+' : '−') + (Math.abs(v) / 1e6).toFixed(1);

  /* Curved arrow around (cx,cy): positive torque = counter-clockwise on screen. */
  function torqueArc(ctx, cx, cy, r, tau, color, width, scaleNm) {
    const sweep = clamp(Math.abs(tau) / scaleNm, 0, 1) * Math.PI * 1.15;
    if (sweep < 0.03) return;
    const ccw = tau > 0, a0 = -Math.PI / 2, a1 = ccw ? a0 - sweep : a0 + sweep;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1, ccw); ctx.stroke();
    const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1);
    const tang = a1 + (ccw ? -Math.PI / 2 : Math.PI / 2);
    const ah = 4 + width;
    ctx.beginPath(); ctx.moveTo(ex + Math.cos(tang) * ah, ey + Math.sin(tang) * ah);
    ctx.lineTo(ex + Math.cos(tang + 2.5) * ah, ey + Math.sin(tang + 2.5) * ah);
    ctx.lineTo(ex + Math.cos(tang - 2.5) * ah, ey + Math.sin(tang - 2.5) * ah); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function flame(ctx, len, w, alpha) {
    const grd = ctx.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, COL.plumeCore); grd.addColorStop(0.35, COL.plume); grd.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.globalAlpha = alpha; ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.lineTo(w * 0.3, len); ctx.lineTo(-w * 0.3, len); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* Gimbal instrument: the tail of the ship seen from the side, the centre-cluster
     flame at its real deflection, a trim protractor and the moment budget. */
  SB.drawGimbalPad = function (canvas, ship, f, trim) {
    const { ctx, W, H, hidden } = setupCanvas(canvas);
    if (hidden) return;
    const mp = SB.massProps(ship, f.prop);
    const left = W * 0.56;
    const baseY = H - 78, comY = 34;
    const scale = (baseY - comY) / mp.com;
    const cx = left * 0.5, R = ship.radius * scale;
    canvas._geom = { cx, width: left };
    // hull (lower part), flaps
    ctx.fillStyle = '#3a4150'; ctx.fillRect(cx - R, 0, 2 * R, baseY);
    ctx.fillStyle = '#4a5262';
    ctx.fillRect(cx + R, baseY - 17 * scale, 3.2 * scale, 12 * scale); ctx.fillRect(cx - R - 3.2 * scale, baseY - 17 * scale, 3.2 * scale, 12 * scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.strokeRect(cx - R, -2, 2 * R, baseY + 2);
    // engines: nozzles and small flames
    const failedIds = [];
    ship.engines.forEach((e, i) => {
      const es = f.engines[i], ex = cx + e.lateral * scale;
      ctx.save(); ctx.translate(ex, baseY);
      if (e.gimbal) ctx.rotate(f.gimbalAct * DEG);
      if (es.level > 0.02 && !e.gimbal) flame(ctx, 14 + 12 * es.level * f.throttle, 2.2, 0.9);
      ctx.fillStyle = es.state === 'failed' ? '#8a2f2f' : '#252a33';
      ctx.beginPath(); ctx.moveTo(-1.4 * scale, 0); ctx.lineTo(1.4 * scale, 0); ctx.lineTo(2 * scale, 3 * scale); ctx.lineTo(-2 * scale, 3 * scale); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (es.state === 'failed') { failedIds.push(e.id); ctx.strokeStyle = COL.bad; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ex - 4, baseY - 2); ctx.lineTo(ex + 4, baseY + 6); ctx.moveTo(ex + 4, baseY - 2); ctx.lineTo(ex - 4, baseY + 6); ctx.stroke(); }
    });
    // centre-cluster flame at the actual gimbal
    if (f.centerF > 1e4) {
      ctx.save(); ctx.translate(cx, baseY + 3 * scale); ctx.rotate(f.gimbalAct * DEG);
      flame(ctx, 22 + 22 * f.centerF / (3 * 2.3e6), 4.5, 1);
      ctx.restore();
    }
    // CoM
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, comY, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, comY, 5, -Math.PI / 2, 0); ctx.lineTo(cx, comY); ctx.fill(); ctx.beginPath(); ctx.arc(cx, comY, 5, Math.PI / 2, Math.PI); ctx.lineTo(cx, comY); ctx.fill();
    // moment arcs about the CoM
    const scaleNm = 8e6;
    torqueArc(ctx, cx, comY, 46, f.tq.asym, COL.bad, 4, scaleNm);
    torqueArc(ctx, cx, comY, 37, f.tq.gimbal, COL.good, 4, scaleNm);
    if (Math.abs(f.tq.rcs) > 1e4) torqueArc(ctx, cx, comY, 29, f.tq.rcs, COL.ref, 3, scaleNm);
    torqueArc(ctx, cx, comY, 20, f.tq.net, '#ffffff', 3, scaleNm);
    // protractor under the base
    const rp = Math.min(54, left * 0.42), pivotY = baseY + 3 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, pivotY, rp, Math.PI / 2 - 16 * DEG, Math.PI / 2 + 16 * DEG); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let d = -15; d <= 15; d += 5) {
      const a = Math.PI / 2 + d * DEG, x0 = cx + Math.cos(a) * rp, y0 = pivotY + Math.sin(a) * rp;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(cx + Math.cos(a) * (rp + (d % 15 === 0 ? 6 : 3)), pivotY + Math.sin(a) * (rp + (d % 15 === 0 ? 6 : 3))); ctx.stroke();
    }
    const tick = (deg, color, len, w) => {
      const a = Math.PI / 2 + deg * DEG;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rp - len), pivotY + Math.sin(a) * (rp - len)); ctx.lineTo(cx + Math.cos(a) * (rp + 2), pivotY + Math.sin(a) * (rp + 2)); ctx.stroke();
    };
    tick(f.gimbalRef, 'rgba(255,255,255,0.45)', 8, 1.5);                       // plan
    if (f.trimBalance != null && Math.abs(f.trimBalance + f.gimbalRef) <= 16) tick(f.trimBalance + f.gimbalRef, COL.warn, 12, 2.5); // balance
    tick(f.gimbalAct, '#ffffff', 9, 2);                                        // actual total
    // trim handle
    const ah = Math.PI / 2 + trim * DEG, hx = cx + Math.cos(ah) * rp, hy = pivotY + Math.sin(ah) * rp;
    ctx.fillStyle = COL.ref; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#062033'; ctx.font = 'bold 8px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('T', hx, hy + 0.5); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL.dim; ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('◄ nose swings ↺', 4, H - 5);
    ctx.textAlign = 'right'; ctx.fillText('nose swings ↻ ►', left - 4, H - 5);
    // moment budget text
    const tx = left + 8; let ty = 16;
    ctx.textAlign = 'left'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText('MOMENT ABOUT CoM  (MN·m)', tx, ty); ty += 16;
    const line = (label, val, color, sub) => {
      ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText(label, tx, ty);
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(val, W - 8, ty); ctx.textAlign = 'left';
      if (sub) { ty += 11; ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText(sub, tx, ty); }
      ty += 17;
    };
    line('ENGINE IMBALANCE', MNm(f.tq.asym), COL.bad, failedIds.length ? failedIds.join(', ') + ' out' : 'engines');
    line('GIMBAL', MNm(f.tq.gimbal), COL.good, 'trim ' + SB.fmt.sn(f.trim, 1) + '° · SAS ' + SB.fmt.sn(f.sas, 1) + '°' + (f.sasSat ? ' SAT' : ''));
    if (Math.abs(f.tq.rcs) > 1e4) line('RCS', MNm(f.tq.rcs), COL.ref);
    if (Math.abs(f.tq.aero) > 2e5) line('AERO', MNm(f.tq.aero), COL.warn);
    line('NET', MNm(f.tq.net), '#fff', SB.fmt.sn(f.alphaDeg, 2) + '°/s² ' + (f.alphaDeg > 0.01 ? '↺' : f.alphaDeg < -0.01 ? '↻' : ''));
    if (f.trimBalance != null) line('BALANCE AT TRIM', SB.fmt.sn(f.trimBalance, 1) + '°', COL.warn);
  };

  /* RCS instrument: the whole ship from the side with its four thruster pods. */
  SB.drawRcsPad = function (canvas, ship, f, sel, power) {
    const { ctx, W, H, hidden } = setupCanvas(canvas);
    if (hidden) return;
    const mp = SB.massProps(ship, f.prop);
    const left = W * 0.5;
    const baseY = H - 22, scale = (H - 40) / ship.length, cx = left * 0.5, R = ship.radius * scale;
    const P = (n, u) => [cx + n * scale, baseY - u * scale];
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach((p, k) => { const q = P(p[0], p[1]); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const L = ship.length, Rr = ship.radius;
    poly([[Rr, 3], [Rr + 3.4, 4.5], [Rr + 3.4, 16], [Rr * 0.95, 17]], '#4a5262'); poly([[-Rr, 3], [-Rr - 3.4, 4.5], [-Rr - 3.4, 16], [-Rr * 0.95, 17]], '#4a5262');
    poly([[Rr * 0.85, L - 12], [Rr * 0.85 + 2.4, L - 10.5], [Rr * 0.85 + 2.4, L - 6.5], [Rr * 0.8, L - 5.5]], '#4a5262'); poly([[-Rr * 0.85, L - 12], [-Rr * 0.85 - 2.4, L - 10.5], [-Rr * 0.85 - 2.4, L - 6.5], [-Rr * 0.8, L - 5.5]], '#4a5262');
    poly([[-Rr, 0], [Rr, 0], [Rr, L - 9], [Rr * 0.72, L - 4.5], [Rr * 0.35, L - 1.2], [0, L], [-Rr * 0.35, L - 1.2], [-Rr * 0.72, L - 4.5], [-Rr, L - 9]], '#3a4150');
    // CoM
    const [, comY] = P(0, mp.com);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, comY, 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('CoM', cx + 8, comY + 3);
    // thrusters
    const hits = [];
    Object.keys(ship.rcs.thrusters).forEach(id => {
      const th = ship.rcs.thrusters[id];
      const [px, py] = P(th.side * Rr, th.u);
      const x = px + th.side * 13, on = sel.has(id);
      ctx.fillStyle = '#222'; ctx.fillRect(px - 2, py - 3, 4, 6);
      if (on) { ctx.fillStyle = COL.rcs; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(px + th.side * 3, py); ctx.lineTo(px + th.side * (14 + 18 * power), py - 4); ctx.lineTo(px + th.side * (14 + 18 * power), py + 4); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(x, py, 10, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.ref : 'rgba(255,255,255,0.08)'; ctx.fill();
      ctx.strokeStyle = on ? COL.ref : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = on ? '#062033' : COL.text; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(id, x, py + 0.5); ctx.textBaseline = 'alphabetic';
      hits.push({ id, x, y: py, r: 16 });
    });
    canvas._hits = hits;
    // moments
    const burst = SB.rcsEffect(ship, mp, Array.from(sel), power);
    const scaleNm = 8e6;
    torqueArc(ctx, cx, comY, 40, f.tq.asym, COL.bad, 4, scaleNm);
    torqueArc(ctx, cx, comY, 31, f.tq.gimbal, COL.good, 3, scaleNm);
    torqueArc(ctx, cx, comY, 23, burst.tau, COL.ref, 4, scaleNm);
    const net = f.tq.asym + f.tq.gimbal + burst.tau;
    torqueArc(ctx, cx, comY, 15, net, '#fff', 2.5, scaleNm);
    // text
    const tx = left + 8; let ty = 16;
    ctx.textAlign = 'left'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText('MOMENT ABOUT CoM  (MN·m)', tx, ty); ty += 16;
    const line = (label, val, color, sub) => {
      ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText(label, tx, ty);
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(val, W - 8, ty); ctx.textAlign = 'left';
      if (sub) { ty += 11; ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = COL.dim; ctx.fillText(sub, tx, ty); }
      ty += 17;
    };
    const alpha = burst.tau / mp.I * RADS;
    line('THIS BURST', MNm(burst.tau), COL.ref, sel.size ? sel.size + ' thruster' + (sel.size > 1 ? 's' : '') + ' · ' + SB.fmt.sn(alpha, 2) + '°/s² ' + (alpha > 0.01 ? '↺' : alpha < -0.01 ? '↻' : '') : 'tap thrusters to select');
    line('ENGINE IMBALANCE', MNm(f.tq.asym), COL.bad);
    line('GIMBAL NOW', MNm(f.tq.gimbal), COL.good);
    line('NET WITH BURST', MNm(net), '#fff', (net / mp.I * RADS).toFixed(2) + '°/s²' + (sel.size ? ' · sideways ' + (burst.fn / 1e3).toFixed(0) + ' kN' : ''));
  };

  /* Engine ring (viewed from below) and attitude indicator. */
  SB.drawInset = function (canvas, ship, f, rf) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // --- engine ring
    const cx = H / 2 + 4, cy = H / 2, rr = H / 2 - 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    const k = rr / 4.6;
    ship.engines.forEach((e, i) => {
      const es = f.engines[i];
      const ex = cx + e.r * Math.cos(e.az * DEG) * k, ey = cy - e.r * Math.sin(e.az * DEG) * k;
      const er = e.kind === 'vac' ? 0.95 * k : 0.62 * k;
      let fill = '#3a3f47', glow = null;
      if (es.state === 'failed') fill = '#7a2b2b';
      else if (es.level > 0.02) { fill = es.state === 'shutdown' ? '#a86a2a' : es.state === 'spool' ? '#d9a13a' : '#ffb04a'; glow = es.level; }
      if (glow) { ctx.fillStyle = `rgba(255,170,70,${0.25 * glow})`; ctx.beginPath(); ctx.arc(ex, ey, er + 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
      if (es.state === 'failed') {
        ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ex - er * 0.6, ey - er * 0.6); ctx.lineTo(ex + er * 0.6, ey + er * 0.6); ctx.moveTo(ex + er * 0.6, ey - er * 0.6); ctx.lineTo(ex - er * 0.6, ey + er * 0.6); ctx.stroke(); ctx.lineWidth = 1;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.id, ex, ey);
    });
    // gimbal vector of the centre cluster (thrust direction, in the trajectory plane)
    const gl = f.gimbalAct * DEG;
    ctx.strokeStyle = Math.abs(f.gimbalAct) > 0.3 ? '#5ee39a' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(gl) * rr * 0.9, cy); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ENGINES', cx, H - 3);

    // --- attitude: plan outline vs actual
    const ax = W - H / 2 - 4, ay = cy, ar = rr;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();
    const rocket = (ang, color, fill) => {
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, -ar * 0.8); ctx.lineTo(ar * 0.22, -ar * 0.35); ctx.lineTo(ar * 0.22, ar * 0.6); ctx.lineTo(-ar * 0.22, ar * 0.6); ctx.lineTo(-ar * 0.22, -ar * 0.35); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    };
    rocket(0, 'rgba(120,190,255,0.8)', null);                  // plan attitude (ghost)
    rocket(-f.pitchErr * DEG, Math.abs(f.pitchErr) > 10 ? COL.bad : Math.abs(f.pitchErr) > 3 ? COL.warn : COL.good, 'rgba(210,220,235,0.25)');
    // rate arrow
    const rate = clamp(f.rateErr / 15, -1, 1);
    if (Math.abs(rate) > 0.02) {
      ctx.strokeStyle = Math.abs(f.rateErr) > 8 ? COL.bad : COL.warn; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax, ay, ar * 0.9, -Math.PI / 2, -Math.PI / 2 - rate * Math.PI * 0.6, rate > 0); ctx.stroke();
    }
    ctx.fillStyle = COL.dim; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ATTITUDE vs PLAN', ax, H - 3);
  };
})(globalThis.SB = globalThis.SB || {});
