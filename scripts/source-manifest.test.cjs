'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
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
    assert.ok(!/^(?:\.|\/|[a-z]:)/i.test(file) || file === '.gitignore' || file.startsWith('.github/workflows/'), file);
    assert.ok(!/(?:^|\/)(?:\.planning|\.superpowers|\.runtime|\.verification|\.magpie-filter|node_modules|dist|\.build)(?:\/|$)/.test(file), file);
    assert.ok(!file.startsWith('docs/superpowers/') && !file.includes('MagpieFilter.config.json'), file);
  }
  const expected = ['console', 'scripts', 'magpie-auto-codex-filter'].flatMap(publicFiles);
  for (const directory of ['', '.github/workflows', 'docs']) {
    for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
      const file = (directory ? directory + '/' : '') + entry.name;
      if (entry.isFile() && /^(?:README\.md|LICENSE|package(?:-lock)?\.json|[^/]+\.cmd|\.gitignore|\.github\/workflows\/[^/]+\.yml|docs\/verification[^/]+\.md)$/.test(file)) expected.push(file);
    }
  }
  assert.deepEqual([...files].sort(), [...expected].sort());
});

test('every distributable source checksum matches the current file bytes', () => {
  for (const {hash, file} of entries()) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, file);
  }
});
