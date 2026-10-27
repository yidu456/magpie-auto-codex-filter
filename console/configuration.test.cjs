'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');

test('one portable file initializes once and reloads manually edited web and policy settings', t => {
  const {createConfigStore} = require('./configuration.cjs');
  const file = path.join(fixture(t), 'MagpieFilter.config.json');
  const store = createConfigStore(file), first = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(first.web.port, 18185);
  assert.match(first.web.token, /^[a-f0-9]{64}$/);
  assert.equal(first.settings.policy.enabled, false);
  first.web.port = 19285; first.web.token = 'ab'.repeat(32);
  first.settings.policy.enabled = true; first.settings.policy.cleanup = 'always';
  first.settings.policy.handlers.rateLimit = false;
  fs.writeFileSync(file, JSON.stringify(first, null, 2));
  const loaded = createConfigStore(file).current;
  assert.equal(loaded.web.port, 19285); assert.equal(loaded.web.token, 'ab'.repeat(32));
  assert.equal(loaded.settings.policy.enabled, true);
  assert.equal(loaded.settings.policy.cleanup, 'always');
  assert.equal(loaded.settings.policy.handlers.rateLimit, false);
  assert.throws(() => store.save({settings: loaded.settings}, 1), /changed.*disk|restart/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
});

test('config rejects invalid JSON, weak token and conflicting ports without replacing user files', t => {
  const {createConfigStore} = require('./configuration.cjs');
  const file = path.join(fixture(t), 'MagpieFilter.config.json');
  const defaults = createConfigStore(file).current;
  for (const change of [{web: {port: 0, token: defaults.web.token}}, {web: {port: 18184, token: defaults.web.token}},
    {web: {port: 18185, token: 'short'}}, {version: 9}, {unknown: true}]) {
    const bytes = JSON.stringify({...defaults, ...change}); fs.writeFileSync(file, bytes);
    assert.throws(() => createConfigStore(file)); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  }
  fs.writeFileSync(file, '{bad'); assert.throws(() => createConfigStore(file), /JSON|configuration/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});

test('web saves preserve token and only publish after a successful disk write', t => {
  const {createConfigStore} = require('./configuration.cjs');
  const file = path.join(fixture(t), 'MagpieFilter.config.json'), store = createConfigStore(file);
  const token = store.current.web.token;
  store.save({settings: {...store.current.settings, policy: {...store.current.settings.policy, cleanup: 'never'}}}, 1);
  assert.equal(JSON.parse(fs.readFileSync(file)).web.token, token);
  assert.equal(store.current.settings.policy.cleanup, 'never');
  fs.renameSync(file, file + '.saved'); fs.mkdirSync(file);
  assert.throws(() => store.save({web: {...store.current.web, port: 19385}}, 2));
  assert.equal(store.current.revision, 1); assert.equal(store.current.web.port, 18185);
});
