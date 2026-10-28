'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createController} = require('../console/controller.cjs');
const {createConfigStore} = require('../console/configuration.cjs');
const {createManagementServer} = require('../console/server.cjs');
const {listen, close} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const directory = path.resolve(__dirname, '../.verification/phase13-task2-browser');
  fs.mkdirSync(directory, {recursive: true});
  const runtime = fs.mkdtempSync(path.join(directory, 'port-consent-'));
  const token = 'ab'.repeat(32), configPath = path.join(runtime, 'fixture-codex.toml');
  let browser, controller, management, release, kills = 0, unsafe = false;
  // All destructive fixture operations below are bound to this explicitly created child.
  const child = spawn(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],
    {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  const upstream = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned port fixture startup timed out')), 10000);
      child.stdout.once('data', data => { clearTimeout(timer); resolve(Number(String(data).trim())); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.ok(Number.isInteger(port) && port > 1024);
    const upstreamOrigin = await listen(upstream);
    const original = '[model_providers.magpie]\nbase_url="' + upstreamOrigin + '/v1"\n';
    fs.writeFileSync(configPath, original);
    const store = createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
    store.save({web: {...store.current.web, authEnabled: true}, settings: {...store.current.settings, configPath, upstream: upstreamOrigin, port}}, 0);
    const owner = Object.freeze({pid: child.pid, name: '<img src=x onerror="globalThis.pwned=1">',
      executable: 'C:/owned fixture/' + 'long-directory/'.repeat(30) + 'node.exe', started: 'fixture-only'});
    const portOwner = {inspect: async p => {
      assert.equal(p, port);
      return {port, owner, canTerminate: !unsafe, reason: unsafe ? 'IDENTITY_UNAVAILABLE' : null};
    }, terminate: async (p, identity) => {
      assert.equal(p, port); assert.equal(identity, owner); assert.equal(identity.pid, child.pid);
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      await new Promise(resolve => { release = resolve; });
      assert.equal(identity.pid, child.pid); kills++;
      child.kill('SIGKILL'); await ended; return {port, released: true};
    }};
    controller = createController({runtime, portOwner});
    const assets = Object.fromEntries([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/app.css', 'app.css', 'text/css']]
      .map(([route, file, type]) => [route, {type, body: fs.readFileSync(path.join(__dirname, '../console/ui', file))}]));
    management = createManagementServer({controller, token, assets}); const origin = await listen(management);
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    const context = await browser.newContext({viewport: {width: 1280, height: 1000}}), page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/#token=' + token);
    await page.locator('#controls').waitFor({state: 'visible'});
    const dialog = page.locator('#port-conflict-dialog');
    const offer = async () => { await page.locator('#enabled').check(); await dialog.waitFor({state: 'visible'}); };
    const gone = () => dialog.waitFor({state: 'hidden'});
    await offer();
    assert.equal(await page.locator('#port-conflict-no').evaluate(el => document.activeElement === el), true);
    assert.ok((await page.locator('#port-conflict-details').textContent()).includes(owner.name));
    assert.ok((await page.locator('#port-conflict-details').textContent()).includes('PID：' + child.pid + '\n'));
    assert.equal(await dialog.locator('img').count(), 0); assert.equal(await page.evaluate(() => globalThis.pwned), undefined);
    assert.equal(await page.locator('#enabled').isChecked(), false);
    const screenshots = [];
    for (const [width, height, size] of [[1280, 1000, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({width, height});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      const screenshot = path.join(directory, 'consent-' + size + '.png'); await page.screenshot({path: screenshot}); screenshots.push(screenshot);
    }
    await page.locator('#port-conflict-no').click(); await gone();
    assert.equal(kills, 0); assert.equal(controller.status().settings.policy.enabled, false);
    await offer(); await page.keyboard.press('Escape'); await gone(); assert.equal(kills, 0);
    await offer();
    await controller.updateWeb({revision: controller.status().revision, web: {port: 19385}});
    await gone(); assert.equal(kills, 0);
    await offer();
    await page.route('**/api/port-conflict', route => route.fulfill({status: 409, contentType: 'application/json', body: '{"error":"stale","code":"PORT_CONFLICT_STALE"}'}));
    await page.locator('#port-conflict-yes').click(); await gone(); assert.equal(kills, 0);
    await page.unroute('**/api/port-conflict');
    await offer();
    await page.route('**/api/port-conflict', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":"expired"}'}));
    await page.locator('#port-conflict-yes').click(); await gone();
    await page.locator('#login').waitFor({state: 'visible'});
    assert.equal(await page.locator('#login-token').isEnabled(), true); assert.equal(await page.locator('#login-submit').isEnabled(), true);
    await page.unroute('**/api/port-conflict');
    await page.locator('#login-token').fill(token); await page.locator('#login-submit').click(); await page.locator('#controls').waitFor({state: 'visible'});
    assert.equal(await page.locator('#enabled').isEnabled(), true); assert.equal(kills, 0);
    unsafe = true; await offer(); assert.equal(await page.locator('#port-conflict-yes').isDisabled(), true);
    assert.ok((await page.locator('#port-conflict-reason').textContent()).includes('IDENTITY_UNAVAILABLE'));
    await page.keyboard.press('Escape'); await gone(); unsafe = false;
    await offer();
    await page.locator('#port-conflict-yes').click();
    await page.waitForFunction(() => document.getElementById('port-conflict-progress').textContent.includes('正在'));
    assert.equal(await page.locator('#port-conflict-yes').isDisabled(), true); assert.equal(await page.locator('#port-conflict-no').isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
    await page.locator('#port-conflict-yes').evaluate(el => { el.click(); el.click(); });
    release(); await gone();
    await page.waitForFunction(() => document.getElementById('connection-state').textContent === '配置已接入');
    assert.equal(kills, 1); assert.equal(controller.status().connected, true); assert.equal(controller.status().settings.policy.enabled, true);
    await controller.disconnect(); assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    // Startup uses display-only inspection and an explicit settings-page action, never an automatic modal.
    await controller.close();
    const saved = JSON.parse(fs.readFileSync(store.filename)); saved.settings.policy.enabled = true;
    fs.writeFileSync(store.filename, JSON.stringify(saved));
    const startupPort = http.createServer(); await new Promise(resolve => startupPort.listen(port, '127.0.0.1', resolve));
    try {
      await close(management);
      controller = createController({runtime, portOwner: {inspect: portOwner.inspect, terminate: () => assert.fail('Startup cannot kill')}});
      await controller.start(); management = createManagementServer({controller, token, assets});
      const startupOrigin = await listen(management); await page.goto(startupOrigin + '/#token=' + token);
      await page.locator('#controls').waitFor({state: 'visible'}); assert.equal(await dialog.isVisible(), false);
      assert.equal(await page.locator('#core-state').textContent(), '待接入'); assert.equal(await page.locator('#enabled').isChecked(), true);
      await page.locator('nav a[data-page=settings]').click(); await page.locator('#resolve-port').click();
      await dialog.waitFor({state: 'visible'}); await page.keyboard.press('Escape'); await gone();
      assert.equal(controller.status().settings.policy.enabled, true); assert.equal(kills, 1);
    } finally { await close(startupPort); }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({yesNoEscape: true, staleRevisionAnd409: true, auth403Relogin: true, unsafeOwner: true,
      pendingDoubleClick: true, startupExplicitAction: true, ownedChildKills: kills, screenshots, pageErrors: errors}, null, 2));
  } finally {
    release?.();
    try { await browser?.close(); }
    finally {
      try { await controller?.close(); }
      finally {
        await close(management); await close(upstream);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await ended;
      }
    }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
