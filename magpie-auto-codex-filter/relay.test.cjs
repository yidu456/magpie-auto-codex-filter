'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {makeProxy} = require('./proxy.cjs');
const {listen, close, call} = require('./test-support.cjs');

const azure = {type: 'invalid_request_error', code: 'cc_switch_upstream_error',
  message: 'The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.'};
const frame = (type, extra = {}) => 'event: ' + type + '\ndata: ' + JSON.stringify({type, ...extra}) + '\n\n';

async function harness(t, handler, policy = {}, options = {}) {
  const upstream = http.createServer(handler);
  t.after(() => close(upstream));
  const upstreamOrigin = await listen(upstream);
  const rows = [];
  const proxy = makeProxy({mode: 'magpie-auto', getUpstream: () => upstreamOrigin,
    getPolicy: () => ({heartbeat: false, ...policy}), retryDelay: () => 1,
    log: (event, data) => rows.push({event, ...data}), ...options});
  t.after(() => close(proxy));
  return {origin: await listen(proxy), proxy, rows};
}

const httpCases = [
  ['JSON gateway', 502, {error: {code: 'cc_switch_upstream_error', message: 'relay failed'}}, 2],
  ['wrapped disconnect', 400, {error: {code: 'stream_disconnected', message: 'stream disconnected before completion'}}, 2],
  ['forward failure', 400, {error: {code: 'cc_switch_forward_failed', message: 'relay failed'}}, 2],
  ['bad response', 502, {error: {code: 'bad_response'}}, 2],
  ['server error', 503, {error: {code: 'server_error'}}, 2],
  ['server error with availability text', 503, {error: {code: 'server_error', message: 'No available channels'}}, 2],
  ['unclassified object', 500, {message: 'Internal server failure'}, 2],
  ['empty object', 504, {}, 2],
  ['HTTP401', 401, {error: {code: 'server_error'}}, 1],
  ['HTTP403', 403, {error: {code: 'stream_disconnected'}}, 1],
  ['quota', 503, {error: {code: 'insufficient_quota', message: 'quota exhausted'}}, 1],
  ['billing', 502, {error: {code: 'billing_error'}}, 1],
  ['balance', 500, {error: {message: 'insufficient balance'}}, 1],
  ['auth', 500, {error: {code: 'invalid_api_key', message: 'relay failed'}}, 1],
  ['permission', 503, {error: {type: 'permission_error', message: 'permission denied'}}, 1],
  ['wrapped authentication', 502, {error: {code: 'cc_switch_upstream_error', message: 'Authentication failed'}}, 1],
  ['invalid parameter', 500, {error: {code: 'invalid_parameter', message: 'stream disconnected before completion'}}, 1],
  ['wrapped invalid parameter type', 502, {error: {code: 'cc_switch_upstream_error', type: 'invalid_parameter'}}, 1],
  ['invalid request', 502, {error: {type: 'invalid_request_error', message: 'invalid model'}}, 1],
  ['wrapped invalid parameters', 502, {error: {code: 'cc_switch_upstream_error', message: 'Invalid parameters: model'}}, 1],
  ['encrypted history', 500, {error: {code: 'invalid_encrypted_content', message: 'history invalid'}}, 1],
  ['encrypted history type', 500, {error: {type: 'invalid_encrypted_content'}}, 1],
  ['encrypted history with relay message', 502, {error: {code: 'invalid_encrypted_content', message: 'stream disconnected before completion'}}, 1],
  ['HTML', 502, '<html><h1>Bad gateway</h1></html>', 1],
  ['text', 503, 'Service unavailable', 1],
  ['JSON string', 502, '"Bad gateway"', 1],
  ['array', 502, [{error: {code: 'server_error'}}], 1],
  ['null', 500, null, 1],
  ['ordinary 400', 400, {error: {code: 'cc_switch_upstream_error', message: 'relay failed'}}, 1]
];

