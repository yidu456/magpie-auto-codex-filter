'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');

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
async function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64 with Node 24.12+.');
  const root = path.resolve(__dirname, '..'), buildDir = path.join(root, '.build'), dist = path.join(root, 'dist');
  fs.mkdirSync(buildDir, {recursive: true}); fs.mkdirSync(dist, {recursive: true});
  const entry = path.join(buildDir, 'bundle.cjs'), blob = path.join(buildDir, 'sea.blob'), output = path.join(dist, 'MagpieFilter.exe');
  await require('esbuild').build({entryPoints: [path.join(root, 'console/main.cjs')], bundle: true, platform: 'node',
    target: 'node24', format: 'cjs', outfile: entry});
  const assets = Object.fromEntries(['index.html', 'app.css', 'app.js'].map(name => [name, path.join(root, 'console/ui', name)]));
  const config = path.join(buildDir, 'sea.json');
  fs.writeFileSync(config, JSON.stringify({main: entry, output: blob, disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false, execArgvExtension: 'none', assets}));
  const prepared = spawnSync(process.execPath, ['--experimental-sea-config', config], {stdio: 'inherit', windowsHide: true});
  if (prepared.error || prepared.status !== 0) throw prepared.error || new Error('SEA preparation failed.');
  fs.copyFileSync(process.execPath, output);
  await require('postject').inject(output, 'NODE_SEA_BLOB', fs.readFileSync(blob), {sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
  setGuiSubsystem(output);
  const sha = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sha + '  MagpieFilter.exe\n');
  const license = await fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE');
  if (!license.ok) throw new Error('Could not fetch matching Node license: ' + license.status);
  const text = await license.text();
  if (!text.includes('Node.js') || !text.includes('Permission')) throw new Error('Unexpected Node license content.');
  fs.writeFileSync(path.join(dist, 'NODE-LICENSE.txt'), text);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE.txt'));
  console.log(JSON.stringify({output, bytes: fs.statSync(output).size, node: process.version, sha256: sha}, null, 2));
}
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {setGuiSubsystem, build};
