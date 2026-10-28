'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomBytes} = require('node:crypto');
const {localOrigin} = require('../magpie-auto-codex-filter/proxy.cjs');
const {normalizePolicy} = require('../magpie-auto-codex-filter/policy.cjs');
const {atomicWrite} = require('../magpie-auto-codex-filter/base-config.cjs');

function validateSettings(value, revision) {
  const keys = ['client', 'configPath', 'upstream', 'port', 'policy'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || keys.some(k => !Object.hasOwn(value, k))
      || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid settings fields.');
  if (!value.policy || typeof value.policy.enabled !== 'boolean') throw new Error('Explicit core policy.enabled is required.');
  if (value.client !== 'codex') throw new Error('Only Codex is supported.');
  if (typeof value.configPath !== 'string' || !path.isAbsolute(value.configPath)
      || !/\.toml$/i.test(value.configPath) || value.configPath.includes('\0')) throw new Error('Use an absolute Codex TOML config path.');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Filter port must be 1024-65535.');
  const upstream = localOrigin(value.upstream);
  if (Number(new URL(upstream).port || 80) === value.port) throw new Error('Upstream and filter ports must differ.');
  const policy = normalizePolicy(value.policy);
  return Object.freeze({client: 'codex', configPath: path.resolve(value.configPath), upstream, port: value.port,
    policy: normalizePolicy({...policy, revision})});
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['version', 'revision', 'web', 'settings'].includes(key))
      || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid configuration version/fields/revision.');
  const web = value.web;
  if (!web || typeof web !== 'object' || Array.isArray(web)
      || Object.keys(web).some(key => !['port', 'token', 'authEnabled'].includes(key))
      || Object.hasOwn(web, 'authEnabled') && typeof web.authEnabled !== 'boolean'
      || !Number.isInteger(web.port) || web.port < 1024 || web.port > 65535
      || typeof web.token !== 'string' || !/^[a-fA-F0-9]{64}$/.test(web.token)) {
    throw new Error('web.port must be 1024-65535; web.token must contain exactly 64 hexadecimal characters; web.authEnabled must be boolean.');
  }
  const settings = validateSettings(value.settings, value.revision);
  if (settings.port === web.port || Number(new URL(settings.upstream).port || 80) === web.port) {
    throw new Error('Web, filter and upstream ports must differ.');
  }
  return Object.freeze({version: 1, revision: value.revision, web: Object.freeze({authEnabled: true, ...web}), settings});
}

function createConfigStore(filename) {
  filename = path.resolve(filename);
  const read = () => {
    const bytes = fs.readFileSync(filename, 'utf8');
    return {bytes, config: validateConfig(JSON.parse(bytes.replace(/^\uFEFF/, '')))};
  };
  if (!fs.existsSync(filename)) {
    const config = validateConfig({version: 1, revision: 0, web: {port: 18185, authEnabled: false, token: randomBytes(32).toString('hex')},
      settings: {client: 'codex', port: 18184, upstream: 'http://127.0.0.1:3425',
        configPath: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), policy: {enabled: false}}});
    fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  let {bytes, config} = read();
  const checkUnchanged = () => {
    if (fs.readFileSync(filename, 'utf8') !== bytes) throw new Error('Configuration changed on disk. Restart to load it before saving from the webpage.');
  };
  return {filename, get current() { return config; }, checkUnchanged,
    validate(patch, revision) { return validateConfig({...config, ...patch, revision}); },
    save(patch, revision) {
      const next = validateConfig({...config, ...patch, revision});
      const text = JSON.stringify(next, null, 2) + '\n';
      checkUnchanged(); atomicWrite(filename, text);
      bytes = text; config = next;
      return config;
    }};
}

module.exports = {createConfigStore, validateSettings, validateConfig};

