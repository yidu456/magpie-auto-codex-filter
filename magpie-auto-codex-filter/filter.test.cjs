'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const {spawn} = require('node:child_process');
const {makeProxy, ADMIN} = require('./proxy.cjs');
const {listen, close, call, fixture} = require('./test-support.cjs');

const history = {model: 'mock', store: true, stream: false, reasoning: {effort: 'xhigh'},
  include: ['reasoning.encrypted_content'], input: [
    {type: 'reasoning', id: 'rs', encrypted_content: 'sealed-test-only', summary: []},
    {type: 'message', id: 'msg', role: 'user', content: 'hello'},
    {type: 'function_call', id: 'fc', call_id: 'pair', name: 'lookup', arguments: '{}'},
    {type: 'function_call_output', id: 'out', call_id: 'pair', output: 'done'}]};
const cleaned = {...history, store: false, include: [], input: [
  {type: 'message', role: 'user', content: 'hello'},
  {type: 'function_call', call_id: 'pair', name: 'lookup', arguments: '{}'},
  {type: 'function_call_output', call_id: 'pair', output: 'done'}]};
const resource = {type: 'invalid_request_error', message: 'The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.'};
const encrypted = {type: 'invalid_request_error', code: 'invalid_encrypted_content', message: 'The encrypted content could not be verified.'};
function entry() {
  const file = path.join(__dirname, 'filter.cjs');
  assert.ok(fs.existsSync(file), 'Conditional Magpie entry is missing');
  return require(file);
}
async function harness(t, handler, options = {}) {
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    handler(req, res, body.length ? JSON.parse(body) : null);
  });
  const upstreamOrigin = await listen(upstream), logs = [];
  const proxy = makeProxy({mode: 'magpie-auto', getUpstream: () => upstreamOrigin, retryDelay: () => 1,
    log: (event, data) => logs.push({event, ...data}), ...options});
  const origin = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });
  return {origin, logs,
    send: body => call(origin, '/magpie/v1/responses', {body: JSON.stringify(body)}),
    health: async () => JSON.parse((await call(origin, ADMIN + '/health', {method: 'GET'})).body)};
}

test('conditional entry uses independent 18184 runtime and rejects other modes', () => {
  const e = entry(), options = e.parseArgs(['status']);
  assert.equal(options.mode, 'magpie-auto');
  assert.equal(options.port, 18184);
  assert.equal(options.upstream, 'http://127.0.0.1:3425');
  assert.equal(options.runtime, path.join(__dirname, '..', '.runtime'));
  for (const mode of ['ccswitch', 'magpie', 'magpie-ccs']) assert.throws(() => e.parseArgs(['start', '--mode', mode]));
});

test('healthy conditional requests preserve reasoning, references and compact without cleanup', async t => {
  const captured = [];
  const h = await harness(t, (req, res, body) => { captured.push({url: req.url, body}); res.end('{"ok":true}'); });
  assert.equal((await h.send(history)).status, 200);
  assert.deepEqual(captured[0].body, history);
  for (const extra of [{previous_response_id: 'old'}, {input: [{type: 'compaction', encrypted_content: 'magpie1:summary'}]}]) {
    const body = {...history, ...extra};
    assert.equal((await h.send(body)).status, 200);
    assert.deepEqual(captured.at(-1).body, body);
  }
  assert.equal((await call(h.origin, '/magpie/v1/responses/compact', {body: JSON.stringify(history)})).status, 200);
  assert.equal(captured.at(-1).url, '/v1/responses/compact');
  const health = await h.health();
  assert.equal(health.service, 'magpie-auto-codex-filter-v1');
  assert.equal(health.stats.removedReasoningItems, 0);
  assert.equal(health.stats.removedItemIds, 0);
  assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 0);
});

test('explicit HTTP history errors clean once, preserve pairs and reset on the next request', async t => {
  for (const error of [resource, encrypted]) await t.test(error.code || 'azure', async t => {
    const bodies = [];
    const h = await harness(t, (req, res, body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        res.writeHead(400, {'content-type': 'application/json', 'content-encoding': 'gzip'});
        res.end(zlib.gzipSync(Buffer.from(JSON.stringify({error}))));
      } else res.end('{"ok":true}');
    });
    assert.equal((await h.send(history)).status, 200);
    assert.deepEqual(bodies, [history, cleaned]);
    assert.equal((await h.send(history)).status, 200);
    assert.deepEqual(bodies[2], history);
    const state = await h.health();
    assert.equal(state.stats.removedReasoningItems, 1);
    assert.equal(state.stats.removedItemIds, 3);
    assert.equal(state.stats.resourceRetries, 1);
    assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 1);
    assert.doesNotMatch(JSON.stringify(h.logs), /sealed-test-only|hello|pair/);
  });
});

