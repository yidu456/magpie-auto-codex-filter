'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

// An allowlist, not a recursive folder copy: local recovery tokens never ship.
const FILES = Object.freeze([
  '.gitattributes', '.github/workflows/test.yml', '.gitignore', 'AGENTS.md', 'AGENT_SETUP.md',
  'LICENSE', 'README.md', 'package.json', 'filter.cjs', 'core.cjs', 'proxy.cjs', 'config.cjs',
  'magpie-config.cjs', 'policy.cjs', 'test-support.cjs', 'filter.test.cjs', 'config.test.cjs',
  'retry.test.cjs', 'performance.test.cjs', 'idle-stop.test.cjs', 'standalone.test.cjs',
  'release.test.cjs', 'release.cjs',
  '\u542f\u52a8Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd',
  '\u67e5\u770bMagpie\u6761\u4ef6\u6e05\u7406\u72b6\u6001.cmd',
  '\u505c\u6b62Magpie\u6761\u4ef6\u6e05\u7406\u670d\u52a1.cmd'
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function readSource(source, name) {
  const file = path.join(source, name);
  if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) {
    throw new Error('Release input must be a regular, unlinked file: ' + name);
  }
  return fs.readFileSync(file);
}
function exportSource(destination) {
  const source = fs.realpathSync(__dirname);
  const requested = path.resolve(destination);
  const output = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(source, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('Export destination must be outside the source directory.');
  }
  const entries = FILES.map(name => [name, readSource(source, name)]);
  fs.mkdirSync(output); // Refuse existing directories; never delete or overwrite them.
  for (const [name, bytes] of entries) {
    const file = path.join(output, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes, {flag: 'wx'});
  }
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'),
    entries.map(([name, bytes]) => hash(bytes) + '  ' + name + '\n').join(''), {flag: 'wx'});
  return {output, files: entries.length + 1};
}
function verify() {
  const source = fs.realpathSync(__dirname), seen = new Set();
  const lines = readSource(source, 'SHA256SUMS.txt').toString('utf8').trimEnd().split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || !FILES.includes(match[2]) || seen.has(match[2])) throw new Error('Invalid integrity manifest.');
    if (hash(readSource(source, match[2])) !== match[1]) throw new Error('Checksum mismatch: ' + match[2]);
    seen.add(match[2]);
  }
  if (seen.size !== FILES.length) throw new Error('Integrity manifest is incomplete.');
  return {verified: seen.size};
}
function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'verify') return verify();
  if (args.length === 2 && args[0] === 'export') return exportSource(args[1]);
  throw new Error('Use node release.cjs verify OR node release.cjs export NEW_DIRECTORY (parent must exist).');
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(), null, 2)); }
  catch (error) { console.error('Release: ' + error.message); process.exitCode = 1; }
}
module.exports = {FILES, exportSource, verify};
