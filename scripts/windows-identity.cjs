'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function numericVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match || match.slice(1, 4).some(value => Number(value) > 65535)) throw new Error('Invalid Windows file version.');
  return match.slice(1, 4).concat('0').join('.');
}
function block(key, value, type, children = []) {
  const name = Buffer.from(key + '\0', 'utf16le'), header = Buffer.alloc(6);
  const chunks = [header, name], pad = () => {
    const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
    chunks.push(Buffer.alloc((4 - size % 4) % 4));
  };
  pad(); chunks.push(value);
  for (const child of children) { pad(); chunks.push(child); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 65535) throw new Error('Windows version resource is too large.');
  header.writeUInt16LE(bytes.length); header.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2); header.writeUInt16LE(type, 4);
  header.copy(bytes); return bytes;
}
function encodeVersionInfo(version) {
  const numeric = numericVersion(version), [major, minor, patch] = numeric.split('.').map(Number), fixed = Buffer.alloc(52);
  [0xfeef04bd, 0x10000, major * 65536 + minor, patch * 65536, major * 65536 + minor, patch * 65536,
    0x3f, 0, 0x40004, 1, 0, 0, 0].forEach((value, index) => fixed.writeUInt32LE(value, index * 4));
  const empty = Buffer.alloc(0), strings = {FileDescription: 'Magpie Filter', ProductName: 'Magpie Filter',
    InternalName: 'MagpieFilter', OriginalFilename: 'MagpieFilter.exe', FileVersion: numeric, ProductVersion: numeric};
  return block('VS_VERSION_INFO', fixed, 0, [block('StringFileInfo', empty, 1, [block('040904B0', empty, 1,
    Object.entries(strings).map(([key, value]) => block(key, Buffer.from(value + '\0', 'utf16le'), 1)))]),
  block('VarFileInfo', empty, 1, [block('Translation', Buffer.from([9, 4, 176, 4]), 0)])]);
}
function run(command, args) {
  const result = spawnSync(command, args, {stdio: 'inherit', windowsHide: true, timeout: 120000});
  if (result.error || result.status !== 0) throw result.error || new Error('Windows version resource update failed.');
}
function copyNativeExecutable(source, output, version, {platform = process.platform, run: execute = run} = {}) {
  const resource = platform === 'win32' ? encodeVersionInfo(version) : null;
  // COPYFILE_EXCL makes this build-owned copy the only possible native API target.
  fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
  if (resource) {
    const directory = path.join(path.dirname(output), '.build'); fs.mkdirSync(directory, {recursive: true});
    const file = path.join(directory, 'windows-version.bin'); fs.writeFileSync(file, resource);
    execute(path.join(process.env.WINDIR || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'windows-version-resource.ps1'), path.resolve(output), file]);
  }
}
module.exports = {numericVersion, encodeVersionInfo, copyNativeExecutable};
