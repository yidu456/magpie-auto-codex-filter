'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('policy validates user settings and keeps snapshots independent', () => {
  const {normalizePolicy} = require('./policy.cjs');
  for (const invalid of [null, [], {enabled: 'false'}, {cleanup: 'sometimes'},
    {revision: -1}, {revision: 0.5}, {unknown: true}, {handlers: []},
    {handlers: {rateLimit: 0}}, {handlers: {other: true}}]) {
    assert.throws(() => normalizePolicy(invalid));
  }
  const input = {cleanup: 'never', handlers: {rateLimit: false}, revision: 3};
  const snapshot = normalizePolicy(input);
  input.handlers.rateLimit = true;
  assert.equal(snapshot.handlers.rateLimit, false);
  assert.equal(snapshot.handlers.transport, true);
  assert.equal(snapshot.cleanup, 'never');
  assert.equal(snapshot.revision, 3);
  assert.throws(() => { snapshot.handlers.transport = false; });
  assert.equal(normalizePolicy(undefined, 'ccswitch').cleanup, 'always');
  assert.equal(normalizePolicy(undefined, 'magpie').cleanup, 'never');
  assert.equal(normalizePolicy(undefined, 'magpie-auto').cleanup, 'conditional');
});
