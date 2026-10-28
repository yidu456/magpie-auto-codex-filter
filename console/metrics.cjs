'use strict';
const MAX_SAVED_BYTES = 1024 * 1024;
const KINDS = ['resource', 'rateLimit', 'transport', 'availability', 'local', 'other'];
const OUTCOMES = ['success', 'failed', 'canceled', 'unavailable'];
const BOUNDS = [100, 500, 1000, 3000, 10000, 30000, 60000];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const timing = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const label = (value, max = 120) => typeof value === 'string' && value.length > 0 && value.length <= max
  && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const code = value => label(value, 160) && /^[a-zA-Z0-9_.:-]+$/.test(value) ? value : 'other';
const kind = value => KINDS.includes(value) ? value : 'other';
const idValid = value => count(value) || !!(label(value, 100) && /^[a-zA-Z0-9_.:-]+$/.test(value));
const localDate = time => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const add = (target, key, amount = 1) => { target[key] = Math.min(Number.MAX_SAFE_INTEGER, (target[key] || 0) + amount); };
function usage(value) {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return null;
  const result = {input_tokens: value.input_tokens, output_tokens: value.output_tokens};
  if (value.total_tokens !== undefined) {
    if (!count(value.total_tokens)) return null;
    result.total_tokens = value.total_tokens;
  }
  if (value.input_tokens_details !== undefined) {
    if (!object(value.input_tokens_details) || !count(value.input_tokens_details.cached_tokens)
      || value.input_tokens_details.cached_tokens > value.input_tokens) return null;
    result.input_tokens_details = {cached_tokens: value.input_tokens_details.cached_tokens};
  }
  return result;
}
function totals() {
  return {started: 0, finished: 0, success: 0, failed: 0, canceled: 0, unavailable: 0,
    filtered: 0, historyPreserved: 0, cleanups: 0, removed: 0, removedItemIds: 0,
    usageRequests: 0, inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null};
}
const histogram = () => ({boundsMs: [...BOUNDS], counts: Array(BOUNDS.length + 1).fill(0), count: 0, sumMs: 0});
function daily(date) {
  return {date, totals: totals(), retry: {scheduled: 0, dispatched: 0, recoveredRequests: 0,
    recoveredByKind: {}, exhausted: 0}, errorsByCode: {}, errorsByKind: {}, byModel: {},
    latency: {ttfb: histogram(), duration: histogram()}};
}
function dimension(target, value, limit) {
  // Reserve the overflow key so untrusted labels cannot grow a dimension forever.
  if (!Object.hasOwn(target, value) && Object.keys(target).filter(key => key !== 'other').length >= limit) value = 'other';
  Object.defineProperty(target, value, {value: Math.min(Number.MAX_SAFE_INTEGER, (Object.hasOwn(target, value) ? target[value] : 0) + 1),
    enumerable: true, configurable: true, writable: true});
}
function sample(hist, value) {
  let index = BOUNDS.findIndex(bound => value <= bound);
  if (index === -1) index = BOUNDS.length;
  add(hist.counts, index); add(hist, 'count'); add(hist, 'sumMs', value);
}
function createRecorder({now = Date.now} = {}) {
  let state = daily(localDate(now())), series = [], recent = [];
  const active = new Map(), diagnostics = {invalidEvents: 0, droppedActive: 0, corruptSnapshots: 0};
  const refresh = () => {
    const time = now(), date = localDate(time), minute = Math.floor(time / 60000) * 60000;
    if (date !== state.date) state = daily(date);
    series = series.filter(row => row.minute >= minute - 179 * 60000 && row.minute <= minute);
    return time;
  };
  const bucket = time => {
    const minute = Math.floor(time / 60000) * 60000;
    let row = series.find(row => row.minute === minute);
    if (!row) {
      row = {minute, started: 0, success: 0, failed: 0, canceled: 0, unavailable: 0,
        retries: 0, inputTokens: null, outputTokens: null};
      series.push(row); series.sort((a, b) => a.minute - b.minute);
      if (series.length > 180) series.shift();
    }
    return row;
  };
  const metadata = (row, data) => {
    if (label(data.model)) row.model = data.model;
    if (typeof data.streaming === 'boolean') row.streaming = data.streaming;
  };
  const observe = (event, data) => {
    const time = refresh();
    if (!object(data) || !idValid(data.requestId)) { add(diagnostics, 'invalidEvents'); return; }
    const id = data.requestId;
    if (event === 'request-started') {
      if (active.has(id) || recent.some(row => row.requestId === id)) return;
      add(state.totals, 'started'); add(bucket(time), 'started');
      if (active.size >= 1000) { add(diagnostics, 'droppedActive'); return; }
      const row = {requestId: id, startedAt: new Date(time).toISOString(), finishedAt: null,
        model: null, enabled: typeof data.enabled === 'boolean' ? data.enabled : null, streaming: null,
        policyRevision: count(data.policyRevision) ? data.policyRevision : null, phase: 'upload', status: null,
        ttfbMs: null, durationMs: null, outcome: null, usage: null, usageState: 'pending',
        observationAvailable: data.enabled === false ? false : null, retryScheduled: 0, retryDispatched: 0,
        retryKinds: [], errorCode: null, errorKind: null};
      if (data.enabled !== true) row.usageState = 'unavailable';
      metadata(row, data); active.set(id, {row, accepted: false, filtered: false, cleaned: false}); return;
    }
    const entry = active.get(id);
    if (!entry) return;
    const row = entry.row;
    if (event === 'request-metadata') metadata(row, data);
    else if (event === 'request-progress' && ['upload', 'upstream', 'backoff', 'streaming'].includes(data.phase)) row.phase = data.phase;
    else if (event === 'forwarded' && row.ttfbMs === null && timing(data.ttfbMs)) {
      row.ttfbMs = data.ttfbMs;
      if (count(data.status) && data.status >= 100 && data.status <= 599) row.status = data.status;
      sample(state.latency.ttfb, data.ttfbMs);
    } else if (event === 'response-usage' && row.enabled === true && row.usage === null) {
      const valid = usage(data.usage);
      if (!valid) { add(diagnostics, 'invalidEvents'); return; }
      row.usage = valid; row.usageState = 'observed'; row.observationAvailable = true;
      add(state.totals, 'usageRequests');
      for (const [key, value] of [['inputTokens', valid.input_tokens], ['outputTokens', valid.output_tokens],
        ['totalTokens', valid.total_tokens], ['cachedInputTokens', valid.input_tokens_details?.cached_tokens]]) {
        if (value !== undefined) add(state.totals, key, value);
      }
      add(bucket(time), 'inputTokens', valid.input_tokens); add(bucket(time), 'outputTokens', valid.output_tokens);
    } else if (event === 'response-observation-unavailable') {
      row.observationAvailable = false;
      if (!row.usage) row.usageState = 'unavailable';
    } else if ((event === 'filtered' || event === 'history-preserved') && !entry.filtered) {
      entry.filtered = true; add(state.totals, event === 'filtered' ? 'filtered' : 'historyPreserved');
      if (count(data.removed)) add(state.totals, 'removed', data.removed);
      if (count(data.removedItemIds)) add(state.totals, 'removedItemIds', data.removedItemIds);
    } else if (event === 'history-cleanup' && !entry.cleaned) {
      entry.cleaned = true; add(state.totals, 'cleanups');
      if (count(data.removed)) add(state.totals, 'removed', data.removed);
      if (count(data.removedItemIds)) add(state.totals, 'removedItemIds', data.removedItemIds);
    } else if (event === 'retry-scheduled') {
      add(state.retry, 'scheduled'); add(row, 'retryScheduled');
    } else if (event === 'retry-dispatched') {
      add(state.retry, 'dispatched'); add(row, 'retryDispatched'); add(bucket(time), 'retries');
      const retryKind = kind(data.kind);
      if (!row.retryKinds.includes(retryKind)) row.retryKinds.push(retryKind);
      row.observationAvailable = row.enabled === true ? null : false;
      if (!row.usage && row.enabled === true) row.usageState = 'pending';
    } else if (event === 'retry-accepted') entry.accepted = true;
    else if (event === 'retry-exhausted') add(state.retry, 'exhausted');
    else if (['http-error', 'stream-error', 'transport-error'].includes(event)) {
      row.errorCode = code(data.errorCode || data.code); row.errorKind = kind(event === 'transport-error' ? 'transport' : data.kind);
      dimension(state.errorsByCode, row.errorCode, 100); dimension(state.errorsByKind, row.errorKind, 6);
    } else if (event === 'request-finished') {
      row.outcome = OUTCOMES.includes(data.outcome) ? data.outcome : 'unavailable';
      row.finishedAt = new Date(time).toISOString(); row.phase = 'finished';
      row.durationMs = timing(data.durationMs) ? data.durationMs : null;
      if (row.durationMs !== null) sample(state.latency.duration, row.durationMs);
      if (row.usage === null) row.usageState = 'unavailable';
      add(state.totals, 'finished'); add(state.totals, row.outcome); add(bucket(time), row.outcome);
      dimension(state.byModel, row.model || 'other', 50);
      if (row.outcome === 'success' && entry.accepted && row.retryDispatched > 0) {
        add(state.retry, 'recoveredRequests');
        for (const retryKind of row.retryKinds) dimension(state.retry.recoveredByKind, retryKind, 6);
      }
      active.delete(id); recent.unshift(row); if (recent.length > 200) recent.pop();
    }
  };
  const snapshot = () => {
    const time = refresh();
    return structuredClone({...state, series, recent, active: [...active.values()].map(({row}) => ({...row,
      elapsedMs: Math.max(0, time - Date.parse(row.startedAt))})), diagnostics});
  };
  const serialize = () => {
    refresh(); return structuredClone({version: 1, ...state, series, recent});
  };
  const hydrate = saved => {
    refresh();
    try {
      if (!object(saved) || Buffer.byteLength(JSON.stringify(saved)) > MAX_SAVED_BYTES || saved.version !== 1
        || !/^\d{4}-\d{2}-\d{2}$/.test(saved.date)) throw new Error('schema');
      if (saved.date !== state.date) return false;
      const clean = daily(saved.date);
      const counters = (source, template, nullable = []) => {
        if (!object(source)) throw new Error('schema');
        for (const key of Object.keys(template)) {
          const value = source[key];
          if (!(nullable.includes(key) && value === null) && !count(value)) throw new Error('count');
          template[key] = value;
        }
        return template;
      };
      const dictionary = (source, max, keyValid) => {
        if (!object(source) || Object.keys(source).length > max) throw new Error('dimension');
        const result = {};
        for (const [key, value] of Object.entries(source)) {
          if (!keyValid(key) || !count(value)) throw new Error('dimension');
          Object.defineProperty(result, key, {value, enumerable: true, configurable: true, writable: true});
        }
        return result;
      };
      counters(saved.totals, clean.totals, ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens']);
      if (!object(saved.retry)) throw new Error('retry');
      for (const key of ['scheduled', 'dispatched', 'recoveredRequests', 'exhausted']) {
        if (!count(saved.retry[key])) throw new Error('retry'); clean.retry[key] = saved.retry[key];
      }
      clean.retry.recoveredByKind = dictionary(saved.retry.recoveredByKind, 6, key => KINDS.includes(key));
      clean.errorsByCode = dictionary(saved.errorsByCode, 101, key => code(key) === key);
      clean.errorsByKind = dictionary(saved.errorsByKind, 6, key => KINDS.includes(key));
      clean.byModel = dictionary(saved.byModel, 51, key => !!label(key));
      if (!object(saved.latency)) throw new Error('latency');
      for (const key of ['ttfb', 'duration']) {
        const hist = saved.latency[key];
        if (!object(hist) || !Array.isArray(hist.boundsMs) || hist.boundsMs.length !== BOUNDS.length
          || !hist.boundsMs.every((n, i) => n === BOUNDS[i]) || !Array.isArray(hist.counts)
          || hist.counts.length !== BOUNDS.length + 1 || !hist.counts.every(count)
          || !count(hist.count) || !timing(hist.sumMs)) throw new Error('latency');
        clean.latency[key] = {boundsMs: [...BOUNDS], counts: [...hist.counts], count: hist.count, sumMs: hist.sumMs};
      }
      if (!Array.isArray(saved.series) || saved.series.length > 180 || !Array.isArray(saved.recent)
        || saved.recent.length > 200) throw new Error('arrays');
      const cleanSeries = saved.series.map(row => {
        const result = counters(row, {minute: 0, started: 0, success: 0, failed: 0, canceled: 0, unavailable: 0,
          retries: 0, inputTokens: null, outputTokens: null}, ['inputTokens', 'outputTokens']);
        if (result.minute % 60000) throw new Error('minute'); return result;
      });
      const cleanRecent = saved.recent.map(row => {
        if (!object(row) || !idValid(row.requestId) || !OUTCOMES.includes(row.outcome)
          || !['observed', 'unavailable'].includes(row.usageState)) throw new Error('record');
        const result = {};
        for (const key of ['startedAt', 'finishedAt']) {
          if (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key]))
            || new Date(row[key]).toISOString() !== row[key]) throw new Error('date');
          result[key] = row[key];
        }
        for (const key of ['enabled', 'streaming', 'observationAvailable']) {
          if (row[key] !== null && typeof row[key] !== 'boolean') throw new Error('boolean'); result[key] = row[key];
        }
        for (const key of ['policyRevision', 'status', 'retryScheduled', 'retryDispatched']) {
          if (!(row[key] === null && ['policyRevision', 'status'].includes(key)) && !count(row[key])) throw new Error('count');
          result[key] = row[key];
        }
        for (const key of ['ttfbMs', 'durationMs']) {
          if (row[key] !== null && !timing(row[key])) throw new Error('timing'); result[key] = row[key];
        }
        if (row.model !== null && !label(row.model)) throw new Error('model');
        if (row.errorCode !== null && code(row.errorCode) !== row.errorCode) throw new Error('code');
        if (row.errorKind !== null && !KINDS.includes(row.errorKind)) throw new Error('kind');
        if (!Array.isArray(row.retryKinds) || row.retryKinds.length > 6 || !row.retryKinds.every(value => KINDS.includes(value))) throw new Error('kind');
        const validUsage = row.usage === null ? null : usage(row.usage);
        if (row.usage !== null && !validUsage || (row.usageState === 'observed') !== (validUsage !== null)) throw new Error('usage');
        return {...result, requestId: row.requestId, model: row.model, errorCode: row.errorCode, errorKind: row.errorKind,
          outcome: row.outcome, phase: 'finished', retryKinds: [...new Set(row.retryKinds)], usage: validUsage, usageState: row.usageState};
      });
      state = clean; series = cleanSeries; recent = cleanRecent; refresh(); return true;
    } catch { add(diagnostics, 'corruptSnapshots'); return false; }
  };
  return {observe, snapshot, serialize, hydrate};
}
module.exports = {createRecorder, MAX_SAVED_BYTES};
