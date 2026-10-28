'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {gzipSync} = require('node:zlib');
const {fixture, listen, close, call, sample} = require('../magpie-auto-codex-filter/test-support.cjs');
const {createController} = require('./controller.cjs');

async function waitFor(fn) {
  const deadline = Date.now() + 2000;
  while (!fn()) {
    assert.ok(Date.now() < deadline, 'Lifecycle did not settle within two seconds');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function setup(t, handler) {
  const runtime = fixture(t), upstream = http.createServer(handler);
  t.after(() => close(upstream)); const origin = await listen(upstream);
  const reserve = http.createServer(), port = Number(new URL(await listen(reserve)).port); await close(reserve);
  const configPath = path.join(runtime, 'mock.toml'), original = '[model_providers.magpie]\nbase_url="' + origin + '/v1"\n';
  fs.writeFileSync(configPath, original);
  const c = createController({runtime});
  t.after(async () => { try { await c.disconnect(); } finally { await c.close(); } });
  await c.update({revision: 0, settings: {...c.status().settings, port, upstream: origin, configPath}});
  return {c, runtime, upstream, configPath, original, origin: 'http://127.0.0.1:' + port};
}

test('explicit gateway and core provide all four states and raw compressed bypass', async t => {
  const rawResponse = gzipSync('{"error":{"code":"rate_limit_exceeded"}}');
  const bodies = [];
  const h = await setup(t, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      bodies.push(Buffer.concat(chunks)); res.writeHead(200, {'content-encoding': 'gzip'}); res.end(rawResponse);
    });
  });
  const {c} = h;
  const core = enabled => c.update({revision: c.status().revision, settings: {...c.status().settings,
    policy: {...c.status().settings.policy, enabled, cleanup: 'always'}}});
  assert.equal(c.status().connected, false); assert.equal(c.status().settings.policy.enabled, false);
  await core(true);
  assert.equal(c.status().connected, false); assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  await assert.rejects(call(h.origin, '/v1/responses', {body: '{}'}));
  await core(false); await c.connect({revision: c.status().revision});
  assert.equal(c.status().connected, true); assert.equal(c.status().settings.policy.enabled, false);
  const raw = gzipSync(JSON.stringify(sample));
  const bypass = await new Promise((resolve, reject) => {
    const request = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-encoding': 'gzip'}}, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({headers: response.headers, body: Buffer.concat(chunks)}));
    }); request.on('error', reject); request.end(raw);
  });
  assert.equal(bypass.headers['content-encoding'], 'gzip');
  assert.deepEqual(bypass.body, rawResponse); assert.deepEqual(bodies[0], raw);
  await core(true);
  await call(h.origin, '/v1/responses', {body: JSON.stringify(sample)});
  assert.equal(JSON.parse(bodies[1]).input.some(item => item.type === 'reasoning'), false);
  await c.disconnect();
  assert.equal(c.status().connected, false); assert.equal(c.status().settings.policy.enabled, true);
  assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
  await c.connect({revision: c.status().revision});
  assert.equal(c.status().settings.policy.enabled, true);
});

test('legacy enabled bytes survive web-only startup without port inspection', async t => {
  const runtime = fixture(t), seed = createController({runtime}); await seed.close();
  const file = path.join(runtime, 'MagpieFilter.config.json'), config = JSON.parse(fs.readFileSync(file));
  config.settings.policy.enabled = true; config.settings.policy.cleanup = 'never';
  config.settings.configPath = path.join(runtime, 'absent-mock.toml');
  const bytes = '\uFEFF' + JSON.stringify(config, null, 2).replace(/\n/g, '\r\n'); fs.writeFileSync(file, bytes);
  const c = createController({runtime, portOwner: {inspect: () => assert.fail('Startup cannot inspect ports')}});
  t.after(() => c.close()); const state = await c.start();
  assert.equal(state.connected, false); assert.equal(state.settings.policy.enabled, false);
  assert.equal(state.settings.policy.cleanup, 'never'); assert.equal(state.portConflict, null);
  await c.close(); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});

test('connect strictly validates revision and accepts no settings or process identity', async t => {
  const h = await setup(t, (req, res) => res.end('{}'));
  for (const value of [undefined, null, [], {}, {revision: '1'}, {revision: 0}, {revision: 1, settings: h.c.status().settings}, {revision: 1, pid: 123},
    Object.assign(Object.create({revision: 1}), {pid: 123})]) {
    await assert.rejects(h.c.connect(value));
    assert.equal(h.c.status().connected, false);
  }
  await h.c.connect({revision: 1});
});

