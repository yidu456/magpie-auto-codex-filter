'use strict';
const {StringDecoder} = require('node:string_decoder');

// Parse only complete object frames. Neither wire text nor JSON primitives are events.
function makeSseParser({limit, onEvent, onUnavailable, strict = true}) {
  const decoder = new StringDecoder('utf8');
  let parts = [], part = '', size = 0, tail = '', available = true;
  const unavailable = reason => {
    if (!available) return;
    available = false; parts = []; part = ''; size = 0; tail = '';
    onUnavailable(reason);
  };
  const append = text => {
    if (!text) return true;
    size += Buffer.byteLength(text);
    if (size > limit) { unavailable('frame_too_large'); return false; }
    // Coalesce tiny writes so fragmentation cannot multiply retained objects.
    if (text.length >= 4096) {
      if (part) parts.push(part);
      part = ''; parts.push(text);
    } else {
      part += text;
      if (part.length >= 4096) { parts.push(part); part = ''; }
    }
    return true;
  };
  const write = chunk => {
    if (!available) return;
    // Scan each new segment once; only a delimiter-sized tail crosses writes.
    const text = tail + decoder.write(chunk);
    tail = '';
    const boundaries = /\r?\n\r?\n/g;
    let boundary, offset = 0;
    while (available && (boundary = boundaries.exec(text))) {
      if (!append(text.slice(offset, boundary.index))) return;
      const frame = parts.join('') + part;
      parts = []; part = ''; size = 0;
      offset = boundary.index + boundary[0].length;
      const lines = frame.split(/\r?\n/);
      const data = lines.filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data.trim() === '[DONE]') continue;
      let value;
      try { value = JSON.parse(data); } catch {
        if (strict) { unavailable('malformed_frame'); return; }
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || value.type;
      if (typeof event === 'string') onEvent(event, value);
    }
    if (!available) return;
    const rest = text.slice(offset);
    let split = Math.max(0, rest.length - 3);
    if (split && /[\uD800-\uDBFF]/.test(rest[split - 1]) && /[\uDC00-\uDFFF]/.test(rest[split])) split--;
    if (!append(rest.slice(0, split))) return;
    tail = rest.slice(split);
    if (size + Buffer.byteLength(tail) > limit) unavailable('frame_too_large');
  };
  return {write, stop() { available = false; parts = []; part = ''; size = 0; tail = ''; },
    setLimit(value) { limit = value; strict = true; },
    get available() { return available; }, get pendingBytes() { return size + Buffer.byteLength(tail); }};
}

function responseUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) return null;
      usage[key] = value[key];
    }
  }
  if (usage.input_tokens === undefined || usage.output_tokens === undefined) return null;
  const cached = value.input_tokens_details?.cached_tokens;
  if (cached !== undefined) {
    if (!Number.isSafeInteger(cached) || cached < 0 || cached > usage.input_tokens) return null;
    usage.input_tokens_details = {cached_tokens: cached};
  }
  return usage;
}

function isContentEvent(event, value) {
  return /^response\.[a-z_]+\.delta$/.test(event)
    || /^response\.output_item\.(added|done)$/.test(event)
      && ['function_call', 'custom_tool_call'].includes(value.item?.type);
}

module.exports = {makeSseParser, responseUsage, isContentEvent};
