'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./test-support.cjs');

test('fixture removal waits for asynchronous resource disposal registered in the test body', async t => {
  let directory, disposed = false;
  await t.test('owned runtime', async child => {
    directory = fixture(child);
    child.after(async () => {
      assert.equal(fs.existsSync(directory), true);
      await fs.promises.writeFile(path.join(directory, 'final-metrics.json'), '{}');
      disposed = true;
    });
  });
  assert.equal(disposed, true);
  assert.equal(fs.existsSync(directory), false);
});
