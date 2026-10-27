'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {listen, close, call} = require('../magpie-auto-codex-filter/test-support.cjs');

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
