'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const api = require('./metrics.cjs');

function setup(time = new Date(2026, 9, 28, 12).getTime()) {
  let clock = time;
  const recorder = api.createRecorder({now: () => clock});
  return {recorder, advance: ms => { clock += ms; }};
}
function finish(r, id, outcome = 'success') {
  r.observe('request-started', {requestId: id, model: 'mock', enabled: true});
  r.observe('forwarded', {requestId: id, ttfbMs: 10, status: 200});
  r.observe('request-finished', {requestId: id, outcome, durationMs: 30});
}

test('lifecycle counts once, merges late metadata and preserves unknown usage', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true, policyRevision: 7});
  r.observe('request-started', {requestId: 1});
  r.observe('request-metadata', {requestId: 1, model: 'mock', streaming: true});
  r.observe('request-progress', {requestId: 1, phase: 'backoff'});
  assert.equal(r.snapshot().active[0].phase, 'backoff');
  r.observe('forwarded', {requestId: 1, ttfbMs: 10, status: 200});
  r.observe('forwarded', {requestId: 1, ttfbMs: 999, status: 500});
  r.observe('request-finished', {requestId: 1, outcome: 'success', durationMs: 30});
  r.observe('request-finished', {requestId: 1, outcome: 'failed', durationMs: 999});
  const s = r.snapshot();
  assert.equal(s.totals.started, 1); assert.equal(s.totals.success, 1);
  assert.equal(s.totals.finished, 1); assert.equal(s.totals.inputTokens, null);
  assert.equal(s.recent[0].model, 'mock'); assert.equal(s.recent[0].usage, null);
  assert.equal(s.recent[0].usageState, 'unavailable');
  assert.equal(s.latency.ttfb.count, 1); assert.equal(s.latency.ttfb.sumMs, 10);
  assert.equal(s.latency.duration.sumMs, 30); assert.equal(s.byModel.mock, 1);
  assert.equal(s.retry.recoveredRequests, 0);
  s.recent[0].model = 'changed'; assert.equal(r.snapshot().recent[0].model, 'mock');
});

test('valid usage alone counts tokens, unavailable inspection can recover on a later retry', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true});
  r.observe('response-usage', {requestId: 1, usage: {input_tokens: -1, output_tokens: 2}});
  r.observe('response-observation-unavailable', {requestId: 1, reason: 'malformed_frame'});
  r.observe('retry-scheduled', {requestId: 1, kind: 'transport'});
  r.observe('retry-dispatched', {requestId: 1, kind: 'transport'});
  r.observe('response-usage', {requestId: 1, usage: {input_tokens: 12, output_tokens: 3, total_tokens: 15,
    input_tokens_details: {cached_tokens: 4}, secret: 'never-store'}});
  r.observe('response-usage', {requestId: 1, usage: {input_tokens: 99, output_tokens: 99}});
  r.observe('retry-accepted', {requestId: 1, retries: 1, status: 200});
  r.observe('request-finished', {requestId: 1, outcome: 'success', durationMs: 60});
  r.observe('request-started', {requestId: 2, enabled: false});
  r.observe('response-usage', {requestId: 2, usage: {input_tokens: 99, output_tokens: 99}});
  r.observe('request-finished', {requestId: 2, outcome: 'unavailable', durationMs: 20});
  const s = r.snapshot();
  assert.equal(s.totals.inputTokens, 12); assert.equal(s.totals.outputTokens, 3);
  assert.equal(s.totals.totalTokens, 15); assert.equal(s.totals.cachedInputTokens, 4);
  assert.equal(s.totals.usageRequests, 1); assert.equal(s.totals.unavailable, 1);
  assert.equal(s.retry.recoveredRequests, 1); assert.equal(s.retry.recoveredByKind.transport, 1);
  assert.equal(s.recent[1].usageState, 'observed');
  assert.equal(JSON.stringify(s).includes('never-store'), false);
});

