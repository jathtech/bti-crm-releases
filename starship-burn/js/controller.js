/* controller.js — the ideal flight computer used to fly the reference (nominal)
   trajectory, plus the pitch-program helper. The player's run does NOT get this
   controller: it replays the recorded nominal gimbal/throttle schedule and only
   has a limited-authority stability augmentation system (SAS) on top. */
(function (SB) {
  'use strict';
  const DEG = SB.DEG, RAD = SB.RAD;

  /* Piecewise smoothstep pitch program. keys = [[t, pitchDeg], ...] sorted by t.
     Returns pitch, rate, acc in radians. */
  SB.pitchProgram = function (keys) {
    return function (t) {
      if (t <= keys[0][0]) return { pitch: keys[0][1] * DEG, rate: 0, acc: 0 };
      for (let i = 1; i < keys.length; i++) {
        const [t0, p0] = keys[i - 1], [t1, p1] = keys[i];
        if (t <= t1) {
          const T = t1 - t0, s = SB.smoothstep((t - t0) / T);
          const dp = (p1 - p0) * DEG;
          return { pitch: p0 * DEG + dp * s.v, rate: dp * s.d1 / T, acc: dp * s.d2 / (T * T) };
        }
      }
      return { pitch: keys[keys.length - 1][1] * DEG, rate: 0, acc: 0 };
    };
  };

  /* PD attitude controller with feed-forward, gains normalised by the current
     control effectiveness so it behaves the same on a full ship and an empty one. */
  SB.idealGimbal = function (st, g, ship, ceff, cmd) {
    if (ceff < 1e-4) return 0;
    const thetaCmd = g.angUp - cmd.pitch;
    const omegaCmd = g.omegaUp - cmd.rate;
    const alphaCmd = -cmd.acc;
    const eTh = SB.wrapPi(st.theta - thetaCmd), eOm = st.omega - omegaCmd;
    const wn = 1.2, z = 0.9;
    const kp = wn * wn / ceff, kd = 2 * z * wn / ceff;
    const d = alphaCmd / ceff - kp * eTh - kd * eOm;
    return SB.clamp(d * RAD, -ship.gimbalMax, ship.gimbalMax);
  };

  /* Stability augmentation for the player's run: holds the *recorded* nominal
     attitude with limited gimbal authority. Returns { out, raw, sat } in degrees. */
  SB.sas = function (st, ship, thetaRef, omegaRef) {
    const eTh = SB.wrapPi(st.theta - thetaRef) * RAD;
    const eOm = (st.omega - omegaRef) * RAD;
    const raw = -(ship.sas.kp * eTh + ship.sas.kd * eOm);
    const a = ship.sas.authority;
    return { out: SB.clamp(raw, -a, a), raw, sat: Math.abs(raw) > a };
  };
})(globalThis.SB = globalThis.SB || {});
