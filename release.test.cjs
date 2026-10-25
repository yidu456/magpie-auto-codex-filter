'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {fixture} = require('./test-support.cjs');

function run(source, args) {
  return spawnSync(process.execPath, [path.join(source, 'release.cjs'), ...args],
    {cwd: source, windowsHide: true, encoding: 'utf8', timeout: 15000});
}
function files(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(directory, entry.name), name + '/') : [name];
  }).sort();
}

test('whitelisted export produces a runnable clean package without local private files', t => {
  assert.ok(fs.existsSync(path.join(__dirname, 'release.cjs')), 'Standalone release command is missing');
  const directory = fixture(t), output = path.join(directory, 'source-only');
  const result = run(__dirname, ['export', output]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(files(output), [
    '.gitattributes', '.github/workflows/test.yml', '.gitignore', 'AGENTS.md', 'AGENT_SETUP.md',
    'LICENSE', 'README.md', 'SHA256SUMS.txt', 'config.cjs', 'config.test.cjs', 'core.cjs',
    'filter.cjs', 'filter.test.cjs', 'idle-stop.test.cjs', 'magpie-config.cjs', 'package.json',
    'performance.test.cjs', 'policy.cjs', 'proxy.cjs', 'release.cjs', 'release.test.cjs',
    'retry.test.cjs', 'standalone.test.cjs', 'test-support.cjs',
    '\u542f\u52a8Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd',
    '\u67e5\u770bMagpie\u6761\u4ef6\u6e05\u7406\u72b6\u6001.cmd',
    '\u505c\u6b62Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd'
  ].sort());
  assert.equal(run(output, ['verify']).status, 0);
  const entry = spawnSync(process.execPath, [path.join(output, 'filter.cjs'), 'help'],
    {cwd: output, windowsHide: true, encoding: 'utf8'});
  assert.equal(entry.status, 0, entry.stderr);
  fs.mkdirSync(path.join(output, '.runtime'));
  fs.writeFileSync(path.join(output, '.runtime/service.json'), 'mock-private-token');
  fs.writeFileSync(path.join(output, 'config.toml'), 'mock-private-config');
  fs.writeFileSync(path.join(output, '.env'), 'mock-private-env');
  fs.writeFileSync(path.join(output, 'extra.cjs'), 'mock-unlisted');
  const second = path.join(directory, 're-exported');
  assert.equal(run(output, ['export', second]).status, 0);
  assert.deepEqual(files(second), files(output).filter(name =>
    !['.runtime/service.json', 'config.toml', '.env', 'extra.cjs'].includes(name)));
  assert.equal(run(second, ['verify']).status, 0);
  fs.appendFileSync(path.join(second, 'core.cjs'), '\n// tampered\n');
  assert.notEqual(run(second, ['verify']).status, 0);
});

test('export refuses existing and source-contained destinations without overwriting anything', t => {
  const directory = fixture(t), marker = path.join(directory, 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  assert.notEqual(run(__dirname, ['export', directory]).status, 0);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
  assert.notEqual(run(__dirname, ['export', __dirname]).status, 0);
  const unsafe = path.join(__dirname, 'release-test-do-not-create');
  assert.equal(fs.existsSync(unsafe), false);
  assert.notEqual(run(__dirname, ['export', unsafe]).status, 0);
  assert.equal(fs.existsSync(unsafe), false);
});