test('planned retries are not dispatched or recovered and errors and cleanup use occurrence counts', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true});
  r.observe('filtered', {requestId: 1, removed: 2, removedItemIds: 3});
  r.observe('history-cleanup', {requestId: 1, removed: 1, removedItemIds: 1});
  r.observe('http-error', {requestId: 1, kind: 'resource', errorCode: 'invalid_encrypted_content'});
  r.observe('stream-error', {requestId: 1, kind: 'transport', errorCode: 'stream_incomplete'});
  r.observe('retry-scheduled', {requestId: 1, kind: 'resource'});
  r.observe('retry-accepted', {requestId: 1});
  r.observe('retry-exhausted', {requestId: 1, kind: 'resource'});
  r.observe('request-finished', {requestId: 1, outcome: 'failed', durationMs: 5});
  const s = r.snapshot();
  assert.equal(s.retry.scheduled, 1); assert.equal(s.retry.dispatched, 0);
  assert.equal(s.retry.recoveredRequests, 0); assert.equal(s.retry.exhausted, 1);
  assert.equal(s.errorsByCode.invalid_encrypted_content, 1);
  assert.equal(s.errorsByKind.transport, 1); assert.equal(s.totals.cleanups, 1);
  assert.equal(s.totals.removed, 3); assert.equal(s.totals.removedItemIds, 4);
});

test('retry completion that is later canceled is not recovered success', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true});
  r.observe('retry-scheduled', {requestId: 1, kind: 'transport'});
  r.observe('retry-dispatched', {requestId: 1, kind: 'transport'});
  r.observe('retry-accepted', {requestId: 1, retries: 1});
  r.observe('request-finished', {requestId: 1, outcome: 'canceled', durationMs: 20});
  assert.equal(r.snapshot().retry.dispatched, 1);
  assert.equal(r.snapshot().retry.recoveredRequests, 0);
  assert.deepEqual(r.snapshot().retry.recoveredByKind, {});
});

test('planned retry wait sums valid scheduled delays, not actual elapsed wait, and persists safely', () => {
  const {recorder: r, advance} = setup();
  r.observe('request-started', {requestId: 1, enabled: true});
  for (const delayMs of [125.5, 2000, 0, -1, Infinity, NaN, '500', Number.MAX_SAFE_INTEGER + 1])
    r.observe('retry-scheduled', {requestId: 1, kind: 'transport', delayMs});
  advance(10);
  r.observe('request-finished', {requestId: 1, outcome: 'canceled', durationMs: 10});
  assert.equal(r.snapshot().retry.plannedWaitMs, 2125.5);
  assert.equal(r.snapshot().retry.scheduled, 8); assert.equal(r.snapshot().retry.dispatched, 0);
  const saved = r.serialize(), {recorder: loaded} = setup();
  assert.equal(loaded.hydrate(saved), true); assert.equal(loaded.snapshot().retry.plannedWaitMs, 2125.5);
  for (const invalid of [-1, Infinity, NaN, '500', Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(saved); bad.retry.plannedWaitMs = invalid;
    assert.equal(loaded.hydrate(bad), false);
    assert.equal(loaded.snapshot().retry.plannedWaitMs, 2125.5);
  }
  const {recorder: large} = setup(); large.observe('request-started', {requestId: 1, enabled: true});
  for (let i = 0; i < 2; i++) large.observe('retry-scheduled', {requestId: 1, delayMs: Number.MAX_SAFE_INTEGER});
  assert.equal(large.snapshot().retry.plannedWaitMs, Number.MAX_SAFE_INTEGER);
});

test('history kept items count initial handling once, separately from removals and actual cleanups', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true});
  r.observe('filtered', {requestId: 1, kept: 7, removed: 2});
  r.observe('filtered', {requestId: 1, kept: 99, removed: 99});
  r.observe('history-cleanup', {requestId: 1, removed: 1});
  r.observe('history-cleanup', {requestId: 1, removed: 99});
  finish(r, 2);
  r.observe('request-started', {requestId: 3, enabled: true});
  r.observe('history-preserved', {requestId: 3, kept: 5, removed: 0});
  for (const [id, kept] of [[4, -1], [5, NaN], [6, Infinity], [7, 1.5], [8, '5']]) {
    r.observe('request-started', {requestId: id, enabled: true});
    r.observe('history-preserved', {requestId: id, kept});
  }
  const s = r.snapshot(); assert.equal(s.totals.kept, 12); assert.equal(s.totals.removed, 3);
  assert.equal(s.totals.filtered, 1); assert.equal(s.totals.cleanups, 1); assert.equal(s.retry.dispatched, 0);
  const saved = r.serialize(), {recorder: loaded} = setup();
  assert.equal(loaded.hydrate(saved), true); assert.equal(loaded.snapshot().totals.kept, 12);
  for (const invalid of [-1, NaN, Infinity, 1.5, '5']) {
    const bad = structuredClone(saved); bad.totals.kept = invalid;
    assert.equal(loaded.hydrate(bad), false); assert.equal(loaded.snapshot().totals.kept, 12);
  }
  const {recorder: large} = setup();
  for (const id of [1, 2]) {
    large.observe('request-started', {requestId: id, enabled: true});
    large.observe('filtered', {requestId: id, kept: Number.MAX_SAFE_INTEGER});
  }
  assert.equal(large.snapshot().totals.kept, Number.MAX_SAFE_INTEGER);
});

