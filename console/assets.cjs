'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sea = require('node:sea');

function loadAssets() {
  const read = name => sea.isSea() ? sea.getAsset(name, 'utf8') : fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
  const shell = {type: 'text/html; charset=utf-8', body: read('index.html')};
  return {'/': shell, '/?page=settings': shell, '/?page=records': shell, '/?page=help': shell,
    '/app.css': {type: 'text/css; charset=utf-8', body: read('app.css')},
    '/app.js': {type: 'application/javascript; charset=utf-8', body: read('app.js')}};
}
module.exports = {loadAssets};
