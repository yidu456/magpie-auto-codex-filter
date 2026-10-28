'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const http = require('node:http');
const vm = require('node:vm');
const {fixture, call, listen, close} = require('../magpie-auto-codex-filter/test-support.cjs');
const {createRecorder} = require('./metrics.cjs');

const verifierContext = {module: {exports: {}}, __dirname, require, process, URL, Buffer};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  + '\nmodule.exports = verifyRunning;', verifierContext);
const verifyRunning = verifierContext.module.exports;

async function portableFixture(t) {
  const runtime = fixture(t), reservation = http.createServer();
  const port = Number(new URL(await listen(reservation)).port); await close(reservation);
  const store = require('./configuration.cjs').createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
  store.save({web: {...store.current.web, port}}, 0);
  return runtime;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(40); }
  throw new Error('Timed out waiting for console lifecycle.');
}
function start(runtime) {
  const child = spawn(process.execPath, [path.join(__dirname, 'main.cjs'), '--runtime', runtime, '--no-open'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  child.output = ''; child.stdout.on('data', data => { child.output += data; }); child.stderr.on('data', data => { child.output += data; });
  return child;
}
function readRecord(runtime) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json'), 'utf8'));
    return {...record, token: config.web.token};
  } catch { return null; }
}
async function quit(record) {
  const headers = {'x-console-token': record.token, 'content-type': 'application/json'};
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
  return call(record.origin, '/api/exit', {headers, body: JSON.stringify({revision: state.revision})});
}

test('singleton verifier accepts saturated bounded metrics and log metadata', async t => {
  let now = new Date(2026, 9, 28, 9).getTime();
  const recorder = createRecorder({now: () => now}), max = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 1200; i++) {
    if (i < 180) now += 60000;
    const requestId = String(i).padStart(100, 'x');
    recorder.observe('request-started', {requestId, enabled: true, policyRevision: max,
      model: (String(i) + '"'.repeat(120)).slice(0, 120), streaming: true});
    recorder.observe('forwarded', {requestId, status: 599, ttfbMs: max});
    recorder.observe('response-usage', {requestId, usage: {input_tokens: max, output_tokens: max,
      total_tokens: max, input_tokens_details: {cached_tokens: max}}});
    for (const kind of ['resource', 'rateLimit', 'transport', 'availability', 'local', 'other']) {
      recorder.observe('retry-scheduled', {requestId, delayMs: max});
      recorder.observe('retry-dispatched', {requestId, kind});
    }
    recorder.observe('http-error', {requestId, errorCode: String(i).padStart(160, 'e'), kind: 'availability'});
    if (i < 200) recorder.observe('request-finished', {requestId, outcome: 'success', durationMs: max});
  }
  const metrics = recorder.snapshot();
  assert.equal(metrics.recent.length, 200); assert.equal(metrics.active.length, 1000);
  assert.equal(metrics.series.length, 180);
  const controller = require('./controller.cjs').createController({runtime: fixture(t)});
  t.after(() => controller.close());
  const application = {service: 'magpie-filter-console-v1', pid: process.pid, instance: 'ab'.repeat(16)};
  // Include all allowed log fields at their escaped-string bounds, not just today's event shapes.
  const logRow = {id: max, time: new Date(now).toISOString(), event: 'request-metadata'};
  for (const key of ['requestId', 'policyRevision', 'cleanup', 'enabled', 'state', 'handler', 'kind', 'errorCode',
    'code', 'retry', 'retries', 'delayMs', 'durationMs', 'outcome', 'phase', 'elapsedMs', 'removed', 'removedItemIds', 'status']) {
    logRow[key] = ['errorCode', 'code'].includes(key) ? 'e'.repeat(160) : '"'.repeat(160);
  }
  const state = {...controller.status(), metrics, application, events: Array.from({length: 200}, () => ({...logRow})),
    activePolicies: metrics.active.map(({requestId, policyRevision}) => ({requestId, policyRevision}))};
  t.diagnostic('Bounded state characters: ' + JSON.stringify(state).length + '; metrics: ' + JSON.stringify(metrics).length);
  assert.ok(JSON.stringify(state).length > 2 * 1024 * 1024);
  const token = 'cd'.repeat(32), server = require('./server.cjs').createManagementServer({token, controller: {status: () => state}});
  t.after(() => close(server));
  const origin = await listen(server);
  assert.equal(await verifyRunning({origin, ...application}, token), true);
  assert.equal(await verifyRunning({origin, ...application}, 'ef'.repeat(32)), false);
});

