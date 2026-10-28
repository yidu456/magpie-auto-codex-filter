'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {copyNativeExecutable, numericVersion} = require('./windows-identity.cjs');

function nativeTarget(platform = process.platform, arch = process.arch) {
  const targets = {'win32-x64': 'windows-x64', 'darwin-arm64': 'macos-arm64', 'darwin-x64': 'macos-x64', 'linux-x64': 'linux-x64'};
  const target = targets[platform + '-' + arch];
  if (!target) throw new Error('Unsupported native target: ' + platform + '-' + arch);
  return {platform, arch, target, executable: platform === 'win32' ? 'MagpieFilter.exe' : 'MagpieFilter'};
}
function run(command, args) {
  const result = spawnSync(command, args, {stdio: 'inherit', windowsHide: true, timeout: 120000});
  if (result.error || result.status !== 0) throw result.error || new Error(path.basename(command) + ' failed.');
  return result;
}
async function finalizeExecutable(output, blob, platform, {run: execute = run, inject = require('postject').inject} = {}) {
  if (platform === 'darwin') execute('/usr/bin/codesign', ['--remove-signature', output]);
  await inject(output, 'NODE_SEA_BLOB', blob, {sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(platform === 'darwin' ? {machoSegmentName: 'NODE_SEA'} : {})});
  if (platform === 'win32') setGuiSubsystem(output);
  else {
    fs.chmodSync(output, 0o755);
    if (platform === 'darwin') execute('/usr/bin/codesign', ['--sign', '-', output]);
  }
}

function setGuiSubsystem(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid PE executable.');
  const pe = bytes.readUInt32LE(0x3c), optional = pe + 24;
  if (optional + 70 > bytes.length || bytes.toString('binary', pe, pe + 4) !== 'PE\0\0'
      || bytes.readUInt16LE(pe + 20) < 70 || ![0x10b, 0x20b].includes(bytes.readUInt16LE(optional))) {
    throw new Error('Unsupported PE executable headers.');
  }
  bytes.writeUInt16LE(2, optional + 68);
  fs.writeFileSync(file, bytes);
}
async function build({outputDirectory} = {}) {
  const target = nativeTarget(), [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 12)) throw new Error('Build requires native Node 24.12+.');
  const root = path.resolve(__dirname, '..'), dist = path.resolve(outputDirectory || path.join(root, 'dist'));
  const buildDir = path.join(dist, '.build'), output = path.join(dist, target.executable);
  if (fs.existsSync(output)) throw new Error('Build output already exists: ' + output);
  fs.mkdirSync(buildDir, {recursive: true}); fs.mkdirSync(dist, {recursive: true});
  const entry = path.join(buildDir, 'bundle.cjs'), blob = path.join(buildDir, 'sea.blob');
  await require('esbuild').build({entryPoints: [path.join(root, 'console/main.cjs')], bundle: true, platform: 'node',
    target: 'node24', format: 'cjs', outfile: entry});
  const assets = Object.fromEntries(['index.html', 'app.css', 'app.js'].map(name => [name, path.join(root, 'console/ui', name)]));
  const config = path.join(buildDir, 'sea.json');
  fs.writeFileSync(config, JSON.stringify({main: entry, output: blob, disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false, execArgvExtension: 'none', assets}));
  run(process.execPath, ['--experimental-sea-config', config]);
  const version = require('../package.json').version;
  copyNativeExecutable(process.execPath, output, version, {run});
  await finalizeExecutable(output, fs.readFileSync(blob), target.platform);
  const sha = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sha + '  ' + target.executable + '\n');
  const license = await fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE', {signal: AbortSignal.timeout(30000)});
  if (!license.ok) throw new Error('Could not fetch matching Node license: ' + license.status);
  const text = await license.text();
  if (!text.includes('Node.js') || !text.includes('Permission')) throw new Error('Unexpected Node license content.');
  fs.writeFileSync(path.join(dist, 'NODE-LICENSE.txt'), text);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE.txt'));
  const metadata = {...target, output, bytes: fs.statSync(output).size, node: process.version,
    version, numericVersion: numericVersion(version), sha256: sha};
  fs.writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
  return metadata;
}
if (require.main === module) build({outputDirectory: process.argv[2]}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {setGuiSubsystem, nativeTarget, finalizeExecutable, build};
