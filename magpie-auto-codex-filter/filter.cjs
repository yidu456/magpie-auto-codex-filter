'use strict';
const path = require('node:path');
const core = require('./core.cjs');
function argumentsFor(argv) {
  const args = [argv[0] || 'help', '--mode', 'magpie-auto', '--port', '18184',
    '--runtime', path.join(__dirname, '..', '.runtime'), ...argv.slice(1)];
  if (core.parseArgs([...args]).mode !== 'magpie-auto') throw new Error('Use the matching entry for other filter modes.');
  return args;
}
function parseArgs(argv) { return core.parseArgs(argumentsFor(argv)); }
async function main(argv = process.argv.slice(2)) {
  if (parseArgs(argv).command === 'help') {
    console.log('node magpie-auto-codex-filter/filter.cjs start|stop|status|logs|serve [--port 18184] [--upstream http://127.0.0.1:3425] [--config PATH] [--runtime PATH]');
    return;
  }
  await core.main(argumentsFor(argv));
}
if (require.main === module) main().catch(error => { console.error('Magpie conditional filter: ' + error.message); process.exitCode = 1; });
module.exports = {parseArgs, main, start: core.start, stop: core.stop, status: core.status};
