const path = require('path');
['util','vehicle','physics','controller','sim','scenarios'].forEach(m => require(path.join(__dirname,'..','js',m+'.js')));
const SB = globalThis.SB;
const id = process.argv[2] || 'landing', every = +(process.argv[3] || 0.5), which = process.argv[4] || 'ref';
const scn = SB.scenarioById(id);
const ref = SB.buildReference(scn);
let run = ref;
if (which === 'fail') run = SB.runPlayer(scn, ref, []);
else if (which === 'sol') run = SB.runPlayer(scn, ref, scn.solution);
else if (which.startsWith('[')) run = SB.runPlayer(scn, ref, JSON.parse(which));
console.log('t      alt     base   vUp    vEast  pitch  pErr  rate   gimb   thr   eng            dev   g    rec');
for (const f of run.frames) {
  if (Math.abs(f.t / every - Math.round(f.t / every)) > 1e-6) continue;
  console.log(f.t.toFixed(1).padStart(5), f.alt.toFixed(0).padStart(7), f.baseAlt.toFixed(0).padStart(6), f.vUp.toFixed(1).padStart(6), f.vEast.toFixed(1).padStart(6),
    f.pitch.toFixed(1).padStart(6), f.pitchErr.toFixed(1).padStart(5), f.rate.toFixed(1).padStart(6), f.gimbalCmd.toFixed(1).padStart(6), f.throttle.toFixed(2).padStart(5),
    f.engines.map(e => e.state[0] + (e.level*9|0)).join(' '), f.dev.toFixed(0).padStart(5), f.gLoad.toFixed(1).padStart(4), f.recovery.toFixed(2).padStart(5));
}
console.log('end', run.end.reason, run.eval ? run.eval.outcome : '');
run.log.forEach(l => console.log('  ' + SB.fmt.t(l.t) + ' ' + l.msg));
