const assert = require('node:assert/strict');
const {chromium} = require(process.env.ELECTION_WATCH_PLAYWRIGHT_PATH || 'playwright');
const url = process.env.ELECTION_WATCH_URL || 'http://127.0.0.1:8877/idaho-election-watch/';

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1500,height:960}});
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({url:request.url(),method:request.method()}));
    await page.goto(url);
    await page.waitForSelector('#table-body tr');
    assert.equal(await page.locator('#table-body tr').count(), 105);
    assert.equal(await page.locator('#table-view').isVisible(), true);
    assert.match(await page.locator('.local-label').innerText(), /Public election watch/);
    await page.locator('#table-body [data-race="sen1"]').click();
    assert.match(await page.locator('#detail-panel h2').innerText(), /District 1 Senate/);
    assert.match(await page.locator('.projection-card').innerText(), /No real contest/);
    assert.equal(await page.locator('#detail-panel').evaluate(panel => panel.lastElementChild.classList.contains('projection-card')), true);
    await page.locator('#map-button').click();
    await page.waitForSelector('.leaflet-interactive');
    assert.equal(await page.locator('.leaflet-interactive').count(), 35);
    await page.locator('#list-button').click();
    await page.locator('#race-notes').fill('Private browser note');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/data/results.json')),
      page.locator('#refresh').click(),
    ]);
    assert.equal(requests.filter(request => request.url.includes('/data/results.json')).length, 2);
    assert.equal(requests.some(request => request.method !== 'GET'), false);
    assert.equal(requests.some(request => request.url.includes('/api/') || request.url.includes('voteidaho.gov')), false);
    await page.reload();
    await page.waitForSelector('#race-notes');
    assert.equal(await page.locator('#race-notes').inputValue(), 'Private browser note');
    const clean = await browser.newContext();
    const fresh = await clean.newPage();
    await fresh.goto(url);
    await fresh.waitForSelector('#race-notes');
    assert.equal(await fresh.locator('#race-notes').inputValue(), '');
    await clean.close();
    for (const category of ['statewide','ada']) {
      await page.locator(`[data-category="${category}"]`).click();
      assert.equal(await page.locator('#table-body tr').count(), 12);
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({path:'/tmp/idaho-pages-mobile.png',fullPage:true});
    assert.deepEqual(errors, []);
    console.log('PASS: project-path assets, list, map, all coverage tabs, snapshot-only refresh, private notes, and mobile layout.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