test('SSE history error discards failed tools, then one cleanup survives later throttling', async t => {
  const bodies = [], streaming = {...history, stream: true};
  const h = await harness(t, (req, res, body) => {
    bodies.push(body);
    if (bodies.length === 1) {
      res.writeHead(200, {'content-type': 'text/event-stream', 'content-encoding': 'gzip'});
      res.end(zlib.gzipSync(Buffer.from('event: response.output_item.done\ndata: {"item":{"type":"custom_tool_call","call_id":"bad"}}\n\n'
        + 'event: response.failed\ndata: ' + JSON.stringify({response: {error: encrypted}}) + '\n\n')));
    } else if (bodies.length === 2) {
      res.writeHead(429); res.end('{"error":{"code":"rate_limit_exceeded"}}');
    } else {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.end('event: response.completed\ndata: {"response":{"output":[{"type":"reasoning","encrypted_content":"new-good"}]}}\n\n');
    }
  });
  const result = await h.send(streaming);
  assert.match(result.body, /new-good/);
  assert.doesNotMatch(result.body, /"bad"|response.failed/);
  assert.deepEqual(bodies, [streaming, {...cleaned, stream: true}, {...cleaned, stream: true}]);
  assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 1);
});

test('ordinary retry and business errors never trigger cleanup', async t => {
  for (const [status, error, attempts] of [
    [429, {code: 'rate_limit_exceeded'}, 2], [503, {code: 'no_available_channel'}, 2],
    [400, {code: 'invalid_request_error', message: 'bad input'}, 1],
    [401, {code: 'invalid_api_key'}, 1], [429, {code: 'insufficient_quota'}, 1],
    [403, encrypted, 1], [500, encrypted, 1],
    [400, {...encrypted, type: 'authentication_error'}, 1],
    [400, {...encrypted, message: 'Account quota exhausted'}, 1]
  ]) await t.test(String(status) + ':' + error.code, async t => {
    const bodies = [];
    const h = await harness(t, (req, res, body) => {
      bodies.push(body);
      if (bodies.length === 1) { res.writeHead(status); res.end(JSON.stringify({error})); }
      else res.end('{"ok":true}');
    });
    await h.send(history);
    assert.equal(bodies.length, attempts);
    for (const body of bodies) assert.deepEqual(body, history);
    assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 0);
  });
});

test('SSE authentication details do not turn an encrypted error code into a cleanup trigger', async t => {
  for (const message of [encrypted.message, resource.message]) await t.test(message, async t => {
    let attempts = 0;
    const h = await harness(t, (req, res) => {
      attempts++;
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.end('event: response.failed\ndata: ' + JSON.stringify({response: {error:
        {...encrypted, type: 'authentication_error', message}}}) + '\n\n');
    });
    await h.send({...history, stream: true});
    assert.equal(attempts, 1);
    assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 0);
  });
});

test('unsafe compact/reference history returns a clear error instead of losing context', async t => {
  for (const extra of [
    {previous_response_id: 'old'}, {conversation: 'old'},
    {context_management: [{type: 'compaction'}]},
    {input: [{type: 'compaction', encrypted_content: 'magpie1:summary'}]},
    {input: [{type: 'item_reference', id: 'old'}]}
  ]) await t.test(Object.keys(extra)[0], async t => {
    let attempts = 0;
    const h = await harness(t, (req, res) => { attempts++; res.writeHead(400); res.end(JSON.stringify({error: encrypted})); });
    const result = await h.send({...history, ...extra});
    assert.equal(attempts, 1);
    assert.match(result.body, /response_reference_not_portable|encrypted_compaction_disabled|encrypted_context_not_portable/);
    assert.equal((await h.health()).stats.removedReasoningItems, 0);
  });
});

test('cleanup consumes existing resource budget and honors the request deadline', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => { attempts++; res.writeHead(400); res.end(JSON.stringify({error: resource})); });
  assert.equal((await h.send(history)).status, 400);
  assert.equal(attempts, 6);
  assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 1);
  const blocked = await harness(t, (req, res) => { res.writeHead(400); res.end(JSON.stringify({error: encrypted})); },
    {retryDelay: () => 1000, deadlineMs: 200});
  assert.equal((await blocked.send(history)).status, 400);
  assert.equal(blocked.logs.filter(r => r.event === 'history-cleanup').length, 0);
});

