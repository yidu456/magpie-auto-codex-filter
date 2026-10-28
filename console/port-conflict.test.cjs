'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {performance} = require('node:perf_hooks');
const {fixture, listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');
const {createController} = require('./controller.cjs');
const {createManagementServer} = require('./server.cjs');

async function setup(t, {unsafe = false} = {}) {
  const runtime = fixture(t), occupied = http.createServer((req, res) => res.end('owned fixture'));
  const port = Number(new URL(await listen(occupied)).port);
  t.after(() => close(occupied));
  const configPath = path.join(runtime, 'fixture.toml');
  const original = '[model_providers.magpie]\nbase_url="http://127.0.0.1:3425/v1"\n';
  fs.writeFileSync(configPath, original);
  let inspected = 0, kills = 0, terminate;
  const owner = Object.freeze({pid: 12345, name: 'fixture', executable: 'C:/fixture/node.exe', started: 'private-start'});
  const metadata = {port, owner, canTerminate: !unsafe, reason: unsafe ? 'IDENTITY_UNAVAILABLE' : null};
  const portOwner = {inspect: async p => { assert.equal(p, port); inspected++; return metadata; },
    terminate: async (p, identity) => {
      assert.equal(p, port); assert.equal(identity, owner, 'Retain the adapter-local capability, not a clone');
      kills++;
      if (terminate) return terminate();
      await close(occupied); return {port, released: true};
    }};
  const controller = createController({runtime, portOwner}); t.after(() => controller.close());
  const settings = {...controller.status().settings, configPath, port,
    policy: {...controller.status().settings.policy, enabled: true}};
  const enable = () => controller.update({revision: controller.status().revision, settings});
  const conflict = async () => {
    let error; try { await enable(); } catch (e) { error = e; }
    assert.equal(error?.code, 'PORT_CONFLICT');
    assert.match(error.conflict.challenge, /^[a-f0-9]{64}$/);
    assert.equal(error.conflict.revision, controller.status().revision);
    assert.equal(error.conflict.port, port);
    assert.deepEqual(error.conflict.owner, {pid: owner.pid, name: owner.name, executable: owner.executable});
    assert.ok(error.conflict.expiresAt > Date.now());
    return error.conflict;
  };
  const resolve = (c, confirm = true, extra = {}) => controller.resolvePortConflict({revision: c.revision, challenge: c.challenge, confirm, ...extra});
  return {runtime, controller, settings, occupied, original, configPath, port, enable, conflict, resolve,
    get inspected() { return inspected; }, get kills() { return kills; }, set terminate(value) { terminate = value; }, metadata};
}

test('occupied fresh enable offers bounded consent and saves no enabled preference', async t => {
  const h = await setup(t), before = fs.readFileSync(h.controller.status().configFile, 'utf8');
  const c = await h.conflict();
  assert.deepEqual(h.controller.status().portConflict, c);
  assert.equal(h.controller.status().connected, false);
  assert.equal(h.controller.status().settings.policy.enabled, false);
  assert.equal(fs.readFileSync(h.controller.status().configFile, 'utf8'), before);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  assert.equal(h.kills, 0); assert.equal(h.inspected, 1);
  assert.doesNotMatch(JSON.stringify(h.controller.status()), /private-start/);
});

test('cancel consumes consent without changing preferences or terminating', async t => {
  const h = await setup(t), c = await h.conflict();
  await h.resolve(c, false);
  assert.equal(h.controller.status().portConflict, null);
  await assert.rejects(h.resolve(c), {code: 'PORT_CONFLICT_STALE'});
  assert.equal(h.kills, 0); assert.equal(h.controller.status().settings.policy.enabled, false);
});

test('wrong, expired, reused, forged and unsafe consent never terminates', async t => {
  const h = await setup(t), c = await h.conflict();
  for (const extra of [{challenge: '00'.repeat(32)}, {revision: 99}, {confirm: 'yes'}, {pid: 12345}, {settings: h.settings}]) {
    await assert.rejects(h.resolve(c, true, extra));
  }
  assert.equal(h.kills, 0);
  t.mock.method(performance, 'now', () => Number.MAX_SAFE_INTEGER);
  await assert.rejects(h.resolve(c), {code: 'PORT_CONFLICT_STALE'});
  assert.equal(h.kills, 0);
  t.mock.restoreAll();
  const unsafe = await setup(t, {unsafe: true}), u = await unsafe.conflict();
  assert.equal(u.canTerminate, false);
  await assert.rejects(unsafe.resolve(u), {code: 'PORT_OWNER_UNSAFE'});
  assert.equal(unsafe.kills, 0);
});

test('confirmed original capability terminates once and uses ordinary activation and persistence', async t => {
  const h = await setup(t), c = await h.conflict();
  const state = await h.resolve(c);
  assert.equal(state.connected, true); assert.equal(state.attached, true);
  assert.equal(state.settings.policy.enabled, true); assert.equal(state.revision, 1);
  assert.equal(state.portConflict, null); assert.equal(h.kills, 1);
  assert.equal(state.transitioning, false); assert.equal(state.portConflictPending, false);
  assert.equal(JSON.parse(fs.readFileSync(state.configFile)).settings.policy.enabled, true);
  await assert.rejects(h.resolve(c), {code: 'PORT_CONFLICT_STALE'});
  assert.equal(h.kills, 1);
});

test('normal activation and disconnect responses are settled, not stale busy snapshots', async t => {
  const h = await setup(t); await close(h.occupied);
  const activated = await h.enable();
  assert.equal(activated.transitioning, false); assert.equal(activated.portConflictPending, false);
  const disconnected = await h.controller.disconnect();
  assert.equal(disconnected.transitioning, false); assert.equal(disconnected.connected, false);
});

test('disk edits, unowned endpoints and newly unresolved journal block kill', async t => {
  for (const guard of ['disk', 'unowned', 'recovery']) {
    const h = await setup(t), c = await h.conflict();
    if (guard === 'disk') fs.appendFileSync(h.controller.status().configFile, '\n');
    if (guard === 'unowned') fs.writeFileSync(h.configPath, h.original.replace('http://127.0.0.1:3425', 'http://127.0.0.1:' + h.port));
    if (guard === 'recovery') fs.writeFileSync(path.join(h.runtime, 'connection.json'), '{}');
    await assert.rejects(h.resolve(c), /disk|unowned|recovery/i);
    assert.equal(h.kills, 0); assert.equal(h.controller.status().portConflict, null);
    if (guard === 'recovery') fs.unlinkSync(path.join(h.runtime, 'connection.json'));
  }
});

test('settings, web changes, disconnect and close invalidate outstanding consent', async t => {
  for (const mutation of ['settings', 'web', 'disconnect', 'close']) {
    const h = await setup(t), c = await h.conflict();
    if (mutation === 'settings') await h.controller.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: false}}});
    if (mutation === 'web') await h.controller.updateWeb({revision: 0, web: {port: 19285}});
    if (mutation === 'disconnect') await h.controller.disconnect();
    if (mutation === 'close') await h.controller.close();
    await assert.rejects(h.resolve(c), {code: 'PORT_CONFLICT_STALE'});
    assert.equal(h.kills, 0);
  }
});

