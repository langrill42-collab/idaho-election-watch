const assert=require('node:assert/strict');
const {chromium}=require(process.env.ELECTION_WATCH_PLAYWRIGHT_PATH || 'playwright');
const origin=process.env.ELECTION_WATCH_URL || 'http://127.0.0.1:8766';
(async()=>{const browser=await chromium.launch({headless:true});try{
 const context=await browser.newContext();const a=await context.newPage(),b=await context.newPage();
 for(const p of [a,b]) {await p.goto(origin);await p.waitForSelector('.projection-card');}
 await b.locator('#detail-panel [data-race="rep15a"]').click();
 for(const [p,reason] of [[a,'Assessment in tab A'],[b,'Assessment in tab B']]) {
  await p.locator('#rating-editor summary').click();await p.selectOption('#rating-bucket','unrated');
  await p.fill('#rating-reason',reason);await p.locator('#rating-form button[type="submit"]').click();
 }
 const saved=await a.evaluate(()=>JSON.parse(localStorage.getItem('idaho-watch-ratings')));
 assert.deepEqual(Object.keys(saved).sort(),['rep15a','sen15']);
 await a.locator('#rating-reset').click();
 const reset=await b.evaluate(()=>JSON.parse(localStorage.getItem('idaho-watch-ratings')));
 assert.deepEqual(Object.keys(reset),['rep15a']);
 await b.reload();await b.waitForSelector('.projection-card');
 assert.match(await b.locator('.override-reason').innerText(),/Assessment in tab B/);
 const data=await (await b.request.get(origin+'/api/data')).json();
 const changed=data.races.find(r=>r.id==='rep15a');changed.candidates[0].id+='-replacement';
 await b.route('**/api/data',route=>route.fulfill({json:data}));
 await b.reload();await b.waitForSelector('.projection-card');
 assert.equal(await b.locator('.override-reason').count(),0);
 assert.match(await b.evaluate(()=>localStorage.getItem('idaho-watch-ratings')),/Assessment in tab B/);
 await b.click('#list-button');await b.selectOption('#rating-filter','override');
 assert.equal(await b.locator('#table-body [data-race="rep15a"]').count(),0);
 console.log('PASS: cross-tab save/reset preserves other races; changed roster invalidates override and filter without deleting assessment');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
