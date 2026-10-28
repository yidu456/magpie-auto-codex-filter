'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomBytes} = require('node:crypto');
const {spawn} = require('node:child_process');
const sea = require('node:sea');
const {atomicWrite} = require('../magpie-auto-codex-filter/base-config.cjs');
const {createController} = require('./controller.cjs');
const {createManagementServer} = require('./server.cjs');
const {loadAssets} = require('./assets.cjs');
const {createConfigStore} = require('./configuration.cjs');
const {openBrowser} = require('./browser.cjs');

const SERVICE = 'magpie-filter-console-v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function parseArgs(args) {
  const directory = sea.isSea() ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
  const options = {runtime: path.join(directory, '.magpie-filter'),
    configFile: path.join(directory, 'MagpieFilter.config.json'), open: true};
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error('Duplicate option: ' + arg);
    seen.add(arg);
    if (arg === '--no-open') options.open = false;
    else if (arg === '--runtime' && args[i + 1] && path.isAbsolute(args[i + 1])) {
      options.runtime = path.resolve(args[++i]);
      options.configFile = path.join(options.runtime, 'MagpieFilter.config.json');
    }
    else throw new Error('Use --runtime ABSOLUTE_PATH and/or --no-open.');
  }
  return options;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function verifyRunning(record, token) {
  return new Promise(resolve => {
    let url;
    try {
      url = new URL(record?.origin);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port)
          || url.username || url.password || url.pathname !== '/' || url.search || url.hash
          || typeof token !== 'string' || !/^[a-fA-F0-9]{64}$/.test(token)) return resolve(false);
    } catch { resolve(false); return; }
    const req = http.get(url.origin + '/api/state', {headers: {'x-console-token': token}}, res => {
      let text = '';
      // Allow 1000 active/200 recent metrics, duplicate policies and 200 bounded log rows.
      res.on('data', chunk => { text += chunk; if (text.length > 4 * 1024 * 1024) { resolve(false); req.destroy(); } });
      res.on('error', () => resolve(false));
      res.on('end', () => {
        try {
          const app = JSON.parse(text).application;
          resolve(res.statusCode === 200 && app?.service === SERVICE && app.instance === record.instance && app.pid === record.pid);
        } catch { resolve(false); }
      });
    });
    req.setTimeout(1000, () => req.destroy()); req.on('error', () => resolve(false));
  });
}
async function openConsole(record, token, configFile, stateFile) {
  try { await openBrowser(record.origin + '/#token=' + token); }
  catch {
    const message = 'Cannot open the default browser. The console is still running.\n\nOpen: ' + record.origin
      + '/\n\nRead the active token field from:\n' + stateFile
      + '\n\nConfigured web.token (next launch):\n' + configFile;
    console.error(message);
    showMessage(message);
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args), runtime = options.runtime;
  fs.mkdirSync(runtime, {recursive: true});
  const lock = path.join(runtime, 'instance.lock'), ownerFile = path.join(lock, 'owner.json'), stateFile = path.join(runtime, 'service.json');
  const existing = readJson(stateFile);
  if (fs.existsSync(stateFile) && (existing?.service !== SERVICE || !/^[a-f0-9]{32}$/.test(existing.instance || ''))) {
    throw new Error('This runtime contains a foreign or invalid service record. Use a separate console runtime; do not delete the original recovery files.');
  }
  if (fs.existsSync(path.join(runtime, 'routes.json')) && !fs.existsSync(path.join(runtime, 'connection.json'))) {
    throw new Error('This runtime contains an unowned address backup. Use a separate console runtime.');
  }
  const instance = randomBytes(16).toString('hex');
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lock);
      atomicWrite(ownerFile, JSON.stringify({pid: process.pid, instance}));
      acquired = true; break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      for (let wait = 0; wait < 40; wait++) {
        const owner = readJson(ownerFile), record = readJson(stateFile);
        const token = record?.token || readJson(options.configFile)?.web?.token;
        if (owner && record?.instance === owner.instance && record.pid === owner.pid && await verifyRunning(record, token)) {
          if (options.open) await openConsole(record, token, options.configFile, stateFile);
          console.log('Console already running at ' + record.origin);
          return {reused: true, origin: record.origin};
        }
        if (owner && !alive(owner.pid)) break;
        await sleep(50);
      }
      const owner = readJson(ownerFile);
      if (!owner || alive(owner.pid)) throw new Error('Another console owns this runtime but is not responding. Do not delete recovery files; retry after its process exits.');
      if (!/^[a-f0-9]{32}$/.test(owner.instance || '')) throw new Error('Invalid console lock identity.');
      // A nonempty tombstone prevents a second stale observer renaming a new owner's lock.
      if (readJson(ownerFile)?.instance !== owner.instance) throw new Error('Console ownership changed; retry.');
      fs.renameSync(lock, lock + '.retired-' + owner.instance);
    }
  }
  if (!acquired) throw new Error('Could not acquire console runtime.');
  const retire = () => {
    if (readJson(stateFile)?.instance === instance) fs.unlinkSync(stateFile);
    if (readJson(ownerFile)?.instance === instance) { fs.unlinkSync(ownerFile); fs.rmdirSync(lock); }
  };
  let controller, server;
  const signal = async () => {
    try { await controller.close(); await exit(); }
    catch (error) { console.error('Console still running: ' + error.message); }
  };
  const exit = async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    retire(); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
  };
  try {
    const previous = readJson(stateFile);
    if (fs.existsSync(stateFile) && (previous?.service !== SERVICE || alive(previous.pid))) {
      throw new Error('Existing service ownership cannot be verified. Keep the original runtime and retry after it exits.');
    }
    const store = createConfigStore(options.configFile), {token, port} = store.current.web;
    const facade = {status: () => ({...controller.status(), application: {service: SERVICE, pid: process.pid, instance}}),
      update: value => controller.update(value), updateWeb: value => controller.updateWeb(value),
      disconnect: () => controller.disconnect(), close: () => controller.close()};
    server = createManagementServer({controller: facade, token, assets: loadAssets(), onExit: () => exit().catch(error => console.error(error.message))});
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    // Bind the configured management port before any recovery or client configuration changes.
    controller = createController({runtime, configStore: store});
    await controller.start();
    // Cache the active credential only for relaunch while configured rotation awaits restart.
    const record = {service: SERVICE, pid: process.pid, instance, origin: 'http://127.0.0.1:' + port, token};
    atomicWrite(stateFile, JSON.stringify(record));
    process.on('SIGINT', signal); process.on('SIGTERM', signal);
    if (options.open) await openConsole(record, token, options.configFile, stateFile);
    console.log('Console ready at ' + record.origin + ' (core ' + (controller.status().settings.policy.enabled ? 'ON' : 'OFF') + ')');
    return {reused: false, origin: record.origin};
  } catch (error) {
    if (controller) await controller.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    retire(); throw error;
  }
}

function showMessage(text) {
  if (process.platform === 'win32' && sea.isSea() && !process.argv.includes('--no-open')) {
    const message = text.replaceAll("'", "''");
    const script = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" + message + "','Magpie Filter') | Out-Null";
    const exe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true, stdio: 'ignore'}).on('error', () => {});
  }
}
function reportError(error) {
  console.error('Magpie Filter: ' + error.message);
  showMessage('Magpie Filter could not start.\n\n' + error.message);
  process.exitCode = 1;
}
if (require.main === module) main().catch(reportError);
module.exports = {main, parseArgs};
