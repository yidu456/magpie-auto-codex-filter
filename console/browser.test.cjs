'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {openBrowser} = require('./browser.cjs');

test('Windows browser launch uses shell URL association with errors surfaced', async () => {
  let captured;
  const spawnProcess = (exe, args, options) => {
    captured = {exe, args, options};
    const child = new EventEmitter();
    process.nextTick(() => child.emit('exit', 0));
    return child;
  };
  await openBrowser('http://127.0.0.1:18185/#token=' + 'ab'.repeat(32), {spawnProcess, platform: 'win32'});
  assert.match(captured.exe, /powershell\.exe$/i);
  assert.equal(captured.options.windowsHide, true);
  assert.equal(captured.options.shell, undefined);
  const script = Buffer.from(captured.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /UseShellExecute = \$true/);
  assert.match(script, /ErrorActionPreference = 'Stop'/);
  assert.match(script, /127\.0\.0\.1:18185/);
});

test('failed browser dispatch rejects instead of silently claiming success', async () => {
  for (const failure of ['exit', 'error']) {
    await assert.rejects(openBrowser('http://127.0.0.1:18185/', {platform: 'win32', spawnProcess: () => {
      const child = new EventEmitter();
      process.nextTick(() => failure === 'exit' ? child.emit('exit', 1) : child.emit('error', new Error('spawn failed')));
      return child;
    }}), /browser|spawn/i);
  }
});
