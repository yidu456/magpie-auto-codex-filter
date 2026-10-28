'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const {listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');

async function runHarness({startupTimeout = false, browserCloseFails = false, exitFails = false, browserCloseHangs = false, apiHangs = false} = {}) {
  const primary = new Error(startupTimeout ? 'UI fixture startup timeout' : 'original browser failure');
  let terminated = false, browserClosed = false, apiCalls = 0;
  const owned = {origin: 'http://127.0.0.1:1234', runtime: '/ui-fixture-test',
    ready: startupTimeout ? new Promise(() => {}) : Promise.resolve(), ended: Promise.resolve(),
    close: async () => { terminated = true; }};
  const chromium = {launch: async () => ({
    newContext: async () => { throw primary; },
    close: async () => { browserClosed = true; if (browserCloseFails) throw new Error('browser close failed'); if (browserCloseHangs) await new Promise(() => {}); }
  })};
  const module = {exports: {}};
  const imports = name => {
    if (name === './serve-ui-fixture.cjs') return {createUIFixture: async () => owned};
    if (name === 'playwright') return {chromium};
    if (name.includes('test-support.cjs')) return {call: async (_, route) => {
      apiCalls++;
      if (apiHangs) await new Promise(() => {});
      if (startupTimeout || exitFails && route === '/api/exit') throw new Error('ECONNREFUSED');
      return {body: '{"revision":0}', status: 200};
    }};
    return require(name);
  };
  const context = {require: imports, module, __dirname, process: {env: {}, execPath: process.execPath, stderr: {write() {}}, exitCode: 0},
    console: {log() {}}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), clearTimeout, Buffer};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'run-browser-smoke.cjs'), 'utf8'), context);
  let failure;
  try { await module.exports.main(); } catch (error) { failure = error; }
  return {failure, primary, terminated, browserClosed, apiCalls};
}

test('startup timeout still terminates owned fixture without masking the timeout', async () => {
  const result = await runHarness({startupTimeout: true});
  assert.match(result.failure.message, /UI fixture startup timeout/);
  assert.equal(result.terminated, true);
  assert.equal(result.apiCalls, 0, 'Do not call an unready listener during timeout cleanup');
});

test('failed browser shutdown cannot skip fixture termination or mask primary failure', async () => {
  const result = await runHarness({browserCloseFails: true});
  assert.equal(result.failure, result.primary);
  assert.equal(result.browserClosed, true);
  assert.equal(result.terminated, true);
});

test('failed exit API cannot skip fixture termination or mask primary failure', async () => {
  const result = await runHarness({exitFails: true});
  assert.equal(result.failure, result.primary);
  assert.equal(result.apiCalls, 2);
  assert.equal(result.terminated, true);
});

test('hanging browser close is bounded and still terminates the fixture', async () => {
  const result = await runHarness({browserCloseHangs: true});
  assert.equal(result.failure, result.primary);
  assert.equal(result.terminated, true);
});

test('hanging shutdown API is bounded and still terminates the fixture', {timeout: 1000}, async () => {
  const result = await runHarness({apiHangs: true});
  assert.equal(result.failure, result.primary);
  assert.equal(result.terminated, true);
});

test('actual fixture cleanup kills only its own console and closes its own mock upstream', async t => {
  const {createUIFixture} = require('./serve-ui-fixture.cjs');
  const unrelated = http.createServer((req, res) => res.end('unrelated'));
  const unrelatedOrigin = await listen(unrelated); t.after(() => close(unrelated));
  const fixture = await createUIFixture(); t.after(() => fixture.close());
  await fixture.ready;
  const pid = fixture.child.pid;
  assert.equal((await call(fixture.origin, '/api/state', {method: 'GET', headers: {'x-console-token': 'ab'.repeat(32)}})).status, 200);
  await fixture.close(); await fixture.close();
  assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/i);
  assert.equal(fixture.upstream.listening, false);
  await assert.rejects(call(fixture.origin, '/', {method: 'GET'}), /ECONNREFUSED/);
  assert.equal((await call(unrelatedOrigin, '/', {method: 'GET'})).body, 'unrelated');
  assert.match(fs.readFileSync(path.join(fixture.runtime, 'mock-codex.toml'), 'utf8'), /model_providers.mock/);
});
