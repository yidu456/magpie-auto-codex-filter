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

module.exports = {harness, frame};
