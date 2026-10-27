'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {once, EventEmitter} = require('node:events');
const {makeProxy} = require('./proxy.cjs');
const {normalizePolicy} = require('./policy.cjs');
const {makeSseParser, responseUsage} = require('./sse.cjs');
const {listen, close, call, sample} = require('./test-support.cjs');
const frame = (type, extra = {}) => 'event: ' + type + '\ndata: ' + JSON.stringify({type, ...extra}) + '\n\n';
const delta = frame('response.output_text.delta', {delta: 'hello'});
const completed = frame('response.completed', {response: {usage: {input_tokens: 10, output_tokens: 2,
  total_tokens: 12, input_tokens_details: {cached_tokens: 4}}}});
async function harness(t, handler, policy = {}, options = {}) {
  const events = [], logs = [], signal = new EventEmitter();
  const upstream = http.createServer(handler);
  const origin = await listen(upstream);
  const proxy = makeProxy({mode: 'magpie-auto', getUpstream: () => origin,
    getPolicy: () => ({bufferResponse: false, protectStreamStart: true, heartbeat: false, ...policy}),
    retryDelay: () => 1, observe: (event, data) => { events.push({event, ...data}); signal.emit(event); },
    log: (event, data) => logs.push({event, ...data}), ...options});
  const proxyOrigin = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });
  return {origin: proxyOrigin, events, logs, proxy, signal};
}
const sse = res => res.writeHead(200, {'content-type': 'text/event-stream'});
const send = h => call(h.origin, '/v1/responses', {body: JSON.stringify(sample)});
const eventsOf = (h, event) => h.events.filter(value => value.event === event);

test('old direct policies default protection OFF and booleans remain independently valid', () => {
  assert.equal(normalizePolicy({bufferResponse: false}).protectStreamStart, false);
  assert.equal(normalizePolicy({bufferResponse: true, protectStreamStart: true}).protectStreamStart, true);
  assert.throws(() => normalizePolicy({protectStreamStart: 1}));
});

test('protected early history and relay failures recover before forwarding and retain tool pairs', async t => {
  const bodies = [];
  const h = await harness(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks)));
    sse(res);
    res.end(bodies.length === 1 ? frame('error', {error: {code: 'invalid_encrypted_content'}})
      : bodies.length === 2 ? frame('response.failed', {response: {error: {code: 'bad_response'}}})
        : delta + completed);
  });
  const result = await send(h);
  assert.equal(result.body, delta + completed);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[1].input.some(item => item.type === 'reasoning'), false);
  assert.deepEqual(bodies[1].input.filter(item => item.call_id).map(item => item.call_id),
    ['call_1', 'call_1', 'call_2', 'call_2']);
  assert.equal(eventsOf(h, 'history-cleanup').length, 1);
  assert.equal(eventsOf(h, 'retry-accepted').length, 1);
  assert.equal(eventsOf(h, 'response-usage').length, 1);
  assert.deepEqual(eventsOf(h, 'request-metadata').map(({model, streaming}) => ({model, streaming})),
    [{model: 'mock-model', streaming: true}]);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'success');
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('first delta is forwarded before completion; late history failure is not cleaned or replayed', async t => {
  let attempts = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const late = frame('response.failed', {response: {error: {code: 'invalid_encrypted_content'}}});
  const h = await harness(t, async (req, res) => {
    req.resume(); attempts++; sse(res); res.write(delta); await gate; res.end(late);
  });
  const result = new Promise((resolve, reject) => {
    const req = http.request(h.origin + '/v1/responses', {method: 'POST'}, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.includes('hello')) release(); });
      res.on('end', () => resolve(body)); res.on('error', reject);
    });
    req.setTimeout(600, () => req.destroy(new Error('first delta was buffered')));
    req.on('error', reject); req.end(JSON.stringify(sample));
  });
  assert.equal(await result, delta + late);
  assert.equal(attempts, 1);
  assert.equal(eventsOf(h, 'history-cleanup').length, 0);
  assert.equal(eventsOf(h, 'retry-scheduled').length, 0);
  assert.equal(eventsOf(h, 'stream-error').length, 1);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
});

