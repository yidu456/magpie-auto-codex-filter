'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {makeProxy, ADMIN, decodeBody} = require('./proxy.cjs');
const {listen, close, call} = require('./test-support.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const completed = 'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n';

async function harness(t, handler, options = {}) {
  const upstream = http.createServer(handler), upstreamOrigin = await listen(upstream);
  const rows = [];
  const proxy = makeProxy({getUpstream: () => upstreamOrigin, gateway: 'magpie', cleanup: 'preserve',
    token: 'test-token', log: (event, data) => rows.push({event, ...data}), ...options});
  const origin = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });
  return {origin, proxy, rows, health: async () => JSON.parse((await call(origin, ADMIN + '/health', {method: 'GET'})).body),
    stop: () => call(origin, ADMIN + '/idle-stop', {headers: {'x-filter-token': 'test-token'}})};
}
async function waitFor(check) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await delay(5); }
  assert.fail('Expected request phase was not reached');
}

test('preserve forwards validated decoded bytes without normalizing JSON or losing numeric precision', async t => {
  const raw = '{ "model":"private-model", "stream":false, "input":"private-prompt", "number":9007199254740993 }';
  const seen = [];
  const h = await harness(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({body: Buffer.concat(chunks).toString(), headers: req.headers}); res.end('{"ok":true}');
  });
  for (const [encoding, compress] of [['identity', x => x], ['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync],
    ['br', zlib.brotliCompressSync], ['zstd', zlib.zstdCompressSync]]) {
    const response = await call(h.origin, '/v1/responses', {body: compress(Buffer.from(raw)), headers: {'content-encoding': encoding}});
    assert.equal(response.status, 200);
    assert.equal(seen.at(-1).body, raw);
    assert.equal(seen.at(-1).headers['content-encoding'], undefined);
    assert.equal(Number(seen.at(-1).headers['content-length']), Buffer.byteLength(raw));
    assert.equal(decodeBody(compress(Buffer.from(raw)), encoding, 1024).toString(), raw);
  }
});

