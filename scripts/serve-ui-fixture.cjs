'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {createConfigStore} = require('../console/configuration.cjs');
const {listen, close} = require('../magpie-auto-codex-filter/test-support.cjs');

async function createUIFixture({executable, open = false} = {}) {
  const root = path.resolve(__dirname, '../.verification'); fs.mkdirSync(root, {recursive: true});
  const runtime = fs.mkdtempSync(path.join(root, 'ui-fixture-'));
  const upstream = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
  let child, ended, closing;
  const dispose = () => closing ||= (async () => {
    // Only this fixture's direct console child is eligible for forced termination.
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await close(upstream);
    if (ended) {
      let timer;
      try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('UI fixture child termination timeout')), 3000); })]); }
      finally { clearTimeout(timer); }
    }
  })();
  try {
    const origin = await listen(upstream);
    const freePort = async () => { const s = http.createServer(); const p = Number(new URL(await listen(s)).port); await close(s); return p; };
    const webPort = await freePort(), filterPort = await freePort();
    const configPath = path.join(runtime, 'mock-codex.toml');
    fs.writeFileSync(configPath, '[model_providers.mock]\nbase_url="' + origin + '/v1"\n');
    const store = createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
    store.save({web: {port: webPort, token: 'ab'.repeat(32)}, settings: {...store.current.settings,
      port: filterPort, upstream: origin, configPath}}, 0);
    const args = [...(executable ? [] : [path.resolve(__dirname, '../console/main.cjs')]), '--runtime', runtime];
    if (!open) args.push('--no-open');
    child = spawn(executable ? path.resolve(executable) : process.execPath, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    const ready = new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', data => { output += data; if (output.includes('Console ready at ')) resolve(); });
      child.once('error', reject); child.once('exit', code => reject(new Error('UI fixture exited before readiness: ' + code)));
    });
    ready.catch(() => {});
    return {origin: 'http://127.0.0.1:' + webPort, runtime, filterPort, child, upstream, ready, ended, close: dispose};
  } catch (error) { await dispose().catch(() => {}); throw error; }
}

async function main() {
  const fixture = await createUIFixture({executable: process.argv[2], open: process.argv.includes('--open')});
  fixture.child.stdout.pipe(process.stdout); fixture.child.stderr.pipe(process.stderr);
  console.log(JSON.stringify({origin: fixture.origin, runtime: fixture.runtime, filterPort: fixture.filterPort}));
  const shutdown = () => fixture.close().catch(error => { console.error(error); process.exitCode = 1; });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try { await fixture.ready; await fixture.ended; process.exitCode = fixture.child.exitCode || 0; }
  finally { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); await fixture.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {createUIFixture};
