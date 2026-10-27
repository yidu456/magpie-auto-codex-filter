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

test('browser fallback identifies the active token cache without printing credentials', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const messages = [];
  const context = {module: {exports: {}}, __dirname, Buffer,
    process: {platform: 'linux'}, console: {error: message => messages.push(message)},
    require: name => name === './browser.cjs' ? {openBrowser: async () => { throw new Error('mock association failure'); }} : require(name)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8') + '\nmodule.exports = openConsole;', context);
  const token = 'ab'.repeat(32);
  await context.module.exports({origin: 'http://127.0.0.1:18185'}, token, 'config.json', 'runtime/service.json');
  assert.match(messages[0], /active token field from:\nruntime\/service.json/);
  assert.equal(messages[0].includes(token), false);
});
