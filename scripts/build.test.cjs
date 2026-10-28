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

test('native targets refuse unsupported architectures rather than relabeling the host binary', () => {
  const {nativeTarget} = require('./build.cjs');
  for (const [platform, arch, target, executable] of [
    ['win32', 'x64', 'windows-x64', 'MagpieFilter.exe'], ['darwin', 'arm64', 'macos-arm64', 'MagpieFilter'],
    ['darwin', 'x64', 'macos-x64', 'MagpieFilter'], ['linux', 'x64', 'linux-x64', 'MagpieFilter']
  ]) assert.deepEqual(nativeTarget(platform, arch), {platform, arch, target, executable});
  for (const [platform, arch] of [['linux', 'arm64'], ['win32', 'arm64'], ['freebsd', 'x64']]) {
    assert.throws(() => nativeTarget(platform, arch), /Unsupported native target/);
  }
});

test('SEA finalization removes macOS signature before NODE_SEA injection then ad-hoc signs and preserves Unix mode', async t => {
  const {finalizeExecutable} = require('./build.cjs'), directory = fixture(t);
  for (const platform of ['darwin', 'linux', 'win32']) {
    const file = path.join(directory, platform + ' with spaces'), pe = Buffer.alloc(256);
    pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\0\0', 64, 'binary');
    pe.writeUInt16LE(112, 84); pe.writeUInt16LE(0x20b, 88); pe.writeUInt16LE(3, 156);
    fs.writeFileSync(file, platform === 'win32' ? pe : 'native fixture');
    const steps = [];
    await finalizeExecutable(file, Buffer.from('blob'), platform, {
      run: (command, args) => steps.push([command, args]),
      inject: async (output, resource, blob, options) => steps.push(['inject', output, resource, blob.toString(), options])
    });
    const injection = steps.find(step => step[0] === 'inject');
    assert.equal(injection[1], file); assert.equal(injection[2], 'NODE_SEA_BLOB'); assert.equal(injection[3], 'blob');
    assert.equal(injection[4].sentinelFuse, 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');
    if (platform === 'darwin') {
      assert.deepEqual(steps.map(step => step[0]), ['/usr/bin/codesign', 'inject', '/usr/bin/codesign']);
      assert.deepEqual(steps[0][1], ['--remove-signature', file]);
      assert.equal(injection[4].machoSegmentName, 'NODE_SEA');
      assert.deepEqual(steps[2][1], ['--sign', '-', file]);
    } else { assert.equal(steps.length, 1); assert.equal(injection[4].machoSegmentName, undefined); }
    if (platform === 'win32') assert.equal(fs.readFileSync(file).readUInt16LE(156), 2);
    else { assert.equal(fs.readFileSync(file, 'utf8'), 'native fixture');
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o755); }
  }
});

test('failed macOS signature removal stops before injection', async t => {
  const {finalizeExecutable} = require('./build.cjs');
  let injected = false;
  await assert.rejects(finalizeExecutable(path.join(fixture(t), 'output'), Buffer.from('blob'), 'darwin', {
    run: () => { throw new Error('codesign failed'); }, inject: async () => { injected = true; }
  }), /codesign failed/);
  assert.equal(injected, false);
});

test('build refuses existing deliverables before bundling or writing any files', async t => {
  const {build} = require('./build.cjs'), outputDirectory = fixture(t);
  const file = path.join(outputDirectory, process.platform === 'win32' ? 'MagpieFilter.exe' : 'MagpieFilter');
  fs.writeFileSync(file, 'delivered bytes');
  await assert.rejects(build({outputDirectory}), /already exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'delivered bytes');
  assert.equal(fs.existsSync(path.join(outputDirectory, '.build')), false);
});
