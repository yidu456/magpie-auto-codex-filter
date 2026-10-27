'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {makeProxy, FilterError} = require('../magpie-auto-codex-filter/proxy.cjs');
const {normalizePolicy} = require('../magpie-auto-codex-filter/policy.cjs');
const {ConfigRouter, magpieEntries} = require('../magpie-auto-codex-filter/config.cjs');
const {atomicWrite, sameEndpoint} = require('../magpie-auto-codex-filter/base-config.cjs');

const {createConfigStore, validateSettings} = require('./configuration.cjs');

function createController({runtime, configStore}) {
  runtime = path.resolve(runtime);
  fs.mkdirSync(runtime, {recursive: true});
  const file = name => path.join(runtime, name);
  const store = configStore || createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
  let revision = store.current.revision, settings = store.current.settings;
  const activeWeb = store.current.web;
  let proxy, router, connection, timer, transitioning = false, closed = false, lastError = null;
  let queue = Promise.resolve(), sequence = 0, logBytes = 0;
  const events = [], activePolicies = new Map();
  const log = (event, data = {}) => {
    const row = {id: ++sequence, time: new Date().toISOString(), event};
    // No request bodies, auth headers or full client configuration enter this log.
    for (const key of ['requestId', 'policyRevision', 'cleanup', 'enabled', 'state', 'handler', 'kind', 'errorCode',
      'code', 'retry', 'retries', 'delayMs', 'durationMs', 'outcome', 'phase', 'elapsedMs', 'removed', 'removedItemIds', 'status']) {
      if (typeof data[key] === 'string') row[key] = data[key].slice(0, 160);
      else if (typeof data[key] === 'number' || typeof data[key] === 'boolean') row[key] = data[key];
    }
    events.push(row);
    if (events.length > 200) events.shift();
    if (event === 'request-started') activePolicies.set(data.requestId, data.policyRevision);
    if (event === 'request-finished') activePolicies.delete(data.requestId);
    try {
      const line = JSON.stringify(row) + '\n';
      if (logBytes === 0 && fs.existsSync(file('console.log'))) logBytes = fs.statSync(file('console.log')).size;
      if (logBytes > 1024 * 1024) {
        const tail = fs.readFileSync(file('console.log'), 'utf8').slice(-512 * 1024);
        atomicWrite(file('console.log'), tail.slice(tail.indexOf('\n') + 1));
        logBytes = fs.statSync(file('console.log')).size;
      }
      fs.appendFileSync(file('console.log'), line, {mode: 0o600}); logBytes += Buffer.byteLength(line);
    } catch { /* Logging failure must not abort a model request or restoration. */ }
  };
  const persist = (next, nextRevision) => store.save({settings: next}, nextRevision);
  const makeRouter = c => new ConfigRouter({configPath: c.configPath, backupPath: file('routes.json'),
    filterOrigin: 'http://127.0.0.1:' + c.port, getUpstream: () => c.upstream, mode: 'magpie-auto', log});
  const retireJournal = () => {
    // Remove the journal last: a partial retirement is recoverable on next launch.
    if (fs.existsSync(file('routes.json'))) fs.unlinkSync(file('routes.json'));
    if (fs.existsSync(file('connection.json'))) fs.unlinkSync(file('connection.json'));
  };
  const restore = () => {
    if (!connection) return;
    const stillPointsHere = () => {
      if (!fs.existsSync(connection.configPath)) return false;
      const text = fs.readFileSync(connection.configPath, 'utf8');
      return magpieEntries(text).some(entry => sameEndpoint(entry.url, 'http://127.0.0.1:' + connection.port));
    };
    if (!fs.existsSync(file('routes.json')) && stillPointsHere()) {
      throw new Error('Recovery backup is missing while the client still uses this filter. Keep runtime files and restore the original address manually.');
    }
    router ||= makeRouter(connection);
    router.restore();
    if (stillPointsHere()) throw new Error('A user-edited endpoint still uses this filter. Restore that address before disconnecting.');
  };
  if (fs.existsSync(file('connection.json'))) {
    try {
      const journal = JSON.parse(fs.readFileSync(file('connection.json'), 'utf8'));
      if (journal.version !== 1) throw new Error('Invalid recovery journal version.');
      const validated = validateSettings({...settings, configPath: journal.configPath, upstream: journal.upstream, port: journal.port}, revision);
      connection = {configPath: validated.configPath, upstream: validated.upstream, port: validated.port};
      restore(); retireJournal(); router = connection = null;
      log('recovered');
    } catch (error) { lastError = error.message; }
  }
  const status = () => ({revision, settings, configFile: store.filename,
    web: {port: store.current.web.port, activePort: activeWeb.port,
      restartRequired: store.current.web.port !== activeWeb.port || store.current.web.token !== activeWeb.token},
    connected: !!proxy?.listening,
    attached: router?.state === 'filtering', state: closed ? 'closed' : lastError ? 'needs-attention' : router?.state || 'idle',
    lastError, connection: connection ? {...connection} : null,
    stats: {...(proxy?.stats || {requests: 0, activeRequests: 0})},
    activePolicies: [...activePolicies].map(([requestId, policyRevision]) => ({requestId, policyRevision})),
    events: events.map(row => ({...row}))});
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const stopListener = async () => {
    clearInterval(timer);
    if (proxy?.listening) await new Promise(resolve => { proxy.close(resolve); proxy.closeIdleConnections(); });
    proxy = null;
  };
  const apply = async ({revision: expected, settings: value, ...extra} = {}, startup = false) => {
    if (closed) throw new Error('Console is closed.');
    if (Object.keys(extra).length) throw new Error('Invalid update fields.');
    if (expected !== revision) throw new Error('Settings changed in another tab. Reload before saving (revision conflict).');
    store.checkUnchanged();
    const next = store.validate({settings: value}, revision + (startup ? 0 : 1)).settings;
    if (next.port === activeWeb.port || Number(new URL(next.upstream).port || 80) === activeWeb.port) {
      throw new Error('Filter and upstream cannot use the active web port.');
    }
    if (connection && ['configPath', 'upstream', 'port'].some(key => connection[key] !== next[key])) {
      throw new Error('Disconnect and restore the current connection before changing endpoints.');
    }
    if (lastError && !proxy && (connection || fs.existsSync(file('connection.json')))) {
      throw new Error('Resolve recovery first using Disconnect: ' + lastError);
    }
    transitioning = true;
    const fresh = next.policy.enabled && !proxy;
    let attachmentAttempted = false;
    try {
      if (fresh) {
        const candidate = {configPath: next.configPath, upstream: next.upstream, port: next.port};
        const checkUnowned = () => {
          if (!fs.existsSync(candidate.configPath)) return;
          const entries = magpieEntries(fs.readFileSync(candidate.configPath, 'utf8'));
          if (entries.some(entry => sameEndpoint(entry.url, 'http://127.0.0.1:' + candidate.port))) {
            throw new Error('An unowned filter URL already exists in this config. Restore it from the original installation first.');
          }
        };
        checkUnowned();
        const candidateRouter = makeRouter(candidate);
        const server = makeProxy({mode: 'magpie-auto', token: randomBytes(32).toString('hex'),
          getUpstream: () => candidate.upstream, getPolicy: () => {
            if (transitioning || closed) throw new FilterError('configuration_transition', 'Connection is changing; retry shortly.', 503);
            return settings.policy;
          }, log});
        await new Promise((resolve, reject) => {
          server.once('error', reject); server.listen(next.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
        });
        proxy = server;
        checkUnowned();
        connection = candidate;
        router = candidateRouter;
        atomicWrite(file('connection.json'), JSON.stringify({version: 1, ...connection}));
        attachmentAttempted = true;
        router.sync();
      }
      if (!startup) persist(next, revision + 1);
      settings = next; if (!startup) revision++; lastError = null;
      if (fresh) {
        timer = setInterval(() => {
          if (transitioning || closed) return;
          try { router.sync(); lastError = null; }
          catch (error) { lastError = error.message; }
        }, 1000);
        timer.unref();
      }
      log('settings-applied', {policyRevision: revision, enabled: settings.policy.enabled, cleanup: settings.policy.cleanup});
      return status();
    } catch (error) {
      if (fresh && proxy) {
        try {
          if (attachmentAttempted) restore();
          await stopListener();
          if (attachmentAttempted) retireJournal();
          connection = router = null;
        }
        catch (restoreError) { lastError = 'Recovery required: ' + restoreError.message; }
      }
      throw error;
    } finally { transitioning = false; }
  };
  const disconnectInternal = async (preservePreference = false) => {
    if (proxy?.stats.activeRequests) throw new Error('There are active requests. Wait for completion or cancel them in the client first.');
    if (!connection && !fs.existsSync(file('connection.json'))) return status();
    if (!connection) throw new Error('Recovery journal is invalid. Preserve runtime files and repair the journal before exiting.');
    transitioning = true;
    try {
      restore();
      const next = validateSettings({...settings, policy: {...settings.policy, enabled: false}}, revision + 1);
      if (!preservePreference) persist(next, revision + 1);
      settings = next; revision++;
      await stopListener(); retireJournal(); connection = router = null; lastError = null;
      log('disconnected');
      return status();
    } catch (error) { lastError = error.message; throw error; }
    finally { transitioning = false; }
  };
  return {status, update: value => serial(() => apply(value)),
    start: () => serial(async () => {
      try { if (settings.policy.enabled) await apply({revision, settings}, true); }
      catch (error) { lastError = lastError || error.message; }
      // Recovery/activation failures must leave a reachable console for diagnosis and exit.
      return status();
    }),
    updateWeb: ({revision: expected, web, ...extra}) => serial(() => {
      if (closed || Object.keys(extra).length || expected !== revision) throw new Error('Settings revision changed or console is closed.');
      if (!web || typeof web !== 'object' || Array.isArray(web)) throw new Error('Invalid web settings.');
      web = {token: store.current.web.token, ...web};
      if (connection && (web.port === connection.port || Number(new URL(connection.upstream).port || 80) === web.port)) {
        throw new Error('Web port conflicts with the current connection.');
      }
      store.save({web}, revision + 1); revision++;
      return status();
    }),
    disconnect: () => serial(() => disconnectInternal()), close: () => serial(async () => {
    if (closed) return;
    await disconnectInternal(true); closed = true;
  })};
}

module.exports = {createController, validateSettings};