test('simultaneous requests keep fallback state separate and transport retry preserves history', async t => {
  const captured = new Map();
  const h = await harness(t, (req, res, body) => {
    const rows = captured.get(body.model) || []; rows.push(body); captured.set(body.model, rows);
    if (body.model === 'bad' && rows.length === 1) { res.writeHead(400); res.end(JSON.stringify({error: resource})); }
    else if (body.model === 'transport' && rows.length === 1) req.socket.destroy();
    else res.end('{"ok":true}');
  });
  await Promise.all(['bad', 'good', 'transport'].map(model => h.send({...history, model})));
  assert.deepEqual(captured.get('bad'), [{...history, model: 'bad'}, {...cleaned, model: 'bad'}]);
  assert.deepEqual(captured.get('good'), [{...history, model: 'good'}]);
  assert.deepEqual(captured.get('transport'), [{...history, model: 'transport'}, {...history, model: 'transport'}]);
  assert.equal(h.logs.filter(r => r.event === 'history-cleanup').length, 1);
});

test('cancellation during cleanup backoff prevents the retry and leaves no active request', async t => {
  let attempts = 0;
  const h = await harness(t, (req, res) => { attempts++; res.writeHead(400); res.end(JSON.stringify({error: resource})); },
    {retryDelay: () => 300});
  const request = http.request(h.origin + '/magpie/v1/responses', {method: 'POST'});
  request.on('error', () => {});
  request.end(JSON.stringify(history));
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('Expected cleanup/backoff state was not reached');
  };
  await waitFor(() => h.logs.some(r => r.event === 'retry-scheduled'));
  request.destroy();
  await waitFor(() => h.logs.some(r => r.event === 'request-finished'));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(attempts, 1);
  assert.equal((await h.health()).stats.activeRequests, 0);
  assert.equal((await h.health()).stats.resourceRetries, 0);
});

test('conditional CMD start/logs/stop use independent runtime and restore exact addresses', async t => {
  const e = entry(), directory = fixture(t), configPath = path.join(directory, 'config.toml');
  const upstream = http.createServer((req, res) => { req.resume(); res.end('{}'); });
  const upstreamOrigin = await listen(upstream);
  const reservation = http.createServer(); await listen(reservation);
  const port = reservation.address().port; await close(reservation);
  const runtime = path.join(directory, 'conditional');
  const original = '\uFEFFopenai_base_url = "' + upstreamOrigin + '/backend-api/codex" # keep\r\n'
    + 'model_provider = "magpie"\r\n[model_providers.magpie]\r\nbase_url = "' + upstreamOrigin + '/v1"\r\n';
  fs.writeFileSync(configPath, original);
  const options = e.parseArgs(['status', '--port', String(port), '--config', configPath, '--runtime', runtime, '--upstream', upstreamOrigin]);
  t.after(async () => { await e.stop(options); await close(upstream); });
  const invoke = (file, viewer = false) => new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', file); assert.ok(fs.existsSync(script), 'Conditional CMD is missing');
    const command = '""' + script + '" --port ' + port + ' --upstream ' + upstreamOrigin
      + ' --config "' + configPath + '" --runtime "' + runtime + '""';
    const child = spawn(process.env.ComSpec, ['/d', '/s', '/c', command], {cwd: directory, windowsHide: true,
      windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', closing = false;
    const closeViewer = () => {
      if (closing) return; closing = true;
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
      killer.on('error', reject);
    };
    const timer = setTimeout(() => { if (viewer) closeViewer(); }, 5000);
    const collect = chunk => {
      output += chunk;
      if (viewer && /Magpie Conditional Filter v10 running=true state=filtering/.test(output)) closeViewer();
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve({code, output}); });
  });
  const start = await invoke('\u542f\u52a8Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd');
  assert.equal(start.code, 0, start.output);
  const state = await e.status(options);
  assert.equal(state.service, 'magpie-auto-codex-filter-v1');
  assert.equal(state.magpieReachable, true);
  assert.equal(state.state, 'filtering');
  assert.equal(fs.readFileSync(configPath, 'utf8'), original.replaceAll(upstreamOrigin, options.filterOrigin + '/magpie'));
  const logs = await invoke('\u67e5\u770bMagpie\u6761\u4ef6\u6e05\u7406\u72b6\u6001.cmd', true);
  assert.match(logs.output, /Magpie Conditional Filter v10 running=true state=filtering/);
  assert.equal((await e.status(options)).pid, state.pid);
  assert.equal((await invoke('\u505c\u6b62Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd')).code, 0);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  fs.writeFileSync(configPath, original.replaceAll(upstreamOrigin, options.filterOrigin + '/magpie'));
  await e.stop(options);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});
