'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {fixture, listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');

async function setup(t) {
  const {createController} = require('./controller.cjs');
  let controller;
  t.after(() => controller?.close());
  const runtime = fixture(t);
  const up = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  t.after(() => close(up));
  const upstream = await listen(up);
  const reservation = http.createServer();
  const port = Number(new URL(await listen(reservation)).port);
  await close(reservation);
  const configPath = path.join(runtime, 'codex.toml');
  const original = 'model_provider = "magpie"\n[model_providers.magpie]\nbase_url = "' + upstream + '/v1"\n# keep me\n';
  fs.writeFileSync(configPath, original);
  controller = createController({runtime});
  const settings = {...controller.status().settings, configPath, upstream, port};
  return {runtime, configPath, original, controller, settings, up, origin: 'http://127.0.0.1:' + port};
}

test('console starts inert, explicitly connects, bypasses on core disable, restores on disconnect', async t => {
  const h = await setup(t), c = h.controller;
  assert.equal(c.status().settings.policy.enabled, false);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  assert.equal(c.status().attached, true);
  assert.match(fs.readFileSync(h.configPath, 'utf8'), new RegExp(':' + h.settings.port + '/magpie/v1'));
  await c.update({revision: c.status().revision, settings: {...c.status().settings, policy: {...c.status().settings.policy, enabled: false}}});
  assert.equal(c.status().connected, true);
  assert.equal((await call(h.origin, '/magpie/v1/responses', {body: 'not-json'})).status, 200);
  await c.disconnect();
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  assert.equal(c.status().connected, false);
});

test('settings validation, stale writes and endpoint replacement cannot corrupt active connection', async t => {
  const h = await setup(t), c = h.controller;
  for (const patch of [{port: 0}, {port: '18184'}, {upstream: 'https://example.com'},
    {client: 'claude'}, {configPath: 'relative.toml'}, {other: 1}]) {
    await assert.rejects(c.update({revision: 0, settings: {...h.settings, ...patch}}));
  }
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  await assert.rejects(c.update({revision: 0, settings: h.settings}), /changed|revision/i);
  await assert.rejects(c.update({revision: c.status().revision, settings: {...c.status().settings, port: h.settings.port + 1}}), /disconnect/i);
  assert.equal(c.status().settings.port, h.settings.port);
  assert.equal((await call(h.origin, '/v1/responses', {body: '{}'})).status, 200);
});

test('atomic settings failure leaves the live policy and revision unchanged', async t => {
  const h = await setup(t), c = h.controller;
  const config = path.join(h.runtime, 'MagpieFilter.config.json');
  fs.renameSync(config, config + '.saved'); fs.mkdirSync(config);
  await assert.rejects(c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, cleanup: 'never'}}}));
  assert.equal(c.status().revision, 0);
  assert.equal(c.status().settings.policy.cleanup, 'conditional');
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('omitting the core policy cannot implicitly enable interception', async t => {
  const h = await setup(t);
  const {policy, ...withoutPolicy} = h.settings;
  await assert.rejects(h.controller.update({revision: 0, settings: withoutPolicy}), /settings|policy/i);
  assert.equal(h.controller.status().connected, false);
});

test('activation journal write failure rolls back listener and keeps saved preferences unchanged', async t => {
  const h = await setup(t);
  await h.controller.update({revision: 0, settings: h.settings});
  const config = path.join(h.runtime, 'MagpieFilter.config.json'), before = fs.readFileSync(config, 'utf8');
  fs.mkdirSync(path.join(h.runtime, 'connection.json'));
  await assert.rejects(h.controller.connect({revision: 1}));
  fs.rmdirSync(path.join(h.runtime, 'connection.json'));
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  assert.equal(h.controller.status().connected, false);
  assert.equal(h.controller.status().revision, 1);
  assert.equal(fs.readFileSync(config, 'utf8'), before);
});

test('unowned edits still pointing at the filter prevent unsafe shutdown', async t => {
  const h = await setup(t), c = h.controller;
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  const attached = fs.readFileSync(h.configPath, 'utf8');
  fs.writeFileSync(h.configPath, attached.replace('/magpie/v1', '/user-edited/v1'));
  try {
    await assert.rejects(c.disconnect(), /still.*filter|restore/i);
    assert.equal(c.status().connected, true);
  } finally { fs.writeFileSync(h.configPath, attached); }
  await c.disconnect();
});