test('completion without delta forwards once and usage is validated once', async t => {
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(completed + completed); });
  const result = await send(h);
  assert.match(result.body, /response.completed/);
  assert.equal(eventsOf(h, 'forwarded').length, 1);
  assert.equal(eventsOf(h, 'response-usage').length, 1);
  assert.deepEqual(eventsOf(h, 'response-usage')[0].usage,
    {input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: {cached_tokens: 4}});
});

test('fragmented UTF8/CRLF, primitives and misleading events cannot spoof terminal status', async t => {
  const misleading = 'data: null\r\n\r\ndata: []\r\n\r\ndata: "response.completed"\r\n\r\n'
    + 'event: unknown\r\ndata: {"type":"response.completed"}\r\n\r\n'
    + frame('response.output_text.delta', {delta: '你好 response.completed'}).replaceAll('\n', '\r\n');
  const terminal = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\r\n\r\n';
  const bytes = Buffer.from(misleading + terminal);
  const h = await harness(t, async (req, res) => {
    req.resume(); sse(res);
    for (let i = 0; i < bytes.length; i += 3) { res.write(bytes.subarray(i, i + 3)); await new Promise(r => setImmediate(r)); }
    res.end();
  });
  assert.equal((await send(h)).body, bytes.toString());
  assert.equal(eventsOf(h, 'response-usage').length, 1);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'success');
});

test('direct gzip remains byte transparent and passive inspection reports late failure', async t => {
  const zipped = zlib.gzipSync(delta + frame('response.failed', {response: {error: {code: 'bad_response'}}}));
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(200, {'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'content-length': zipped.length});
    res.end(zipped);
  }, {protectStreamStart: false});
  const bytes = await new Promise((resolve, reject) => {
    const req = http.request(h.origin + '/v1/responses', {method: 'POST'}, res => {
      assert.equal(res.headers['content-encoding'], 'gzip');
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }); req.on('error', reject); req.end(JSON.stringify(sample));
  });
  assert.deepEqual(bytes, zipped);
  if (!eventsOf(h, 'request-finished').length) await once(h.signal, 'request-finished', {signal: AbortSignal.timeout(1000)});
  assert.equal(eventsOf(h, 'retry-scheduled').length, 0);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
});

test('partial uploads are observable before parse and client cancel finishes once', async t => {
  const h = await harness(t, (req, res) => { req.resume(); res.end('{}'); });
  const request = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-length': '10000'}});
  request.on('error', () => {});
  request.write('{"model":');
  await once(h.signal, 'request-started', {signal: AbortSignal.timeout(1000)});
  assert.equal(h.proxy.stats.activeRequests, 1);
  assert.deepEqual(eventsOf(h, 'request-started').map(({model, streaming}) => ({model, streaming})),
    [{model: null, streaming: null}]);
  assert.equal(eventsOf(h, 'request-progress')[0].phase, 'upload');
  request.destroy();
  await once(h.signal, 'request-finished', {signal: AbortSignal.timeout(1000)});
  assert.equal(eventsOf(h, 'request-finished').length, 1);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'canceled');
  assert.equal(h.proxy.stats.activeRequests, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.at(-1).event, 'request-finished');
});

test('core bypass HTTP errors have metadata without decoding response bodies', async t => {
  const h = await harness(t, (req, res) => { req.resume(); res.writeHead(403); res.end('private-error-text'); }, {enabled: false});
  assert.equal((await send(h)).body, 'private-error-text');
  assert.equal(eventsOf(h, 'http-error').length, 1);
  assert.equal(eventsOf(h, 'http-error')[0].status, 403);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
  assert.doesNotMatch(JSON.stringify(h.events), /private-error-text|foreign-account-ciphertext|arguments|result/);
});

