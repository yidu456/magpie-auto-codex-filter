'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createUIFixture} = require('./serve-ui-fixture.cjs');
const exited = child => child.exitCode !== null || child.signalCode !== null;

async function main({executable, browserConsent = false, authEnabled = true} = {}) {
  let fixture, browser;
  // This child owns the only ephemeral port offered for confirmation; never select an existing listener.
  const child = spawn(process.execPath, ['-e', "require('node:http').createServer((q,s)=>s.end('owned fixture')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})"],
    {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  const bounded = async (work, ms = 90000) => {
    let timer;
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Consent fixture deadline')), ms); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const port = await bounded(new Promise((resolve, reject) => {
      child.stdout.once('data', data => resolve(Number(String(data).trim()))); child.once('error', reject);
    }), 10000);
    assert.ok(Number.isInteger(port) && port > 1024);
    fixture = await createUIFixture({executable, authEnabled}); await bounded(fixture.ready, 15000);
    const headers = {'content-type': 'application/json', ...(authEnabled ? {'x-console-token': 'ab'.repeat(32)} : {})};
    const request = async (route, body) => {
      const response = await fetch(fixture.origin + route, {method: body ? 'POST' : 'GET', headers,
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(90000)});
      return {status: response.status, state: await response.json()};
    };
    const state = async () => (await request('/api/state')).state;
    const original = fs.readFileSync((await state()).settings.configPath, 'utf8');
    let page;
    if (browserConsent) {
      const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
      browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
      page = await browser.newPage(); page.setDefaultTimeout(90000);
      await page.goto(fixture.origin + '/' + (authEnabled ? '#token=' + 'ab'.repeat(32) : ''));
      await page.locator('#controls').waitFor({state: 'visible'});
      await page.locator('nav a[data-page=settings]').click();
      await page.locator('#port').fill(String(port)); await page.locator('#save-connection').click();
      await page.waitForFunction(port => document.getElementById('port').value === String(port) && !document.getElementById('port').disabled, port);
      // Wait for the save request, not just the input draft.
      await bounded((async () => { while ((await state()).settings.port !== port) await new Promise(resolve => setTimeout(resolve, 50)); })());
      await page.locator('nav a[data-page=dashboard]').click();
    }
    const offer = async () => {
      if (page) { await page.locator('#gateway').check(); await page.locator('#port-conflict-dialog').waitFor({state: 'visible'}); }
      else {
        const current = await state();
        if (current.settings.port !== port) assert.equal((await request('/api/settings', {revision: current.revision, settings: {...current.settings, port}})).status, 200);
        assert.equal((await request('/api/connect', {revision: (await state()).revision})).status, 409);
      }
      const current = await state(), conflict = current.portConflict;
      assert.equal(current.connected, false); assert.equal(conflict?.port, port);
      // Abort before consent if native inspection identifies anything but the explicitly tracked fixture.
      assert.equal(conflict.owner?.pid, child.pid); assert.ok(conflict.challenge); assert.equal(exited(child), false);
      if (page) {
        assert.ok((await page.locator('#port-conflict-details').textContent()).includes('PID：' + child.pid));
        assert.equal(await page.locator('#port-conflict-no').evaluate(el => el === document.activeElement), true);
      }
      return current;
    };
    let current = await offer();
    const resolve = confirm => request('/api/port-conflict', {revision: current.revision, challenge: current.portConflict.challenge, confirm});
    if (page) { await page.locator('#port-conflict-no').click(); await page.locator('#port-conflict-dialog').waitFor({state: 'hidden'}); }
    else assert.equal((await resolve(false)).status, 200);
    assert.equal(exited(child), false);
    assert.equal(await (await fetch('http://127.0.0.1:' + port, {signal: AbortSignal.timeout(5000)})).text(), 'owned fixture');
    assert.equal((await state()).settings.policy.enabled, false);
    assert.equal(fs.readFileSync((await state()).settings.configPath, 'utf8'), original);
    current = await offer();
    const canTerminate = process.platform !== 'darwin' && (process.platform !== 'linux' || process.getuid() !== 0);
    assert.equal(current.portConflict.canTerminate, canTerminate);
    if (canTerminate) {
      if (page) { await page.locator('#port-conflict-yes').click(); await page.locator('#port-conflict-dialog').waitFor({state: 'hidden'}); }
      else { const confirmed = await resolve(true); assert.equal(confirmed.status, 200, JSON.stringify(confirmed.state)); }
      await bounded(ended); assert.equal(exited(child), true);
    } else {
      if (page) {
        assert.equal(await page.locator('#port-conflict-yes').isDisabled(), true);
        await page.locator('#port-conflict-no').click(); await page.locator('#port-conflict-dialog').waitFor({state: 'hidden'});
      } else assert.equal((await resolve(false)).status, 200);
      assert.equal(exited(child), false);
      // Display-only platforms require the user to quit the owner; simulate that only on our own child.
      child.kill('SIGKILL'); await bounded(ended, 5000);
      const latest = await state();
      assert.equal((await request('/api/connect', {revision: latest.revision})).status, 200);
    }
    current = await state(); assert.equal(current.connected, true); assert.equal(current.settings.policy.enabled, false);
    assert.equal((await request('/api/disconnect', {revision: current.revision})).status, 200);
    assert.equal(fs.readFileSync(current.settings.configPath, 'utf8'), original);
    current = await state(); assert.equal((await request('/api/exit', {revision: current.revision})).status, 200);
    await bounded(fixture.ended, 5000);
    const result = {productionLauncher: true, executable: executable || 'source launcher', browserConsent, cancelPreservesOwner: true,
      confirmedTermination: canTerminate, displayOnlyManualQuit: !canTerminate, exactRestore: true, ownedPid: child.pid};
    console.log(JSON.stringify(result)); return result;
  } finally {
    try { if (browser) await bounded(browser.close(), 5000); }
    finally {
      try { await fixture?.close(); }
      finally { if (!exited(child)) child.kill('SIGKILL'); await bounded(ended, 5000); }
    }
  }
}
if (require.main === module) main({executable: process.argv[2], browserConsent: process.argv.includes('--browser')})
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
