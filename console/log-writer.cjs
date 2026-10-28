'use strict';
const fs = require('node:fs/promises');
const {randomBytes} = require('node:crypto');
function createLogWriter(filename, {maxBytes = 1024 * 1024, retainBytes = 512 * 1024,
  maxQueueBytes = 1024 * 1024, maxLineBytes = 16 * 1024, batchBytes = 64 * 1024, maxQueueLines = 2048} = {}) {
  for (const value of [maxBytes, retainBytes, maxQueueBytes, maxLineBytes, batchBytes, maxQueueLines]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid log writer limit.');
  }
  if (retainBytes >= maxBytes) throw new Error('Log tail must be smaller than rotation limit.');
  const state = {queuedBytes: 0, queuedLines: 0, droppedLines: 0, writeErrors: 0, writes: 0, rotations: 0, lastError: null, closed: false};
  let queue = [], pending = null, size = null;
  const rotate = async () => {
    const handle = await fs.open(filename, 'r');
    let tail;
    try {
      const length = Math.min(retainBytes, size), buffer = Buffer.alloc(length);
      const {bytesRead} = await handle.read(buffer, 0, length, size - length);
      tail = buffer.subarray(0, bytesRead);
      if (size > length) {
        const newline = tail.indexOf(10); tail = newline === -1 ? Buffer.alloc(0) : tail.subarray(newline + 1);
      }
    } finally { await handle.close(); }
    const temp = filename + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      await fs.writeFile(temp, tail, {flag: 'wx', mode: 0o600}); await fs.rename(temp, filename);
      size = tail.length; state.rotations++;
    } finally { await fs.unlink(temp).catch(() => {}); }
  };
  const drain = async () => {
    while (queue.length) {
      const batch = []; let bytes = 0;
      while (queue.length && (bytes === 0 || bytes + queue[0].length <= batchBytes)) {
        const line = queue.shift(); batch.push(line); bytes += line.length;
      }
      try {
        if (size === null) {
          try { size = (await fs.stat(filename)).size; }
          catch (error) { if (error.code !== 'ENOENT') throw error; size = 0; }
        }
        if (size > maxBytes) await rotate();
        await fs.appendFile(filename, Buffer.concat(batch, bytes), {mode: 0o600});
        size += bytes; state.writes++; state.lastError = null;
      } catch (error) {
        size = null; state.writeErrors++; state.droppedLines += batch.length;
        state.lastError = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'IO_ERROR';
      } finally { state.queuedBytes -= bytes; state.queuedLines -= batch.length; }
    }
  };
  const flush = () => {
    if (!pending && queue.length) {
      pending = new Promise((resolve, reject) => setImmediate(async () => {
        try {
          do { await drain(); } while (queue.length);
          // Release ownership and settle together, with no promise handoff window.
          pending = null; resolve();
        } catch (error) { pending = null; reject(error); }
      }));
    }
    return pending || Promise.resolve();
  };
  const write = line => {
    if (state.closed || typeof line !== 'string' || line.length === 0 || line.length > maxLineBytes) { state.droppedLines++; return false; }
    const bytes = Buffer.byteLength(line);
    if (bytes > maxLineBytes || state.queuedBytes + bytes > maxQueueBytes || state.queuedLines >= maxQueueLines) {
      state.droppedLines++; return false;
    }
    queue.push(Buffer.from(line)); state.queuedBytes += bytes; state.queuedLines++; flush(); return true;
  };
  return {write, flush, close: async () => { state.closed = true; await flush(); },
    get diagnostics() { return {...state}; }};
}
module.exports = {createLogWriter};
