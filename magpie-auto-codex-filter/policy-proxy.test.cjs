'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {makeProxy} = require('./proxy.cjs');
const {listen, close, call, sample} = require('./test-support.cjs');
const azure = {type: 'invalid_request_error', message: 'The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.'};
const alb = '<html><title>400 Bad Request</title><h1>400 Bad Request</h1><center>alb</center></html>';
const frame = (type, extra = {}) => 'event: ' + type + '\ndata: ' + JSON.stringify({type, ...extra}) + '\n\n';

async function harness(t, handler, options = {}) {
  const up = http.createServer(handler);
  t.after(() => close(up));
  const upstream = await listen(up);
  const proxy = makeProxy({mode: 'magpie-auto', getUpstream: () => upstream, retryDelay: () => 1, ...options});
  t.after(() => close(proxy));
  const origin = await listen(proxy);
  return {proxy, origin, send: (body = sample) => call(origin, '/magpie/v1/responses', {body: JSON.stringify(body)})};
}

test('hot cleanup modes preserve service identity and original tool pairs', async t => {
  const seen = [];
  let policy = {cleanup: 'always'};
  const h = await harness(t, (req, res) => {
    let text = ''; req.on('data', c => { text += c; });
    req.on('end', () => { seen.push(JSON.parse(text)); res.end('{}'); });
  }, {getPolicy: () => policy});
  await h.send();
  assert.equal(seen[0].input.some(x => x.type === 'reasoning'), false);
  assert.equal(seen[0].input.find(x => x.type === 'function_call').call_id, 'call_1');
  policy = {cleanup: 'never'};
  await h.send();
  assert.deepEqual(seen[1], sample);
  const state = JSON.parse((await call(h.origin, '/__codex_filter__/health', {method: 'GET'})).body);
  assert.equal(state.service, 'magpie-auto-codex-filter-v1');
});

const scenarios = [
  ['azureResource', 400, {error: azure}],
  ['encryptedContent', 400, {error: {code: 'invalid_encrypted_content'}}],
  ['rateLimit', 429, {error: {code: 'rate_limit_exceeded'}}],
  ['unavailable', 503, {error: {code: 'no_available_channel'}}],
  ['alb400', 400, alb],
  ['transport', 0, null],
  ['streamIncomplete', 200, frame('response.failed')]
];
for (const [handler, status, payload] of scenarios) {
  test('checkbox ' + handler + ' gates only its recovery path', async t => {
    for (const enabled of [false, true]) {
      await t.test(String(enabled), async t => {
        let attempts = 0;
        const h = await harness(t, (req, res) => {
          req.resume(); req.on('end', () => {
            attempts++;
            if (attempts > 1) { res.end('{}'); return; }
            if (!status) { req.socket.destroy(); return; }
            res.writeHead(status, {'content-type': handler === 'streamIncomplete' ? 'text/event-stream' : 'application/json'});
            res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
          });
        }, {getPolicy: () => ({handlers: {[handler]: enabled}})});
        const result = await h.send();
        assert.equal(attempts, enabled ? 2 : 1);
        if (enabled) assert.equal(result.status, 200);
        else assert.equal(result.status, status === 0 || status === 200 ? 502 : status);
      });
    }
  });
}

test('never cleanup does not enable encrypted-content fallback', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => {
    req.resume(); req.on('end', () => {
      attempts++; res.writeHead(400); res.end('{"error":{"code":"invalid_encrypted_content"}}');
    });
  }, {getPolicy: () => ({cleanup: 'never'})});
  assert.equal((await h.send()).status, 400);
  assert.equal(attempts, 1);
});

