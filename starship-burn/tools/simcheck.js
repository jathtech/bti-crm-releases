/* Node harness: builds each reference, runs the failure with no actions, then
   with the scenario's example solution, and prints what happened. Exits non-zero
   if a reference does not fly clean or a solution does not succeed. */
const path = require('path');
['util', 'vehicle', 'physics', 'controller', 'sim', 'scenarios'].forEach(m => require(path.join(__dirname, '..', 'js', m + '.js')));
const SB = globalThis.SB;

const only = process.argv[2];
let bad = 0;
function summarize(tag, run) {
  const f = run.frames[run.frames.length - 1];
  const ev = run.eval;
  console.log(`  ${tag.padEnd(12)} end=${run.end.reason.padEnd(10)} t=${f.t.toFixed(1).padStart(6)}  alt=${(f.alt/1000).toFixed(2)}km  v=${f.speed.toFixed(0)}  pitch=${f.pitch.toFixed(1)}  pitchErr=${f.pitchErr.toFixed(1)}  rate=${f.rate.toFixed(2)}  dv=${f.dv.toFixed(0)}  maxDev=${run.maxDev.toFixed(0)} rms=${run.rmsDev.toFixed(0)}` + (ev ? `  → ${ev.outcome} ★${ev.stars}` : ''));
  if (ev) ev.rows.forEach(r => console.log(`      ${r.ok ? 'ok ' : 'XX '} ${r.label}: ${r.value}`));
  return f;
}
for (const scn of SB.SCENARIOS) {
  if (only && scn.id !== only) continue;
  console.log(`\n== ${scn.title} (${scn.id})`);
  const t0 = Date.now();
  const ref = SB.buildReference(scn);
  const tRef = Date.now() - t0;
  // the reference judged by its own rules (no failures) must be clean
  const nominal = SB.runPlayer(Object.assign({}, scn, { failures: [] }), ref, []);
  const f = summarize('reference', ref);
  summarize('nominal', nominal);
  if (!nominal.eval.success || nominal.maxDev > 1) { console.log('  !! nominal replay is not clean'); bad++; }
  const t1 = Date.now();
  const fail = SB.runPlayer(scn, ref, []);
  const tRun = Date.now() - t1;
  summarize('no-action', fail);
  const sol = SB.runPlayer(scn, ref, scn.solution || []);
  summarize('solution', sol);
  if (!sol.eval.success) { console.log('  !! example solution does not succeed'); bad++; }
  console.log(`  timing: ref ${tRef} ms, player run ${tRun} ms, frames ${ref.frames.length}`);
  if (process.env.LOG) [fail, sol].forEach((r, k) => { console.log('  -- log ' + (k ? 'solution' : 'no-action')); r.log.forEach(l => console.log('     ' + SB.fmt.t(l.t) + ' ' + l.msg)); });
}
process.exit(bad ? 1 : 0);
