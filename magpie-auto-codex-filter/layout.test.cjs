'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('consolidated entry works from another cwd and keeps the package-root runtime', () => {
  const file = path.join(__dirname, 'filter.cjs');
  const root = path.dirname(__dirname);
  const result = spawnSync(process.execPath, [file, 'help'], {cwd: path.dirname(root), encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /start\|stop\|status\|logs\|serve/);
  const options = require(file).parseArgs(['status']);
  assert.equal(options.runtime, path.join(root, '.runtime'));
  assert.equal(options.mode, 'magpie-auto');
  assert.equal(options.port, 18184);
});
