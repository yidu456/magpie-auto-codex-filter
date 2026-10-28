'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {makeProxy, FilterError} = require('../magpie-auto-codex-filter/proxy.cjs');
const {normalizePolicy} = require('../magpie-auto-codex-filter/policy.cjs');
const {ConfigRouter, magpieEntries} = require('../magpie-auto-codex-filter/config.cjs');
const {atomicWrite, sameEndpoint} = require('../magpie-auto-codex-filter/base-config.cjs');

const {createConfigStore, validateSettings} = require('./configuration.cjs');
const {createRecorder, MAX_SAVED_BYTES} = require('./metrics.cjs');
const {createLogWriter} = require('./log-writer.cjs');
const {createPortOwner} = require('./port-owner.cjs');

function createController({runtime, configStore, portOwner = createPortOwner()}) {
  runtime = path.resolve(runtime);
  fs.mkdirSync(runtime, {recursive: true});
  const file = name => path.join(runtime, name);
  const store = configStore || createConfigStore(path.join(runtime, 'MagpieFilter.config.json'));
  let revision = store.current.revision, settings = store.current.settings;
  const activeWeb = store.current.web;
  let proxy, router, connection, timer, transitioning = false, closed = false, lastError = null;
  let consent = null, portConflictPending = false;
  let queue = Promise.resolve(), sequence = 0, proxySequence = 0, metricsSave = null;
  const events = [], recorder = createRecorder(), writer = createLogWriter(file('console.log'));
  const instance = randomBytes(8).toString('hex');
  const persistence = {loadError: null, writeErrors: 0, lastError: null, lastSavedAt: null, timerActive: true};
  try {
    if (fs.existsSync(file('metrics.json'))) {
      if (fs.statSync(file('metrics.json')).size > MAX_SAVED_BYTES) persistence.loadError = 'SNAPSHOT_TOO_LARGE';
      else if (!recorder.hydrate(JSON.parse(fs.readFileSync(file('metrics.json'), 'utf8')))) persistence.loadError = 'INVALID_OR_STALE_SNAPSHOT';
    }
  } catch { persistence.loadError = 'INVALID_SNAPSHOT'; }
  const saveMetrics = () => {
    if (metricsSave) return metricsSave;
    metricsSave = (async () => {
      const temp = file('metrics.json.' + randomBytes(8).toString('hex') + '.tmp');
      try {
        const text = JSON.stringify(recorder.serialize());
        if (Buffer.byteLength(text) > MAX_SAVED_BYTES) throw Object.assign(new Error(), {code: 'SNAPSHOT_TOO_LARGE'});
        await fs.promises.writeFile(temp, text, {flag: 'wx', mode: 0o600});
        await fs.promises.rename(temp, file('metrics.json'));
        persistence.lastSavedAt = new Date().toISOString(); persistence.lastError = null;
      } catch (error) {
        persistence.writeErrors++;
        persistence.lastError = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'IO_ERROR';
      } finally { await fs.promises.unlink(temp).catch(() => {}); }
    })().finally(() => { metricsSave = null; });
    return metricsSave;
  };
  const metricsTimer = setInterval(saveMetrics, 60000); metricsTimer.unref();
  const log = (event, data = {}) => {
    const row = {id: ++sequence, time: new Date().toISOString(), event};
    // No request bodies, auth headers or full client configuration enter this log.
    for (const key of ['requestId', 'policyRevision', 'cleanup', 'enabled', 'state', 'handler', 'kind', 'errorCode',
      'code', 'retry', 'retries', 'delayMs', 'durationMs', 'outcome', 'phase', 'elapsedMs', 'removed', 'removedItemIds', 'status']) {
      if (typeof data[key] === 'string' && data[key].length <= 160 && !/[\x00-\x1f\x7f]/.test(data[key])) {
        if (['errorCode', 'code'].includes(key) && !/^[a-zA-Z0-9_.:-]+$/.test(data[key])) continue;
        row[key] = data[key];
      } else if ((typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0)
        || typeof data[key] === 'boolean') row[key] = data[key];
    }
    events.push(row);
    if (events.length > 200) events.shift();
    writer.write(JSON.stringify(row) + '\n');
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
  const currentConflict = () => {
    if (consent && performance.now() >= consent.deadline) consent = null;
    return consent?.public || null;
  };
  const offerConflict = (next, metadata, code = 'PORT_CONFLICT') => {
    const challenge = randomBytes(32).toString('hex');
    const conflict = {port: next.port, owner: metadata.owner ? {
      pid: metadata.owner.pid, name: metadata.owner.name, executable: metadata.owner.executable
    } : null, canTerminate: metadata.canTerminate, reason: metadata.reason,
    revision, challenge, expiresAt: Date.now() + 60000};
    // The original frozen owner is an adapter-local capability; never clone it for termination.
    consent = {settings: next, owner: metadata.owner, deadline: performance.now() + 60000, public: conflict};
    lastError = code === 'PORT_CONFLICT' ? 'EADDRINUSE: filter port is occupied. Explicit confirmation is required.'
      : 'Port owner changed. Review the new owner before confirming.';
    return Object.assign(new Error(lastError), {code, conflict});
  };
  const status = () => {
    const metrics = recorder.snapshot();
    return {revision, settings, configFile: store.filename,
    web: {port: store.current.web.port, activePort: activeWeb.port,
      restartRequired: store.current.web.port !== activeWeb.port || store.current.web.token !== activeWeb.token},
    connected: !!proxy?.listening,
    attached: router?.state === 'filtering', state: closed ? 'closed' : lastError ? 'needs-attention' : router?.state || 'idle',
    lastError, transitioning, portConflictPending, portConflict: currentConflict(), connection: connection ? {...connection} : null,
    stats: {...(proxy?.stats || {requests: 0, activeRequests: 0})},
    activePolicies: metrics.active.map(({requestId, policyRevision}) => ({requestId, policyRevision})),
    events: events.map(row => ({...row})), metrics,
    diagnostics: {logs: writer.diagnostics, persistence: {...persistence}}};
  };
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const mutate = fn => { consent = null; return serial(() => { consent = null; return fn(); }); };
  const stopListener = async () => {
    clearInterval(timer);
    if (proxy?.listening) await new Promise(resolve => { proxy.close(resolve); proxy.closeIdleConnections(); });
    proxy = null;
  };
  const validateUpdate = ({revision: expected, settings: value, ...extra} = {}, startup = false) => {
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
    if (!proxy && (connection || fs.existsSync(file('connection.json')))) {
      throw new Error('Resolve recovery first using Disconnect: ' + (lastError || 'Recovery journal is unresolved.'));
    }
    return next;
  };
  const checkUnowned = candidate => {
    if (!fs.existsSync(candidate.configPath)) return;
    const entries = magpieEntries(fs.readFileSync(candidate.configPath, 'utf8'));
    if (entries.some(entry => sameEndpoint(entry.url, 'http://127.0.0.1:' + candidate.port))) {
      throw new Error('An unowned filter URL already exists in this config. Restore it from the original installation first.');
    }
  };
  const apply = async (value, startup = false) => {
    const next = validateUpdate(value, startup);
    transitioning = true;
    const fresh = next.policy.enabled && !proxy;
    let attachmentAttempted = false;
    try {
      if (fresh) {
        const candidate = {configPath: next.configPath, upstream: next.upstream, port: next.port};
        checkUnowned(candidate);
        const candidateRouter = makeRouter(candidate);
        const namespace = instance + ':' + ++proxySequence + ':';
        const namespaced = data => Number.isSafeInteger(data?.requestId) && data.requestId >= 0
          ? {...data, requestId: namespace + data.requestId} : data;
        const server = makeProxy({mode: 'magpie-auto', token: randomBytes(32).toString('hex'),
          getUpstream: () => candidate.upstream, getPolicy: () => {
            if (transitioning || closed) throw new FilterError('configuration_transition', 'Connection is changing; retry shortly.', 503);
            return settings.policy;
          }, log: (event, data) => log(event, namespaced(data)), observe: (event, data) => {
            try { recorder.observe(event, namespaced(data)); }
            catch { /* Optional recording cannot affect forwarding or restoration. */ }
          }});
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject); server.listen(next.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
          });
        } catch (error) {
          if (error.code === 'EADDRINUSE') throw offerConflict(next, await portOwner.inspect(next.port));
          throw error;
        }
        proxy = server;
        checkUnowned(candidate);
        connection = candidate;
        router = candidateRouter;
        atomicWrite(file('connection.json'), JSON.stringify({version: 1, ...connection}));
        attachmentAttempted = true;
        router.sync();
      }
      if (!startup) persist(next, revision + 1);
      settings = next; if (!startup) revision++; lastError = null; consent = null;
      if (fresh) {
        timer = setInterval(() => {
          if (transitioning || closed) return;
          try { router.sync(); lastError = null; }
          catch (error) { lastError = error.message; }
        }, 1000);
        timer.unref();
      }
      log('settings-applied', {policyRevision: revision, enabled: settings.policy.enabled, cleanup: settings.policy.cleanup});
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
    return status();
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
    } catch (error) { lastError = error.message; throw error; }
    finally { transitioning = false; }
    return status();
  };
  const resolvePortConflict = value => serial(async () => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['revision', 'challenge', 'confirm'].includes(key))
      || typeof value.confirm !== 'boolean' || typeof value.challenge !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.challenge) || !Number.isSafeInteger(value.revision)) {
      throw Object.assign(new Error('Invalid port-conflict fields.'), {code: 'INVALID_PORT_CONFLICT'});
    }
    const conflict = currentConflict();
    if (closed || !conflict || value.revision !== revision || value.challenge !== conflict.challenge) {
      throw Object.assign(new Error('Port confirmation expired or changed. Retry activation for fresh consent.'), {code: 'PORT_CONFLICT_STALE'});
    }
    const confirmed = consent; consent = null;
    if (!value.confirm) return status();
    try {
      const next = validateUpdate({revision, settings: confirmed.settings});
      if (!next.policy.enabled || proxy) throw new Error('Connection changed. Retry activation.');
      checkUnowned(next);
      // Repeat normal activation's address-backup ownership validation before any destructive work.
      makeRouter(next);
      if (!conflict.canTerminate) throw Object.assign(new Error('Port owner cannot be safely terminated. Quit it manually and retry.'), {code: 'PORT_OWNER_UNSAFE'});
      transitioning = portConflictPending = true;
      try { await portOwner.terminate(next.port, confirmed.owner); }
      catch (error) {
        if (error.code === 'PORT_OWNER_CHANGED') throw offerConflict(next, error.conflict || await portOwner.inspect(next.port), error.code);
        throw error;
      }
      await apply({revision, settings: next});
    } catch (error) { lastError = error.message; throw error; }
    finally { transitioning = portConflictPending = false; }
    return status();
  });
  return {status, resolvePortConflict, update: value => mutate(() => apply(value)),
    start: () => mutate(async () => {
      try { if (settings.policy.enabled) await apply({revision, settings}, true); }
      catch (error) { lastError = lastError || error.message; }
      // Recovery/activation failures must leave a reachable console for diagnosis and exit.
      return status();
    }),
    updateWeb: ({revision: expected, web, ...extra}) => mutate(() => {
      if (closed || Object.keys(extra).length || expected !== revision) throw new Error('Settings revision changed or console is closed.');
      if (!web || typeof web !== 'object' || Array.isArray(web)) throw new Error('Invalid web settings.');
      web = {token: store.current.web.token, ...web};
      if (connection && (web.port === connection.port || Number(new URL(connection.upstream).port || 80) === web.port)) {
        throw new Error('Web port conflicts with the current connection.');
      }
      store.save({web}, revision + 1); revision++;
      return status();
    }),
    disconnect: () => mutate(() => disconnectInternal()), close: () => mutate(async () => {
    if (closed) return;
    await disconnectInternal(true); closed = true;
    clearInterval(metricsTimer); persistence.timerActive = false;
    if (metricsSave) await metricsSave;
    await saveMetrics(); await writer.close();
  })};
}

module.exports = {createController, validateSettings};