test('oversized HTTP error bodies still emit one body-free fallback observation', async t => {
  const marker = 'private-upstream-message';
  const body = JSON.stringify({error: {code: 'invalid_api_key', message: marker + 'x'.repeat(70000)}});
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(401, {'content-type': 'application/json'}); res.end(body);
  });
  const result = await send(h);
  assert.equal(result.status, 401);
  assert.equal(result.body, body);
  assert.deepEqual(eventsOf(h, 'http-error').map(({status, kind, errorCode}) => ({status, kind, errorCode})),
    [{status: 401, kind: 'other', errorCode: 'http_401'}]);
  assert.doesNotMatch(JSON.stringify(eventsOf(h, 'http-error')), new RegExp(marker));
});

test('direct successful 2xx SSE is inspected without changing status or bytes', async t => {
  const text = frame('response.completed', {response: {usage: {input_tokens: 1, output_tokens: 2}}});
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(201, {'content-type': 'text/event-stream'}); res.end(text);
  }, {protectStreamStart: false});
  const result = await send(h);
  assert.equal(result.status, 201);
  assert.equal(result.body, text);
  assert.deepEqual(eventsOf(h, 'response-usage').map(value => value.usage), [{input_tokens: 1, output_tokens: 2}]);
  assert.equal(eventsOf(h, 'stream-error').length, 0);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'success');
});

test('non-inspected SSE statuses do not fabricate stream incompletion', async t => {
  const text = 'event: response.output_text.delta\ndata: {"delta":"redirect"}\n\n';
  const h = await harness(t, (req, res) => {
    req.resume(); res.writeHead(302, {'content-type': 'text/event-stream'}); res.end(text);
  }, {protectStreamStart: false});
  const result = await send(h);
  assert.equal(result.status, 302);
  assert.equal(result.body, text);
  assert.equal(eventsOf(h, 'stream-error').length, 0);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'unavailable');
});

test('prelude cap does not cap post-delta content in the same network chunk', async t => {
  const text = delta + frame('response.output_text.delta', {delta: 'x'.repeat(3000)}) + completed;
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(text); }, {}, {limit: 512});
  const result = await call(h.origin, '/v1/responses', {body: '{"stream":true}'});
  assert.equal(result.status, 200);
  assert.equal(result.body, text);
});

test('malformed and oversized passive frames preserve bytes and make metadata unavailable', async t => {
  for (const bad of ['data: not JSON\n\n', 'data: ' + 'x'.repeat(70000) + '\n\n']) {
    await t.test(bad.length > 100 ? 'oversized' : 'malformed', async t => {
      const text = delta + bad + completed;
      const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(text); });
      assert.equal((await send(h)).body, text);
      assert.equal(eventsOf(h, 'response-usage').length, 0);
      assert.equal(eventsOf(h, 'response-observation-unavailable').length, 1);
      assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'unavailable');
    });
  }
});

test('full buffering takes precedence over protection and discards failed tool output', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume(); attempts++; sse(res);
    res.end(attempts === 1 ? delta + frame('response.failed', {response: {error: {code: 'bad_response'}}}) : completed);
  }, {bufferResponse: true});
  assert.equal((await send(h)).body, completed);
  assert.equal(attempts, 2);
});

test('core bypass, malformed input and observer exceptions cannot affect lifecycle or forwarding', async t => {
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(completed); }, {enabled: false});
  await send(h);
  assert.equal(eventsOf(h, 'response-usage').length, 0);
  assert.equal(eventsOf(h, 'request-started')[0].enabled, false);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'unavailable');
  const blocked = await harness(t, (req, res) => { req.resume(); res.end('{}'); });
  assert.equal((await call(blocked.origin, '/v1/responses', {body: '['})).status, 400);
  assert.equal(eventsOf(blocked, 'request-started').length, 1);
  assert.equal(eventsOf(blocked, 'request-finished')[0].outcome, 'failed');
  const throws = await harness(t, (req, res) => { req.resume(); sse(res); res.end(completed); }, {},
    {observe() { throw new Error('observer failure'); }});
  assert.equal((await send(throws)).status, 200);
});