test('async compressed validation rejects invalid encodings, JSON types and decoded limit overflow', async t => {
  let calls = 0;
  const h = await harness(t, (req, res) => { calls++; req.resume(); res.end('{}'); }, {limit: 128});
  for (const [body, encoding, status, code] of [
    [Buffer.from('bad gzip'), 'gzip', 400, 'invalid_compressed_request'],
    [Buffer.from('{}'), 'unknown', 415, 'unsupported_content_encoding'],
    [Buffer.from('{}'), 'constructor', 415, 'unsupported_content_encoding'],
    [zlib.gzipSync(Buffer.from('{')), 'gzip', 400, 'invalid_request_json'],
    [zlib.gzipSync(Buffer.from('{"input":4}')), 'gzip', 400, 'invalid_input'],
    [zlib.gzipSync(Buffer.from('{"include":4}')), 'gzip', 400, 'invalid_include'],
    ...[['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync], ['zstd', zlib.zstdCompressSync]]
      .map(([encoding, compress]) => [compress(Buffer.from('{"input":"' + 'x'.repeat(129) + '"}')), encoding, 413, 'request_too_large'])]) {
    const response = await call(h.origin, '/v1/responses', {body, headers: {'content-encoding': encoding}});
    assert.equal(response.status, status); assert.equal(JSON.parse(response.body).error.code, code);
    assert.equal((await h.health()).inflightRequests, 0);
  }
  assert.equal(calls, 0);
});

test('cancellation during asynchronous decoding aborts preparation and never dispatches upstream', async t => {
  let release, signal, calls = 0;
  const original = zlib.gunzip;
  t.mock.method(zlib, 'gunzip', (body, options, callback) => {
    signal = options.signal;
    original(body, options, (error, raw) => { release = () => callback(error, raw); });
  });
  const h = await harness(t, (req, res) => { calls++; req.resume(); res.end('{}'); });
  const request = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-encoding': 'gzip'}});
  request.on('error', () => {}); request.end(zlib.gzipSync(Buffer.from('{"input":"hello"}')));
  t.after(() => { request.destroy(); release?.(); });
  await waitFor(() => !!release);
  assert.equal((await h.stop()).status, 409);
  request.destroy();
  await waitFor(async () => (await h.health()).inflightRequests === 0);
  assert.equal(signal.aborted, true);
  release(); await delay(20);
  assert.equal(calls, 0);
  assert.equal(h.rows.some(row => row.event === 'request-started'), false);
});

test('large compressed request allows a small sibling to complete while decoding', async t => {
  let decoding = false;
  const original = zlib.gunzip;
  t.mock.method(zlib, 'gunzip', (...args) => { decoding = true; return original(...args); });
  const order = [];
  const h = await harness(t, async (req, res) => {
    for await (const chunk of req) {}
    order.push(req.headers['x-test-size']); res.end('{}');
  });
  const body = zlib.gzipSync(Buffer.from('{"input":"' + 'x'.repeat(32 * 1024 * 1024) + '"}'));
  const large = call(h.origin, '/v1/responses', {body, headers: {'content-encoding': 'gzip', 'x-test-size': 'large'}});
  await waitFor(() => decoding);
  assert.equal((await call(h.origin, '/v1/responses', {body: '{"input":"small"}', headers: {'x-test-size': 'small'}})).status, 200);
  assert.equal(order[0], 'small'); assert.equal((await large).status, 200);
});

test('cancellation also terminates native decompression already in progress', async t => {
  let started = false, decodeError, calls = 0;
  const original = zlib.gunzip;
  t.mock.method(zlib, 'gunzip', (body, options, callback) => {
    started = true;
    return original(body, options, (error, raw) => { decodeError = error; callback(error, raw); });
  });
  const body = zlib.gzipSync(Buffer.from('{"input":"' + 'x'.repeat(32 * 1024 * 1024) + '"}'));
  const h = await harness(t, (req, res) => { calls++; req.resume(); res.end('{}'); });
  const request = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-encoding': 'gzip'}});
  request.on('error', () => {}); request.end(body);
  t.after(() => request.destroy());
  await waitFor(() => started); request.destroy();
  await waitFor(() => !!decodeError);
  assert.equal(decodeError.code, 'ABORT_ERR');
  assert.equal(calls, 0); assert.equal((await h.health()).inflightRequests, 0);
});

test('conditional preserves initial compressed bytes and serializes only the sanitized retry', async t => {
  const raw = '{ "input":[{"type":"reasoning","encrypted_content":"old"},{"type":"function_call","id":"old-id","call_id":"keep","name":"tool","arguments":"{}"}], "store":true }';
  const seen = [];
  const h = await harness(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({body: Buffer.concat(chunks).toString(), headers: req.headers});
    if (seen.length === 1) { res.writeHead(400); res.end('{"error":{"code":"invalid_encrypted_content"}}'); }
    else res.end('{}');
  }, {cleanup: 'conditional', retryDelay: () => 1});
  assert.equal((await call(h.origin, '/v1/responses', {body: zlib.gzipSync(Buffer.from(raw)), headers: {'content-encoding': 'gzip'}})).status, 200);
  assert.equal(seen[0].body, raw);
  assert.deepEqual(JSON.parse(seen[1].body), {input: [{type: 'function_call', call_id: 'keep', name: 'tool', arguments: '{}'}], store: false});
  for (const row of seen) {
    assert.equal(row.headers['content-encoding'], undefined);
    assert.equal(Number(row.headers['content-length']), Buffer.byteLength(row.body));
  }
});

for (const abort of [false, true]) test('committed SSE drains original chunks with admission held' + (abort ? ' until canceled' : ' until delivered'), async t => {
  const frame = 'event: response.output_text.delta\ndata: {"delta":"' + 'x'.repeat(8 * 1024 * 1024) + '"}\n\n';
  const h = await harness(t, (req, res) => { req.resume(); res.writeHead(200, {'content-type': 'text/event-stream'}); res.end(frame + completed); });
  let writes = 0, blocked = 0, endBytes = 0;
  h.proxy.prependListener('request', (req, res) => {
    if (req.url !== '/v1/responses') return;
    const write = res.write, end = res.end;
    res.write = function(chunk, ...args) { writes++; const ok = write.call(this, chunk, ...args); if (!ok) blocked++; return ok; };
    res.end = function(chunk, ...args) { endBytes += chunk ? Buffer.byteLength(chunk) : 0; return end.call(this, chunk, ...args); };
  });
  let incoming;
  const result = new Promise((resolve, reject) => {
    const request = http.request(h.origin + '/v1/responses', {method: 'POST'}, res => {
      incoming = res; res.pause(); const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    });
    request.on('error', reject); request.end('{"stream":true,"input":"hello"}');
    t.after(() => request.destroy());
  });
  result.catch(() => {});
  await waitFor(() => incoming && (blocked || endBytes));
  assert.equal(endBytes, 0, 'must not concatenate the full committed response for res.end');
  assert.ok(writes > 1); assert.ok(blocked > 0);
  assert.equal((await h.stop()).status, 409);
  assert.equal((await h.health()).inflightRequests, 1);
  if (abort) incoming.destroy();
  else { incoming.resume(); assert.equal(await result, frame + completed); }
  await waitFor(async () => (await h.health()).inflightRequests === 0);
  const writesAfter = writes; await delay(20); assert.equal(writes, writesAfter);
});

test('late failed tool chunks are discarded and metrics contain only observed durations and bytes', async t => {
  let attempts = 0;
  const success = 'event: response.output_text.delta\ndata: {"delta":"safe-result"}\n\n' + completed;
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(200, {'content-type': 'text/event-stream'});
    if (++attempts === 1) {
      res.write('event: response.output_item.done\ndata: {"item":{"type":"function_call","name":"private-tool","arguments":"private-secret"}}\n\n');
      setTimeout(() => res.end('event: response.failed\ndata: {"response":{"error":{"code":"stream_incomplete"}}}\n\n'), 15);
    } else setTimeout(() => res.end(success), 10);
  }, {retryDelay: () => 20});
  const raw = '{ "input":"private-prompt", "model":"private-model", "stream":true }';
  const result = await call(h.origin, '/v1/responses', {body: raw});
  assert.equal(result.body, success); assert.equal(attempts, 2);
  const finished = h.rows.find(row => row.event === 'request-finished');
  assert.ok(finished.timingsMs, 'stage measurements must be available');
  for (const key of ['preparation', 'headers', 'firstResponseData', 'upstreamComplete', 'delivery', 'backoff']) {
    assert.ok(Number.isFinite(finished.timingsMs[key]) && finished.timingsMs[key] >= 0, key);
  }
  assert.ok(finished.timingsMs.backoff >= 10);
  assert.equal(finished.bytes.received, Buffer.byteLength(raw));
  assert.equal(finished.bytes.decoded, Buffer.byteLength(raw));
  assert.equal(finished.bytes.delivered, Buffer.byteLength(success));
  assert.ok(finished.bytes.upstream > finished.bytes.delivered);
  assert.ok(finished.bytes.bufferedPeak >= finished.bytes.delivered);
  assert.doesNotMatch(JSON.stringify(h.rows), /private-prompt|private-model|private-tool|private-secret|test-token/);
});

