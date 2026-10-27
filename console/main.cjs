'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {randomBytes} = require('node:crypto');
const {spawn} = require('node:child_process');
const sea = require('node:sea');
const {atomicWrite} = require('../magpie-auto-codex-filter/base-config.cjs');
const {createController} = require('./controller.cjs');
const {createManagementServer} = require('./server.cjs');
const {loadAssets} = require('./assets.cjs');

const SERVICE = 'magpie-filter-console-v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function parseArgs(args) {
  const options = {runtime: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MagpieFilterConsole'), open: true};
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error('Duplicate option: ' + arg);
    seen.add(arg);
    if (arg === '--no-open') options.open = false;
    else if (arg === '--runtime' && args[i + 1] && path.isAbsolute(args[i + 1])) options.runtime = path.resolve(args[++i]);
    else throw new Error('Use --runtime ABSOLUTE_PATH and/or --no-open.');
  }
  return options;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function verifyRunning(record) {
  return new Promise(resolve => {
    let url;
    try {
      url = new URL(record?.origin);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port)
          || url.username || url.password || url.pathname !== '/' || url.search || url.hash
          || typeof record.token !== 'string' || !/^[a-f0-9]{64}$/.test(record.token)) return resolve(false);
    } catch { resolve(false); return; }
    const req = http.get(url.origin + '/api/state', {headers: {'x-console-token': record.token}}, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 512 * 1024) req.destroy(); });
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
function openBrowser(record) {
  const url = record.origin + '/#token=' + record.token;
  const executable = process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe')
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(executable, [url], {detached: true, windowsHide: true, stdio: 'ignore'});
  child.on('error', error => console.error('Cannot open browser: ' + error.message)); child.unref();
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
        if (owner && record?.instance === owner.instance && record.pid === owner.pid && await verifyRunning(record)) {
          if (options.open) openBrowser(record);
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
    // Lock ownership is verified before the controller may inspect recovery journals.
    controller = createController({runtime});
    const token = randomBytes(32).toString('hex');
    const facade = {...controller, status: () => ({...controller.status(), application: {service: SERVICE, pid: process.pid, instance}})};
    server = createManagementServer({controller: facade, token, assets: loadAssets(), onExit: () => exit().catch(error => console.error(error.message))});
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const record = {service: SERVICE, pid: process.pid, instance, token, origin: 'http://127.0.0.1:' + server.address().port};
    atomicWrite(stateFile, JSON.stringify(record));
    process.on('SIGINT', signal); process.on('SIGTERM', signal);
    if (options.open) openBrowser(record);
    console.log('Console ready at ' + record.origin + ' (core OFF)');
    return {reused: false, origin: record.origin};
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    retire(); throw error;
  }
}

function reportError(error) {
  console.error('Magpie Filter: ' + error.message);
  if (process.platform === 'win32' && sea.isSea() && !process.argv.includes('--no-open')) {
    const message = ('Magpie Filter could not start.\n\n' + error.message).replaceAll("'", "''");
    const script = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" + message + "','Magpie Filter') | Out-Null";
    const exe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {windowsHide: true, stdio: 'ignore'}).on('error', () => {});
  }
  process.exitCode = 1;
}
if (require.main === module) main().catch(reportError);
module.exports = {main, parseArgs};