test('HTTP relay recovery excludes business failures and non-object 5xx bodies', async t => {
  for (const [name, status, payload, want] of httpCases) {
    await t.test(name, async t => {
      let attempts = 0;
      const h = await harness(t, (req, res) => {
        req.resume(); attempts++;
        res.writeHead(attempts === 1 ? status : 200, {'content-type': 'application/json'});
        res.end(attempts === 1 ? typeof payload === 'string' ? payload : JSON.stringify(payload) : '{"ok":true}');
      });
      const result = await call(h.origin, '/v1/responses', {body: '{"input":"offline fixture"}'});
      assert.equal(attempts, want);
      assert.equal(result.status, want === 2 ? 200 : status);
      assert.equal(h.proxy.stats.transportRetries, want - 1);
      assert.equal(h.proxy.stats.resourceRetries, 0);
      assert.equal(h.proxy.stats.availabilityRetries, 0);
    });
  }
});

test('HTTP specific categories never fall back to another enabled handler', async t => {
  const cases = [
    ['transport gateway OFF', 502, {code: 'cc_switch_upstream_error'}, {transport: false}, 1],
    ['transport disconnect OFF', 400, {code: 'stream_disconnected'}, {transport: false}, 1],
    ['transport forward OFF', 500, {code: 'cc_switch_forward_failed'}, {transport: false}, 1],
    ['stream incomplete OFF does not disable HTTP transport', 400, {code: 'stream_disconnected'}, {streamIncomplete: false}, 2],
    ['availability OFF', 503, {code: 'no_available_channel'}, {unavailable: false}, 1],
    ['rate limit OFF', 429, {code: 'rate_limit_exceeded'}, {rateLimit: false}, 1],
    ['rate limit on 5xx OFF', 503, {code: 'rate_limit_exceeded'}, {rateLimit: false}, 1],
    ['Azure on 5xx OFF', 500, azure, {azureResource: false}, 1],
    ['encrypted on 5xx OFF', 502, {code: 'invalid_encrypted_content'}, {encryptedContent: false}, 1]
  ];
  for (const [name, status, error, handlers, want] of cases) {
    await t.test(name, async t => {
      let attempts = 0;
      const h = await harness(t, (req, res) => {
        req.resume(); attempts++;
        res.writeHead(attempts === 1 ? status : 200);
        res.end(attempts === 1 ? JSON.stringify({error}) : '{}');
      }, {handlers});
      const result = await call(h.origin, '/v1/responses', {body: '{}'});
      assert.equal(attempts, want);
      assert.equal(result.status, want === 2 ? 200 : status);
      assert.equal(h.proxy.stats.transportRetries, want - 1);
    });
  }
});

test('SSE explicit relay errors use transport rather than streamIncomplete', async t => {
  for (const code of ['cc_switch_forward_failed', 'bad_response', 'server_error']) {
    for (const event of ['error', 'response.failed']) {
      for (const transport of [false, true]) {
        await t.test(code + ' ' + event + ' transport=' + transport, async t => {
          let attempts = 0;
          const h = await harness(t, (req, res) => {
            req.resume(); attempts++;
            res.writeHead(200, {'content-type': 'text/event-stream'});
            res.end(attempts > 1 ? frame('response.completed')
              : frame(event, {response: {error: {code, message: 'relay failed'}}}));
          }, {handlers: {transport, streamIncomplete: !transport}});
          const result = await call(h.origin, '/v1/responses', {body: '{"stream":true}'});
          assert.equal(attempts, transport ? 2 : 1);
          assert.equal(result.status, transport ? 200 : 502);
          if (transport) assert.match(result.body, /response.completed/);
          else assert.doesNotMatch(result.body, /response.completed/);
          assert.equal(h.proxy.stats.transportRetries, transport ? 1 : 0);
        });
      }
    }
  }
});

