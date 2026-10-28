'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {nativeTarget} = require('./build.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const launcher = '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -P "$(dirname "$0")" && pwd)\nexec "$HERE/MagpieFilter" "$@"\n';

function packageRelease({outputDirectory, releaseDirectory} = {}) {
  const native = nativeTarget(), source = path.resolve(outputDirectory || 'dist');
  const release = path.resolve(releaseDirectory || path.join(source, 'release'));
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'build-info.json'), 'utf8'));
  if (['platform', 'arch', 'target', 'executable'].some(key => metadata[key] !== native[key])
      || !/^v\d+\.\d+\.\d+$/.test(metadata.node || '')) throw new Error('Build metadata does not match the native target.');
  const inputs = [native.executable, 'LICENSE.txt', 'NODE-LICENSE.txt'];
  for (const file of inputs) if (!fs.lstatSync(path.join(source, file)).isFile()) throw new Error('Payload must be a regular file: ' + file);
  if (metadata.sha256 !== hash(path.join(source, native.executable))) throw new Error('Executable checksum does not match build metadata.');
  const top = 'MagpieFilter-' + native.target;
  const archive = path.join(release, top + (native.platform === 'win32' ? '.zip' : '.tar.gz'));
  const sums = path.join(release, 'SHA256SUMS.txt');
  if (fs.existsSync(archive) || fs.existsSync(sums)) throw new Error('Release output already exists. Use a fresh release directory.');
  fs.mkdirSync(release, {recursive: true});
  const stage = fs.mkdtempSync(path.join(release, '.package-stage-')), payload = path.join(stage, top);
  try {
    fs.mkdirSync(payload);
    for (const file of inputs) fs.copyFileSync(path.join(source, file), path.join(payload, file));
    const start = native.platform === 'win32' ? 'Double-click MagpieFilter.exe, or run .\\MagpieFilter.exe from PowerShell.'
      : 'Run ./start.sh from a terminal' + (native.platform === 'darwin' ? ', or double-click Start-MagpieFilter.command.' : '.');
    const notes = native.platform === 'darwin' ? 'Ad-hoc signed only: not notarized and not a verified publisher. macOS may require manual approval. Occupying processes must be quit manually.'
      : native.platform === 'linux' ? 'Requires x64 glibc Linux (for example Ubuntu 22.04+), not Alpine/musl.' : 'No publisher certificate signing is applied.';
    fs.writeFileSync(path.join(payload, 'START-HERE.txt'), 'Magpie Filter - ' + native.target + '\n\n'
      + 'Extract the entire archive to a writable directory; do not run inside the archive.\n' + start + '\n'
      + 'No Node installation is required. The local browser console opens automatically.\n'
      + 'Configuration MagpieFilter.config.json and runtime .magpie-filter are executable-adjacent, independent of the current directory.\n'
      + 'Keep the extracted folder writable. Exit using the console Exit action; do not delete recovery data while attached.\n'
      + 'No installer, service, autostart, or shell-profile modification. Do not share config/runtime credentials.\n'
      + 'Port takeover requires explicit per-conflict consent and can lose unsaved work. Never confirm an unfamiliar owner.\n'
      + notes + '\n\nProject license: LICENSE.txt. Bundled Node ' + metadata.node + ' license: NODE-LICENSE.txt.\n');
    const files = [...inputs, 'START-HERE.txt'];
    if (native.platform !== 'win32') {
      for (const file of ['start.sh', ...(native.platform === 'darwin' ? ['Start-MagpieFilter.command'] : [])]) {
        fs.writeFileSync(path.join(payload, file), launcher, {mode: 0o755}); files.push(file);
      }
      fs.chmodSync(path.join(payload, native.executable), 0o755);
    }
    fs.writeFileSync(path.join(payload, 'SHA256SUMS.txt'), files.map(file => hash(path.join(payload, file)) + '  ' + file + '\n').join(''));
    const stagedArchive = path.join(stage, path.basename(archive));
    const args = [native.platform === 'win32' ? '-acf' : '-czf', stagedArchive, '-C', stage, top];
    const result = spawnSync('tar', args, {encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0) throw result.error || new Error('Portable archive creation failed.');
    fs.copyFileSync(stagedArchive, archive, fs.constants.COPYFILE_EXCL);
    const sha256 = hash(archive);
    fs.writeFileSync(sums, sha256 + '  ' + path.basename(archive) + '\n', {flag: 'wx'});
    return {target: native.target, archive, sha256, checksums: sums, directory: top, executable: native.executable, files: [...files, 'SHA256SUMS.txt']};
  } finally {
    // Delete only this invocation's fresh, verified staging directory, never the build/runtime or release output.
    if (path.dirname(fs.realpathSync(stage)) !== fs.realpathSync(release) || !path.basename(stage).startsWith('.package-stage-')) {
      throw new Error('Unexpected package staging path.');
    }
    fs.rmSync(stage, {recursive: true, force: true});
  }
}
if (require.main === module) {
  try { console.log(JSON.stringify(packageRelease({outputDirectory: process.argv[2], releaseDirectory: process.argv[3]}), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = {packageRelease};
