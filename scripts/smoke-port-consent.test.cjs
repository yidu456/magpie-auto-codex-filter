'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('production launcher consent fixture cancels without a kill and confirms only its tracked listener', {timeout: 150000}, async () => {
  const {main} = require('./smoke-port-consent.cjs');
  const result = await main();
  assert.equal(result.cancelPreservesOwner, true); assert.equal(result.exactRestore, true);
  assert.equal(result.productionLauncher, true);
  assert.equal(result.confirmedTermination, process.platform !== 'darwin' && (process.platform !== 'linux' || process.getuid() !== 0));
});
