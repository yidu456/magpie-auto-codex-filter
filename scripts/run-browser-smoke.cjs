'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {call} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const child = spawn(process.execPath, [path.join(__dirname, 'serve-ui-fixture.cjs')], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const ended = once(child, 'exit');
  let fixture, browser;
  try {
    fixture = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('UI fixture startup timeout')), 15000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('UI fixture exited: ' + code)); });
      child.stderr.on('data', data => process.stderr.write(data));
      child.stdout.on('data', data => {
        output += data;
        for (const line of output.split(/\r?\n/)) {
          if (!line.startsWith('{')) continue;
          try { const value = JSON.parse(line); if (value.origin && value.runtime) fixture = value; } catch {}
        }
        if (fixture && output.includes('Console ready at ')) { clearTimeout(timeout); resolve(fixture); }
      });
    });
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
    const page = await context.newPage();
    await page.goto(fixture.origin);
    const run = eval('(' + fs.readFileSync(path.join(__dirname, 'browser-smoke.js'), 'utf8') + ')');
    const screenshots = path.resolve(__dirname, '../.verification/task-4-browser');
    fs.mkdirSync(screenshots, {recursive: true});
    console.log(JSON.stringify(await run(page, {screenshots, only: process.env.UI_SMOKE_CASE}), null, 2));
  } finally {
    await browser?.close();
    if (fixture) {
      const headers = {'x-console-token': 'ab'.repeat(32)};
      const state = JSON.parse((await call(fixture.origin, '/api/state', {method: 'GET', headers})).body);
      await call(fixture.origin, '/api/exit', {headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({revision: state.revision})});
      await ended;
    } else child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
