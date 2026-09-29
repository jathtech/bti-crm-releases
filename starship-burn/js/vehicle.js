/* vehicle.js — Starship configuration, mass properties and the engine model. */
(function (SB) {
  'use strict';
  const G0 = SB.G0, DEG = SB.DEG;

  function eng(id, kind, r, az, gimbal, thrustVac, ispVac, exitArea) {
    return { id, kind, r, az, lateral: r * Math.cos(az * DEG), gimbal, thrustVac, ispVac, exitArea };
  }

  /* Ship as flown in the game. Lengths in metres from the engine plane, masses in kg.
     The engine ring is the real hexagonal layout viewed from below: three gimballing
     sea-level Raptors clustered in the middle, three fixed Raptor Vacuums outboard.
     For the 2-D sim each engine's torque arm is its lateral projection into the
     trajectory plane (r*cos(azimuth)). */
  SB.SHIP_BASE = {
    name: 'Starship',
    length: 52, radius: 4.5,
    catchPinU: 41,                          // catch pins sit just below the forward flaps, measured from the engine plane
    dryMass: 120e3, prop: 0, propMax: 1200e3,
    dryCom: 22, propComEmpty: 5, propComFull: 17, tankHeightFull: 24,
    engines: [
      eng('C1', 'center', 1.3, 210, true, 2.30e6, 350, 1.3),
      eng('C2', 'center', 1.3, 90, true, 2.30e6, 350, 1.3),
      eng('C3', 'center', 1.3, 330, true, 2.30e6, 350, 1.3),
      eng('V1', 'vac', 3.2, 150, false, 2.55e6, 378, 4.5),
      eng('V2', 'vac', 3.2, 270, false, 2.55e6, 378, 4.5),
      eng('V3', 'vac', 3.2, 30, false, 2.55e6, 378, 4.5),
    ],
    gimbalMax: 15, gimbalRate: 20,         // deg, deg/s
    minThrottle: 0.4,
    spoolUp: 1.6, spoolDown: 0.6,          // s
    relightP: { center: 0.85, vac: 0.70 }, // probability an in-flight relight succeeds
    /* RCS: hot-gas thrusters fed from the tank ullage, in the nose and the aft skirt.
       side = which way the exhaust goes (+1 = starboard/+n); force is per thruster. */
    rcs: { force: 60e3, isp: 90, thrusters: {
      NL: { u: 47, side: -1, name: 'nose, port' }, NR: { u: 47, side: 1, name: 'nose, starboard' },
      TL: { u: 7, side: -1, name: 'aft, port' }, TR: { u: 7, side: 1, name: 'aft, starboard' } } },
    sas: { kp: 1.0, kd: 1.4, authority: 3.0 }, // deg per deg, deg per deg/s, deg
    gLimit: 5.5,                            // structural limit, g
    aero: { cdaAxial: 60, cdaBroad: 400, cm: 400, damp: 1500 },
  };

  SB.makeShip = function (overrides) {
    const s = Object.assign({}, SB.SHIP_BASE, overrides || {});
    s.sas = Object.assign({}, SB.SHIP_BASE.sas, (overrides && overrides.sas) || {});
    s.rcs = Object.assign({}, SB.SHIP_BASE.rcs, (overrides && overrides.rcs) || {});
    s.aero = Object.assign({}, SB.SHIP_BASE.aero, (overrides && overrides.aero) || {});
    s.engines = SB.SHIP_BASE.engines.map(e => Object.assign({}, e));
    return s;
  };

  /* Landing propellant lives in the header tanks (LOX header in the nose, CH4 header
     inside the main LOX tank), which is why a landing ship has a higher CoM than its
     fill level would suggest: scenarios set propComFixed for that. */
  SB.massProps = function (ship, prop) {
    const fill = SB.clamp(prop / ship.propMax, 0, 1);
    const propCom = ship.propComFixed != null ? ship.propComFixed : SB.lerp(ship.propComEmpty, ship.propComFull, fill);
    const m = ship.dryMass + prop;
    const com = (ship.dryMass * ship.dryCom + prop * propCom) / m;
    const hp = ship.propComFixed != null ? (ship.propTankHeight || 4) : Math.max(1, ship.tankHeightFull * fill);
    const I = ship.dryMass * (ship.length * ship.length / 12 + (ship.dryCom - com) * (ship.dryCom - com))
            + prop * (hp * hp / 12 + (propCom - com) * (propCom - com));
    return { m, com, I, L: com };
  };

  SB.engineThrust = function (e, pAmb) { return Math.max(0, e.thrustVac - e.exitArea * pAmb); };
  SB.engineMdot = function (e) { return e.thrustVac / (e.ispVac * G0); };

  SB.makeEngineStates = function (ship, onIds) {
    return ship.engines.map(e => {
      const on = onIds.indexOf(e.id) >= 0;
      return { id: e.id, state: on ? 'on' : 'off', level: on ? 1 : 0, dead: false, relights: 0 };
    });
  };

  SB.stepEngine = function (es, ship, dt) {
    switch (es.state) {
      case 'spool': es.level = Math.min(1, es.level + dt / ship.spoolUp); if (es.level >= 1) es.state = 'on'; break;
      case 'shutdown': es.level = Math.max(0, es.level - dt / ship.spoolDown); if (es.level <= 0) es.state = 'off'; break;
      case 'failed': es.level = Math.max(0, es.level - dt / 0.3); break;
      case 'on': es.level = 1; break;
      default: es.level = 0;
    }
  };

  /* Force, torque and mass flow of an RCS selection about the current CoM. */
  SB.rcsEffect = function (ship, mp, thrusters, power) {
    let fn = 0, tau = 0, mdot = 0;
    (thrusters || []).forEach(id => {
      const th = ship.rcs.thrusters[id]; if (!th) return;
      const F = ship.rcs.force * (power || 1);
      const f = -th.side * F;              // exhaust to one side pushes the vehicle the other way
      fn += f; tau += -(th.u - mp.com) * f; mdot += F / (ship.rcs.isp * G0);
    });
    return { fn, tau, mdot };
  };

  /* Remaining delta-v with the currently running engines' mean Isp (falls back to
     the ship average when nothing is lit). */
  SB.deltaV = function (ship, st) {
    let ispSum = 0, n = 0;
    st.engines.forEach((es, i) => { if (es.level > 0) { ispSum += ship.engines[i].ispVac; n++; } });
    const isp = n ? ispSum / n : 360;
    const m = ship.dryMass + st.prop;
    return isp * G0 * Math.log(m / ship.dryMass);
  };
})(globalThis.SB = globalThis.SB || {});
