'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');

test('standalone smoke removes every inherited PATH alias and uses an empty bin directory on every OS', t => {
  const {standaloneEnvironment} = require('./smoke-exe.cjs'), directory = fixture(t);
  const environment = standaloneEnvironment(directory, {Path: '/has/node', PATH: '/also/has/node', NODE_OPTIONS: '--require unsafe', SAFE: 'kept'});
  assert.equal(environment.SAFE, 'kept'); assert.equal(environment.NODE_OPTIONS, '');
  assert.equal(environment.PATH, path.join(directory, 'no-node-bin'));
  assert.equal(Object.keys(environment).filter(key => /^path$/i.test(key)).length, 1);
  assert.deepEqual(fs.readdirSync(environment.PATH), []);
});