test('changed owner and reoccupied activation require fresh consent, never a second kill', async t => {
  const h = await setup(t), c = await h.conflict();
  const changed = {...h.metadata, owner: Object.freeze({...h.metadata.owner, pid: 12346})};
  h.terminate = () => { throw Object.assign(new Error('Port owner changed.'), {code: 'PORT_OWNER_CHANGED', conflict: changed}); };
  await assert.rejects(h.resolve(c), e => e.code === 'PORT_OWNER_CHANGED' && e.conflict.challenge !== c.challenge && e.conflict.owner.pid === 12346);
  assert.equal(h.controller.status().connected, false); assert.equal(h.kills, 1);
  // The mock reports release while its controlled listener remains occupied.
  const h2 = await setup(t), c2 = await h2.conflict(); h2.terminate = () => ({released: true});
  await assert.rejects(h2.resolve(c2), e => e.code === 'PORT_CONFLICT' && e.conflict.challenge !== c2.challenge);
  assert.equal(h2.kills, 1); assert.equal(h2.controller.status().settings.policy.enabled, false);
});

test('termination errors stay failed with consumed consent and honest pending close serialization', async t => {
  for (const code of ['PORT_TERMINATION_DENIED', 'PORT_TERMINATION_TIMEOUT', 'PORT_RELEASE_TIMEOUT', 'PORT_INSPECTION_FAILED']) {
    const h = await setup(t), c = await h.conflict();
    h.terminate = () => { throw Object.assign(new Error('Safe termination failure.'), {code}); };
    await assert.rejects(h.resolve(c), {code});
    assert.equal(h.controller.status().connected, false); assert.equal(h.controller.status().portConflict, null);
    assert.equal(h.controller.status().settings.policy.enabled, false);
  }
  const h = await setup(t), c = await h.conflict();
  let release, begun;
  const gate = new Promise(r => { release = r; }); t.after(release);
  const started = new Promise(r => { begun = r; });
  h.terminate = async () => { begun(); await gate; await close(h.occupied); return {released: true}; };
  const confirmation = h.resolve(c); await started;
  assert.equal(h.controller.status().transitioning, true);
  assert.equal(h.controller.status().portConflictPending, true);
  const closing = h.controller.close(); let closed = false; closing.then(() => { closed = true; });
  await new Promise(r => setImmediate(r)); assert.equal(closed, false);
  release(); await confirmation; await closing;
  assert.equal(h.kills, 1); assert.equal(h.controller.status().state, 'closed');
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('startup conflict preserves enabled preference but never auto terminates or saves consent', async t => {
  const h = await setup(t); await h.controller.close();
  const filename = path.join(h.runtime, 'MagpieFilter.config.json');
  const config = JSON.parse(fs.readFileSync(filename)); config.settings = h.settings;
  fs.writeFileSync(filename, JSON.stringify(config));
  const portOwner = {inspect: async () => h.metadata, terminate: async () => assert.fail('Startup cannot terminate')};
  const c = createController({runtime: h.runtime, portOwner}); t.after(() => c.close());
  const before = fs.readFileSync(filename, 'utf8'); const state = await c.start();
  assert.equal(state.connected, false); assert.equal(state.settings.policy.enabled, true);
  assert.equal(state.state, 'needs-attention'); assert.ok(state.portConflict.challenge);
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  assert.doesNotMatch(before, /challenge|force|private-start/);
});

test('protected management conflict API enforces auth, strict body, 409 and yes/no', async t => {
  const h = await setup(t), server = createManagementServer({controller: h.controller, token: 'test'});
  t.after(() => close(server)); const origin = await listen(server);
  const headers = {'x-console-token': 'test', 'content-type': 'application/json'};
  const post = (route, body, patch = {}) => call(origin, route, {headers: {...headers, ...patch}, body: JSON.stringify(body)});
  const conflict = await post('/api/settings', {revision: 0, settings: h.settings});
  assert.equal(conflict.status, 409); const c = JSON.parse(conflict.body).conflict;
  assert.equal(JSON.parse(conflict.body).code, 'PORT_CONFLICT');
  const body = {revision: 0, challenge: c.challenge, confirm: true};
  assert.equal((await call(origin, '/api/port-conflict', {method: 'GET', headers})).status, 404);
  assert.equal((await call(origin, '/api/port-conflict', {headers, body: 'x'.repeat(33000)})).status, 413);
  assert.equal((await call(origin, '/api/port-conflict', {headers, body: '{'})).status, 400);
  assert.equal((await post('/api/port-conflict', body, {'content-type': 'text/plain'})).status, 415);
  for (const patch of [{'x-console-token': ''}, {origin: 'http://evil'}, {host: 'evil'}, {'sec-fetch-site': 'cross-site'}]) {
    assert.equal((await post('/api/port-conflict', body, patch)).status, 403);
  }
  for (const extra of [{pid: 12345}, {settings: h.settings}, {confirm: 'yes'}]) {
    assert.equal((await post('/api/port-conflict', {...body, ...extra})).status, 400);
  }
  assert.equal(h.kills, 0);
  assert.equal((await post('/api/port-conflict', {...body, confirm: false})).status, 200);
  assert.equal((await post('/api/port-conflict', body)).status, 409);
  const fresh = JSON.parse((await post('/api/settings', {revision: 0, settings: h.settings})).body).conflict;
  assert.equal((await post('/api/port-conflict', {...body, challenge: fresh.challenge})).status, 200);
  assert.equal(h.kills, 1);
});

test('native failure metadata cannot bypass the public conflict projection', async t => {
  const h = await setup(t), c = await h.conflict();
  h.terminate = () => { throw Object.assign(new Error('Safe denial.'), {code: 'PORT_TERMINATION_DENIED', conflict: {...h.metadata, private: 'not-public'}}); };
  const server = createManagementServer({controller: h.controller, token: 'test'});
  t.after(() => close(server)); const origin = await listen(server);
  const response = await call(origin, '/api/port-conflict', {headers: {'x-console-token': 'test', 'content-type': 'application/json'},
    body: JSON.stringify({revision: c.revision, challenge: c.challenge, confirm: true})});
  assert.equal(response.status, 409); assert.equal(JSON.parse(response.body).code, 'PORT_TERMINATION_DENIED');
  assert.doesNotMatch(response.body, /private-start|not-public/);
  assert.equal(JSON.parse(response.body).conflict, undefined);
});

test('unowned occupied route and invalid settings stop before port inspection or consent', async t => {
  const h = await setup(t);
  await assert.rejects(h.controller.update({revision: 0, settings: {...h.settings, port: 'invalid'}}));
  fs.writeFileSync(h.configPath, h.original.replace('http://127.0.0.1:3425', 'http://127.0.0.1:' + h.port));
  await assert.rejects(h.enable(), /unowned/i);
  assert.equal(h.inspected, 0); assert.equal(h.kills, 0); assert.equal(h.controller.status().portConflict, null);
});

test('abandoned confirmation request remains pending and duplicate consent cannot dispatch twice', async t => {
  const h = await setup(t), c = await h.conflict();
  let release, begun;
  const gate = new Promise(r => { release = r; }); t.after(release);
  const started = new Promise(r => { begun = r; });
  h.terminate = async () => { begun(); await gate; await close(h.occupied); return {released: true}; };
  const server = createManagementServer({controller: h.controller, token: 'test'});
  t.after(() => close(server)); const origin = await listen(server);
  const body = JSON.stringify({revision: c.revision, challenge: c.challenge, confirm: true});
  const headers = {'x-console-token': 'test', 'content-type': 'application/json'};
  const req = http.request(origin + '/api/port-conflict', {method: 'POST', headers}); req.on('error', () => {}); req.end(body);
  await started; req.destroy();
  const status = JSON.parse((await call(origin, '/api/state', {method: 'GET', headers})).body);
  assert.equal(status.portConflictPending, true); assert.equal(status.transitioning, true); assert.equal(status.connected, false);
  const duplicate = call(origin, '/api/port-conflict', {headers, body});
  release(); assert.equal((await duplicate).status, 409);
  assert.equal(h.kills, 1); assert.equal(h.controller.status().connected, true);
});

test('management body timeout does not cancel an already dispatched long confirmation', {timeout: 16000}, async t => {
  const h = await setup(t), c = await h.conflict();
  let begun;
  const started = new Promise(r => { begun = r; });
  h.terminate = async () => { begun(); await new Promise(r => setTimeout(r, 10200)); await close(h.occupied); return {released: true}; };
  const server = createManagementServer({controller: h.controller, token: 'test'});
  t.after(() => close(server)); const origin = await listen(server);
  const headers = {'x-console-token': 'test', 'content-type': 'application/json'};
  // The shared request helper has a five-second client deadline, unlike browser fetch.
  const confirmation = new Promise((resolve, reject) => {
    const req = http.request(origin + '/api/port-conflict', {method: 'POST', headers}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString()}));
    });
    req.setTimeout(14000, () => req.destroy(new Error('Long confirmation timeout'))); req.on('error', reject);
    req.end(JSON.stringify({revision: c.revision, challenge: c.challenge, confirm: true}));
  });
  await started;
  assert.equal(h.controller.status().portConflictPending, true);
  const response = await confirmation;
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).transitioning, false);
  assert.equal(h.kills, 1); assert.equal(h.controller.status().connected, true);
});