test('post-delta disconnect and deadline never retry and release active requests', async t => {
  for (const deadline of [false, true]) {
    await t.test(deadline ? 'deadline' : 'disconnect', async t => {
      let attempts = 0;
      const h = await harness(t, (req, res) => {
        req.resume(); attempts++; sse(res); res.write(delta);
        if (!deadline) setTimeout(() => res.destroy(), 20);
      }, {}, {deadlineMs: 70});
      await assert.rejects(send(h));
      assert.equal(attempts, 1);
      assert.equal(eventsOf(h, 'retry-scheduled').length, 0);
      assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
      assert.equal(h.proxy.stats.activeRequests, 0);
    });
  }
});

test('response.incomplete is a single failed observation, not HTTP200 success', async t => {
  const text = frame('response.incomplete');
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(text); });
  assert.equal((await send(h)).body, text);
  assert.equal(eventsOf(h, 'stream-error').length, 1);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
});

test('malformed prelude does not change full buffering semantics', async t => {
  const text = 'data: not-json\n\n' + completed;
  let attempts = 0;
  const h = await harness(t, (req, res) => { req.resume(); attempts++; sse(res); res.end(text); }, {bufferResponse: true});
  assert.equal((await send(h)).body, text);
  assert.equal(attempts, 1);
});

test('known passive failure survives subsequent observation loss', async t => {
  const text = delta + frame('response.failed', {response: {error: {code: 'bad_response'}}})
    + 'data: malformed\n\n' + completed;
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(text); });
  assert.equal((await send(h)).body, text);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
  assert.equal(eventsOf(h, 'response-usage').length, 0);
});

test('passive parser stops retaining oversized frames and usage never includes payload fields', () => {
  const unavailable = [], events = [];
  const parser = makeSseParser({limit: 1024, onUnavailable: value => unavailable.push(value), onEvent: (...args) => events.push(args)});
  for (let i = 0; i < 100; i++) {
    parser.write(Buffer.alloc(2048, 'x'));
    assert.ok(parser.pendingBytes <= 1024);
  }
  parser.write(Buffer.from(completed));
  assert.equal(unavailable.length, 1);
  assert.equal(events.length, 0);
  for (const bad of [null, [], {input_tokens: -1, output_tokens: 2}, {input_tokens: 1.2, output_tokens: 1},
    {input_tokens: 1, output_tokens: 2, input_tokens_details: {cached_tokens: 2}}, {input_tokens: 1}]) {
    assert.equal(responseUsage(bad), null);
  }
  assert.deepEqual(responseUsage({input_tokens: 3, output_tokens: 1, secret: 'do-not-observe',
    input_tokens_details: {cached_tokens: 1, prompt: 'secret'}}),
  {input_tokens: 3, output_tokens: 1, input_tokens_details: {cached_tokens: 1}});
});

test('protected Azure/relay handler exclusions stay authoritative', async t => {
  for (const [handler, error] of [
    ['azureResource', {type: 'invalid_request_error', message: 'The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.'}],
    ['transport', {code: 'server_error'}], ['streamIncomplete', {}]
  ]) {
    for (const enabled of [false, true]) await t.test(handler + '=' + enabled, async t => {
      let attempts = 0;
      const h = await harness(t, (req, res) => {
        req.resume(); attempts++; sse(res);
        res.end(attempts === 1 ? frame('response.failed', {response: {error}}) : completed);
      }, {handlers: {[handler]: enabled}});
      await send(h);
      assert.equal(attempts, enabled ? 2 : 1);
    });
  }
});

