/* Headless browser smoke test: loads the game, walks the main flow and saves screenshots. */
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/shots';
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); }
  // ---- phone
  const ctx = await browser.newContext({ viewport: { width: 390, height: 660 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(url + '?m=hotstage');
  await page.waitForTimeout(400);
  await shot(page, '01-briefing');
  await page.click('#cardWatch');
  await page.waitForTimeout(300);
  // jump to interesting moments deterministically
  await page.evaluate(() => { SB.ui.setPlaying(false); SB.ui.seek(6.0); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await shot(page, '02-hotstage-t6');
  await page.evaluate(() => { SB.ui.seek(12.5); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await shot(page, '03-hotstage-spin');
  await page.evaluate(() => { SB.ui.seek(SB.app.run.duration); SB.app.lastTelemetryI = -1; SB.app.rudAge = 0.8; });
  await page.waitForTimeout(150);
  await shot(page, '04-hotstage-rud');
  await page.evaluate(() => SB.ui.showResults());
  await page.waitForTimeout(150);
  await shot(page, '05-results-fail');
  await page.click('#cardFix');
  await page.waitForTimeout(100);
  // add a trim action via the UI: seek to 2.0 via the API then use the GIMBAL tab
  await page.evaluate(() => { SB.ui.seek(2.0); SB.app.lastTelemetryI = -1; });
  await page.click('.tabs button[data-tab="trim"]');
  await page.waitForTimeout(150);
  await page.locator('#gimbalPad').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await shot(page, '06a-gimbal-pad-before');
  // drag the gimbal pad: 44 px to the left ~ +4 degrees of trim
  const gpBox = await page.locator('#gimbalPad').boundingBox();
  await page.mouse.move(gpBox.x + gpBox.width * 0.3, gpBox.y + gpBox.height * 0.6);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(gpBox.x + gpBox.width * 0.3 - k * 5.5, gpBox.y + gpBox.height * 0.6); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const trimNow = await page.evaluate(() => SB.app.actions.map(a => a.type + ':' + a.value).join(','));
  console.log('actions after pad drag:', trimNow);
  await shot(page, '06-edit-trim-added');
  await page.evaluate(() => { SB.ui.seek(SB.app.run.duration); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await page.evaluate(() => SB.ui.showResults());
  await page.waitForTimeout(150);
  await shot(page, '07-results-success');
  const evalRes = await page.evaluate(() => SB.app.run.eval);
  console.log('hotstage fix result:', evalRes.outcome, 'stars', evalRes.stars);
  // ---- ascent
  await page.goto(url + '?m=rvac-out');
  await page.waitForTimeout(300);
  await page.click('#cardWatch');
  await page.evaluate(() => { SB.ui.setPlaying(false); SB.ui.seek(16); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await shot(page, '08-ascent-t16');
  await page.click('.tabs button[data-tab="engine"]');
  await page.waitForTimeout(100);
  await shot(page, '09-ascent-engines-tab');
  await page.evaluate(() => { SB.app.actions = SB.scenarioById('rvac-out').solution.map(a => Object.assign({}, a)); SB.ui.recompute(); SB.ui.seek(45); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await shot(page, '10-ascent-solution-t45');
  // ---- landing
  await page.goto(url + '?m=landing');
  await page.waitForTimeout(300);
  await page.click('#cardWatch');
  await page.evaluate(() => { SB.ui.setPlaying(false); SB.ui.seek(3.0); SB.app.lastTelemetryI = -1; });
  await page.waitForTimeout(150);
  await shot(page, '11-landing-flip');
  await page.evaluate(() => { SB.ui.seek(SB.app.run.duration); SB.app.lastTelemetryI = -1; SB.app.rudAge = 0.6; });
  await page.waitForTimeout(150);
  await shot(page, '12-landing-crash');
  await page.evaluate(() => { SB.app.actions = SB.scenarioById('landing').solution.map(a => Object.assign({}, a)); SB.ui.recompute(); SB.ui.seek(13); SB.app.lastTelemetryI = -1; });
  await page.click('.tabs button[data-tab="rcs"]');
  await page.waitForTimeout(150);
  // tap the nose-starboard and aft-port thrusters, then fire
  await page.locator('#rcsPad').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const hits = await page.evaluate(() => document.getElementById('rcsPad')._hits);
  const rpBox = await page.locator('#rcsPad').boundingBox();
  for (const id of ['NR', 'TL']) { const h = hits.find(x => x.id === id); await page.mouse.click(rpBox.x + h.x, rpBox.y + h.y); await page.waitForTimeout(80); }
  await page.waitForTimeout(150);
  await shot(page, '13-landing-rcs-pad');
  await page.click('#addRcs');
  await page.waitForTimeout(150);
  console.log('rcs action:', await page.evaluate(() => JSON.stringify(SB.app.actions.filter(a => a.type === 'rcs'))));
  await page.evaluate(() => { SB.app.actions = SB.app.actions.filter(a => a.type !== 'rcs'); SB.ui.recompute(); });
  await page.evaluate(() => SB.ui.seek(SB.app.run.duration));
  await page.waitForTimeout(150);
  await shot(page, '14-landing-touchdown');
  // overflow probe: every tab must fit the phone viewport without page scroll
  await page.evaluate(() => document.getElementById('overlay').classList.add('hidden'));
  for (const tab of ['throttle', 'engine', 'trim', 'rcs']) {
    await page.click(`.tabs button[data-tab="${tab}"]`);
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight, bh: document.body.scrollHeight }));
    console.log(`tab ${tab}: scrollHeight ${m.sh} vs viewport ${m.ih} ${m.sh <= m.ih ? 'fits' : 'OVERFLOWS by ' + (m.sh - m.ih)}`);
    await shot(page, '16-phone-' + tab);
  }
  await page.click('#btnMissions');
  await page.waitForTimeout(150);
  await shot(page, '15-missions');
  // real-time playback sanity: play for 2 s and check the playhead advanced
  await page.evaluate(() => { document.getElementById('overlay').classList.add('hidden'); SB.ui.seek(0); SB.ui.setPlaying(true); });
  await page.waitForTimeout(2000);
  const t = await page.evaluate(() => SB.app.t);
  console.log('after 2 s of playback t =', t.toFixed(2));
  await ctx.close();
  // ---- desktop
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page2.goto(url + '?m=rvac-out');
  await page2.waitForTimeout(300);
  await page2.evaluate(() => { document.getElementById('overlay').classList.add('hidden'); SB.app.actions = SB.scenarioById('rvac-out').solution.map(a => Object.assign({}, a)); SB.ui.recompute(); SB.ui.seek(30); SB.app.lastTelemetryI = -1; });
  await page2.waitForTimeout(200);
  await shot(page2, '20-desktop-ascent');
  await ctx2.close();
  await browser.close();
  console.log(errors.length ? 'CONSOLE ISSUES:\n' + errors.join('\n') : 'no console errors');
})().catch(e => { console.error(e); process.exit(1); });