for (const authEnabled of [true, false]) test('connect API is strict and trust-protected with auth ' + authEnabled, async t => {
  const {c} = await setup(t, (req, res) => res.end('{}'));
  const server = require('./server.cjs').createManagementServer({controller: c, token: 'fixture', authEnabled});
  t.after(() => close(server)); const origin = await listen(server);
  const headers = {'content-type': 'application/json', ...(authEnabled ? {'x-console-token': 'fixture'} : {})};
  const post = (body, patch = {}) => call(origin, '/api/connect', {headers: {...headers, ...patch}, body: JSON.stringify(body)});
  for (const patch of [{origin: 'http://evil'}, {host: 'evil'}, {'sec-fetch-site': 'cross-site'}, ...(authEnabled ? [{'x-console-token': ''}] : [])]) {
    assert.equal((await post({revision: 1}, patch)).status, 403); assert.equal(c.status().connected, false);
  }
  for (const extra of [{settings: c.status().settings}, {pid: 123}, {confirm: true}]) {
    assert.equal((await post({revision: 1, ...extra})).status, 400); assert.equal(c.status().connected, false);
  }
  assert.equal((await post({revision: 0})).status, 409);
  assert.equal((await post({revision: 1}, {'content-type': 'text/plain'})).status, 415);
  assert.equal((await call(origin, '/api/connect', {headers, body: 'x'.repeat(33000)})).status, 413);
  assert.equal((await post({revision: 1})).status, 200); assert.equal(c.status().connected, true);
});

test('forced gateway close covers speculative idle TCP without touching another server', {timeout: 5000}, async t => {
  const net = require('node:net');
  const h = await setup(t, (req, res) => res.end('unrelated upstream')); await h.c.connect({revision: 1});
  const socket = net.connect(Number(new URL(h.origin).port), '127.0.0.1'); socket.on('error', () => {});
  t.after(() => socket.destroy()); await new Promise(resolve => socket.once('connect', resolve));
  const canceled = new Promise(resolve => socket.once('close', resolve));
  const before = Date.now(); await h.c.disconnect(); assert.ok(Date.now() - before < 2000); await canceled;
  assert.equal((await call('http://127.0.0.1:' + h.upstream.address().port, '/', {method: 'GET'})).body, 'unrelated upstream');
});

test('rejected half-open WebSocket upgrade cannot strand disconnect or its mutation queue', {timeout: 5000}, async t => {
  const net = require('node:net');
  const h = await setup(t, () => assert.fail('Unsupported upgrade cannot reach upstream'));
  await h.c.connect({revision: 1});
  const socket = net.connect({port: Number(new URL(h.origin).port), host: '127.0.0.1', allowHalfOpen: true});
  socket.on('error', () => {});
  let response = '', disconnecting, timer;
  try {
    await new Promise(resolve => socket.once('connect', resolve));
    socket.on('data', chunk => { response += chunk.toString(); });
    socket.write('GET /v1/responses HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    await waitFor(() => response.includes('WebSocket filtering is not supported.'));
    assert.match(response, /^HTTP\/1\.1 426 Upgrade Required\r\n/);
    assert.match(response, /\r\nConnection: close\r\n/);
    assert.equal(h.c.status().stats.activeRequests, 0);
    disconnecting = h.c.disconnect();
    await Promise.race([disconnecting, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Rejected upgrade stranded gateway disconnect')), 1000);
    })]);
    assert.equal(h.c.status().connected, false);
    assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
    const updated = await h.c.update({revision: h.c.status().revision, settings: h.c.status().settings});
    assert.equal(updated.transitioning, false);
    await h.c.connect({revision: updated.revision});
    assert.equal(h.c.status().connected, true);
  } finally {
    clearTimeout(timer); socket.destroy(); await disconnecting;
  }
});

test('changing core keeps an admitted request policy until forced gateway cancellation', async t => {
  const h = await setup(t, (req, res) => { req.resume(); });
  const {c} = h;
  await c.update({revision: 1, settings: {...c.status().settings, policy: {...c.status().settings.policy, enabled: true}}});
  await c.connect({revision: c.status().revision});
  const req = http.request(h.origin + '/v1/responses', {method: 'POST'}); req.on('error', () => {});
  t.after(() => req.destroy()); req.end(JSON.stringify(sample));
  await waitFor(() => c.status().metrics.active.length === 1);
  const captured = c.status().metrics.active[0].policyRevision;
  await c.update({revision: c.status().revision, settings: {...c.status().settings, policy: {...c.status().settings.policy, enabled: false}}});
  assert.equal(c.status().connected, true); assert.equal(c.status().stats.activeRequests, 1);
  assert.equal(c.status().metrics.active[0].enabled, true); assert.equal(c.status().metrics.active[0].policyRevision, captured);
  await c.disconnect(); assert.equal(c.status().settings.policy.enabled, false); assert.equal(c.status().metrics.active.length, 0);
});

