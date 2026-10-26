'use strict';
const fs = require('node:fs');
const {ConfigRouter: BaseRouter, atomicWrite, replaceBase, sameEndpoint,
  rewriteOrigin, sectionProvider, unquote} = require('./base-config.cjs');

function magpieEntries(text) {
  let provider = null;
  const entries = [], seen = new Set();
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) { provider = sectionProvider(line) ?? false; continue; }
    const match = line.match(/^(\s*(openai_base_url|base_url|model_catalog_url)\s*=\s*)("(?:[^"\\]|\\.)*"|'[^']*')(\s*(?:#.*)?)$/);
    if (!match || (provider === null ? match[2] !== 'openai_base_url' : provider === false || match[2] === 'openai_base_url')) continue;
    const key = JSON.stringify([provider, match[2]]);
    if (seen.has(key)) throw new Error('Duplicate endpoint entries; refusing to edit config.');
    seen.add(key);
    entries.push({provider, key, name: match[2], quote: match[3][0], line, url: unquote(match[3]), prefix: match[1], suffix: match[4]});
  }
  return entries;
}

class ConfigRouter extends BaseRouter {
  constructor(options) { super({...options, mode: options.mode || 'magpie'}); }
  sync() {
    if (!fs.existsSync(this.configPath)) { this.changeState('waiting-for-codex-config'); return; }
    const text = fs.readFileSync(this.configPath, 'utf8');
    const entries = magpieEntries(text), upstream = this.getUpstream();
    let changed = text, attached = false;
    for (const entry of entries) {
      if (sameEndpoint(entry.url, this.filterOrigin)) {
        if (this.routes.get(entry.key)?.filteredUrl !== entry.url) {
          throw new Error('Filter URL found without its original-address backup; refusing to guess.');
        }
        attached = attached || entry.name !== 'model_catalog_url';
        continue;
      }
      if (!sameEndpoint(entry.url, upstream)) continue;
      const target = new URL(entry.url);
      if (target.search || target.hash) throw new Error('Query strings and fragments in provider base_url are not supported.');
      const filteredUrl = rewriteOrigin(entry.url, this.filterOrigin);
      const prefixed = new URL(filteredUrl);
      prefixed.pathname = '/magpie' + prefixed.pathname;
      changed = replaceBase(changed, entry, prefixed.href);
      const filteredLine = magpieEntries(changed).find(item => item.key === entry.key).line;
      this.routes.set(entry.key, {originalUrl: entry.url, originalLine: entry.line, filteredUrl: prefixed.href, filteredLine});
      attached = attached || entry.name !== 'model_catalog_url';
    }
    if (changed !== text) {
      this.save();
      if (fs.readFileSync(this.configPath, 'utf8') !== text) return;
      atomicWrite(this.configPath, changed);
      this.log('config-attached', {mode: this.mode});
    }
    this.changeState(attached ? 'filtering' : entries.length ? 'waiting-for-magpie' : 'waiting-for-supported-provider');
  }
  entry(text, key) { return magpieEntries(text).find(item => item.key === key); }
}
module.exports = {ConfigRouter};
