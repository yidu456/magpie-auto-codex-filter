'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {call, listen, close, sample} = require('../magpie-auto-codex-filter/test-support.cjs');
const frame = (type, extra = {}) => 'event: ' + type + '\ndata: ' + JSON.stringify({type, ...extra}) + '\n\n';
const delta = frame('response.output_text.delta', {delta: 'fixture-first-delta'});
const completed = frame('response.completed', {response: {usage: {input_tokens: 10, output_tokens: 2,
  total_tokens: 12, input_tokens_details: {cached_tokens: 4}}}});

async function main() {
  const exe = path.resolve(process.argv[2] || 'dist/MagpieFilter.exe');
  const root = path.resolve('.verification'); fs.mkdirSync(root, {recursive: true});
  const runtime = fs.mkdtempSync(path.join(root, 'exe-'));
  const configFile = path.join(runtime, 'MagpieFilter.config.json');
  const reserved = http.createServer();
  const webPort = Number(new URL(await listen(reserved)).port); await close(reserved);
  // Literal version-1 fixture deliberately omits the new protection field.
  const oldConfig = {version: 1, revision: 0, web: {port: webPort, token: 'ab'.repeat(32)}, settings: {
    client: 'codex', configPath: path.join(runtime, 'mock-codex.toml'), upstream: 'http://127.0.0.1:3425', port: 18184,
    policy: {enabled: false, cleanup: 'conditional', bufferResponse: true, heartbeat: true,
      handlers: {azureResource: true, encryptedContent: true, rateLimit: true, transport: true,
        streamIncomplete: true, alb400: true, unavailable: true}, revision: 0}}};
  const oldBytes = JSON.stringify(oldConfig, null, 2) + '\n'; fs.writeFileSync(configFile, oldBytes);
  const children = [], env = {...process.env, PATH: process.env.WINDIR + '\\System32', NODE_OPTIONS: ''};
  const launch = (executable = exe, args = ['--runtime', runtime, '--no-open'], cwd = runtime) => {
    const child = spawn(executable, args, {cwd, env: {...env, CODEX_HOME: path.join(runtime, 'unused-codex-home')}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.output = ''; child.stdout.on('data', x => { child.output += x; }); child.stderr.on('data', x => { child.output += x; });
    child.on('error', error => { child.output += error.message; });
    children.push(child); return child;
  };
  const wait = async fn => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 60)); }
    throw new Error('Packaged lifecycle timed out. ' + children.map(c => c.output).join('\n'));
  };
  let record, upstreamServer, releaseDelta, savedMetrics;
  const stop = async () => {
    if (!record) return;
    const headers = {'x-console-token': record.token, 'content-type': 'application/json'};
    const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
    return call(record.origin, '/api/exit', {headers, body: JSON.stringify({revision: state.revision})});
  };
  try {
    const first = launch();
    record = await wait(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8')); } catch { return null; } });
    const headers = {'x-console-token': record.token};
    const state = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
    assert.equal(state.settings.policy.enabled, false); assert.equal(state.application.pid, first.pid);
    assert.equal(state.settings.policy.bufferResponse, true); assert.equal(state.settings.policy.protectStreamStart, false);
    assert.equal(fs.readFileSync(configFile, 'utf8'), oldBytes, 'Loading old config must not rewrite it');
    assert.equal(record.origin, 'http://127.0.0.1:' + webPort);
    assert.equal(record.token, oldConfig.web.token);
    for (const page of ['/', '/?page=settings', '/?page=records', '/?page=help']) {
      const shell = await call(record.origin, page, {method: 'GET'});
      assert.equal(shell.status, 200); assert.match(shell.body, /page-dashboard/);
    }
    const second = launch(); await wait(() => second.exitCode !== null); assert.equal(second.exitCode, 0, second.output);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'), 'utf8')).pid, first.pid);
    const received = [];
    let recoveryAttempts = 0, lateAttempts = 0, completedDelta = false;
    const deltaGate = new Promise(resolve => { releaseDelta = resolve; });
    upstreamServer = http.createServer((req, res) => {
      let text = ''; req.on('data', chunk => { text += chunk; });
      req.on('end', async () => {
        received.push(text);
        let input; try { input = JSON.parse(text); } catch { res.end('{}'); return; }
        if (!input.stream) { res.end('{}'); return; }
        res.writeHead(200, {'content-type': 'text/event-stream'});
        if (input.model === 'fixture-early-recovery' && ++recoveryAttempts === 1) {
          res.end(frame('error', {error: {code: 'invalid_encrypted_content'}})); return;
        }
        if (input.model === 'fixture-first-delta') {
          res.write(delta); await deltaGate; completedDelta = true; res.end(completed); return;
        }
        if (input.model === 'fixture-late-failure') {
          lateAttempts++; res.end(delta + frame('response.failed', {response: {error: {code: 'invalid_encrypted_content'}}})); return;
        }
        res.end(delta + completed);
      });
    });
    const upstream = await listen(upstreamServer), reservation = http.createServer();
    const port = Number(new URL(await listen(reservation)).port); await close(reservation);
    const configPath = path.join(runtime, 'mock-codex.toml');
    const original = 'model_provider="mock"\n[model_providers.mock]\nbase_url="' + upstream + '/v1"\n';
    fs.writeFileSync(configPath, original);
    const controlHeaders = {...headers, 'content-type': 'application/json'};
    let applied = await call(record.origin, '/api/settings', {headers: controlHeaders, body: JSON.stringify({revision: state.revision,
      settings: {...state.settings, upstream, port, configPath, policy: {...state.settings.policy, enabled: true, cleanup: 'always'}}})});
    assert.equal(applied.status, 200, applied.body);
    let current = JSON.parse(applied.body);
    assert.equal(current.attached, true);
    const proxyOrigin = 'http://127.0.0.1:' + port;
    assert.equal((await call(proxyOrigin, '/magpie/v1/responses', {body: '{"input":[{"type":"reasoning","encrypted_content":"mock"},{"role":"user","content":"hi"}]}'})).status, 200);
    assert.equal(JSON.parse(received[0]).input.length, 1);
    applied = await call(record.origin, '/api/settings', {headers: controlHeaders, body: JSON.stringify({revision: current.revision,
      settings: {...current.settings, policy: {...current.settings.policy, cleanup: 'conditional', bufferResponse: false,
        protectStreamStart: true, heartbeat: false}}})});
    assert.equal(applied.status, 200, applied.body); current = JSON.parse(applied.body);
    assert.equal(current.settings.policy.protectStreamStart, true); assert.equal(current.settings.policy.bufferResponse, false);
    const early = await new Promise((resolve, reject) => {
      const req = http.request(proxyOrigin + '/magpie/v1/responses', {method: 'POST'}, res => {
        let body = '', sawDelta = false;
        res.on('data', chunk => {
          body += chunk;
          if (!sawDelta && body.includes('fixture-first-delta')) {
            sawDelta = true;
            if (completedDelta) { reject(new Error('First real delta arrived after upstream completion')); return; }
            releaseDelta();
          }
        });
        res.on('error', reject); res.on('end', () => resolve(body));
      });
      req.setTimeout(5000, () => req.destroy(new Error('Packaged first delta was buffered')));
      req.on('error', reject); req.end(JSON.stringify({...sample, model: 'fixture-first-delta'}));
    });
    assert.equal(early, delta + completed);
    const recovered = await call(proxyOrigin, '/magpie/v1/responses', {body: JSON.stringify({...sample, model: 'fixture-early-recovery'})});
    assert.equal(recovered.body, delta + completed); assert.equal(recoveryAttempts, 2);
    const recoveryBodies = received.map(text => { try { return JSON.parse(text); } catch { return {}; } })
      .filter(input => input.model === 'fixture-early-recovery');
    assert.equal(recoveryBodies[0].input.some(item => item.type === 'reasoning'), true);
    assert.equal(recoveryBodies[1].input.some(item => item.type === 'reasoning'), false);
    assert.deepEqual(recoveryBodies[1].input.filter(item => item.call_id).map(item => item.call_id), ['call_1', 'call_1', 'call_2', 'call_2']);
    const late = await call(proxyOrigin, '/magpie/v1/responses', {body: JSON.stringify({...sample, model: 'fixture-late-failure'})});
    assert.match(late.body, /fixture-first-delta/); assert.match(late.body, /response.failed/); assert.equal(lateAttempts, 1);
    applied = await call(record.origin, '/api/settings', {headers: controlHeaders, body: JSON.stringify({revision: current.revision,
      settings: {...current.settings, policy: {...current.settings.policy, enabled: false}}})});
    assert.equal(applied.status, 200); current = JSON.parse(applied.body);
    assert.equal((await call(proxyOrigin, '/magpie/v1/responses', {body: 'raw bypass'})).status, 200);
    assert.equal(received.at(-1), 'raw bypass');
    assert.equal((await call(record.origin, '/api/disconnect', {headers: controlHeaders, body: JSON.stringify({revision: current.revision})})).status, 200);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    // Saved web changes must not prevent re-opening the still-running, old-token instance.
    current = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers})).body);
    savedMetrics = current.metrics;
    assert.equal(savedMetrics.retry.dispatched, 1); assert.equal(savedMetrics.retry.recoveredRequests, 1);
    assert.equal(savedMetrics.totals.usageRequests, 2); assert.equal(savedMetrics.totals.inputTokens, 20);
    assert.equal(savedMetrics.totals.outputTokens, 4); assert.equal(savedMetrics.totals.totalTokens, 24);
    assert.equal(savedMetrics.totals.cachedInputTokens, 8);
    assert.equal(savedMetrics.totals.cleanups, 1);
    assert.ok(savedMetrics.series.length > 0 && savedMetrics.recent.length > 0);
    assert.equal(savedMetrics.recent[0].usageState, 'unavailable', 'Core bypass does not invent usage');
    const nextReservation = http.createServer();
    const nextWebPort = Number(new URL(await listen(nextReservation)).port); await close(nextReservation);
    const nextToken = 'cd'.repeat(32);
    assert.equal((await call(record.origin, '/api/web', {headers: controlHeaders,
      body: JSON.stringify({revision: current.revision, web: {port: nextWebPort, token: nextToken}})})).status, 200);
    const reopened = launch(); await wait(() => reopened.exitCode !== null); assert.equal(reopened.exitCode, 0, reopened.output);
    assert.equal((await stop()).status, 200); await wait(() => first.exitCode !== null); assert.equal(first.exitCode, 0, first.output);
    assert.equal(fs.existsSync(path.join(runtime, 'service.json')), false);
    assert.equal(fs.existsSync(path.join(runtime, 'instance.lock')), false);
    const checkpoint = fs.readFileSync(path.join(runtime, 'metrics.json'), 'utf8');
    const persisted = JSON.parse(checkpoint);
    for (const key of ['active', 'recent', 'series']) assert.equal(Object.hasOwn(persisted, key), false);
    assert.doesNotMatch(checkpoint + fs.readFileSync(path.join(runtime, 'console.log'), 'utf8'),
      /foreign-account-ciphertext|"delta"|call_1|call_2|arguments|image_url|raw bypass/);
    record = null;
    const config = JSON.parse(fs.readFileSync(configFile));
    config.settings.policy.enabled = true; config.settings.policy.cleanup = 'never';
    const edited = JSON.stringify(config, null, 2); fs.writeFileSync(configFile, edited);
    const restarted = launch();
    record = await wait(() => { try { return JSON.parse(fs.readFileSync(path.join(runtime, 'service.json'))); } catch { return null; } });
    assert.equal(record.origin, 'http://127.0.0.1:' + nextWebPort);
    assert.equal(record.token, nextToken);
    current = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers: {'x-console-token': nextToken}})).body);
    assert.equal(current.attached, true); assert.equal(current.settings.policy.cleanup, 'never');
    assert.deepEqual(current.metrics.totals, savedMetrics.totals);
    assert.deepEqual(current.metrics.retry, savedMetrics.retry);
    assert.deepEqual(current.metrics.latency, savedMetrics.latency);
    assert.deepEqual(current.metrics.byModel, savedMetrics.byModel);
    assert.deepEqual(current.metrics.series, []); assert.deepEqual(current.metrics.recent, []); assert.deepEqual(current.metrics.active, []);
    assert.equal((await stop()).status, 200); await wait(() => restarted.exitCode !== null);
    assert.equal(restarted.exitCode, 0, restarted.output);
    assert.equal(fs.readFileSync(configFile, 'utf8'), edited);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original); record = null;
    const copyDirectory = path.join(runtime, 'copied'), alternateCwd = path.join(runtime, 'alternate-cwd');
    fs.mkdirSync(copyDirectory); fs.mkdirSync(alternateCwd);
    const copiedExe = path.join(copyDirectory, 'MagpieFilter.exe'); fs.copyFileSync(exe, copiedExe);
    const copyReservation = http.createServer();
    const copyPort = Number(new URL(await listen(copyReservation)).port); await close(copyReservation);
    const adjacentConfig = path.join(copyDirectory, 'MagpieFilter.config.json');
    const directBytes = JSON.stringify({...oldConfig, web: {...oldConfig.web, port: copyPort}, settings: {...oldConfig.settings,
      policy: {...oldConfig.settings.policy, bufferResponse: false}}}, null, 2) + '\n';
    fs.writeFileSync(adjacentConfig, directBytes);
    const copied = launch(copiedExe, ['--no-open'], alternateCwd);
    record = await wait(() => { try { return JSON.parse(fs.readFileSync(path.join(copyDirectory, '.magpie-filter/service.json'))); } catch { return null; } });
    current = JSON.parse((await call(record.origin, '/api/state', {method: 'GET', headers: {'x-console-token': record.token}})).body);
    assert.equal(current.configFile, adjacentConfig); assert.equal(current.application.pid, copied.pid);
    assert.equal(current.settings.policy.enabled, false); assert.equal(current.settings.policy.bufferResponse, false);
    assert.equal(current.settings.policy.protectStreamStart, false, 'Old unbuffered stays direct');
    assert.equal(fs.readFileSync(adjacentConfig, 'utf8'), directBytes);
    assert.equal(fs.existsSync(path.join(alternateCwd, 'MagpieFilter.config.json')), false);
    assert.equal(fs.existsSync(path.join(alternateCwd, '.magpie-filter')), false);
    assert.equal((await stop()).status, 200); await wait(() => copied.exitCode !== null); assert.equal(copied.exitCode, 0, copied.output); record = null;
    console.log(JSON.stringify({exe, runtime, standaloneStartup: true, embeddedAssets: true, singleInstance: true,
      fixtureFilterAndBypass: true, portableSettings: true, pendingWebRotation: true,
      literalOldConfigReadOnly: true, oldUnbufferedDirect: true, protectedFirstDelta: true, earlyRecovery: true,
      lateFailureNoReplay: true, aggregateOnlyRestore: true, copiedAlternateCwdNoNodePath: true, adjacentConfig: true,
      editedStartupEnabled: true, exactRestore: true, cleanExit: true}));
  } finally {
    releaseDelta?.();
    await stop().catch(() => {});
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await wait(() => child.exitCode !== null || child.signalCode !== null);
    }
    if (upstreamServer) await close(upstreamServer);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