test('failed restoration keeps route synchronization usable for repair and retry', async t => {
  const h = await setup(t, (req, res) => res.end('{}')); await h.c.connect({revision: 1});
  const attached = fs.readFileSync(h.configPath, 'utf8');
  fs.writeFileSync(h.configPath, attached.replace('/magpie/v1', '/edited/v1'));
  await assert.rejects(h.c.disconnect(), /restore|still.*filter/i);
  assert.equal(h.c.status().connected, true);
  fs.writeFileSync(h.configPath, h.original);
  await waitFor(() => fs.readFileSync(h.configPath, 'utf8').includes('/magpie/v1'));
  await h.c.disconnect(); assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
});

test('disconnect retires repaired recovery records even when no gateway was created', async t => {
  const h = await setup(t, (req, res) => res.end('{}')); await h.c.close();
  fs.writeFileSync(h.configPath, h.original.replace(h.c.status().settings.upstream, h.origin));
  fs.writeFileSync(path.join(h.runtime, 'connection.json'), JSON.stringify({version: 1, configPath: h.configPath,
    upstream: h.c.status().settings.upstream, port: h.c.status().settings.port}));
  const c = createController({runtime: h.runtime}); t.after(() => c.close());
  assert.equal(c.status().connected, false); assert.ok(c.status().lastError);
  fs.writeFileSync(h.configPath, h.original);
  await assert.doesNotReject(c.disconnect()); assert.equal(c.status().connection, null);
  assert.equal(fs.existsSync(path.join(h.runtime, 'connection.json')), false);
});

for (const mode of ['upload', 'full', 'protected', 'direct', 'backoff', 'bypass']) {
  test('forced disconnect cancels ' + mode + ' and restores before upstream completion', {timeout: 6000}, async t => {
    let hits = 0, upstreamCanceled = false, restoredBeforeCancel = false;
    const h = await setup(t, (req, res) => {
      hits++; res.on('close', () => {
        upstreamCanceled = true;
        restoredBeforeCancel = fs.readFileSync(h.configPath, 'utf8') === h.original;
      }); req.resume();
      req.on('end', () => {
        if (mode === 'backoff') { res.writeHead(429, {'content-type': 'application/json', 'retry-after': '1'}); res.end('{"error":{"code":"rate_limit_exceeded"}}'); }
        else if (mode !== 'upload') { res.writeHead(200, {'content-type': 'text/event-stream'}); res.write('event: response.created\ndata: {"type":"response.created"}\n\n'); }
      });
    });
    const {c} = h;
    await c.update({revision: c.status().revision, settings: {...c.status().settings,
      policy: {...c.status().settings.policy, enabled: mode !== 'bypass', bufferResponse: mode === 'full',
        protectStreamStart: mode === 'protected', heartbeat: true}}});
    await c.connect({revision: c.status().revision});
    const req = http.request(h.origin + '/v1/responses', {method: 'POST', headers: mode === 'upload' ? {'content-length': 1000} : {}}, res => {
      res.on('error', () => {}); res.resume();
    });
    req.on('error', () => {}); t.after(() => req.destroy());
    const canceled = new Promise(resolve => req.once('close', resolve));
    if (mode === 'upload') req.write('{'); else req.end(JSON.stringify({...sample, stream: true}));
    await waitFor(() => c.status().stats.activeRequests === 1 && (mode === 'upload' || hits === 1));
    if (mode === 'backoff') await waitFor(() => c.status().metrics.active[0]?.phase === 'backoff');
    await assert.rejects(c.close(), /active requests/i);
    const attached = fs.readFileSync(h.configPath, 'utf8');
    const backup = fs.readFileSync(path.join(h.runtime, 'routes.json'), 'utf8');
    fs.writeFileSync(h.configPath, attached.replace('/magpie/v1', '/edited/v1'));
    await assert.rejects(c.disconnect(), /restore|still.*filter/i);
    assert.equal(c.status().connected, true); assert.equal(c.status().stats.activeRequests, 1);
    assert.equal(fs.existsSync(path.join(h.runtime, 'connection.json')), true);
    assert.equal(fs.readFileSync(path.join(h.runtime, 'routes.json'), 'utf8'), backup);
    fs.writeFileSync(h.configPath, attached);
    const before = Date.now(); await c.disconnect();
    assert.ok(Date.now() - before < 2000, 'Must not wait for the provider'); await canceled;
    assert.equal(c.status().stats.activeRequests, 0); assert.deepEqual(c.status().metrics.active, []);
    assert.equal(c.status().connected, false); assert.equal(c.status().settings.policy.enabled, mode !== 'bypass');
    assert.equal(fs.readFileSync(h.configPath, 'utf8'), h.original);
    assert.equal(fs.existsSync(path.join(h.runtime, 'connection.json')), false);
    if (!['upload', 'backoff'].includes(mode)) {
      await waitFor(() => upstreamCanceled); assert.equal(restoredBeforeCancel, true);
    }
    if (mode === 'backoff') {
      await new Promise(resolve => setTimeout(resolve, 1150)); assert.equal(hits, 1, 'Canceled backoff cannot replay');
    }
    await assert.rejects(call(h.origin, '/v1/responses', {body: '{}'}));
  });
}
