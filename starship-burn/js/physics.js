/* physics.js — 2-D rigid-body flight dynamics around a round Earth.
   World frame: Earth centre at the origin; the vehicle starts on the +y axis.
   theta is the inertial angle of the nose (CCW from +x), omega its rate.
   Body axes: u = nose direction, n = u rotated -90 deg (starboard / downrange side). */
(function (SB) {
  'use strict';
  const G0 = SB.G0, DEG = SB.DEG;
  SB.EARTH = { R: 6371000, mu: 3.986004418e14 };

  SB.atmo = function (alt) {
    const h = Math.max(0, alt);
    const f = Math.exp(-h / 8500);
    return { rho: 1.225 * f, p: 101325 * f };
  };

  /* Local frame and trajectory-space quantities for a state. */
  SB.geom = function (st) {
    const E = SB.EARTH;
    const r = Math.hypot(st.x, st.y);
    const upx = st.x / r, upy = st.y / r;
    const ex = upy, ey = -upx;
    const ux = Math.cos(st.theta), uy = Math.sin(st.theta);
    const speed = Math.hypot(st.vx, st.vy);
    const vUp = st.vx * upx + st.vy * upy, vEast = st.vx * ex + st.vy * ey;
    return {
      r, upx, upy, ex, ey, ux, uy,
      alt: r - E.R,
      dr: E.R * Math.atan2(st.x, st.y),          // downrange along the surface
      speed, vUp, vEast,
      gamma: Math.atan2(vUp, vEast),             // flight-path angle (rad)
      pitch: Math.atan2(ux * ex + uy * ey, ux * upx + uy * upy), // from local vertical toward downrange (rad)
      angUp: Math.atan2(st.y, st.x),
      omegaUp: (st.x * st.vy - st.y * st.vx) / (r * r),
    };
  };

  /* Max thrust of currently running engines and control effectiveness. */
  SB.controlInfo = function (st, ship, throttle, pAmb) {
    const mp = SB.massProps(ship, st.prop);
    let favail = 0, centerF = 0;
    for (let i = 0; i < ship.engines.length; i++) {
      const es = st.engines[i], e = ship.engines[i];
      if (es.level <= 0) continue;
      const F = SB.engineThrust(e, pAmb);
      favail += es.level * F;
      if (e.gimbal) centerF += es.level * throttle * F;
    }
    return { mp, favail, ceff: centerF * mp.L / mp.I };
  };

  /* Advance the vehicle one step. ctrl = { throttle (0.4..1), gimbalCmd (deg), rcs (-1|0|1) }. */
  SB.stepVehicle = function (st, ctrl, ship, dt, opts) {
    const E = SB.EARTH;
    const mp = SB.massProps(ship, st.prop);
    const r = Math.hypot(st.x, st.y);
    const upx = st.x / r, upy = st.y / r;
    const alt = r - E.R;
    const atm = SB.atmo(alt);

    const gmax = ship.gimbalMax;
    const gcmd = SB.clamp(ctrl.gimbalCmd || 0, -gmax, gmax);
    const gstep = ship.gimbalRate * dt;
    st.gimbal += SB.clamp(gcmd - st.gimbal, -gstep, gstep);
    const delta = st.gimbal * DEG, sd = Math.sin(delta), cd = Math.cos(delta);

    const ux = Math.cos(st.theta), uy = Math.sin(st.theta);
    const nx = uy, ny = -ux;
    let Fn = 0, Fu = 0, tau = 0, mdot = 0, thrust = 0, centerF = 0, tqAsym = 0, tqGimbal = 0, tqRcs = 0, tqAero = 0;
    const engTq = new Array(ship.engines.length).fill(0);
    const thr = SB.clamp(ctrl.throttle, ship.minThrottle, 1);
    for (let i = 0; i < ship.engines.length; i++) {
      const e = ship.engines[i], es = st.engines[i];
      SB.stepEngine(es, ship, dt);
      if (es.level <= 0) continue;
      const F = es.level * thr * SB.engineThrust(e, atm.p);
      thrust += F;
      let fn = 0, fu = F;
      if (e.gimbal) { fn = F * sd; fu = F * cd; centerF += F; }
      Fn += fn; Fu += fu;
      const tA = e.lateral * fu, tG = mp.L * fn;   // off-centre thrust vs gimbal deflection
      tau += tA + tG; tqAsym += tA; tqGimbal += tG; engTq[i] = tA;
      mdot += es.level * thr * SB.engineMdot(e);
    }
    const rcs = (st.prop > 0 && ctrl.rcs && ctrl.rcs.thrusters && ctrl.rcs.thrusters.length) ? ctrl.rcs : null;
    if (rcs) {
      const r = SB.rcsEffect(ship, mp, rcs.thrusters, rcs.power);
      Fn += r.fn; tau += r.tau; tqRcs = r.tau; mdot += r.mdot;
    }
    let Fx = Fn * nx + Fu * ux, Fy = Fn * ny + Fu * uy;
    let q = 0, aoa = 0, drag = 0;
    if (opts && opts.aero) {
      const v2 = st.vx * st.vx + st.vy * st.vy;
      if (atm.rho > 1e-7 && v2 > 1) {
        const v = Math.sqrt(v2), vhx = st.vx / v, vhy = st.vy / v;
        const cosA = vhx * ux + vhy * uy, sinA = vhx * uy - vhy * ux;
        aoa = Math.atan2(sinA, cosA);
        q = 0.5 * atm.rho * v2;
        const cda = ship.aero.cdaAxial + (ship.aero.cdaBroad - ship.aero.cdaAxial) * sinA * sinA;
        drag = q * cda;
        Fx -= drag * vhx; Fy -= drag * vhy;
        tqAero = ship.aero.cm * q * Math.sin(2 * aoa) - ship.aero.damp * q * st.omega;
        tau += tqAero;
      }
    }
    const gmag = E.mu / (r * r);
    const ax = Fx / mp.m - gmag * upx, ay = Fy / mp.m - gmag * upy;
    const alpha = tau / mp.I;
    st.vx += ax * dt; st.vy += ay * dt;
    st.x += st.vx * dt; st.y += st.vy * dt;
    st.omega += alpha * dt;
    st.theta = SB.wrapPi(st.theta + st.omega * dt);
    st.prop = Math.max(0, st.prop - mdot * dt);
    return {
      m: mp.m, I: mp.I, L: mp.L, com: mp.com, thrust, centerF, tau, alpha, mdot, q, aoa, drag,
      pAmb: atm.p, gLoad: Math.hypot(Fx, Fy) / mp.m / G0, rcs,
      tq: { asym: tqAsym, gimbal: tqGimbal, rcs: tqRcs, aero: tqAero, net: tau }, engTq,
    };
  };

  /* Stack (ship + booster locked together) before hot-stage release: translation only. */
  SB.stepStack = function (st, bst, ctrl, ship, booster, dt, tRel) {
    const E = SB.EARTH;
    const mp = SB.massProps(ship, st.prop);
    const r = Math.hypot(st.x, st.y);
    const upx = st.x / r, upy = st.y / r;
    const atm = SB.atmo(r - E.R);
    const ux = Math.cos(st.theta), uy = Math.sin(st.theta);
    let thrust = 0, mdot = 0;
    const thr = SB.clamp(ctrl.throttle, ship.minThrottle, 1);
    for (let i = 0; i < ship.engines.length; i++) {
      const e = ship.engines[i], es = st.engines[i];
      SB.stepEngine(es, ship, dt);
      if (es.level <= 0) continue;
      thrust += es.level * thr * SB.engineThrust(e, atm.p);
      mdot += es.level * thr * SB.engineMdot(e);
    }
    const bthrust = booster.thrust(tRel);
    const mtot = mp.m + bst.mass;
    const F = thrust + bthrust;
    const gmag = E.mu / (r * r);
    const ax = F * ux / mtot - gmag * upx, ay = F * uy / mtot - gmag * upy;
    st.vx += ax * dt; st.vy += ay * dt;
    st.x += st.vx * dt; st.y += st.vy * dt;
    st.prop = Math.max(0, st.prop - mdot * dt);
    st.omega = 0;
    // booster rides along, its top at the ship's engine plane
    bst.theta = st.theta; bst.vx = st.vx; bst.vy = st.vy;
    const off = mp.com + (booster.length - booster.com);
    bst.x = st.x - off * ux; bst.y = st.y - off * uy;
    return { m: mp.m, I: mp.I, L: mp.L, com: mp.com, thrust, centerF: 0, tau: 0, alpha: 0, mdot, q: 0, aoa: 0, drag: 0, pAmb: atm.p, gLoad: F / mtot / G0, rcs: null,
      tq: { asym: 0, gimbal: 0, rcs: 0, aero: 0, net: 0 }, engTq: new Array(ship.engines.length).fill(0) };
  };

  /* Free booster after release: scripted attitude (the flip), axial thrust per the
     booster's own schedule (residual engines, then boostback), gravity, simple drag. */
  SB.stepBooster = function (bst, booster, dt, tRel) {
    const E = SB.EARTH;
    const r = Math.hypot(bst.x, bst.y);
    const upx = bst.x / r, upy = bst.y / r;
    const atm = SB.atmo(r - E.R);
    if (bst.theta0 == null) bst.theta0 = bst.theta;
    if (booster.attitude) bst.theta = SB.wrapPi(bst.theta0 + booster.attitude(tRel));
    const ux = Math.cos(bst.theta), uy = Math.sin(bst.theta);
    const F = booster.thrust(tRel);
    let Fx = F * ux, Fy = F * uy;
    const v2 = bst.vx * bst.vx + bst.vy * bst.vy;
    if (v2 > 1) {
      const v = Math.sqrt(v2);
      const drag = 0.5 * atm.rho * v2 * booster.cda;
      Fx -= drag * bst.vx / v; Fy -= drag * bst.vy / v;
    }
    const gmag = E.mu / (r * r);
    bst.vx += (Fx / bst.mass - gmag * upx) * dt;
    bst.vy += (Fy / bst.mass - gmag * upy) * dt;
    bst.x += bst.vx * dt; bst.y += bst.vy * dt;
    bst.thrustNow = F;
  };

  /* Osculating orbit from a state: returns perigee/apogee altitudes (m). */
  SB.orbitOf = function (st) {
    const E = SB.EARTH;
    const r = Math.hypot(st.x, st.y), v2 = st.vx * st.vx + st.vy * st.vy;
    const eps = v2 / 2 - E.mu / r;
    const h = st.x * st.vy - st.y * st.vx;
    if (eps >= 0) return { perigee: Infinity, apogee: Infinity, bound: false };
    const a = -E.mu / (2 * eps);
    const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (E.mu * E.mu)));
    return { perigee: a * (1 - e) - E.R, apogee: a * (1 + e) - E.R, bound: true };
  };
})(globalThis.SB = globalThis.SB || {});
