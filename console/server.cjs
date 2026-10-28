'use strict';
const http = require('node:http');
const {timingSafeEqual} = require('node:crypto');

function createManagementServer({controller, token, assets = {}, onExit = () => {}}) {
  if (typeof token !== 'string' || !token.length) throw new Error('Management token is required.');
  const expected = Buffer.from(token);
  let mutations = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      if (!res.destroyed) { res.writeHead(status, {'content-type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
    };
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      const host = '127.0.0.1:' + server.address().port, origin = 'http://' + host;
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin
          || req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
        json(403, {error: 'Untrusted request origin or host.'}); return;
      }
      if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
        const asset = assets[req.url]; res.writeHead(200, {'content-type': asset.type}); res.end(asset.body); return;
      }
      const given = Buffer.from(String(req.headers['x-console-token'] || ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        json(403, {error: 'Open the console again from the application to authenticate.'}); return;
      }
      if (req.url === '/api/state' && req.method === 'GET') { json(200, controller.status()); return; }
      if (req.method !== 'POST' || !['/api/settings', '/api/web', '/api/disconnect', '/api/exit', '/api/port-conflict'].includes(req.url)) {
        json(404, {error: 'Unknown route.'}); return;
      }
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { json(415, {error: 'Send application/json.'}); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({destroyOnReturn: false})) {
        size += chunk.length;
        if (size > 32768) { req.resume(); json(413, {error: 'Settings request exceeds 32 KiB.'}); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
      const work = mutations.then(async () => {
        if (req.url === '/api/port-conflict') return controller.resolvePortConflict(body);
        if (body.revision !== controller.status().revision) throw new Error('Settings revision changed. Reload before saving.');
        if (req.url === '/api/settings') return controller.update(body);
        if (req.url === '/api/web') return controller.updateWeb(body);
        if (Object.keys(body).some(key => key !== 'revision')) throw new Error('Invalid control fields.');
        if (req.url === '/api/disconnect') return controller.disconnect();
        await controller.close();
        // Finish the response when possible; an abandoned browser cannot strand a closed core.
        let scheduled = false;
        const exit = () => { if (!scheduled) { scheduled = true; setImmediate(onExit); } };
        if (res.destroyed) exit();
        else { res.once('finish', exit); res.once('close', exit); }
        return {exiting: true};
      });
      mutations = work.catch(() => {});
      json(200, await work);
    } catch (error) {
      const portError = /^PORT_(?:CONFLICT(?:_STALE)?|OWNER_(?:CHANGED|UNSAFE)|INSPECTION_FAILED|TERMINATION_(?:DENIED|TIMEOUT|FAILED)|RELEASE_TIMEOUT)$/.test(error.code || '');
      json(portError || /revision|active requests|Disconnect|disconnect/.test(error.message) ? 409 : 400,
        {error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message,
          ...(portError ? {code: error.code, ...(['PORT_CONFLICT', 'PORT_OWNER_CHANGED'].includes(error.code) && error.conflict
            ? {conflict: error.conflict} : {})} : {})});
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

module.exports = {createManagementServer};
