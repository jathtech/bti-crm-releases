/* brute-force search for example solutions */
const path = require('path');
['util','vehicle','physics','controller','sim','scenarios'].forEach(m => require(path.join(__dirname,'..','js',m+'.js')));
const SB = globalThis.SB;
const which = process.argv[2] || 'rvac-out';
const scn = SB.scenarioById(which);
const ref = SB.buildReference(scn);
const out = [];
function tryIt(actions, label) {
  const run = SB.runPlayer(scn, ref, actions);
  const f = run.frames[run.frames.length - 1];
  out.push({ label, actions, ok: run.eval.success, stars: run.eval.stars, outcome: run.eval.outcome, maxDev: run.maxDev, rms: run.rmsDev, end: run.end.reason, t: f.t, vz: f.vUp, vx: f.vEast, pitch: f.pitch, rate: f.rate, dv: f.dv, rows: run.eval.rows });
}
if (which === 'rvac-out') {
  for (const trim of [4.0, 4.5, 5.0, 5.5]) {
    tryIt([{ t: 12.4, type: 'trim', value: trim }], `trim ${trim} only`);
    for (const t1 of [0.95, 1.0]) for (const steps of [
      [[25, 0.85], [38, 0.75], [50, 0.65], [60, 0.55]],
      [[28, 0.8], [45, 0.62]],
      [[30, 0.8], [45, 0.62]],
      [[22, 0.9], [34, 0.8], [46, 0.7], [58, 0.6]],
    ]) {
      const a = [{ t: 12.4, type: 'trim', value: trim }, { t: 12.4, type: 'throttle', value: t1 }].concat(steps.map(([t, v]) => ({ t, type: 'throttle', value: v })));
      tryIt(a, `trim ${trim} thr ${t1} steps ${JSON.stringify(steps)}`);
    }
    tryIt([{ t: 12.4, type: 'engine', engine: 'V1', cmd: 'off' }], `shut V1`);
    tryIt([{ t: 12.4, type: 'engine', engine: 'V1', cmd: 'off' }, { t: 12.4, type: 'throttle', value: 1.0 }, { t: 40, type: 'throttle', value: 0.8 }], `shut V1 + 100% + 80%@40`);
  }
} else if (which === 'landing') {
  for (const thr1 of [0.55, 0.65, 0.75]) for (const trim1 of [1.5, 2.5]) for (const t2 of [6.3, 7.0]) for (const thr2 of [0.8, 0.9, 1.0]) for (const trim2 of [3.0, 3.5, 4.0]) for (const t3 of [10, 12]) for (const thr3 of [0.6, 0.7, 0.8]) {
    const a = [{ t: 0.2, type: 'throttle', value: thr1 }, { t: 0.2, type: 'trim', value: trim1 }, { t: t2, type: 'throttle', value: thr2 }, { t: t2, type: 'trim', value: trim2 }, { t: t3, type: 'throttle', value: thr3 }];
    tryIt(a, `thr ${thr1} trim ${trim1} | @${t2} thr ${thr2} trim ${trim2} | @${t3} thr ${thr3}`);
  }
} else if (which === 'hotstage') {
  for (const trim of [3, 3.5, 4, 4.5, 5]) for (const t of [1.6, 2.0, 3.0]) tryIt([{ t, type: 'trim', value: trim }], `trim ${trim} @${t}`);
  tryIt([{ t: 2.0, type: 'engine', engine: 'V1', cmd: 'off' }], 'shut V1');
}
out.sort((a, b) => (b.stars - a.stars) || (a.rms - b.rms));
console.log(`${out.filter(o => o.ok).length}/${out.length} succeed`);
for (const o of out.slice(0, 12)) console.log(`★${o.stars} ${o.outcome.padEnd(28)} end=${o.end.padEnd(9)} t=${o.t.toFixed(1)} maxDev=${o.maxDev.toFixed(0)} rms=${o.rms.toFixed(0)} vz=${o.vz.toFixed(1)} vx=${o.vx.toFixed(1)} pitch=${o.pitch.toFixed(1)} dv=${o.dv.toFixed(0)}  :: ${o.label}`);
if (process.env.ROWS) out.slice(0, 3).forEach(o => o.rows.forEach(r => console.log('   ', r.ok ? 'ok' : 'XX', r.label, r.value)));
