'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {call} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main() {
  const exe = path.resolve(process.argv[2] || 'dist/MagpieFilter.exe');
  const root = path.resolve('.verification'); fs.mkdirSync(root, {recursive: true});
  const runtime = fs.mkdtempSync(path.join(root, 'exe-'));
  const children = [], env = {...process.env, PATH: process.env.WINDIR + '\\System32', NODE_OPTIONS: ''};
  const launch = () => {
    const child = spawn(exe, ['--runtime', runtime, '--no-open'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.output = ''; child.stdout.on('data', x => { child.output += x; }); child.stderr.on('data', x => { child.output += x; });
    children.push(child); return child;
  };
  const wait = async fn => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 60)); }
    throw new Error('Packaged lifecycle timed out. ' + children.map(c => c.output).join('\n'));
  };
  let record;
  const stop = async () => {
    if (!record) return;
    const headers = {'x-console-token': record.token, 'content-type': 'application/json'};
    const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
    return call(record.origin, '/api/exit', {headers, body: JSON.stringify({revision: state.revision})});
  };
  try {
    const first = launch();
    record = await wait(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8')); } catch { return null; } });
    const headers = {'x-console-token': record.token};
    const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
    assert.equal(state.settings.policy.enabled, false); assert.equal(state.application.pid, first.pid);
    assert.equal((await call(record.origin, '/', {method: 'GET'})).status, 200);
    const second = launch(); await wait(() => second.exitCode !== null); assert.equal(second.exitCode, 0, second.output);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8')).pid, first.pid);
    assert.equal((await stop()).status, 200); await wait(() => first.exitCode !== null); assert.equal(first.exitCode, 0, first.output);
    assert.equal(fs.existsSync(path.join(runtime, 'service.json')), false);
    assert.equal(fs.existsSync(path.join(runtime, 'instance.lock')), false);
    record = null;
    console.log(JSON.stringify({exe, runtime, standaloneStartup: true, embeddedAssets: true, singleInstance: true, cleanExit: true}));
  } finally {
    await stop().catch(() => {});
    for (const child of children) if (child.exitCode === null) await wait(() => child.exitCode !== null).catch(() => child.kill());
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
