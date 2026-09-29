const path = require('path');
['util','vehicle','physics','controller','sim','scenarios'].forEach(m => require(path.join(__dirname,'..','js',m+'.js')));
const SB = globalThis.SB, DEG = SB.DEG, RAD = SB.RAD;
const base = SB.scenarioById('rvac-out');
function variant(o) {
  const scn = Object.assign({}, base);
  scn.initial = Object.assign({}, base.initial, { alt: o.alt0, gamma: o.g0 });
  scn.plan = Object.assign({}, base.plan);
  const pp = SB.pitchProgram([[0, o.p0], [o.tEnd, o.p1]]);
  scn.plan.pitch = (t, st, g) => {
    const p = pp(t);
    const gTgt = SB.lerp(o.g0, o.gEnd, SB.clamp(t / o.tEnd, 0, 1));
    p.pitch -= SB.clamp(o.gain * (gTgt - g.gamma * RAD), -o.clampDeg, o.clampDeg) * DEG;
    return p;
  };
  return scn;
}
const results = [];
for (const alt0 of [140e3, 145e3]) for (const g0 of [0.8, 1.2, 1.6]) for (const gain of [6, 10]) for (const gEnd of [0.1, 0.3]) for (const p0 of [82, 84]) {
  const o = { alt0, g0, gain, gEnd, p0, p1: 91, tEnd: 66, clampDeg: 8 };
  const scn = variant(o);
  const ref = SB.buildReference(scn);
  const f = ref.frames[ref.frames.length - 1];
  const orb = SB.orbitOf(f);
  const maxPitchDev = Math.max(...ref.frames.map(x => Math.abs(x.pitch - 90)));
  results.push({ o, end: ref.end.reason, t: f.t, alt: f.alt, gamma: f.gamma, per: orb.perigee/1e3, apo: orb.apogee/1e3, dv: f.dv, maxPitchDev });
}
results.sort((a, b) => (Math.abs(a.per - 150) + Math.abs(a.apo - 200)) - (Math.abs(b.per - 150) + Math.abs(b.apo - 200)));
for (const r of results.slice(0, 12)) console.log(JSON.stringify(r.o), r.end, 't', r.t.toFixed(1), 'alt', (r.alt/1e3).toFixed(1), 'γ', r.gamma.toFixed(2), 'orbit', r.per.toFixed(0), 'x', r.apo.toFixed(0), 'dv', r.dv.toFixed(0), 'pitchDev', r.maxPitchDev.toFixed(1));