test('protected policies remain snapshotted across retries', async t => {
  let policy = {bufferResponse: false, protectStreamStart: true, heartbeat: false, revision: 4}, attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume(); attempts++; sse(res);
    policy = {bufferResponse: false, protectStreamStart: false, heartbeat: false, handlers: {transport: false}, revision: 5};
    res.end(attempts % 2 ? frame('response.failed', {response: {error: {code: 'bad_response'}}}) : completed);
  }, {}, {getPolicy: () => policy});
  assert.equal((await send(h)).body, completed);
  assert.equal(attempts, 2);
  assert.equal(eventsOf(h, 'request-started')[0].policyRevision, 4);
  await send(h);
  assert.equal(attempts, 3);
  assert.equal(eventsOf(h, 'request-started')[1].policyRevision, 5);
});

test('heartbeat runs only before protected content and stops at first delta', async t => {
  const h = await harness(t, (req, res) => {
    req.resume(); sse(res);
    setTimeout(() => res.write(delta), 25);
    setTimeout(() => res.end(completed), 80);
  }, {heartbeat: true}, {heartbeatMs: 5});
  const text = (await send(h)).body;
  assert.match(text.slice(0, text.indexOf('hello')), /event: response.in_progress/);
  assert.doesNotMatch(text.slice(text.indexOf('hello')), /event: response.in_progress/);
  assert.equal(eventsOf(h, 'forwarded').length, 1);
});