test('kept items and planned wait reset at midnight while in-flight and live history survive', () => {
  const {recorder: r, advance} = setup(new Date(2026, 9, 27, 23, 59, 50).getTime());
  r.observe('request-started', {requestId: 1, enabled: true});
  r.observe('history-preserved', {requestId: 1, kept: 11, removed: 0});
  r.observe('retry-scheduled', {requestId: 1, kind: 'transport', delayMs: 250});
  assert.equal(r.snapshot().totals.kept, 11); assert.equal(r.snapshot().retry.plannedWaitMs, 250);
  advance(20000);
  assert.equal(r.snapshot().totals.kept, 0); assert.equal(r.snapshot().retry.plannedWaitMs, 0);
  assert.equal(r.snapshot().active.length, 1);
  r.observe('retry-scheduled', {requestId: 1, kind: 'transport', delayMs: 750});
  r.observe('request-finished', {requestId: 1, outcome: 'canceled', durationMs: 20000});
  assert.equal(r.snapshot().retry.plannedWaitMs, 750); assert.equal(r.snapshot().recent.length, 1);
});

test('midnight resets daily counters but keeps active records and rolling series', () => {
  const {recorder: r, advance} = setup(new Date(2026, 9, 27, 23, 59, 50).getTime());
  r.observe('request-started', {requestId: 'old:1', enabled: true});
  advance(20000);
  assert.equal(r.snapshot().active.length, 1); assert.equal(r.snapshot().totals.started, 0);
  r.observe('forwarded', {requestId: 'old:1', ttfbMs: 20000, status: 200});
  r.observe('request-finished', {requestId: 'old:1', outcome: 'success', durationMs: 20001});
  const s = r.snapshot();
  assert.equal(s.date, '2026-10-28'); assert.equal(s.totals.success, 1);
  assert.equal(s.series.length, 2); assert.equal(s.series[0].started, 1);
  assert.equal(s.series[1].success, 1); assert.equal(s.recent[0].startedAt.slice(0, 10), '2026-10-27');
  advance(181 * 60000); assert.equal(r.snapshot().series.length, 0);
});

test('bounds recent, active, model/error dimensions and persistence while rejecting unsafe metadata', () => {
  const {recorder: r, advance} = setup();
  for (let i = 0; i < 250; i++) {
    r.observe('request-started', {requestId: i, enabled: true, model: 'model-' + i, body: 'secret-body'});
    r.observe('http-error', {requestId: i, errorCode: 'code-' + i, kind: 'custom-' + i, message: 'secret-message'});
    r.observe('request-finished', {requestId: i, outcome: 'failed', durationMs: 1});
    advance(60000);
  }
  for (let i = 0; i < 1100; i++) r.observe('request-started', {requestId: 'live:' + i, enabled: true});
  r.observe('request-metadata', {requestId: 'live:0', model: 'bad\nlabel', streaming: {body: 'secret-nested'}});
  r.observe('http-error', {requestId: 'live:0', errorCode: 'secret\nbody', kind: {secret: 'secret-kind'}});
  const s = r.snapshot(), serialized = JSON.stringify(r.serialize());
  assert.equal(s.recent.length, 200); assert.equal(s.series.length, 180);
  assert.equal(s.active.length, 1000); assert.equal(s.diagnostics.droppedActive, 100);
  assert.ok(Object.keys(s.byModel).length <= 51); assert.ok(Object.keys(s.errorsByCode).length <= 101);
  assert.ok(Object.keys(s.errorsByKind).length <= 7); assert.ok(Buffer.byteLength(serialized) < 1024 * 1024);
  assert.doesNotMatch(serialized, /secret|bad\\nlabel/);
});