test('port conflicts never change the client or claim the other listener', async t => {
  const h = await setup(t), other = http.createServer((req, res) => res.end('other'));
  t.after(() => close(other));
  await new Promise(resolve => other.listen(h.settings.port, '127.0.0.1', resolve));
  await h.controller.update({revision: 0, settings: h.settings});
  await assert.rejects(h.controller.connect({revision: h.controller.status().revision}), /EADDRINUSE/);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  assert.equal((await call(h.origin, '/', {method: 'GET'})).body, 'other');
});

test('activation cannot adopt an unowned preexisting filter URL even when its port is free', async t => {
  const h = await setup(t), c = h.controller;
  const unowned = h.original.replace(h.settings.upstream + '/v1', h.origin + '/magpie/v1');
  fs.writeFileSync(h.configPath, unowned);
  try {
    await c.update({revision: 0, settings: h.settings});
    await assert.rejects(c.connect({revision: c.status().revision}), /unowned|backup/i);
    assert.equal(c.status().connected, false);
    await assert.rejects(call(h.origin, '/magpie/v1/responses', {body: '{}'}));
    assert.equal(fs.readFileSync(h.configPath, 'utf8'), unowned);
  } finally { fs.writeFileSync(h.configPath, h.original); }
});

test('exit preserves saved bytes and fresh restart keeps core off while retaining other policy choices', async t => {
  const h = await setup(t), c = h.controller;
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true, cleanup: 'never'}}});
  await c.connect({revision: c.status().revision});
  fs.writeFileSync(h.configPath, h.original.replace(h.settings.upstream, 'http://127.0.0.1:12345'));
  await c.close();
  assert.match(fs.readFileSync(h.configPath, 'utf8'), /12345/);
  const reopened = require('./controller.cjs').createController({runtime: h.runtime});
  t.after(() => reopened.close());
  await reopened.start();
  assert.equal(reopened.status().settings.policy.enabled, false);
  assert.equal(reopened.status().connected, false);
  assert.equal(reopened.status().settings.policy.cleanup, 'never');
});

