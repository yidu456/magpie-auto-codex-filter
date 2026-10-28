'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const http = require('node:http');
const {createUIFixture} = require('./serve-ui-fixture.cjs');
const {call, listen, close} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main({executable} = {}) {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture = await createUIFixture({executable, authEnabled: false});
  const children = [fixture.child], errors = [], requests = [];
  let browser, record, page, failure;
  const wait = async fn => {
    const end = Date.now() + 15000;
    while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error('Optional auth fixture timed out');
  };
  const readRecord = () => { try { return JSON.parse(fs.readFileSync(path.join(fixture.runtime, 'service.json'))); } catch { return null; } };
  const headers = () => ({'content-type': 'application/json', ...(record?.authEnabled ? {'x-console-token': record.token} : {})});
  const state = async () => JSON.parse((await call(fixture.origin, '/api/state', {method: 'GET', headers: headers()})).body);
  const launch = () => {
    const child = spawn(executable || process.execPath, [...(executable ? [] : [path.resolve(__dirname, '../console/main.cjs')]),
      '--runtime', fixture.runtime, '--no-open'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.output = ''; child.stdout.on('data', data => { child.output += data; }); child.stderr.on('data', data => { child.output += data; });
    children.push(child); return child;
  };
  const ended = child => child.exitCode !== null || child.signalCode !== null;
  const duplicate = async () => { const child = launch(); await wait(() => ended(child)); assert.equal(child.exitCode, 0, child.output); };
  const restart = async child => {
    // Chromium keeps speculative sockets open; close its pool before exercising process exit.
    await browser.close(); browser = null;
    const result = await call(fixture.origin, '/api/exit', {headers: headers(), body: JSON.stringify({revision: (await state()).revision})});
    assert.equal(result.status, 200, result.body); await wait(() => ended(child)); assert.equal(child.exitCode, 0, child.output);
    record = null; const next = launch(); record = await wait(readRecord);
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    page = await browser.newPage({viewport: {width: 1280, height: 1000}}); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message)); return next;
  };
  const fourPages = async authRequired => {
    for (const name of ['dashboard', 'settings', 'records', 'help']) {
      await page.goto(fixture.origin + (name === 'dashboard' ? '/' : '/?page=' + name));
      await page.locator('#controls').waitFor({state: 'visible'}); await page.locator('#page-' + name).waitFor({state: 'visible'});
      assert.equal(await page.locator('#login').isHidden(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(JSON.parse((await call(fixture.origin, '/api/auth', {method: 'GET'})).body), {authRequired});
    }
  };
  const saveAuth = async (enabled, token) => {
    await page.goto(fixture.origin + '/?page=settings'); await page.locator('#controls').waitFor({state: 'visible'});
    if (token) { await page.locator('#web-auth-enabled').check(); await page.locator('#web-token').fill(token); }
    await page.locator('#web-auth-enabled').setChecked(enabled);
    await page.locator('#save-web').click();
    await page.waitForFunction(() => document.getElementById('web-hint').textContent.includes('重启'));
    await page.waitForFunction(() => !document.getElementById('save-web').disabled);
    assert.equal((await state()).web.authEnabled, enabled);
  };
  const occupied = http.createServer((req, res) => res.end('owned fixture occupant'));
  try {
    await fixture.ready; record = await wait(readRecord);
    assert.equal(record.authEnabled, false); assert.equal(Object.hasOwn(record, 'token'), false);
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    page = await browser.newPage({viewport: {width: 1280, height: 1000}}); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.headers()); });
    await page.addInitScript(() => sessionStorage.setItem('console-token', 'stale-token'));
    await page.goto(fixture.origin + '/?page=help#token=' + 'ab'.repeat(32));
    await page.locator('#controls').waitFor({state: 'visible'});
    assert.equal(new URL(page.url()).hash, ''); assert.equal(await page.evaluate(() => sessionStorage.getItem('console-token')), null);
    assert.equal(await page.locator('#web-token').isHidden(), true);
    await fourPages(false); await page.setViewportSize({width: 390, height: 844}); await fourPages(false);
    assert.equal(requests.some(headers => headers['x-console-token']), false, 'Off mode sends no management credential');
    await page.route('**/api/state', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":"Untrusted request origin or host."}'}));
    await page.reload(); await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Untrusted'));
    assert.equal(await page.locator('#login').isHidden(), true); await page.unroute('**/api/state');
    await page.reload(); await page.locator('#controls').waitFor({state: 'visible'});
    // Consent remains mandatory without a token. This listener belongs to the fixture parent and is never terminated.
    const occupiedOrigin = await listen(occupied); let current = await state();
    const saved = await call(fixture.origin, '/api/settings', {headers: headers(), body: JSON.stringify({revision: current.revision,
      settings: {...current.settings, port: Number(new URL(occupiedOrigin).port)}})});
    assert.equal(saved.status, 200, saved.body);
    await page.goto(fixture.origin + '/'); await page.locator('#controls').waitFor({state: 'visible'});
    await page.locator('#enabled').check(); await page.locator('#port-conflict-dialog').waitFor({state: 'visible'});
    assert.equal(await page.locator('#port-conflict-no').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await page.locator('#port-conflict-dialog').waitFor({state: 'hidden'});
    assert.equal((await state()).settings.policy.enabled, false);
    assert.equal((await call(occupiedOrigin, '/', {method: 'GET'})).body, 'owned fixture occupant');
    await saveAuth(true, 'cd'.repeat(32)); assert.equal((await state()).web.activeAuthEnabled, false); await duplicate();
    let child = await restart(fixture.child); assert.equal(record.authEnabled, true); assert.equal(record.token, 'cd'.repeat(32));
    assert.equal((await call(fixture.origin, '/api/state', {method: 'GET'})).status, 403);
    // New context has no stale fixture initialization; protected flow supports manual and fragment login.
    await page.goto(fixture.origin + '/'); await page.locator('#login').waitFor({state: 'visible'});
    await page.locator('#login-token').fill('ab'.repeat(32)); await page.locator('#login-submit').click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('令牌无效'));
    await page.locator('#login-token').fill(record.token); await page.locator('#login-submit').click(); await page.locator('#controls').waitFor({state: 'visible'});
    await fourPages(true); await page.setViewportSize({width: 390, height: 844}); await fourPages(true);
    await page.goto(fixture.origin + '/?page=settings#token=' + record.token); await page.locator('#controls').waitFor({state: 'visible'});
    assert.equal(new URL(page.url()).hash, '');
    await saveAuth(false, 'ef'.repeat(32)); assert.equal((await state()).web.activeAuthEnabled, true);
    assert.equal((await call(fixture.origin, '/api/state', {method: 'GET'})).status, 403);
    assert.equal((await call(fixture.origin, '/api/state', {method: 'GET', headers: {'x-console-token': 'ef'.repeat(32)}})).status, 403);
    await duplicate(); child = await restart(child);
    assert.equal(record.authEnabled, false); assert.equal(Object.hasOwn(record, 'token'), false);
    await fourPages(false); assert.equal(await page.evaluate(() => sessionStorage.getItem('console-token')), null); await duplicate();
    current = await state(); assert.equal(current.web.restartRequired, false); assert.doesNotMatch(JSON.stringify(current), /(?:ab|cd|ef){32}/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({optionalAuth: true, defaultOffFourPagesDesktopMobile: true, noOffCredential: true, off403NoLoginLoop: true,
      oneUseConsentOff: true, enableDisableRealRestarts: true, protectedLoginFourPages: true, pendingRotationSingleton: true, pageErrors: errors}));
  } catch (error) { failure = error; }
  finally {
    const cleanup = async work => { try { await work(); } catch (error) { failure ||= error; } };
    await cleanup(async () => { if (browser) { let timer; try { await Promise.race([browser.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Auth browser shutdown timeout')), 5000);
    })]); } finally { clearTimeout(timer); } } });
    await cleanup(async () => {
      if (record) { const current = await state().catch(() => null); if (current) await call(fixture.origin, '/api/exit',
        {headers: headers(), body: JSON.stringify({revision: current.revision})}); }
    });
    for (const child of children) await cleanup(async () => { if (!ended(child)) { child.kill('SIGKILL'); await wait(() => ended(child)); } });
    await cleanup(() => fixture.close()); await cleanup(() => close(occupied));
  }
  if (failure) throw failure;
}
if (require.main === module) main({executable: process.argv[2]}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
