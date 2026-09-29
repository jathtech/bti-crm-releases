const path = require('path');
['util','vehicle','physics','controller','sim','scenarios'].forEach(m => require(path.join(__dirname,'..','js',m+'.js')));
const SB = globalThis.SB;
const base = SB.scenarioById('landing');
function variant(h0, flipThr, lean, cutIds, aProf, kv) {
  const scn = Object.assign({}, base);
  scn.initial = Object.assign({}, base.initial, { alt: h0 });
  scn.plan = Object.assign({}, base.plan);
  scn.plan.profile = h => -Math.sqrt(1.0 + 2 * aProf * Math.max(h, 0));
  scn.plan.pitch = (function () {
    const pp = SB.pitchProgram([[0, 90], [0.4, 90], [5.5, 0], [30, 0]]);
    return (t, st, g) => { const p = pp(t); if (t > 2.5) p.pitch += SB.clamp(-lean * g.vEast, -25, 25) * SB.DEG; return p; };
  })();
  scn.plan.throttle = function (t, st, g, ctx, ship, ci) {
    if (t < 5.5) return flipThr;
    const gl = SB.EARTH.mu / (g.r * g.r);
    const h = Math.max(g.alt - ci.mp.com * Math.cos(g.pitch), 0);
    const vz = g.vUp, vDes = this.profile(h);
    const running = st.engines.filter(e => e.level > 0).length;
    if (running > 2 && vz >= vDes - 1.5 && !ctx.mem.cut) { ctx.mem.cut = true; ctx.cutoff(cutIds); }
    const aCmd = gl + aProf * (vz < -1 ? 1 : 0) + kv * (vDes - vz);
    return aCmd * ci.mp.m / Math.max(ci.favail * Math.max(Math.cos(g.pitch), 0.3), 1);
  };
  return scn;
}
for (const h0 of [600, 650, 700]) for (const thr of [0.42, 0.45, 0.5]) for (const lean of [1.0, 1.3]) for (const kv of [1.2]) {
  const scn = variant(h0, thr, lean, ['C2'], 3.5, kv);
  const ref = SB.buildReference(scn);
  const f = ref.frames[ref.frames.length - 1];
  const cut = ref.recordedEvents[0];
  console.log(`h0=${h0} thr=${thr} lean=${lean} kv=${kv}  end=${ref.end.reason} t=${f.t.toFixed(1)} vz=${f.vUp.toFixed(1)} vx=${f.vEast.toFixed(1)} pitch=${f.pitch.toFixed(1)} rate=${f.rate.toFixed(1)} dr=${f.dr.toFixed(0)} cut@${cut ? cut.t.toFixed(1) : '-'} dv=${f.dv.toFixed(0)} maxG=${Math.max(...ref.frames.map(x=>x.gLoad)).toFixed(1)}`);
}
