const assert = require('node:assert/strict');
const engine = require(process.env.ELECTION_WATCH_PLAYWRIGHT_PATH || 'playwright')[process.env.ELECTION_WATCH_BROWSER || 'chromium'];
const url = process.env.ELECTION_WATCH_URL || 'http://127.0.0.1:8877/idaho-election-watch/';

(async () => {
  const browser = await engine.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const snapshot = await (await context.request.get(url + 'data/results.json')).json();
    assert.equal(snapshot.meta.autoRefreshEndsAt, '2026-11-04T01:00:00-07:00');
    const openAt = async time => {
      const page = await context.newPage();
      let requests = 0;
      await page.route('**/data/results.json*', route => {
        requests++;
        return route.fulfill({json:snapshot});
      });
      await page.clock.install({time:new Date(time)});
      await page.clock.pauseAt(new Date(time));
      await page.goto(url);
      await page.waitForSelector('.race-card');
      return {page, requests:()=>requests};
    };

    const before = await openAt('2026-11-04T03:59:00Z');
    await before.page.clock.runFor(59999);
    assert.equal(before.requests(), 1);
    await Promise.all([
      before.page.waitForResponse('**/data/results.json*'),
      before.page.clock.runFor(1),
    ]);
    assert.equal(before.requests(), 2, 'automatic checks start at statewide poll close');
    await before.page.close();

    const boundary = await openAt('2026-11-04T07:54:00Z');
    await Promise.all([
      boundary.page.waitForResponse('**/data/results.json*'),
      boundary.page.clock.runFor(300000),
    ]);
    assert.equal(boundary.requests(), 2, 'five-minute refresh still runs before cutoff');
    await boundary.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    await boundary.page.clock.runFor(60000);
    assert.equal(boundary.requests(), 2, 'no fetch at 1 a.m. Mountain');
    assert.match(await boundary.page.locator('#fetch-time').innerText(), /Automatic updates ended at 1:00 AM MST/);
    await boundary.page.clock.runFor(3600000);
    assert.equal(boundary.requests(), 2, 'no later automatic fetch');
    await Promise.all([
      boundary.page.waitForResponse('**/data/results.json*'),
      boundary.page.locator('#refresh').click({force:true}),
    ]);
    assert.equal(boundary.requests(), 3, 'manual refresh remains available');
    await boundary.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    await boundary.page.clock.runFor(600000);
    assert.equal(boundary.requests(), 3, 'manual refresh never restarts the timer');
    await boundary.page.route('**/data/results.json*', route => route.fulfill({status:503,json:{error:'Snapshot unavailable'}}));
    await Promise.all([
      boundary.page.waitForResponse('**/data/results.json*'),
      boundary.page.locator('#refresh').click({force:true}),
    ]);
    await boundary.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.match(await boundary.page.locator('#notice').innerText(), /Keeping the last loaded snapshot/);
    assert.equal(await boundary.page.locator('#source-status').innerText(), 'Unable to refresh');
    await boundary.page.close();

    const asleep = await openAt('2026-11-04T07:58:00Z');
    await asleep.page.clock.setSystemTime(new Date('2026-11-04T09:00:00Z'));
    await asleep.page.clock.runFor(300000);
    assert.equal(asleep.requests(), 1, 'a suspended tab rechecks the cutoff on wake');
    await asleep.page.close();

    const late = await openAt('2026-11-05T04:00:00Z');
    await late.page.clock.runFor(3600000);
    assert.equal(late.requests(), 1, 'opening later loads one snapshot without restarting automatic checks');
    await late.page.close();
    console.log('PASS: poll-close start, five-minute interval, 1 a.m. cutoff, suspended tabs, late opening, and manual-only refresh afterward.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
