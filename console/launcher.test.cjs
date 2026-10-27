'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {fixture, call} = require('../magpie-auto-codex-filter/test-support.cjs');

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
  try { return JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8')); } catch { return null; }
}
async function quit(record) {
  const headers = {'x-console-token': record.token, 'content-type': 'application/json'};
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
  return call(record.origin, '/api/exit', {headers, body: JSON.stringify({revision: state.revision})});
}

test('launcher is single-instance, inert by default and exits through authenticated API', async t => {
  const children = []; let record;
  t.after(async () => {
    if (record) await quit(record).catch(() => {});
    for (const child of children) {
      if (child.exitCode === null) await waitFor(() => child.exitCode !== null).catch(() => child.kill());
    }
  });
  const runtime = fixture(t);
  const first = start(runtime); children.push(first);
  record = await waitFor(() => readRecord(runtime));
  const headers = {'x-console-token': record.token};
  const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
  assert.equal(state.application.pid, first.pid);
  assert.equal(state.application.instance, record.instance);
  assert.equal(state.settings.policy.enabled, false);
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
  const runtime = fixture(t), first = start(runtime); children.push(first);
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
