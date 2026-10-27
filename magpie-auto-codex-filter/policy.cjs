'use strict';

const HANDLERS = Object.freeze(['azureResource', 'encryptedContent', 'rateLimit',
  'transport', 'streamIncomplete', 'alb400', 'unavailable']);

function normalizePolicy(value = {}, mode = 'magpie-auto') {
  const keys = ['enabled', 'cleanup', 'handlers', 'bufferResponse', 'protectStreamStart', 'heartbeat', 'revision'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid policy fields.');
  const defaults = mode === 'magpie-auto' ? 'conditional' : mode === 'magpie' ? 'never' : 'always';
  const policy = {enabled: true, cleanup: defaults, bufferResponse: true, protectStreamStart: false, heartbeat: true, revision: 0, ...value};
  for (const key of ['enabled', 'bufferResponse', 'protectStreamStart', 'heartbeat']) {
    if (typeof policy[key] !== 'boolean') throw new Error(key + ' must be boolean.');
  }
  if (!['always', 'conditional', 'never'].includes(policy.cleanup)) throw new Error('Invalid cleanup policy.');
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 0) throw new Error('Invalid policy revision.');
  const handlers = value.handlers === undefined ? {} : value.handlers;
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)
      || Object.keys(handlers).some(key => !HANDLERS.includes(key) || typeof handlers[key] !== 'boolean')) {
    throw new Error('Invalid recovery handlers.');
  }
  policy.handlers = Object.freeze(Object.fromEntries(HANDLERS.map(key => [key, handlers[key] ?? true])));
  return Object.freeze(policy);
}

module.exports = {HANDLERS, normalizePolicy};
