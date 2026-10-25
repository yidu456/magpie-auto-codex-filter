'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

function temporary(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'magpie-standalone-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), parent);
    assert.match(path.basename(directory), /^magpie-standalone-/);
    fs.rmSync(directory, {recursive: true, force: true});
  });
  return directory;
}
function invoke(directory, args, filename = 'filter.cjs') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, filename), ...args],
      {cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated command timed out')); }, 25000);
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
  });
}
function isolatedSource(t) {
  const directory = temporary(t);
  for (const file of fs.readdirSync(__dirname)) {
    if (file.endsWith('.cjs') && !file.endsWith('.test.cjs')) {
      fs.copyFileSync(path.join(__dirname, file), path.join(directory, file));
    }
  }
  return directory;
}

test('standalone entry loads with no sibling directories or installed packages', async t => {
  const directory = isolatedSource(t);
  const result = await invoke(directory, ['help']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /start\|stop/);
  for (const mode of ['ccswitch', 'magpie', 'magpie-ccs']) {
    const rejected = await invoke(directory, ['status', '--mode', mode]);
    assert.notEqual(rejected.code, 0);
  }
});

test('isolated background lifecycle preserves history and restores mock config byte for byte', async t => {
  let directory, args, upstream;
  // Shutdown must run before the temporary directory's cleanup hook.
  t.after(async () => {
    try { if (args) assert.equal((await invoke(directory, ['stop', ...args])).code, 0); }
    finally {
      if (upstream?.listening) {
        upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
      }
    }
  });
  directory = isolatedSource(t);
  const config = path.join(directory, 'config.toml');
  upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.url, '/v1/responses');
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), {model: 'mock', store: true, input: [
      {type: 'reasoning', id: 'rs', encrypted_content: 'mock-only'}, {role: 'user', content: 'hello'}]});
    res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const origin = 'http://127.0.0.1:' + upstream.address().port;
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const original = '\uFEFFopenai_base_url = "' + origin + '/backend-api/codex" # keep\r\n'
    + 'model_provider = "magpie"\r\n[model_providers.magpie]\r\nbase_url = "' + origin + '/v1"\r\n';
  fs.writeFileSync(config, original);
  args = ['--port', String(port), '--upstream', origin, '--config', config, '--runtime', path.join(directory, 'runtime')];
  const started = await invoke(directory, ['start', ...args]);
  assert.equal(started.code, 0, started.stderr);
  const state = JSON.parse(started.stdout);
  assert.equal(state.service, 'magpie-auto-codex-filter-v1');
  assert.equal(state.mode, 'magpie-auto');
  assert.equal(state.state, 'filtering');
  assert.equal(state.upstreamReachable, true);
  assert.equal(fs.readFileSync(config, 'utf8'), original.replaceAll(origin, 'http://127.0.0.1:' + port + '/magpie'));
  const response = await fetch('http://127.0.0.1:' + port + '/magpie/v1/responses', {method: 'POST', body: JSON.stringify({
    model: 'mock', store: true, input: [{type: 'reasoning', id: 'rs', encrypted_content: 'mock-only'}, {role: 'user', content: 'hello'}]})});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true});
  assert.equal(JSON.parse((await invoke(directory, ['start', ...args])).stdout).pid, state.pid);
  assert.equal((await invoke(directory, ['idle-stop', ...args])).code, 0);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  fs.writeFileSync(config, original.replaceAll(origin, 'http://127.0.0.1:' + port + '/magpie'));
  assert.equal((await invoke(directory, ['stop', ...args])).code, 0);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
});