test('web edits persist in the portable config; disk edits block stale saves but not safe exit', async t => {
  const h = await setup(t), c = h.controller;
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  const file = path.join(h.runtime, 'MagpieFilter.config.json');
  const config = JSON.parse(fs.readFileSync(file));
  assert.equal(config.settings.policy.enabled, true);
  assert.equal(fs.existsSync(path.join(h.runtime, 'settings.json')), false);
  config.web.port = 19185; config.settings.policy.cleanup = 'never';
  const text = JSON.stringify(config); fs.writeFileSync(file, text);
  await assert.rejects(c.update({revision: c.status().revision, settings: c.status().settings}), /changed.*disk|restart/i);
  await c.close();
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('manual enabled config starts web-only and close preserves its saved bytes', async t => {
  const h = await setup(t), file = path.join(h.runtime, 'MagpieFilter.config.json');
  await h.controller.close();
  const config = JSON.parse(fs.readFileSync(file));
  config.settings = {...h.settings, policy: {...h.settings.policy, enabled: true, cleanup: 'always'}};
  fs.writeFileSync(file, JSON.stringify(config));
  const c = require('./controller.cjs').createController({runtime: h.runtime});
  t.after(() => c.close()); await c.start();
  assert.equal(c.status().attached, false);
  assert.equal(c.status().settings.policy.enabled, false);
  assert.equal(c.status().settings.policy.cleanup, 'always');
  await c.close();
  assert.equal(JSON.parse(fs.readFileSync(file)).settings.policy.enabled, true);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('web port-only save retains pending token rotation without returning credentials', async t => {
  const h = await setup(t), c = h.controller;
  const pending = 'cd'.repeat(32);
  await c.updateWeb({revision: 0, web: {port: 19185, token: pending}});
  await c.updateWeb({revision: c.status().revision, web: {port: 19186}});
  const config = JSON.parse(fs.readFileSync(path.join(h.runtime, 'MagpieFilter.config.json')));
  assert.equal(config.web.token, pending);
  assert.equal(c.status().web.port, 19186);
  assert.equal(c.status().web.restartRequired, true);
  assert.equal(JSON.stringify(c.status()).includes(pending), false);
});

test('startup never inspects an occupied port; explicit connect remains diagnosable and retryable', async t => {
  const h = await setup(t), file = path.join(h.runtime, 'MagpieFilter.config.json');
  await h.controller.close();
  const occupied = http.createServer();
  t.after(() => close(occupied));
  const occupiedPort = Number(new URL(await listen(occupied)).port);
  const config = JSON.parse(fs.readFileSync(file));
  config.settings = {...h.settings, port: occupiedPort, policy: {...h.settings.policy, enabled: true}};
  fs.writeFileSync(file, JSON.stringify(config));
  const c = require('./controller.cjs').createController({runtime: h.runtime});
  t.after(() => c.close());
  await c.start();
  assert.equal(c.status().state, 'idle');
  assert.equal(c.status().portConflict, null);
  await assert.rejects(c.connect({revision: c.status().revision}), /EADDRINUSE/);
  assert.equal(c.status().state, 'needs-attention');
  assert.match(c.status().lastError, /EADDRINUSE/);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  await c.update({revision: c.status().revision, settings: {...c.status().settings, port: h.settings.port}});
  await c.connect({revision: c.status().revision});
  assert.equal(c.status().attached, true);
});

test('recovery journal restores a crashed attachment before accepting new configuration', async t => {
  const h = await setup(t);
  await h.controller.close();
  const {ConfigRouter} = require('../magpie-auto-codex-filter/config.cjs');
  const connection = {configPath: h.configPath, upstream: h.settings.upstream, port: h.settings.port};
  fs.writeFileSync(path.join(h.runtime, 'connection.json'), JSON.stringify({version: 1, ...connection}));
  const router = new ConfigRouter({configPath: h.configPath, filterOrigin: h.origin, mode: 'magpie-auto',
    backupPath: path.join(h.runtime, 'routes.json'), getUpstream: () => h.settings.upstream});
  router.sync();
  const c = require('./controller.cjs').createController({runtime: h.runtime});
  t.after(() => c.close());
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  assert.equal(c.status().connected, false);
  assert.equal(fs.existsSync(path.join(h.runtime, 'connection.json')), false);
});

test('normal close refuses active uploads while failed restoration keeps the proxy available', async t => {
  const h = await setup(t), c = h.controller;
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  const req = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-length': 10}});
  req.on('error', () => {}); req.write('{');
  await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(c.close(), /active|request/i);
  req.destroy();
  await new Promise(resolve => setTimeout(resolve, 50));
  const attached = fs.readFileSync(h.configPath, 'utf8');
  fs.renameSync(h.configPath, h.configPath + '.saved'); fs.mkdirSync(h.configPath);
  await assert.rejects(c.disconnect());
  assert.equal(c.status().connected, true);
  fs.rmdirSync(h.configPath); fs.renameSync(h.configPath + '.saved', h.configPath);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), attached);
  await c.disconnect();
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('metrics retain namespaced lifecycles across reconnect, observed tokens and independent revisions', async t => {
  const h = await setup(t), c = h.controller;
  h.up.removeAllListeners('request');
  h.up.on('request', (req, res) => {
    req.resume(); req.on('end', () => {
      res.setHeader('content-type', 'text/event-stream');
      res.end('event: response.completed\ndata: ' + JSON.stringify({type: 'response.completed', response: {
        usage: {input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: {cached_tokens: 4}},
        output: [{text: 'secret-output'}]}}) + '\n\n');
    });
  });
  const send = () => call(h.origin, '/v1/responses', {body: JSON.stringify({model: 'mock', stream: true,
    input: [{role: 'user', content: 'secret-prompt'}]}), headers: {authorization: 'Bearer secret-credential', connection: 'close'}});
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  let revision = c.status().revision;
  assert.equal((await send()).status, 200);
  assert.equal(c.status().revision, revision);
  assert.equal(c.status().metrics.totals.success, 1);
  assert.equal(c.status().metrics.totals.inputTokens, 12);
  await c.disconnect();
  await c.update({revision: c.status().revision, settings: {...c.status().settings, policy: {...c.status().settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  revision = c.status().revision; await send();
  const state = c.status(); assert.equal(state.revision, revision);
  assert.equal(state.metrics.totals.success, 2); assert.equal(state.metrics.totals.inputTokens, 24);
  assert.equal(state.metrics.totals.kept, 2);
  assert.equal(state.metrics.recent.length, 2);
  assert.notEqual(state.metrics.recent[0].requestId, state.metrics.recent[1].requestId);
  assert.equal(state.activePolicies.length, 0);
  await c.close();
  const persisted = fs.readFileSync(path.join(h.runtime, 'metrics.json'), 'utf8');
  assert.doesNotMatch(persisted, /secret-prompt|secret-output|secret-credential/);
  assert.equal(Object.hasOwn(JSON.parse(persisted), 'series'), false);
  assert.equal(Object.hasOwn(JSON.parse(persisted), 'recent'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(h.runtime, 'console.log'), 'utf8'), /secret-prompt|secret-output|secret-credential/);
  const loaded = require('./controller.cjs').createController({runtime: h.runtime});
  t.after(() => loaded.close());
  assert.equal(loaded.status().metrics.totals.success, 2);
  assert.equal(loaded.status().metrics.totals.kept, 2);
  assert.equal(loaded.status().metrics.active.length, 0);
  assert.deepEqual(loaded.status().metrics.recent, []);
  assert.deepEqual(loaded.status().metrics.series, []);
});

test('minute persistence is atomic, independent of revision and stops on normal close', async t => {
  const runtime = fixture(t);
  t.mock.timers.enable({apis: ['setInterval']});
  const c = require('./controller.cjs').createController({runtime});
  t.after(() => c.close());
  const file = path.join(runtime, 'metrics.json');
  assert.equal(fs.existsSync(file), false);
  t.mock.timers.tick(60000);
  for (let i = 0; i < 200 && !fs.existsSync(file); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
  assert.equal(c.status().revision, 0);
  await c.close(); const text = fs.readFileSync(file, 'utf8');
  t.mock.timers.tick(120000); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(c.status().diagnostics.logs.closed, true);
  assert.equal(c.status().diagnostics.persistence.timerActive, false);
  assert.deepEqual(fs.readdirSync(runtime).filter(name => name.endsWith('.tmp')), []);
});

test('corrupt and oversize metrics never block startup and I/O failures stay diagnostic', async t => {
  const runtime = fixture(t), filename = path.join(runtime, 'metrics.json');
  fs.writeFileSync(filename, '{bad secret');
  const c = require('./controller.cjs').createController({runtime});
  t.after(() => c.close()); await c.start();
  assert.equal(c.status().state, 'idle'); assert.equal(c.status().metrics.totals.started, 0);
  assert.equal(c.status().diagnostics.persistence.loadError, 'INVALID_SNAPSHOT');
  assert.doesNotMatch(JSON.stringify(c.status().diagnostics), /secret/);
  fs.unlinkSync(filename); fs.mkdirSync(filename);
  await assert.doesNotReject(c.close());
  assert.equal(c.status().diagnostics.persistence.writeErrors, 1);
  fs.rmdirSync(filename); fs.writeFileSync(filename, ' '.repeat(1024 * 1024 + 1));
  const second = require('./controller.cjs').createController({runtime});
  t.after(() => second.close()); assert.equal(second.status().diagnostics.persistence.loadError, 'SNAPSHOT_TOO_LARGE');
});

test('failed safe restore leaves persistence timer and log writer usable until close is retried', async t => {
  const h = await setup(t), c = h.controller;
  await c.update({revision: 0, settings: {...h.settings, policy: {...h.settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  const attached = fs.readFileSync(h.configPath, 'utf8');
  fs.writeFileSync(h.configPath, attached.replace('/magpie/v1', '/edited/v1'));
  try {
    await assert.rejects(c.close(), /still.*filter|restore/i);
    assert.equal(c.status().connected, true);
    assert.equal(c.status().diagnostics.logs.closed, false);
    assert.equal(c.status().diagnostics.persistence.timerActive, true);
    assert.equal((await call(h.origin, '/v1/responses', {body: '{}'})).status, 200);
    assert.equal(c.status().metrics.totals.success, 1);
  } finally { fs.writeFileSync(h.configPath, attached); }
  await c.close(); assert.equal(c.status().diagnostics.logs.closed, true);
});

test('metrics hydration and close never rewrite a legacy BOM CRLF configuration', async t => {
  const runtime = fixture(t), file = path.join(runtime, 'MagpieFilter.config.json');
  const seed = require('./controller.cjs').createController({runtime}); await seed.close();
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete config.settings.policy.protectStreamStart;
  const original = '\uFEFF' + JSON.stringify(config, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  fs.writeFileSync(file, original);
  const c = require('./controller.cjs').createController({runtime}); t.after(() => c.close());
  assert.equal(c.status().settings.policy.protectStreamStart, false);
  await c.start(); await c.close();
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