test('incomplete SSE retains its original terminal payload rather than becoming a success', async t => {
  const incomplete = 'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n';
  const h = await harness(t, (req, res) => { req.resume(); res.writeHead(200, {'content-type': 'text/event-stream'}); res.end(incomplete); });
  assert.equal((await call(h.origin, '/v1/responses', {body: '{"stream":true}'})).body, incomplete);
  assert.equal(h.rows.find(row => row.event === 'request-finished').outcome, 'failed');
});

test('unobserved SSE and backoff timings are omitted for a plain JSON response', async t => {
  const h = await harness(t, (req, res) => { req.resume(); res.end('{}'); });
  await call(h.origin, '/v1/responses', {body: '{"input":"hello"}'});
  const finished = h.rows.find(row => row.event === 'request-finished');
  assert.equal(finished.timingsMs.firstResponseData, undefined);
  assert.equal(finished.timingsMs.delivery, undefined);
  assert.equal(finished.timingsMs.backoff, undefined);
  assert.equal(finished.bytes.delivered, undefined);
});

test('ping before model delta measures first response data without claiming model first-content timing', async t => {
  const ping = ': ping\n\n';
  const content = 'event: response.output_text.delta\ndata: {"delta":"mock-text"}\n\n' + completed;
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(200, {'content-type': 'text/event-stream'}); res.write(ping);
    setTimeout(() => res.end(content), 60);
  });
  assert.equal((await call(h.origin, '/v1/responses', {body: '{"stream":true}'})).body, ping + content);
  const timings = h.rows.find(row => row.event === 'request-finished').timingsMs;
  assert.ok(Number.isFinite(timings.firstResponseData));
  assert.ok(timings.upstreamComplete - timings.firstResponseData >= 30, 'ping data precedes the delayed model delta');
  assert.equal(Object.hasOwn(timings, 'firstContent'), false);
  assert.deepEqual(Object.keys(timings).sort(), ['delivery', 'firstResponseData', 'headers', 'preparation', 'upstreamComplete']);
});

test('upstream completion timing describes the final HTTP attempt rather than the first rejected attempt', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume();
    if (++attempts === 1) { res.writeHead(429); res.end('{"error":{"code":"rate_limit_exceeded"}}'); }
    else setTimeout(() => res.end('{}'), 40);
  }, {retryDelay: () => 30});
  await call(h.origin, '/v1/responses', {body: '{}'});
  const finished = h.rows.find(row => row.event === 'request-finished');
  assert.ok(finished.timingsMs.upstreamComplete > finished.timingsMs.headers + finished.timingsMs.backoff + 20);
});
