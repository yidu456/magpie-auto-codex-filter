'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');

test('GUI subsystem update validates PE headers and changes only the subsystem bytes', t => {
  const {setGuiSubsystem} = require('./build.cjs');
  const file = path.join(fixture(t), 'own-output.exe');
  const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\0\0', 64, 'binary');
  pe.writeUInt16LE(112, 64 + 20); pe.writeUInt16LE(0x20b, 64 + 24); pe.writeUInt16LE(3, 64 + 24 + 68);
  fs.writeFileSync(file, pe); setGuiSubsystem(file);
  const result = fs.readFileSync(file);
  assert.equal(result.readUInt16LE(156), 2);
  result.writeUInt16LE(3, 156); assert.deepEqual(result, pe);
  fs.writeFileSync(file, 'not a PE');
  assert.throws(() => setGuiSubsystem(file), /PE|executable/i);
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a PE');
});
