'use strict';

const legacy = Object.freeze({ccswitch: ['ccswitch', 'always'], magpie: ['magpie', 'preserve'],
  'magpie-ccs': ['magpie', 'always'], 'magpie-auto': ['magpie', 'conditional']});

function resolvePolicy({mode, gateway, cleanup} = {}) {
  if (mode !== undefined && (typeof mode !== 'string' || !Object.hasOwn(legacy, mode))) throw new Error('Mode must be ccswitch, magpie, magpie-ccs or magpie-auto.');
  if (gateway !== undefined && !['ccswitch', 'magpie'].includes(gateway)) throw new Error('Gateway must be ccswitch or magpie.');
  if (cleanup !== undefined && !['preserve', 'conditional', 'always'].includes(cleanup)) throw new Error('Cleanup must be preserve, conditional or always.');
  const defaults = legacy[mode === undefined ? gateway || 'ccswitch' : mode];
  if (mode !== undefined && ((gateway !== undefined && gateway !== defaults[0])
      || (cleanup !== undefined && cleanup !== defaults[1]))) throw new Error('Legacy mode and explicit gateway/cleanup select different options.');
  return Object.freeze({gateway: gateway ?? defaults[0], cleanup: cleanup ?? defaults[1]});
}

module.exports = {resolvePolicy};
