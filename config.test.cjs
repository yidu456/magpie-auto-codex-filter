'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {ConfigRouter} = require('./magpie-config.cjs');
const {fixture} = require('./test-support.cjs');

function options(t) {
  const directory = fixture(t);
  return {mode: 'magpie-auto', configPath: path.join(directory, 'config.toml'),
    backupPath: path.join(directory, 'routes.json'), filterOrigin: 'http://127.0.0.1:18184',
    getUpstream: () => 'http://127.0.0.1:3425'};
}
test('local Magpie adapter attaches all matching routes without touching auth, catalogs or other gateways', t => {
  const settings = options(t);
  const original = '\uFEFFopenai_base_url = \'http://127.0.0.1:3425/backend-api/codex\' # keep\r\n'
    + 'model_provider = "magpie"\r\nmodel_catalog_json = "local-models.json"\r\n'
    + '[model_providers.magpie]\r\nbase_url = "http://127.0.0.1:3425/v1"\r\n'
    + 'model_catalog_url = "http://127.0.0.1:3425/v1/codex/models"\r\nexperimental_bearer_token = "mock-only"\r\n'
    + '[model_providers.old]\r\nbase_url = "http://127.0.0.1:3425/v1"\r\n'
    + '[model_providers.ccs]\r\nbase_url = "http://127.0.0.1:15721/v1"\r\n'
    + '[model_providers.remote]\r\nbase_url = "https://provider.example/v1"\r\n';
  fs.writeFileSync(settings.configPath, original);
  const router = new ConfigRouter(settings); router.sync();
  const attached = original.replaceAll('http://127.0.0.1:3425', 'http://127.0.0.1:18184/magpie');
  assert.equal(router.state, 'filtering');
  assert.equal(fs.readFileSync(settings.configPath, 'utf8'), attached);
  assert.doesNotMatch(fs.readFileSync(settings.backupPath, 'utf8'), /mock-only/);
  router.sync(); assert.equal(fs.readFileSync(settings.configPath, 'utf8'), attached);
  new ConfigRouter(settings).restore();
  assert.equal(fs.readFileSync(settings.configPath, 'utf8'), original);
  router.sync();
  fs.writeFileSync(settings.configPath, attached.replace('[model_providers.old]\r\nbase_url = "http://127.0.0.1:18184/magpie/v1"',
    '[model_providers.old]\r\nbase_url = "https://changed.example/v1"'));
  router.restore();
  assert.equal(fs.readFileSync(settings.configPath, 'utf8'), original.replace('[model_providers.old]\r\nbase_url = "http://127.0.0.1:3425/v1"',
    '[model_providers.old]\r\nbase_url = "https://changed.example/v1"'));
});
test('missing and non-Magpie configs stay in standby without writing recovery files', t => {
  const settings = options(t), router = new ConfigRouter(settings);
  router.sync(); assert.equal(router.state, 'waiting-for-codex-config');
  const original = 'model_provider = "ccs"\n[model_providers.ccs]\nbase_url = "http://127.0.0.1:15721/v1"\n';
  fs.writeFileSync(settings.configPath, original); router.sync();
  assert.equal(router.state, 'waiting-for-magpie');
  assert.equal(fs.readFileSync(settings.configPath, 'utf8'), original);
  assert.equal(fs.existsSync(settings.backupPath), false);
});
test('unowned filter URLs, duplicate entries and query credentials are refused without config edits', t => {
  const settings = options(t);
  for (const original of [
    'openai_base_url = "http://127.0.0.1:18184/magpie/v1"\n',
    'openai_base_url = "http://127.0.0.1:3425/v1"\nopenai_base_url = "http://127.0.0.1:3425/v1"\n',
    'openai_base_url = "http://127.0.0.1:3425/v1?key=mock-only"\n'
  ]) {
    fs.writeFileSync(settings.configPath, original);
    assert.throws(() => new ConfigRouter(settings).sync());
    assert.equal(fs.readFileSync(settings.configPath, 'utf8'), original);
  }
});
test('existing recovery data refuses another config, port or mode', t => {
  const settings = options(t);
  fs.writeFileSync(settings.configPath, 'openai_base_url = "http://127.0.0.1:3425/v1"\n');
  new ConfigRouter(settings).sync();
  for (const extra of [{configPath: settings.configPath + '.other'}, {filterOrigin: 'http://127.0.0.1:18183'}, {mode: 'magpie-ccs'}]) {
    assert.throws(() => new ConfigRouter({...settings, ...extra}), /backup/i);
  }
  new ConfigRouter(settings).restore();
});
