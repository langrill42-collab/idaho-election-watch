const assert = require('node:assert/strict');
const engine = require(process.env.ELECTION_WATCH_PLAYWRIGHT_PATH || 'playwright')[process.env.ELECTION_WATCH_BROWSER || 'chromium'];
const url = process.env.ELECTION_WATCH_URL || 'http://127.0.0.1:8877/idaho-election-watch/';

(async () => {
  const browser = await engine.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({url:request.url(),method:request.method()}));
    await page.goto(url);
    await page.waitForSelector('.race-card', {timeout:5000});
    assert.equal(await page.locator('.race-card').count(), 105);
    assert.equal(await page.locator('#table-view').isVisible(), true);
    assert.equal(await page.locator('.race-rail').isVisible(), false);
    assert.equal(await page.locator('#detail-panel').isVisible(), false);
    assert.match(await page.locator('.local-label').innerText(), /Public election watch/);
    await page.locator('#race-cards [data-race="sen1"]').click();
    assert.match(page.url(), /#race=sen1$/);
    assert.equal(await page.locator('#table-view').isVisible(), false);
    assert.match(await page.locator('#detail-panel h2').innerText(), /District 1 Senate/);
    assert.match(await page.locator('.projection-card').innerText(), /No real contest/);
    assert.equal(await page.locator('#detail-panel').evaluate(panel => panel.lastElementChild.classList.contains('projection-card')), true);
    await page.locator('[data-back-races]').click();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    await page.locator('#map-button').click();
    await page.waitForSelector('.leaflet-interactive');
    assert.equal(await page.locator('.leaflet-interactive').count(), 35);
    await page.screenshot({path:'/tmp/idaho-phone-map.png'});
    await page.locator('.leaflet-interactive').first().dispatchEvent('click');
    await page.waitForFunction(() => document.body.classList.contains('race-open'));
    await page.locator('[data-back-races]').click();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    assert.equal(await page.locator('#map-view').isVisible(), true);
    await page.locator('#list-button').click();
    await page.locator('#race-cards [data-race="sen1"]').click();
    await page.locator('#race-notes').fill('Private browser note');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/data/results.json')),
      page.locator('[data-detail-refresh]').click(),
    ]);
    assert.equal(requests.filter(request => request.url.includes('/data/results.json')).length, 2);
    assert.equal(requests.some(request => request.method !== 'GET'), false);
    assert.equal(requests.some(request => request.url.includes('/api/') || request.url.includes('voteidaho.gov')), false);
    await page.reload();
    await page.waitForSelector('#race-notes');
    assert.equal(await page.locator('#race-notes').inputValue(), 'Private browser note');
    const clean = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const fresh = await clean.newPage();
    await fresh.goto(url + '#race=sen1');
    await fresh.waitForSelector('#race-notes');
    assert.equal(await fresh.locator('#race-notes').inputValue(), '');
    await fresh.locator('#detail-panel [data-race="rep1a"]').click();
    await fresh.locator('[data-back-races]').click();
    await fresh.waitForFunction(() => !document.body.classList.contains('race-open'));
    assert.equal(await fresh.locator('.race-card').count(), 105);
    await clean.close();
    await page.locator('[data-back-races]').click();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    for (const category of ['statewide','ada']) {
      await page.locator(`[data-category="${category}"]`).click();
      assert.equal(await page.locator('.race-card').count(), 12);
    }
    await page.locator('[data-category="legislature"]').click();
    await page.locator('[data-seat="senate"]').click();
    assert.equal(await page.locator('.race-card').count(), 35);
    await page.locator('#search').fill('District 15');
    assert.equal(await page.locator('.race-card').count(), 1);
    await page.locator('#race-cards [data-race="sen15"]').click();
    await page.goBack();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    assert.equal(await page.locator('#search').inputValue(), 'District 15');
    assert.equal(await page.locator('.race-card').count(), 1);
    await page.locator('#search').fill('');
    await page.locator('[data-seat="all"]').click();
    await page.locator('#filters-toggle').click();
    await page.selectOption('#rating-filter','toss-up');
    assert.ok(await page.locator('.race-card').count() > 0);
    await page.selectOption('#rating-filter','all');
    await page.locator('#filters-toggle').click();
    await page.locator('#race-cards [data-race="sen20"]').scrollIntoViewIfNeeded();
    const listScroll = await page.evaluate(() => window.scrollY);
    assert.ok(listScroll > 1000);
    await page.locator('#race-cards [data-race="sen20"]').click();
    await page.locator('[data-back-races]').click();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    await page.waitForFunction(y => Math.abs(window.scrollY-y) < 10, listScroll);
    await page.locator('#search').fill('District 15');
    await page.locator('#race-cards [data-race="sen15"]').click();
    await page.locator('#rating-editor summary').click();
    await page.selectOption('#rating-bucket','unrated');
    await page.fill('#rating-reason','Phone draft survives refresh');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/data/results.json')),
      page.locator('[data-detail-refresh]').click(),
    ]);
    assert.equal(await page.locator('#rating-reason').inputValue(), 'Phone draft survives refresh');
    await page.locator('[data-show-map]').click();
    await page.waitForFunction(() => !document.body.classList.contains('race-open'));
    assert.equal(await page.locator('#map-view').isVisible(), true);
    await page.locator('[data-category="statewide"]').click();
    await page.selectOption('#map-race-select','gov');
    assert.equal(await page.locator('#map-race-select').inputValue(), 'gov');
    await page.locator('#list-button').click();
    await page.locator('[data-category="legislature"]').click();
    for (const width of [320,390,768,1500]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => window.scrollTo(0,0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({path:'/tmp/idaho-phone-list.png'});
    await page.locator('#search').fill('District 15');
    await page.locator('#race-cards [data-race="sen15"]').click();
    await page.screenshot({path:'/tmp/idaho-phone-detail.png'});
    await page.locator('.finance-table').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/idaho-phone-finance.png'});
    const snapshot = await (await context.request.get(url + 'data/results.json')).json();
    const reporting = snapshot.races.find(r=>r.id==='sen15');
    reporting.status='reporting'; reporting.votes=200; reporting.precinctsReporting=1;
    reporting.candidates[0].votes=120; reporting.candidates[1].votes=80;
    const live = await context.newPage();
    let attempts=0;
    await live.route('**/data/results.json*',route=>++attempts===1
      ? route.fulfill({status:503,json:{error:'Snapshot temporarily unavailable'}})
      : route.fulfill({json:snapshot}));
    await live.goto(url);
    await live.waitForSelector('#race-cards [data-retry]');
    await live.locator('#race-cards [data-retry]').click();
    await live.waitForSelector('.race-card');
    const liveCard=live.locator('.race-card').filter({has:live.locator('[data-race="sen15"]')});
    assert.match(await liveCard.innerText(), /Unofficial · 200 votes/);
    assert.match(await liveCard.innerText(), /60\.0%/);
    assert.match(await liveCard.innerText(), /40\.0%/);
    assert.match(await liveCard.innerText(), /Pre-election/);
    await live.close();
    assert.deepEqual(errors, []);
    console.log('PASS: phone cards, detail/back/deep links, filters, map, reporting and retry states, snapshot-only refresh, private notes/drafts, and responsive widths.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
