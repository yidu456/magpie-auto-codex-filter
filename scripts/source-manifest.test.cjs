'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const publicFiles = directory => fs.readdirSync(path.join(root, directory), {withFileTypes: true})
  .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
  .flatMap(entry => {
    const file = directory + '/' + entry.name;
    return entry.isDirectory() ? publicFiles(file) : /\.(?:cjs|js|css|html|ps1)$/.test(file) ? [file] : [];
  });
const entries = () => fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/).map(line => {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.ok(match, 'Malformed source checksum entry'); return {hash: match[1], file: match[2]};
});

test('distributable source manifest excludes private state and includes all public source and tests', () => {
  const files = entries().map(entry => entry.file);
  assert.equal(new Set(files).size, files.length, 'Duplicate source checksum paths');
  for (const file of files) {
    assert.ok(!/^(?:\.|\/|[a-z]:)/i.test(file) || ['.gitignore', '.gitattributes'].includes(file) || file.startsWith('.github/workflows/'), file);
    assert.ok(!/(?:^|\/)(?:\.planning|\.superpowers|\.runtime|\.verification|\.magpie-filter|node_modules|dist|\.build)(?:\/|$)/.test(file), file);
    assert.ok(!file.startsWith('docs/superpowers/') && !file.includes('MagpieFilter.config.json'), file);
  }
  const expected = ['console', 'scripts', 'magpie-auto-codex-filter'].flatMap(publicFiles);
  for (const directory of ['', '.github/workflows', 'docs']) {
    for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
      const file = (directory ? directory + '/' : '') + entry.name;
      if (entry.isFile() && /^(?:README\.md|LICENSE|package(?:-lock)?\.json|[^/]+\.cmd|\.gitignore|\.gitattributes|\.github\/workflows\/[^/]+\.yml|docs\/verification[^/]+\.md)$/.test(file)) expected.push(file);
    }
  }
  assert.deepEqual([...files].sort(), [...expected].sort());
});

test('every distributable source checksum matches the current file bytes', () => {
  for (const {hash, file} of entries()) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, file);
  }
});

test('fresh Git materialization preserves every public manifest byte with autocrlf enabled or disabled', {timeout: 60000}, t => {
  const fixtureRoot = path.join(root, '.verification');
  fs.mkdirSync(fixtureRoot, {recursive: true});
  const directory = fs.mkdtempSync(path.join(fixtureRoot, 'source-checkout-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(fixtureRoot));
    fs.rmSync(directory, {recursive: true, force: true});
  });
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  const inventory = entries();
  const files = [...inventory.map(entry => entry.file), 'SHA256SUMS.txt'];
  if (fs.existsSync(path.join(root, '.gitattributes')) && !files.includes('.gitattributes')) files.push('.gitattributes');
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), {recursive: true});
    fs.copyFileSync(path.join(root, file), path.join(source, file));
  }
  const git = (cwd, args) => execFileSync('git', args, {cwd, windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe']});
  git(source, ['init']);
  git(source, ['-c', 'core.autocrlf=false', 'add', '--all']);
  git(source, ['-c', 'user.name=Source fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'source byte fixture']);
  for (const autocrlf of ['true', 'false']) {
    const checkout = path.join(directory, autocrlf);
    git(directory, ['clone', '--no-checkout', '--local', source, checkout]);
    git(checkout, ['config', 'core.autocrlf', autocrlf]);
    git(checkout, ['checkout', '--force', 'HEAD']);
    for (const {file, hash} of inventory) {
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(checkout, file))).digest('hex'), hash, `${file} (autocrlf=${autocrlf})`);
    }
    assert.deepEqual(fs.readFileSync(path.join(checkout, 'SHA256SUMS.txt')), fs.readFileSync(path.join(root, 'SHA256SUMS.txt')));
  }
});
