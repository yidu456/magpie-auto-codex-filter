'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {makeProxy, ADMIN} = require('./proxy.cjs');
const {listen, close, call} = require('./test-support.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function harness(t, handler = (req, res) => { req.resume(); res.end('{"ok":true}'); }, options = {}) {
  const upstream = http.createServer(handler), upstreamOrigin = await listen(upstream);
  let stops = 0;
  const proxy = makeProxy({getUpstream: () => upstreamOrigin, token: 'test-token',
    onStop: () => { stops++; }, ...options});
  const origin = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });
  return {origin, stops: () => stops,
    stop: (route = 'idle-stop', headers = {'x-filter-token': 'test-token'}) => call(origin, ADMIN + '/' + route, {headers}),
    health: async () => JSON.parse((await call(origin, ADMIN + '/health', {method: 'GET'})).body)};
}
async function waitFor(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await delay(5); }
  assert.fail('Timed out waiting for the test request to reach its expected phase');
}
function upload(origin, route, body) {
  let response;
  const result = new Promise((resolve, reject) => { response = {resolve, reject}; });
  const request = http.request(origin + route, {method: 'POST', headers: {'content-length': Buffer.byteLength(body)}}, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => response.resolve({status: res.statusCode, body: Buffer.concat(chunks).toString()}));
    res.on('error', response.reject);
  });
  request.on('error', response.reject);
  result.catch(() => {});
  request.write(body.slice(0, Math.floor(body.length / 2)));
  return {request, result, finish: () => request.end(body.slice(Math.floor(body.length / 2)))};
}

for (const route of ['/v1/responses', '/upload']) {
  test('partial upload ' + route + ' blocks idle-stop before body parsing and releases on finish', async t => {
    const h = await harness(t, async (req, res) => {
      try { for await (const chunk of req) {} res.end('{"ok":true}'); }
      catch (error) { if (error.code !== 'ECONNRESET') throw error; }
    });
    const body = '{"input":"still uploading"}', pending = upload(h.origin, route, body);
    t.after(() => pending.request.destroy());
    await once(pending.request, 'socket');
    await delay(25);
    const stopped = await h.stop();
    assert.equal(stopped.status, 409);
    assert.equal(JSON.parse(stopped.body).error.code, 'filter_busy');
    assert.equal(h.stops(), 0);
    assert.equal((await h.health()).inflightRequests, 1);
    pending.finish(); assert.equal((await pending.result).status, 200);
    assert.equal((await h.health()).inflightRequests, 0);
    assert.equal((await h.stop()).status, 200);
    assert.equal(h.stops(), 1);
  });
}

test('aborting partial upload releases admission exactly once', async t => {
  const h = await harness(t), pending = upload(h.origin, '/v1/responses', '{"input":"not finished"}');
  await once(pending.request, 'socket'); await delay(25);
  assert.equal((await h.stop()).status, 409);
  pending.request.destroy();
  await waitFor(async () => (await h.health()).inflightRequests === 0);
  assert.equal((await h.stop()).status, 200);
  assert.equal(h.stops(), 1);
});

test('active SSE and retry backoff both refuse idle-stop', async t => {
  for (const phase of ['stream', 'backoff']) await t.test(phase, async t => {
    let release, reached = false, attempts = 0;
    const h = await harness(t, (req, res) => {
      req.resume(); attempts++;
      if (phase === 'backoff' && attempts === 1) { res.writeHead(429); res.end('{"error":{"code":"rate_limit_exceeded"}}'); return; }
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write('event: response.output_text.delta\ndata: {"delta":"buffered"}\n\n');
      release = () => res.end('event: response.completed\ndata: {"response":{}}\n\n');
      reached = true;
    }, {retryDelay: () => 150, log: event => { if (event === 'retry-scheduled') reached = true; }});
    const response = call(h.origin, '/v1/responses', {body: '{"input":"hello","stream":true}'});
    response.catch(() => {});
    await waitFor(() => reached);
    assert.equal((await h.stop()).status, 409);
    assert.equal(h.stops(), 0);
    await waitFor(() => !!release); release();
    assert.equal((await response).status, 200);
    assert.equal((await h.health()).inflightRequests, 0);
    assert.equal((await h.stop()).status, 200);
  });
});

test('idle-stop authenticates controls and excludes health polling from admission', async t => {
  const h = await harness(t, undefined, {gateway: 'magpie', cleanup: 'preserve'});
  for (const headers of [{}, {'x-filter-token': 'wrong'}, {'x-filter-token': 'test-token', origin: 'https://example.invalid'}]) {
    assert.equal((await h.stop('idle-stop', headers)).status, 403);
  }
  assert.equal((await call(h.origin, '/magpie' + ADMIN + '/idle-stop', {headers: {'x-filter-token': 'test-token'}})).status, 403);
  assert.equal(h.stops(), 0);
  const state = await h.health();
  assert.equal(state.inflightRequests, 0);
  assert.doesNotMatch(JSON.stringify(state), /test-token/);
  assert.equal((await h.stop()).status, 200);
});

test('idle-stop closes admission synchronously before asynchronous restoration and refuses a second stop', async t => {
  let release, entered = false, calls = 0;
  const restoration = new Promise(resolve => { release = resolve; });
  const h = await harness(t, undefined, {onStop: async () => { entered = true; calls++; await restoration; }});
  const stopping = h.stop();
  try {
    await waitFor(() => entered);
    const rejected = await call(h.origin, '/v1/responses', {body: '{"input":"too late"}'});
    assert.equal(rejected.status, 503);
    assert.equal(JSON.parse(rejected.body).error.code, 'filter_stopping');
    assert.equal((await h.stop()).status, 409);
    assert.equal(calls, 1);
    assert.equal((await h.health()).inflightRequests, 0);
  } finally { release(); await stopping; }
  assert.equal((await call(h.origin, '/models', {method: 'GET'})).status, 503);
});

test('failed restoration reopens admission without stopping or stranding the gate', async t => {
  let calls = 0;
  const h = await harness(t, undefined, {onStop: async () => { if (++calls === 1) throw new Error('restore failed'); }});
  assert.equal((await h.stop()).status, 500);
  assert.equal((await call(h.origin, '/v1/responses', {body: '{"input":"still available"}'})).status, 200);
  assert.equal((await h.health()).inflightRequests, 0);
  assert.equal((await h.stop()).status, 200);
  assert.equal(calls, 2);
});

test('malformed, oversized, compressed and refused requests do not leak admission', async t => {
  const h = await harness(t, undefined, {limit: 64});
  for (const [route, body, headers, status] of [['/v1/responses', '{', {}, 400],
    ['/v1/responses', 'x'.repeat(65), {}, 413], ['/v1/responses', 'bad-gzip', {'content-encoding': 'gzip'}, 400],
    ['/v1/responses/compact', '{}', {}, 409], ['/v1/responses', '{"input":1}', {}, 400]]) {
    assert.equal((await call(h.origin, route, {body, headers})).status, status);
    assert.equal((await h.health()).inflightRequests, 0);
  }
  assert.equal((await h.stop()).status, 200);
});

test('legacy stop still invokes recovery while requests are admitted', async t => {
  const h = await harness(t), pending = upload(h.origin, '/v1/responses', '{"input":"legacy stop"}');
  t.after(() => pending.request.destroy());
  await once(pending.request, 'socket'); await delay(25);
  assert.equal((await h.stop('stop')).status, 200);
  assert.equal(h.stops(), 1);
  pending.finish(); await pending.result;
});
