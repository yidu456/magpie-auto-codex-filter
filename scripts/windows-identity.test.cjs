'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync, spawn} = require('node:child_process');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');

function readBlock(bytes, offset = 0) {
  assert.equal(offset % 4, 0, 'Resource blocks must be DWORD aligned');
  const length = bytes.readUInt16LE(offset), valueLength = bytes.readUInt16LE(offset + 2), type = bytes.readUInt16LE(offset + 4);
  let cursor = offset + 6, key = '';
  while (bytes.readUInt16LE(cursor)) { key += String.fromCharCode(bytes.readUInt16LE(cursor)); cursor += 2; }
  cursor = (cursor + 2 + 3) & ~3;
  const value = bytes.subarray(cursor, cursor + valueLength * (type === 1 ? 2 : 1));
  cursor += value.length;
  const children = [];
  while (((cursor + 3) & ~3) < offset + length) {
    cursor = (cursor + 3) & ~3;
    const child = readBlock(bytes, cursor); children.push(child); cursor += child.length;
  }
  assert.ok(cursor <= offset + length);
  return {key, length, valueLength, type, value, children};
}

test('VERSIONINFO is aligned with consistent four-component versions and application strings', () => {
  const {encodeVersionInfo, numericVersion} = require('./windows-identity.cjs');
  assert.equal(numericVersion('0.1.0-dev'), '0.1.0.0');
  assert.equal(numericVersion('12.34.56-beta.2+build'), '12.34.56.0');
  for (const version of ['1.2', '1.2.3.4', '65536.0.0', '1.2.3;evil', '01.2.3']) assert.throws(() => numericVersion(version), /version/i);
  const bytes = encodeVersionInfo('12.34.56-beta.2'), root = readBlock(bytes);
  assert.equal(root.length, bytes.length); assert.equal(root.key, 'VS_VERSION_INFO');
  assert.equal(root.type, 0); assert.equal(root.valueLength, 52);
  assert.equal(root.value.readUInt32LE(0), 0xfeef04bd);
  assert.equal(root.value.readUInt32LE(8), 0x000c0022); assert.equal(root.value.readUInt32LE(12), 0x00380000);
  assert.equal(root.value.readUInt32LE(16), 0x000c0022); assert.equal(root.value.readUInt32LE(20), 0x00380000);
  const strings = root.children.find(child => child.key === 'StringFileInfo').children[0];
  assert.equal(strings.key, '040904B0');
  assert.deepEqual(Object.fromEntries(strings.children.map(child => [child.key, child.value.toString('utf16le').replace(/\0$/, '')])), {
    FileDescription: 'Magpie Filter', ProductName: 'Magpie Filter', InternalName: 'MagpieFilter',
    OriginalFilename: 'MagpieFilter.exe', FileVersion: '12.34.56.0', ProductVersion: '12.34.56.0'
  });
  const translation = root.children.find(child => child.key === 'VarFileInfo').children[0];
  assert.equal(translation.key, 'Translation'); assert.equal(translation.type, 0);
  assert.deepEqual([...translation.value], [9, 4, 176, 4]);
});

test('native resource helper edits only a fresh owned Windows copy before injection, never the runtime or Unix output', async t => {
  const {copyNativeExecutable} = require('./windows-identity.cjs'), directory = fixture(t);
  const source = path.join(directory, 'node.exe'); fs.writeFileSync(source, 'original runtime');
  for (const platform of ['win32', 'linux', 'darwin']) {
    const owned = path.join(directory, platform); fs.mkdirSync(owned);
    const output = path.join(owned, platform === 'win32' ? 'MagpieFilter.exe' : 'MagpieFilter'), calls = [];
    copyNativeExecutable(source, output, '0.1.0-dev', {platform, run: (command, args) => {
      assert.equal(fs.readFileSync(source, 'utf8'), 'original runtime');
      assert.equal(fs.readFileSync(output, 'utf8'), 'original runtime'); calls.push({command, args});
    }});
    assert.equal(calls.length, platform === 'win32' ? 1 : 0);
    if (platform === 'win32') {
      assert.match(calls[0].command, /WindowsPowerShell.*powershell\.exe$/i);
      assert.equal(calls[0].args.at(-2), output);
      assert.equal(readBlock(fs.readFileSync(calls[0].args.at(-1))).key, 'VS_VERSION_INFO');
    }
    assert.throws(() => copyNativeExecutable(source, output, '0.1.0-dev', {platform}), /EEXIST/);
  }
  assert.throws(() => copyNativeExecutable(source, source, '0.1.0-dev'), /output|copy|EEXIST/i);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original runtime');
});

test('actual Windows resources and controlled launched image identify only the copied native executable', {skip: process.platform !== 'win32', timeout: 30000}, async t => {
  const {copyNativeExecutable} = require('./windows-identity.cjs');
  const output = path.join(fixture(t), 'MagpieFilter.exe'), before = fs.readFileSync(process.execPath);
  copyNativeExecutable(process.execPath, output, require('../package.json').version);
  const script = '$v = [Diagnostics.FileVersionInfo]::GetVersionInfo($env:MAGPIE_IDENTITY_FIXTURE); $v | Select-Object FileDescription,ProductName,InternalName,OriginalFilename,FileVersion,ProductVersion | ConvertTo-Json -Compress';
  const result = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    {encoding: 'utf8', windowsHide: true, timeout: 15000, env: {...process.env, MAGPIE_IDENTITY_FIXTURE: output}});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {FileDescription: 'Magpie Filter', ProductName: 'Magpie Filter',
    InternalName: 'MagpieFilter', OriginalFilename: 'MagpieFilter.exe', FileVersion: '0.1.0.0', ProductVersion: '0.1.0.0'});
  assert.deepEqual(fs.readFileSync(process.execPath), before);
  const child = spawn(output, ['-e', 'setInterval(() => {}, 1000)'], {windowsHide: true, stdio: 'ignore'});
  const ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const identity = require('./smoke-exe.cjs').verifyWindowsIdentity(output, child.pid);
    assert.equal(identity.Name, 'MagpieFilter.exe'); assert.equal(identity.ProcessId, child.pid);
    assert.equal(identity.ExecutablePath, output);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended; }
});