test('requests keep their policy revision through retry while new requests see updates', async t => {
  let policy = {cleanup: 'conditional', revision: 1}, reads = 0, first = true;
  const logs = [], seen = [];
  const h = await harness(t, (req, res) => {
    let text = ''; req.on('data', c => { text += c; });
    req.on('end', () => {
      seen.push(JSON.parse(text));
      if (first) {
        first = false; policy = {cleanup: 'never', handlers: {azureResource: false}, revision: 2};
        res.writeHead(400); res.end(JSON.stringify({error: azure}));
      } else res.end('{}');
    });
  }, {getPolicy: () => { reads++; return policy; }, log: (event, data) => logs.push({event, ...data})});
  assert.equal((await h.send()).status, 200);
  assert.equal(seen[1].input.some(x => x.type === 'reasoning'), false);
  await h.send();
  assert.deepEqual(seen[2], sample);
  assert.equal(reads, 2);
  assert.deepEqual(logs.filter(x => x.event === 'request-started').map(x => x.policyRevision), [1, 2]);
});

test('core OFF preserves compressed bytes and forwards invalid JSON without retry', async t => {
  const zlib = require('node:zlib');
  const seen = [];
  const h = await harness(t, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({body: Buffer.concat(chunks), encoding: req.headers['content-encoding'], url: req.url});
      res.writeHead(429); res.end('{"error":{"code":"rate_limit_exceeded"}}');
    });
  }, {getPolicy: () => ({enabled: false, cleanup: 'always'})});
  const compressed = zlib.gzipSync(Buffer.from('not json'));
  const result = await call(h.origin, '/magpie/v1/responses', {
    body: compressed, headers: {'content-encoding': 'gzip'}
  });
  assert.equal(result.status, 429);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {body: compressed, encoding: 'gzip', url: '/v1/responses'});
  assert.equal((await call(h.origin, '/magpie/v1/responses/compact', {body: '{}'})).status, 429);
});

test('unbuffered SSE is delivered before completion and late failure is never replayed', async t => {
  let attempts = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  const h = await harness(t, (req, res) => {
    req.resume(); req.on('end', async () => {
      attempts++; res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(frame('response.output_text.delta', {delta: 'first'}));
      await gate;
      res.end(frame('response.failed', {error: azure}));
    });
  }, {getPolicy: () => ({bufferResponse: false})});
  await new Promise((resolve, reject) => {
    let text = '';
    const req = http.request(h.origin + '/v1/responses', {method: 'POST'}, res => {
      res.on('data', chunk => {
        text += chunk;
        if (text.includes('first')) release();
      });
      res.on('error', reject);
      res.on('end', () => {
        try { assert.match(text, /response.failed/); assert.equal(attempts, 1); resolve(); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(500, () => req.destroy(new Error('first frame was buffered')));
    req.end(JSON.stringify(sample));
  });
});

test('heartbeat OFF removes synthetic progress without changing buffered success', async t => {
  const h = await harness(t, (req, res) => {
    req.resume(); req.on('end', () => {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      setTimeout(() => res.end(frame('response.completed')), 70);
    });
  }, {heartbeatMs: 5, getPolicy: () => ({heartbeat: false})});
  const result = await h.send();
  assert.match(result.body, /response.completed/);
  assert.doesNotMatch(result.body, /resp_filter_|response.in_progress/);
});

test('uploading requests count as active and keep the policy captured at headers', async t => {
  let policy = {cleanup: 'always'}, captured;
  const h = await harness(t, (req, res) => {
    let text = ''; req.on('data', c => { text += c; });
    req.on('end', () => { captured = JSON.parse(text); res.end('{}'); });
  }, {getPolicy: () => policy});
  const text = JSON.stringify(sample);
  let req;
  const finished = new Promise((resolve, reject) => {
    req = http.request(h.origin + '/v1/responses', {method: 'POST', headers: {'content-length': Buffer.byteLength(text)}}, res => {
      res.resume(); res.on('end', resolve); res.on('error', reject);
    });
    req.on('error', reject); req.write(text.slice(0, 15));
  });
  t.after(() => req.destroy());
  await new Promise(resolve => setTimeout(resolve, 50));
  const active = h.proxy.stats.activeRequests;
  policy = {cleanup: 'never'};
  req.end(text.slice(15)); await finished;
  assert.equal(active, 1);
  assert.equal(captured.input.some(x => x.type === 'reasoning'), false);
  assert.equal(h.proxy.stats.activeRequests, 0);
});
