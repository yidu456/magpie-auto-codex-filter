'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function input(t) {
  const directory = fixture(t), outputDirectory = path.join(directory, 'build with spaces');
  fs.mkdirSync(outputDirectory);
  const executable = process.platform === 'win32' ? 'MagpieFilter.exe' : 'MagpieFilter';
  fs.writeFileSync(path.join(outputDirectory, executable), process.platform === 'win32' ? 'owned executable fixture'
    : '#!/bin/sh\nprintf "%s\\n" "$0" "$@"\n');
  fs.writeFileSync(path.join(outputDirectory, 'LICENSE.txt'), 'MIT project fixture');
  fs.writeFileSync(path.join(outputDirectory, 'NODE-LICENSE.txt'), 'Node.js Permission fixture');
  const target = process.platform === 'win32' ? 'windows-x64' : process.platform === 'linux' ? 'linux-x64' : 'macos-' + process.arch;
  fs.writeFileSync(path.join(outputDirectory, 'build-info.json'), JSON.stringify({platform: process.platform, arch: process.arch,
    target, executable, node: process.version, sha256: hash(path.join(outputDirectory, executable))}));
  for (const file of ['MagpieFilter.config.json', 'console.log', 'metrics.json', 'secret.toml']) fs.writeFileSync(path.join(outputDirectory, file), 'must not ship');
  fs.mkdirSync(path.join(outputDirectory, '.magpie-filter'));
  fs.writeFileSync(path.join(outputDirectory, '.magpie-filter', 'service.json'), 'must not ship');
  return {directory, outputDirectory, target, executable};
}

test('native archive has one fixed directory and only executable, licenses, instructions, launchers and verified checksums', t => {
  const {packageRelease} = require('./package-release.cjs'), {directory, outputDirectory, target, executable} = input(t);
  const releaseDirectory = path.join(directory, 'release with spaces');
  const result = packageRelease({outputDirectory, releaseDirectory});
  const top = 'MagpieFilter-' + target;
  assert.equal(path.basename(result.archive), top + (process.platform === 'win32' ? '.zip' : '.tar.gz'));
  assert.equal(result.sha256, hash(result.archive));
  const listing = spawnSync('tar', ['-tf', result.archive], {encoding: 'utf8', timeout: 10000});
  assert.equal(listing.status, 0, listing.stderr);
  const files = listing.stdout.trim().split(/\r?\n/).filter(file => !file.endsWith('/')).sort();
  const payload = [executable, 'LICENSE.txt', 'NODE-LICENSE.txt', 'START-HERE.txt', 'SHA256SUMS.txt'];
  if (process.platform !== 'win32') payload.push('start.sh');
  if (process.platform === 'darwin') payload.push('Start-MagpieFilter.command');
  assert.deepEqual(files, payload.map(file => top + '/' + file).sort());
  const extracted = path.join(directory, 'extracted with spaces'); fs.mkdirSync(extracted);
  const extraction = spawnSync('tar', ['-xf', result.archive, '-C', extracted], {encoding: 'utf8', timeout: 10000});
  assert.equal(extraction.status, 0, extraction.stderr);
  const packageDirectory = path.join(extracted, top);
  const checksums = fs.readFileSync(path.join(packageDirectory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(checksums.length, payload.length - 1);
  for (const row of checksums) { const [sum, file] = row.split('  '); assert.equal(sum, hash(path.join(packageDirectory, file))); }
  assert.match(fs.readFileSync(path.join(packageDirectory, 'START-HERE.txt'), 'utf8'), /writable|Node|adjacent/);
  assert.equal(fs.existsSync(path.join(packageDirectory, 'MagpieFilter.config.json')), false);
  if (process.platform !== 'win32') for (const file of payload.filter(file => file === executable || /\.sh$|\.command$/.test(file))) {
    assert.equal(fs.statSync(path.join(packageDirectory, file)).mode & 0o777, 0o755, file);
  }
  if (process.platform !== 'win32') for (const file of payload.filter(file => /\.sh$|\.command$/.test(file))) {
    const launched = spawnSync(path.join(packageDirectory, file), ['argument with spaces'], {cwd: directory, encoding: 'utf8', timeout: 10000});
    assert.equal(launched.status, 0, launched.stderr);
    assert.deepEqual(launched.stdout.trim().split('\n'), [path.join(packageDirectory, executable), 'argument with spaces']);
  }
  assert.throws(() => packageRelease({outputDirectory, releaseDirectory}), /already exists/);
});

test('packaging refuses foreign targets, modified executable, missing files and symlink payloads without creating an archive', t => {
  const {packageRelease} = require('./package-release.cjs'), {directory, outputDirectory} = input(t);
  const metadataFile = path.join(outputDirectory, 'build-info.json'), original = fs.readFileSync(metadataFile, 'utf8');
  for (const change of [{target: 'foreign-x64'}, {arch: 'ia32'}, {platform: 'freebsd'}, {executable: '../secret.toml'}, {sha256: '0'.repeat(64)}]) {
    fs.writeFileSync(metadataFile, JSON.stringify({...JSON.parse(original), ...change}));
    assert.throws(() => packageRelease({outputDirectory, releaseDirectory: path.join(directory, 'release')}), /target|metadata|checksum/i);
  }
  fs.writeFileSync(metadataFile, original); fs.unlinkSync(path.join(outputDirectory, 'NODE-LICENSE.txt'));
  assert.throws(() => packageRelease({outputDirectory, releaseDirectory: path.join(directory, 'release')}), /license|ENOENT/i);
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(outputDirectory, 'secret.toml'), path.join(outputDirectory, 'NODE-LICENSE.txt'));
    assert.throws(() => packageRelease({outputDirectory, releaseDirectory: path.join(directory, 'release')}), /regular file/i);
  }
  assert.equal(fs.existsSync(path.join(directory, 'release')), false);
});
