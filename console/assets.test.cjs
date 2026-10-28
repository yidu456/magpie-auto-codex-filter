'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');

test('homepage has two independent accessible switches and all boolean preferences are switch styled', () => {
  const html = require('./assets.cjs').loadAssets()['/'].body.toString();
  for (const id of ['gateway', 'enabled', 'heartbeat', 'web-auth-enabled']) {
    assert.match(html, new RegExp('<input[^>]*id="' + id + '"[^>]*role="switch"'));
  }
  assert.equal((html.match(/data-handler="[^"]+"[^>]*role="switch"/g) || []).length, 7);
  assert.match(html, /网关关闭/); assert.match(html, /中断/);
});

test('the actual browser assets are served with safe types and no filesystem fallback', async t => {
  const assets = require('./assets.cjs').loadAssets();
  const server = require('./server.cjs').createManagementServer({token: 'test', assets, controller: {status: () => ({revision: 0})}});
  t.after(() => close(server));
  const origin = await listen(server);
  for (const [route, type] of [['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'application/javascript']]) {
    const response = await call(origin, route, {method: 'GET'});
    assert.equal(response.status, 200);
    assert.ok(response.headers['content-type'].startsWith(type));
    assert.ok(response.body.length > 100);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal((await call(origin, '/ui/../controller.cjs', {method: 'GET', headers: {'x-console-token': 'test'}})).status, 404);
});

test('manual login and pending web settings are available without exposing a token', () => {
  const html = require('./assets.cjs').loadAssets()['/'].body.toString();
  for (const id of ['login-form', 'login-token', 'controls', 'web-form', 'web-port', 'web-token', 'web-hint', 'config-file']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /id="controls" hidden/);
  assert.match(html, /重启 Codex/);
});

test('application identity belongs only on Settings beside portable configuration', () => {
  const html = require('./assets.cjs').loadAssets()['/'].body.toString();
  const settings = html.split('id="page-settings"')[1].split('id="page-records"')[0];
  for (const id of ['application-name', 'application-pid', 'application-executable']) assert.match(settings, new RegExp('id="' + id + '"'));
  assert.doesNotMatch(html.split('id="page-dashboard"')[1].split('id="page-settings"')[0], /id="application-/);
});

test('direct settings, records and help pages share only the whitelisted console shell', async t => {
  const assets = require('./assets.cjs').loadAssets();
  const server = require('./server.cjs').createManagementServer({token: 'test', assets, controller: {status: () => ({revision: 0})}});
  t.after(() => close(server)); const origin = await listen(server);
  for (const route of ['/?page=settings', '/?page=records', '/?page=help']) {
    const response = await call(origin, route, {method: 'GET'});
    assert.equal(response.status, 200, route);
    assert.equal(response.body, assets['/'].body);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const route of ['/?page=unknown', '/records', '/help', '/?page=help&file=controller.cjs', '/app.js?page=help']) {
    const response = await call(origin, route, {method: 'GET', headers: {'x-console-token': 'test'}});
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.body, /<!doctype/);
  }
  assert.equal((await call(origin, '/api/state', {method: 'GET'})).status, 403);
});
