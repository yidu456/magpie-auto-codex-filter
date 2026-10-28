'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./log-writer.cjs');
const {fixture} = require('../magpie-auto-codex-filter/test-support.cjs');

test('writes are deferred, batched and ordered, including writes queued during flush', async t => {
  const filename = path.join(fixture(t), 'console.log'), w = api.createLogWriter(filename);
  for (let i = 0; i < 100; i++) w.write(i + '\n');
  assert.equal(fs.existsSync(filename), false);
  const pending = w.flush(); w.write('last\n'); await pending; await w.flush();
  assert.equal(fs.readFileSync(filename, 'utf8'), Array.from({length: 100}, (_, i) => i + '\n').join('') + 'last\n');
  assert.ok(w.diagnostics.writes < 10); assert.equal(w.diagnostics.queuedBytes, 0);
});

test('rotation retains a bounded tail at a complete line boundary before appending', async t => {
  const filename = path.join(fixture(t), 'console.log');
  fs.writeFileSync(filename, 'discard\n' + 'kept\n'.repeat(40));
  const w = api.createLogWriter(filename, {maxBytes: 128, retainBytes: 64});
  w.write('new\n'); await w.flush();
  const text = fs.readFileSync(filename, 'utf8');
  assert.ok(Buffer.byteLength(text) <= 68); assert.ok(text.startsWith('kept\n'));
  assert.ok(text.endsWith('new\n')); assert.doesNotMatch(text, /discard/);
  assert.equal(w.diagnostics.rotations, 1);
});

test('I/O failure is diagnostic, drops the failed batch and a later write can recover', async t => {
  const filename = path.join(fixture(t), 'console.log'); fs.mkdirSync(filename);
  const w = api.createLogWriter(filename); w.write('lost\n');
  await assert.doesNotReject(w.flush()); assert.equal(w.diagnostics.writeErrors, 1);
  assert.match(w.diagnostics.lastError, /^[A-Z0-9_]+$/);
  assert.equal(w.diagnostics.queuedBytes, 0);
  fs.rmdirSync(filename); w.write('recovered\n'); await w.flush();
  assert.equal(fs.readFileSync(filename, 'utf8'), 'recovered\n');
});

test('queue and per-line bounds reject overload without blocking and close drains accepted lines', async t => {
  const filename = path.join(fixture(t), 'console.log');
  const w = api.createLogWriter(filename, {maxQueueBytes: 12, maxLineBytes: 8});
  assert.equal(w.write('one\n'), true); assert.equal(w.write('two\n'), true);
  assert.equal(w.write('three\n'), false); assert.equal(w.write('oversized-line\n'), false);
  const closing = w.close(); assert.equal(w.write('late\n'), false); await closing;
  assert.equal(fs.readFileSync(filename, 'utf8'), 'one\ntwo\n');
  assert.equal(w.diagnostics.droppedLines, 3); assert.equal(w.diagnostics.closed, true);
  await assert.doesNotReject(w.close());
});

test('queue bounds retained line objects as well as bytes and rejects empty writes', async t => {
  const filename = path.join(fixture(t), 'console.log');
  const w = api.createLogWriter(filename, {maxQueueLines: 3});
  assert.equal(w.write(''), false);
  assert.equal(w.write('a'), true); assert.equal(w.write('b'), true); assert.equal(w.write('c'), true);
  assert.equal(w.write('d'), false); await w.flush();
  assert.equal(fs.readFileSync(filename, 'utf8'), 'abc'); assert.equal(w.diagnostics.droppedLines, 2);
  for (const options of [{maxBytes: 0}, {maxQueueBytes: NaN}, {retainBytes: 1024 * 1024}, {maxQueueLines: -1}])
    assert.throws(() => api.createLogWriter(filename, options), /limit|tail/i);
});

for (const closeLate of [false, true]) {
  test(`completion-window write is covered by ${closeLate ? 'close' : 'flush'} without a second drain call`, async t => {
    const filename = path.join(fixture(t), 'console.log');
    let first = true, lateAccepted, closing;
    // Keep real file effects while deterministically opening the append-completion microtask window.
    t.mock.method(fs.promises, 'appendFile', (file, bytes) => {
      fs.appendFileSync(file, bytes);
      if (first) {
        first = false;
        queueMicrotask(() => queueMicrotask(() => {
          lateAccepted = w.write('late\n');
          if (closeLate) closing = w.close();
        }));
      }
      return Promise.resolve();
    });
    const w = api.createLogWriter(filename);
    assert.equal(w.write('first\n'), true);
    const flushing = w.flush();
    await flushing;
    if (closeLate) await closing;
    assert.equal(lateAccepted, true);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'first\nlate\n');
    assert.equal(w.diagnostics.queuedBytes, 0); assert.equal(w.diagnostics.queuedLines, 0);
    assert.equal(w.diagnostics.closed, closeLate);
  });
}