test('singleton verifier still rejects oversized, malformed and mismatched responses', async t => {
  const application = {service: 'magpie-filter-console-v1', pid: process.pid, instance: 'ab'.repeat(16)};
  let status = 200, text = '';
  const server = http.createServer((req, res) => { res.writeHead(status); res.end(text); });
  t.after(() => close(server));
  const record = {origin: await listen(server), ...application}, token = 'cd'.repeat(32);
  for (const [name, code, body] of [
    ['oversized', 200, JSON.stringify({padding: 'x'.repeat(4 * 1024 * 1024), application})],
    ['malformed', 200, '{'],
    ['wrong status', 503, JSON.stringify({application})],
    ['wrong service', 200, JSON.stringify({application: {...application, service: 'other'}})],
    ['wrong instance', 200, JSON.stringify({application: {...application, instance: 'ef'.repeat(16)}})],
    ['wrong pid', 200, JSON.stringify({application: {...application, pid: process.pid + 1}})]
  ]) {
    status = code; text = body;
    assert.equal(await verifyRunning(record, token), false, name);
  }
});

test('launcher is single-instance, inert by default and exits through authenticated API', async t => {
  const children = []; let record;
  t.after(async () => {
    if (record) await quit(record).catch(() => {});
    for (const child of children) {
      if (child.exitCode === null) await waitFor(() => child.exitCode !== null).catch(() => child.kill());
    }
  });
  const runtime = await portableFixture(t);
  const first = start(runtime); children.push(first);
  record = await waitFor(() => readRecord(runtime));
  const headers = {'x-console-token': record.token};
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
  assert.equal(state.application.pid, first.pid);
  assert.equal(state.application.instance, record.instance);
  assert.equal(state.settings.policy.enabled, false);
  const config = JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json')));
  assert.equal(record.origin, 'http://127.0.0.1:' + config.web.port);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'))).token, config.web.token);
  const second = start(runtime); children.push(second);
  await waitFor(() => second.exitCode !== null);
  assert.equal(second.exitCode, 0, second.output);
  assert.equal(readRecord(runtime).pid, first.pid);
  assert.doesNotMatch(first.output + second.output, new RegExp(record.token));
  assert.equal((await quit(record)).status, 200);
  await waitFor(() => first.exitCode !== null);
  assert.equal(first.exitCode, 0, first.output);
  assert.equal(fs.existsSync(path.join(runtime, 'service.json')), false);
  assert.equal(fs.existsSync(path.join(runtime, 'instance.lock')), false);
  record = null;
});

test('launcher refuses a live unverified owner without editing runtime state', async t => {
  const runtime = fixture(t), lock = path.join(runtime, 'instance.lock');
  fs.mkdirSync(lock);
  const owner = {pid: process.pid, instance: 'test-owner'};
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner));
  const child = start(runtime);
  await waitFor(() => child.exitCode !== null);
  assert.notEqual(child.exitCode, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')), owner);
});

test('launcher arguments reject unknown flags and require explicit absolute runtime', () => {
  const {parseArgs} = require('./main.cjs');
  assert.throws(() => parseArgs(['--runtime', 'relative']));
  assert.throws(() => parseArgs(['--mystery']));
  assert.equal(parseArgs(['--no-open']).open, false);
  assert.equal(parseArgs([]).configFile, path.resolve(__dirname, '../MagpieFilter.config.json'));
  assert.equal(parseArgs([]).runtime, path.resolve(__dirname, '../.magpie-filter'));
});

test('foreign service records are never overwritten even without a console lock', async t => {
  const runtime = fixture(t), file = path.join(runtime, 'service.json');
  const original = JSON.stringify({service: 'magpie-auto-codex-filter-v1', pid: process.pid, token: 'legacy-test-only'});
  fs.writeFileSync(file, original);
  const child = start(runtime);
  t.after(async () => {
    const record = readRecord(runtime);
    if (record?.service === 'magpie-filter-console-v1') await quit(record).catch(() => {});
    if (child.exitCode === null) child.kill();
  });
  await waitFor(() => child.exitCode !== null || readRecord(runtime)?.service !== 'magpie-auto-codex-filter-v1');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.notEqual(child.exitCode, 0);
});

test('a terminated owned process can be relaunched without keeping its activation', async t => {
  const children = []; let record;
  t.after(async () => {
    if (record) await quit(record).catch(() => {});
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const runtime = await portableFixture(t), first = start(runtime); children.push(first);
  record = await waitFor(() => readRecord(runtime));
  first.kill();
  await waitFor(() => first.exitCode !== null || first.signalCode !== null);
  const second = start(runtime); children.push(second);
  const previous = record.instance;
  record = await waitFor(() => { const next = readRecord(runtime); return next?.instance !== previous && next?.pid === second.pid ? next : null; });
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers: {'x-console-token': record.token}})).body);
  assert.equal(state.settings.policy.enabled, false);
  await quit(record); await waitFor(() => second.exitCode !== null); record = null;
});

