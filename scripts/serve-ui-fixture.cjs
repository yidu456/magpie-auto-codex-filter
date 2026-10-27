'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {createConfigStore} = require('../console/configuration.cjs');
const {listen, close} = require('../magpie-auto-codex-filter/test-support.cjs');

async function main() {
  const root = path.resolve(__dirname, '../.verification'); fs.mkdirSync(root, {recursive: true});
  const runtime = fs.mkdtempSync(path.join(root, 'ui-fixture-'));
  const upstream = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  const origin = await listen(upstream);
  const freePort = async () => { const s = http.createServer(); const p = Number(new URL(await listen(s)).port); await close(s); return p; };
  const webPort = await freePort(), filterPort = await freePort();
  const configPath = path.join(runtime, 'mock-codex.toml');
  fs.writeFileSync(configPath, '[model_providers.mock]\nbase_url="' + origin + '/v1"\n');
  const store = createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
  store.save({web: {port: webPort, token: 'ab'.repeat(32)}, settings: {...store.current.settings,
    port: filterPort, upstream: origin, configPath}}, 0);
  const executable = process.argv[2] ? path.resolve(process.argv[2]) : process.execPath;
  const args = [...(process.argv[2] ? [] : [path.resolve(__dirname, '../console/main.cjs')]), '--runtime', runtime];
  if (!process.argv.includes('--open')) args.push('--no-open');
  const child = spawn(executable, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.once('error', async error => { console.error(error); await close(upstream); process.exitCode = 1; });
  child.once('exit', async code => { await close(upstream); process.exitCode = code || 0; });
  console.log(JSON.stringify({origin: 'http://127.0.0.1:' + webPort, runtime, filterPort}));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
