'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createUIFixture} = require('./serve-ui-fixture.cjs');
const {call, sample} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture = await createUIFixture({authEnabled: false});
  const children = [fixture.child], requests = [], errors = [];
  let browser, failure, upstreamCanceled = false, hits = 0, mode = 'protected';
  const wait = async fn => {
    const deadline = Date.now() + 5000;
    while (!await fn()) { assert.ok(Date.now() < deadline, 'Gateway browser fixture deadline'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const headers = {'content-type': 'application/json'};
  const state = async () => JSON.parse((await call(fixture.origin, '/api/state', {method: 'GET'})).body);
  const post = async (route, value) => {
    const response = await call(fixture.origin, route, {headers, body: JSON.stringify({revision: (await state()).revision, ...value})});
    assert.equal(response.status, 200, response.body); return JSON.parse(response.body);
  };
  const exited = child => child.exitCode !== null || child.signalCode !== null;
  const launch = () => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../console/main.cjs'), '--runtime', fixture.runtime, '--no-open'],
      {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.output = ''; child.stdout.on('data', chunk => { child.output += chunk; }); child.stderr.on('data', chunk => { child.output += chunk; });
    children.push(child); return child;
  };
  try {
    await fixture.ready;
    const initial = await state(), configPath = initial.settings.configPath, original = fs.readFileSync(configPath, 'utf8');
    fixture.upstream.removeAllListeners('request');
    fixture.upstream.on('request', (req, res) => {
      hits++; req.resume(); res.on('close', () => { upstreamCanceled = true; });
      req.on('end', () => {
        if (mode === 'backoff') { res.writeHead(429, {'content-type': 'application/json', 'retry-after': '1'}); res.end('{"error":{"code":"rate_limit_exceeded"}}'); }
        else { res.writeHead(200, {'content-type': 'text/event-stream'}); res.write('event: response.created\ndata: {"type":"response.created"}\n\n'); }
      });
    });
    browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome'});
    const page = await browser.newPage({viewport: {width: 1280, height: 1000}}); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.origin); await page.locator('#controls').waitFor({state: 'visible'});
    const settled = () => page.waitForFunction(() => !document.getElementById('gateway').disabled);
    assert.equal(await page.locator('#gateway').isChecked(), false); assert.equal(await page.locator('#enabled').isChecked(), false);
    await page.getByRole('switch', {name: '核心过滤总开关'}).focus(); await page.keyboard.press('Space'); await settled();
    assert.equal((await state()).connected, false); assert.equal(await page.locator('#core-state').textContent(), '未生效');
    await page.getByRole('switch', {name: '网关接入开关'}).check(); await settled();
    assert.equal((await state()).connected, true); assert.equal((await state()).settings.policy.enabled, true);
    await page.locator('#enabled').uncheck(); await settled();
    assert.equal((await state()).connected, true); assert.ok((await page.locator('#core-description').textContent()).includes('直通'));
    await page.locator('#enabled').check(); await settled();
    const duplicate = launch(); await wait(() => exited(duplicate)); assert.equal(duplicate.exitCode, 0, duplicate.output);
    assert.equal((await state()).connected, true); assert.equal((await state()).settings.policy.enabled, true);
    for (const delivery of ['upload', 'full', 'protected', 'direct', 'backoff', 'bypass']) {
      mode = delivery; hits = 0; upstreamCanceled = false;
      if (!(await state()).connected) await post('/api/connect');
      const current = await state();
      await post('/api/settings', {settings: {...current.settings, policy: {...current.settings.policy,
        enabled: delivery !== 'bypass', bufferResponse: delivery === 'full', protectStreamStart: delivery === 'protected'}}});
      await page.reload(); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
      const req = http.request('http://127.0.0.1:' + fixture.filterPort + '/v1/responses', {method: 'POST',
        headers: delivery === 'upload' ? {'content-length': 1000} : {}}, res => { res.on('error', () => {}); res.resume(); });
      req.on('error', () => {}); requests.push(req);
      const canceled = new Promise(resolve => req.once('close', resolve));
      if (delivery === 'upload') req.write('{'); else req.end(JSON.stringify(sample));
      await wait(async () => (await state()).stats.activeRequests === 1 && (delivery === 'upload' || hits === 1));
      if (delivery === 'backoff') await wait(async () => (await state()).metrics.active[0]?.phase === 'backoff');
      const attached = fs.readFileSync(configPath, 'utf8');
      page.once('dialog', dialog => { assert.ok(dialog.message().includes('中断')); dialog.dismiss(); });
      await page.locator('#gateway').click(); await settled();
      assert.equal(await page.locator('#gateway').isChecked(), true); assert.equal((await state()).stats.activeRequests, 1);
      assert.equal(fs.readFileSync(configPath, 'utf8'), attached);
      if (!['upload', 'backoff'].includes(delivery)) assert.equal(upstreamCanceled, false);
      page.once('dialog', dialog => dialog.accept());
      const before = Date.now(); await page.locator('#gateway').uncheck(); await settled(); await canceled;
      assert.ok(Date.now() - before < 3000, 'Disconnect cannot await natural completion');
      const off = await state(); assert.equal(off.connected, false); assert.equal(off.stats.activeRequests, 0);
      assert.deepEqual(off.metrics.active, []); assert.equal(off.settings.policy.enabled, delivery !== 'bypass');
      assert.equal(fs.readFileSync(configPath, 'utf8'), original);
      if (!['upload', 'backoff'].includes(delivery)) await wait(() => upstreamCanceled);
      if (delivery === 'backoff') { await new Promise(resolve => setTimeout(resolve, 1150)); assert.equal(hits, 1); }
    }
    const file = path.join(fixture.runtime, 'MagpieFilter.config.json'), config = JSON.parse(fs.readFileSync(file));
    await post('/api/exit'); await wait(() => exited(fixture.child));
    config.settings.policy.enabled = true;
    const bytes = '\uFEFF' + JSON.stringify(config, null, 2).replace(/\n/g, '\r\n'); fs.writeFileSync(file, bytes);
    const fresh = launch(); await wait(() => { try { return JSON.parse(fs.readFileSync(path.join(fixture.runtime, 'service.json'))).pid === fresh.pid; } catch { return false; } });
    await page.reload(); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
    assert.equal((await state()).connected, false); assert.equal((await state()).settings.policy.enabled, false);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes); assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    for (const [width, height] of [[1280, 1000], [390, 844]]) {
      await page.setViewportSize({width, height});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByRole('switch', {name: '网关接入开关'}).isVisible(), true);
    }
    await post('/api/exit'); await wait(() => exited(fresh)); assert.equal(fresh.exitCode, 0, fresh.output);
    assert.deepEqual(errors, []);
    const result = {fourStates: true, coreKeyboard: true, duplicatePreservesLive: true, freshOldEnabledWebOnly: true,
      sixHungModesForceNoYes: true, upstreamCanceled: true, noBackoffReplay: true, exactRestore: true, desktopMobile: true, pageErrors: errors};
    console.log(JSON.stringify(result)); return result;
  } catch (error) { failure = error; }
  finally {
    for (const request of requests) request.destroy();
    const cleanup = async fn => { try { await fn(); } catch (error) { failure ||= error; } };
    await cleanup(async () => { if (browser) await browser.close(); });
    await cleanup(async () => { if (children.some(child => !exited(child))) { await post('/api/disconnect'); await post('/api/exit'); } });
    for (const child of children) if (!exited(child)) { child.kill('SIGKILL'); await cleanup(() => wait(() => exited(child))); }
    await cleanup(() => fixture.close());
  }
  if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {main};