test('configured web port conflicts fail without fallback or touching the client', async t => {
  const runtime = await portableFixture(t), configFile = path.join(runtime, 'MagpieFilter.config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  const other = http.createServer((req, res) => res.end('other'));
  t.after(() => close(other));
  await new Promise(resolve => other.listen(config.web.port, '127.0.0.1', resolve));
  const child = start(runtime); await waitFor(() => child.exitCode !== null);
  assert.notEqual(child.exitCode, 0); assert.match(child.output, /EADDRINUSE|already in use/);
  assert.equal(fs.existsSync(path.join(runtime, 'service.json')), false);
  assert.equal((await call('http://127.0.0.1:' + config.web.port, '/', {method: 'GET'})).body, 'other');
});

test('fresh launch follows edited token, web port and enabled policy without resetting the file', async t => {
  const runtime = await portableFixture(t), configFile = path.join(runtime, 'MagpieFilter.config.json');
  const up = http.createServer((req, res) => {req.resume(); req.on('end', () => res.end('{}'));});
  t.after(() => close(up)); const upstream = await listen(up);
  const reservation = http.createServer(); const port = Number(new URL(await listen(reservation)).port); await close(reservation);
  const configPath = path.join(runtime, 'mock.toml'), original = '[model_providers.mock]\nbase_url="' + upstream + '/v1"\n';
  fs.writeFileSync(configPath, original);
  const config = JSON.parse(fs.readFileSync(configFile));
  config.web.token = 'bc'.repeat(32); config.settings = {...config.settings, configPath, port, upstream,
    policy: {...config.settings.policy, enabled: true, cleanup: 'never'}};
  fs.writeFileSync(configFile, JSON.stringify(config));
  const child = start(runtime); let record;
  t.after(async () => { if (record) await quit(record).catch(() => {}); if (child.exitCode === null) child.kill(); });
  record = await waitFor(() => readRecord(runtime));
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers: {'x-console-token': config.web.token}})).body);
  assert.equal(state.attached, true); assert.equal(state.settings.policy.enabled, true);
  assert.equal(state.settings.policy.cleanup, 'never');
  await quit(record); await waitFor(() => child.exitCode !== null);
  assert.equal(JSON.parse(fs.readFileSync(configFile)).settings.policy.enabled, true);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original); record = null;
});

test('BOM config and pending token rotation do not prevent reopening the live instance', async t => {
  const runtime = await portableFixture(t), file = path.join(runtime, 'MagpieFilter.config.json');
  fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'));
  const children = []; let record;
  t.after(async () => { if (record) await quit(record).catch(() => {}); for (const c of children) if (c.exitCode === null) c.kill(); });
  const first = start(runtime); children.push(first);
  record = await waitFor(() => { try {return JSON.parse(fs.readFileSync(path.join(runtime, 'service.json')));} catch {return null;} });
  const second = start(runtime); children.push(second); await waitFor(() => second.exitCode !== null);
  assert.equal(second.exitCode, 0, second.output);
  const headers = {'x-console-token': record.token, 'content-type': 'application/json'};
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal((await call(record.origin, '/api/web', {headers, body: JSON.stringify({revision: config.revision,
    web: {port: config.web.port, token: 'de'.repeat(32)}})})).status, 200);
  const third = start(runtime); children.push(third); await waitFor(() => third.exitCode !== null);
  assert.equal(third.exitCode, 0, third.output);
  await quit(record); await waitFor(() => first.exitCode !== null); record = null;
});

test('startup recovery failures still publish an authenticated management console', async t => {
  let child, record, configPath, config;
  t.after(async () => {
    if (configPath) fs.writeFileSync(configPath, '[model_providers.mock]\nbase_url="' + config.settings.upstream + '/v1"\n');
    if (record) await quit(record).catch(() => {});
    if (child?.exitCode === null) await waitFor(() => child.exitCode !== null).catch(() => child.kill('SIGKILL'));
  });
  const runtime = await portableFixture(t), file = path.join(runtime, 'MagpieFilter.config.json');
  config = JSON.parse(fs.readFileSync(file));
  configPath = path.join(runtime, 'mock.toml');
  fs.writeFileSync(configPath, '[model_providers.mock]\nbase_url="http://127.0.0.1:18184/magpie/v1"\n');
  config.settings.configPath = configPath; config.settings.policy.enabled = true;
  fs.writeFileSync(file, JSON.stringify(config));
  fs.writeFileSync(path.join(runtime, 'connection.json'), JSON.stringify({version: 1, configPath, port: 18184, upstream: config.settings.upstream}));
  child = start(runtime);
  record = await waitFor(() => readRecord(runtime));
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers: {'x-console-token': config.web.token}})).body);
  assert.equal(state.state, 'needs-attention'); assert.match(state.lastError, /backup|recovery/i);
});
