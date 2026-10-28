'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {fixture, listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');

for (const authEnabled of [false, true]) test('auth discovery and management guards with auth ' + authEnabled, async t => {
  const token = 'fixture-secret', controller = require('./controller.cjs').createController({runtime: fixture(t)});
  t.after(() => controller.close());
  const server = require('./server.cjs').createManagementServer({controller, token, authEnabled});
  t.after(() => close(server)); const origin = await listen(server);
  const request = (route, headers = {}, options = {}) => call(origin, route, {method: 'GET', headers, ...options});
  const discovery = await request('/api/auth');
  assert.equal(discovery.status, 200);
  assert.deepEqual(JSON.parse(discovery.body), {authRequired: authEnabled});
  assert.equal((await request('/api/state')).status, authEnabled ? 403 : 200);
  assert.equal((await request('/api/state', {'x-console-token': token})).status, 200);
  for (const headers of [{host: 'evil.test'}, {origin: 'https://evil.test'}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'same-site'}]) {
    for (const route of ['/api/auth', '/api/state']) assert.equal((await request(route, {...headers, 'x-console-token': token})).status, 403);
  }
  const headers = {'x-console-token': token};
  assert.equal((await request('/api/web', headers, {method: 'POST', body: '{}'})).status, 415);
  assert.equal((await request('/api/web', {...headers, 'content-type': 'application/json'}, {method: 'POST', body: 'x'.repeat(33000)})).status, 413);
  assert.doesNotMatch(discovery.body, /fixture-secret|pid|revision|web|settings/);
});

test('auth flag save stays restart-only and retains token when the web patch omits it', async t => {
  const fs = require('node:fs'), path = require('node:path'), runtime = fixture(t);
  const controller = require('./controller.cjs').createController({runtime}); t.after(() => controller.close());
  const token = JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json'))).web.token;
  const server = require('./server.cjs').createManagementServer({controller, token, authEnabled: false});
  t.after(() => close(server)); const origin = await listen(server);
  const saved = await call(origin, '/api/web', {headers: {'content-type': 'application/json'},
    body: JSON.stringify({revision: 0, web: {port: controller.status().web.port, authEnabled: true}})});
  assert.equal(saved.status, 200, saved.body);
  assert.deepEqual(JSON.parse(saved.body).web, {port: 18185, activePort: 18185, authEnabled: true, activeAuthEnabled: false, restartRequired: true});
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json'))).web.token, token);
  assert.doesNotMatch(saved.body, new RegExp(token));
  assert.deepEqual(JSON.parse((await call(origin, '/api/auth', {method: 'GET'})).body), {authRequired: false});
  assert.equal((await call(origin, '/api/state', {method: 'GET'})).status, 200);
});

test('management enforces token, origin, host, request size and route boundaries', async t => {
  const controller = require('./controller.cjs').createController({runtime: fixture(t)});
  t.after(() => controller.close());
  const server = require('./server.cjs').createManagementServer({controller, token: 'test-only-token', assets: {'/': {body: '<h1>console</h1>', type: 'text/html'}}});
  t.after(() => close(server));
  const origin = await listen(server);
  const headers = {'x-console-token': 'test-only-token', 'content-type': 'application/json', origin};
  const request = (route, options = {}) => call(origin, route, {method: 'GET', headers, ...options});
  assert.equal((await request('/api/state', {headers: {}})).status, 403);
  assert.equal((await request('/api/state', {headers: {...headers, origin: 'https://evil.example'}})).status, 403);
  assert.equal((await request('/api/state', {headers: {...headers, host: 'evil.example'}})).status, 403);
  assert.equal((await request('/api/state', {headers: {...headers, 'sec-fetch-site': 'cross-site'}})).status, 403);
  const state = await request('/api/state');
  assert.equal(state.status, 200);
  assert.doesNotMatch(state.body, /test-only-token/);
  assert.equal(state.headers['access-control-allow-origin'], undefined);
  assert.equal((await request('/api/exit')).status, 404);
  assert.equal((await request('/../settings.json')).status, 404);
  assert.equal((await request('/api/settings', {method: 'POST', body: 'x'.repeat(33000)})).status, 413);
  assert.equal((await request('/api/settings', {method: 'POST', body: '{'})).status, 400);
  const data = JSON.parse(state.body);
  assert.equal(data.metrics.totals.started, 0);
  assert.equal(data.diagnostics.logs.closed, false);
  const save = await request('/api/settings', {method: 'POST', body: JSON.stringify({revision: data.revision,
    settings: {...data.settings, policy: {...data.settings.policy, handlers: {...data.settings.policy.handlers, rateLimit: false}}}})});
  assert.equal(save.status, 200);
  assert.equal(JSON.parse(save.body).settings.policy.handlers.rateLimit, false);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('successful exit still closes the launcher if the browser disconnects during shutdown', async t => {
  let release, started, exits = 0;
  const begun = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  const controller = {status: () => ({revision: 0}), close: async () => { started(); await gate; }};
  const server = require('./server.cjs').createManagementServer({controller, token: 'test', onExit: () => { exits++; }});
  t.after(() => close(server));
  const origin = await listen(server);
  const req = http.request(origin + '/api/exit', {method: 'POST', headers: {'x-console-token': 'test', 'content-type': 'application/json'}});
  req.on('error', () => {}); req.end('{"revision":0}');
  await begun;
  req.destroy();
  await new Promise(resolve => setTimeout(resolve, 30));
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(exits, 1);
});

test('web config is saved to the same file and token changes require restart without leaking it', async t => {
  const fs = require('node:fs'), path = require('node:path'), runtime = fixture(t);
  const controller = require('./controller.cjs').createController({runtime});
  t.after(() => controller.close());
  const original = JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json')));
  const server = require('./server.cjs').createManagementServer({controller, token: original.web.token});
  t.after(() => close(server)); const origin = await listen(server);
  const headers = {'x-console-token': original.web.token, 'content-type': 'application/json'};
  const result = await call(origin, '/api/web', {headers, body: JSON.stringify({revision: 0, web: {port: 19285, token: 'cd'.repeat(32)}})});
  assert.equal(result.status, 200, result.body);
  const state = JSON.parse(result.body);
  assert.equal(state.web.port, 19285); assert.equal(state.web.restartRequired, true);
  assert.doesNotMatch(result.body, /cdcdcdcd/);
  const saved = JSON.parse(fs.readFileSync(path.join(runtime, 'MagpieFilter.config.json')));
  assert.equal(saved.web.token, 'cd'.repeat(32));
  assert.equal((await call(origin, '/api/state', {method: 'GET', headers})).status, 200);
  assert.equal((await call(origin, '/api/state', {method: 'GET', headers: {'x-console-token': saved.web.token}})).status, 403);
  const invalid = await call(origin, '/api/web', {headers, body: JSON.stringify({revision: state.revision, web: {port: 0, token: ''}})});
  assert.equal(invalid.status, 400);
});