test('same-day hydration restores aggregates only and ignores memory-only or unknown saved details', () => {
  const {recorder: r} = setup(); finish(r, 1);
  r.observe('request-started', {requestId: 2, enabled: true});
  const saved = r.serialize();
  assert.equal(Object.hasOwn(saved, 'series'), false); assert.equal(Object.hasOwn(saved, 'recent'), false);
  assert.equal(r.snapshot().series.length, 1); assert.equal(r.snapshot().recent.length, 1);
  saved.body = 'secret-body'; saved.recent = [{tool: 'secret-tool'}]; saved.series = {body: 'secret-curve'};
  const {recorder: loaded, advance} = setup();
  assert.equal(loaded.hydrate(saved), true); assert.equal(loaded.snapshot().totals.success, 1);
  assert.equal(loaded.snapshot().active.length, 0); assert.doesNotMatch(JSON.stringify(loaded.snapshot()), /secret/);
  assert.deepEqual(loaded.snapshot().recent, []); assert.deepEqual(loaded.snapshot().series, []);
  for (const mutate of [s => { s.totals.success = -1; }, s => { s.retry.scheduled = Infinity; },
    s => { s.totals = []; }, s => { s.latency.duration.counts = [NaN]; }, s => { s.retry.recoveredByKind = []; },
    s => { s.errorsByCode = {x: 'secret'}; }]) {
    const bad = structuredClone(saved); mutate(bad);
    assert.equal(loaded.hydrate(bad), false); assert.equal(loaded.snapshot().totals.success, 1);
  }
  assert.equal(loaded.snapshot().diagnostics.corruptSnapshots, 6);
  advance(24 * 3600000); assert.equal(loaded.hydrate(saved), false); assert.equal(loaded.snapshot().totals.success, 0);
});

test('malformed observations and unknown diagnostic events cannot add data or abort the recorder', () => {
  const {recorder: r} = setup();
  for (const value of [null, [], 'secret', {requestId: {}}, {requestId: Infinity}])
    assert.doesNotThrow(() => r.observe('request-started', value));
  finish(r, 'a:1'); r.observe('upstream-error', {requestId: 'a:1', message: 'secret'});
  assert.equal(r.snapshot().totals.started, 1); assert.doesNotMatch(JSON.stringify(r.snapshot()), /secret/);
});

test('latency buckets use inclusive hand-derived boundaries and reject nonfinite timings', () => {
  const {recorder: r} = setup();
  for (const [id, ms] of [[1, 0], [2, 100], [3, 100.5], [4, 500], [5, 60001]]) {
    r.observe('request-started', {requestId: id, enabled: true});
    r.observe('forwarded', {requestId: id, ttfbMs: ms, status: 200});
    r.observe('request-finished', {requestId: id, outcome: 'success', durationMs: ms});
  }
  r.observe('request-started', {requestId: 6, enabled: true});
  r.observe('forwarded', {requestId: 6, ttfbMs: Infinity, status: 200});
  r.observe('request-finished', {requestId: 6, outcome: 'failed', durationMs: NaN});
  assert.deepEqual(r.snapshot().latency.ttfb.counts, [2, 2, 0, 0, 0, 0, 0, 1]);
  assert.equal(r.snapshot().latency.duration.count, 5);
  assert.equal(r.snapshot().latency.duration.sumMs, 60701.5);
});

test('ordinary HTTP success does not invent terminal-inspection or usage availability', () => {
  const {recorder: r} = setup(); finish(r, 1);
  const row = r.snapshot().recent[0];
  assert.equal(row.observationAvailable, null);
  assert.equal(row.usage, null); assert.equal(row.usageState, 'unavailable');
});

test('prototype-like dimensions and nullable optional usage survive sanitized hydration', () => {
  const {recorder: r} = setup();
  r.observe('request-started', {requestId: 1, enabled: true, model: '__proto__'});
  r.observe('http-error', {requestId: 1, errorCode: 'constructor', kind: 'resource'});
  r.observe('response-usage', {requestId: 1, usage: {input_tokens: 0, output_tokens: 0}});
  r.observe('request-finished', {requestId: 1, outcome: 'success', durationMs: 0});
  assert.equal(r.snapshot().totals.inputTokens, 0); assert.equal(r.snapshot().totals.totalTokens, null);
  assert.equal(r.snapshot().byModel.__proto__, 1); assert.equal(r.snapshot().errorsByCode.constructor, 1);
  const {recorder: loaded} = setup(); assert.equal(loaded.hydrate(r.serialize()), true);
  assert.equal(loaded.snapshot().byModel.__proto__, 1);
});