test('prelude cap rejects streams with no output without buffering an entire response', async t => {
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(': ' + 'x'.repeat(2000)); }, {}, {limit: 512});
  const result = await call(h.origin, '/v1/responses', {body: '{"stream":true}'});
  assert.equal(result.status, 502);
  assert.match(result.body, /response_too_large/);
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('slow downstream backpressures protected prelude and streaming tail; cancel never replays', async t => {
  let produced = 0, attempts = 0;
  const total = 32 * 1024 * 1024;
  const chunk = Buffer.from(frame('response.output_text.delta', {delta: 'x'.repeat(16000)}));
  const h = await harness(t, async (req, res) => {
    req.resume(); attempts++; sse(res);
    res.write(': ' + 'p'.repeat(128 * 1024) + '\n\n' + delta);
    while (produced < total && !res.destroyed) {
      produced += chunk.length;
      if (!res.write(chunk)) {
        const controller = new AbortController();
        const canceled = () => controller.abort();
        res.once('close', canceled);
        try { await once(res, 'drain', {signal: controller.signal}); } catch { break; }
        finally { res.removeListener('close', canceled); }
      }
    }
    if (!res.destroyed) res.end(completed);
  }, {}, {limit: 256 * 1024});
  const response = await new Promise((resolve, reject) => {
    const request = http.request(h.origin + '/v1/responses', {method: 'POST'}, resolve);
    request.on('error', reject); request.end(JSON.stringify(sample));
  });
  response.on('error', () => {}); response.pause();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(produced < total, 'upstream must stall instead of retaining the full tail');
  response.destroy();
  if (!eventsOf(h, 'request-finished').length) await once(h.signal, 'request-finished', {signal: AbortSignal.timeout(1000)});
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'canceled');
  assert.equal(attempts, 1);
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('protected fragmented gzip retries early relay errors and delivers decoded success', async t => {
  let attempts = 0;
  const h = await harness(t, async (req, res) => {
    req.resume(); attempts++;
    const bytes = zlib.gzipSync(attempts === 1 ? frame('response.failed', {response: {error: {code: 'server_error'}}})
      : delta + completed);
    res.writeHead(200, {'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'content-length': bytes.length});
    for (let i = 0; i < bytes.length; i += 3) { res.write(bytes.subarray(i, i + 3)); await new Promise(resolve => setImmediate(resolve)); }
    res.end();
  });
  const result = await send(h);
  assert.equal(result.body, delta + completed);
  assert.equal(result.headers['content-encoding'], undefined);
  assert.equal(attempts, 2);
  assert.equal(eventsOf(h, 'response-usage').length, 1);
});

test('delivered client-tool items close the replay boundary even without text deltas', async t => {
  let attempts = 0;
  const text = frame('response.output_item.done', {item: {type: 'custom_tool_call', call_id: 'safe-pair', input: 'private-tool-input'}})
    + frame('response.failed', {response: {error: {code: 'invalid_encrypted_content'}}});
  const h = await harness(t, (req, res) => { req.resume(); attempts++; sse(res); res.end(text); });
  assert.equal((await send(h)).body, text);
  assert.equal(attempts, 1);
  assert.equal(eventsOf(h, 'history-cleanup').length, 0);
  assert.doesNotMatch(JSON.stringify(h.events), /private-tool-input|safe-pair|foreign-account-ciphertext/);
});

test('cancel during protected backoff prevents retry dispatch', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume(); attempts++; sse(res); res.end(frame('response.failed', {response: {error: {code: 'bad_response'}}}));
  }, {}, {retryDelay: () => 100});
  const request = http.request(h.origin + '/v1/responses', {method: 'POST'});
  request.on('error', () => {}); request.end(JSON.stringify(sample));
  await once(h.signal, 'retry-scheduled', {signal: AbortSignal.timeout(1000)});
  request.destroy();
  await once(h.signal, 'request-finished', {signal: AbortSignal.timeout(1000)});
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(attempts, 1);
  assert.equal(eventsOf(h, 'retry-dispatched').length, 0);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'canceled');
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('protected pre-output deadline finishes without replay or success claims', async t => {
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.flushHeaders(); }, {},
    {deadlineMs: 40, idleTimeoutMs: 1000});
  assert.equal((await send(h)).status, 502);
  assert.equal(eventsOf(h, 'request-finished')[0].outcome, 'failed');
  assert.equal(eventsOf(h, 'forwarded').length, 1);
  assert.equal(eventsOf(h, 'retry-dispatched').length, 0);
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('parser coalesces byte fragmentation and preserves supplementary UTF8 characters', () => {
  const values = [];
  const text = frame('response.output_text.delta', {delta: '\ud83d\ude80'.repeat(4096)}).replaceAll('\n', '\r\n');
  const parser = makeSseParser({limit: Buffer.byteLength(text), onUnavailable() { assert.fail('valid fragmented frame'); },
    onEvent: (event, value) => values.push(value.delta)});
  const bytes = Buffer.from(text);
  for (const byte of bytes) parser.write(Buffer.from([byte]));
  assert.deepEqual(values, ['\ud83d\ude80'.repeat(4096)]);
  assert.equal(parser.pendingBytes, 0);
});

test('proxy control routes do not create orphaned request observations', async t => {
  const h = await harness(t, (req, res) => { req.resume(); res.end('{}'); });
  assert.equal((await call(h.origin, '/__codex_filter__/health', {method: 'GET'})).status, 200);
  assert.equal((await call(h.origin, '/__codex_filter__/stop', {body: '{}'})).status, 403);
  assert.deepEqual(h.events, []);
});

test('rejected observer promises are isolated as well as synchronous throws', async t => {
  let calls = 0;
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(completed); }, {},
    {observe() { calls++; return Promise.reject(new Error('observer rejected')); }});
  assert.equal((await send(h)).status, 200);
  assert.ok(calls > 0);
  assert.equal(h.proxy.stats.activeRequests, 0);
});

test('client close before response finish is canceled even after upstream completion', async t => {
  let downstream, finished, deliveries = 0;
  const done = new Promise(resolve => { finished = resolve; });
  const h = await harness(t, (req, res) => { req.resume(); sse(res); res.end(completed); }, {bufferResponse: true},
    {observe(event, data) {
      if (event === 'response-usage') downstream.destroy();
      if (event === 'forwarded') deliveries++;
      if (event === 'request-finished') finished(data);
    }});
  h.proxy.on('request', (req, res) => { downstream = res; });
  await assert.rejects(send(h));
  assert.equal((await done).outcome, 'canceled');
  assert.equal(deliveries, 0);
  assert.equal(h.proxy.stats.activeRequests, 0);
});
