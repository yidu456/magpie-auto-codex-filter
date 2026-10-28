'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createUIFixture} = require('./serve-ui-fixture.cjs');
const {call} = require('../magpie-auto-codex-filter/test-support.cjs');

async function bounded(work, milliseconds, message) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  let fixture, browser, ready = false, failure;
  try {
    fixture = await createUIFixture();
    await bounded(fixture.ready, 15000, 'UI fixture startup timeout'); ready = true;
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
    const page = await context.newPage();
    await page.goto(fixture.origin);
    const run = eval('(' + fs.readFileSync(path.join(__dirname, 'browser-smoke.js'), 'utf8') + ')');
    const screenshots = path.resolve(__dirname, '../.verification/task-4-browser');
    fs.mkdirSync(screenshots, {recursive: true});
    console.log(JSON.stringify(await run(page, {screenshots, only: process.env.UI_SMOKE_CASE}), null, 2));
  } catch (error) { failure = error; }
  finally {
    const cleanup = async work => { try { await work(); } catch (error) { failure ||= error; } };
    await cleanup(async () => { if (browser) await bounded(browser.close(), 3000, 'Browser shutdown timeout'); });
    await cleanup(async () => bounded((async () => {
      if (!ready) return;
      const headers = {'x-console-token': 'ab'.repeat(32)};
      const state = JSON.parse((await call(fixture.origin, '/api/state', {method: 'GET', headers})).body);
      const exit = await call(fixture.origin, '/api/exit', {headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({revision: state.revision})});
      if (exit.status !== 200) throw new Error('UI fixture exit failed: ' + exit.status);
      await bounded(fixture.ended, 3000, 'UI fixture shutdown timeout');
    })(), 5000, 'UI fixture API shutdown timeout'));
    await cleanup(async () => { await fixture?.close(); });
  }
  if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