test('conditional HTTP400 history cleanup stays separate and preserves tool call pairs', async t => {
  const raw = Buffer.from(' { "store" : true, "include" : ["reasoning.encrypted_content"], "input" : [ '
    + '{"type":"reasoning","id":"rs_old","encrypted_content":"fixture"}, '
    + '{"type":"function_call","id":"fc_old","call_id":"pair","name":"test","arguments":"{}"}, '
    + '{"type":"function_call_output","id":"out_old","call_id":"pair","output":"fixture"} ] }\n');
  for (const error of [{code: 'invalid_encrypted_content'}, azure]) {
    for (const enabled of [false, true]) {
      await t.test((error.code === 'invalid_encrypted_content' ? 'encrypted' : 'Azure') + ' enabled=' + enabled, async t => {
        const seen = [];
        const h = await harness(t, async (req, res) => {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          seen.push({body: Buffer.concat(chunks), headers: req.headers});
          res.writeHead(seen.length === 1 ? 400 : 200);
          res.end(seen.length === 1 ? JSON.stringify({error}) : '{}');
        }, {handlers: {transport: false, [error.code === 'invalid_encrypted_content' ? 'encryptedContent' : 'azureResource']: enabled}});
        const result = await call(h.origin, '/v1/responses', {body: raw});
        assert.equal(result.status, enabled ? 200 : 400);
        assert.equal(seen.length, enabled ? 2 : 1);
        assert.deepEqual(seen[0].body, raw);
        if (enabled) {
          assert.deepEqual(JSON.parse(seen[1].body), {store: false, include: [], input: [
            {type: 'function_call', call_id: 'pair', name: 'test', arguments: '{}'},
            {type: 'function_call_output', call_id: 'pair', output: 'fixture'}
          ]});
          assert.equal(Number(seen[1].headers['content-length']), seen[1].body.length);
        }
        assert.equal(h.proxy.stats.resourceRetries, enabled ? 1 : 0);
        assert.equal(h.proxy.stats.transportRetries, 0);
      });
    }
  }
});

test('conditional and never requests replay exact decoded JSON bytes, including gzip', async t => {
  const raw = Buffer.from(' \n{ "input" : "offline", "store" : true, "previous_response_id" : "resp_fixture", '
    + '"reasoning" : {"effort":"high"}, "include" : ["reasoning.encrypted_content"], '
    + '"context_management" : [{"type":"compaction"}], "number" : 1.00 }\r\n');
  for (const cleanup of ['conditional', 'never']) {
    for (const gzip of [false, true]) {
      await t.test(cleanup + ' gzip=' + gzip, async t => {
        const seen = [];
        const h = await harness(t, async (req, res) => {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          seen.push({body: Buffer.concat(chunks), headers: req.headers});
          res.writeHead(seen.length === 1 ? 502 : 200);
          res.end(seen.length === 1 ? '{"error":{"code":"bad_response"}}' : '{}');
        }, {cleanup});
        assert.equal((await call(h.origin, '/v1/responses', {body: gzip ? zlib.gzipSync(raw) : raw,
          headers: gzip ? {'content-encoding': 'gzip'} : {}})).status, 200);
        assert.equal(seen.length, 2);
        for (const attempt of seen) {
          assert.deepEqual(attempt.body, raw);
          assert.equal(attempt.headers['content-encoding'], undefined);
          assert.equal(Number(attempt.headers['content-length']), raw.length);
        }
        assert.equal(h.rows.filter(row => row.event === 'history-cleanup').length, 0);
      });
    }
  }
});

test('gateway recovery shares the ten retry transport budget and never consumes availability', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume(); attempts++;
    res.writeHead(attempts % 2 ? 502 : 400);
    res.end(attempts % 2 ? '{"error":{"code":"cc_switch_upstream_error"}}'
      : '{"error":{"code":"stream_disconnected"}}');
  });
  const result = await call(h.origin, '/v1/responses', {body: '{}'});
  assert.equal(attempts, 11);
  assert.equal(result.status, 502);
  assert.equal(h.proxy.stats.transportRetries, 10);
  assert.equal(h.proxy.stats.transportRetryExhausted, 1);
  assert.equal(h.proxy.stats.availabilityRetries, 0);
  assert.equal(h.proxy.stats.resourceRetries, 0);
});
