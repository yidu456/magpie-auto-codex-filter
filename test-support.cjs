'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {once}=require('node:events');
const assert=require('node:assert/strict');
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
function call(origin, route, {body, headers = {}, method = 'POST'} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin + route, {method, headers}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    request.setTimeout(5000, () => request.destroy(new Error('test request timeout')));
    request.on('error', reject);
    request.end(body);
  });
}
function fixture(t) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'magpie-test-'));
  t.after(() => {
    // Never touch the user's live runtime; remove only this test's own temp folder.
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root));
    assert.match(path.basename(directory), /^magpie-test-/);
    fs.rmSync(directory, {recursive: true, force: true});
  });
  return directory;
}
const sample = {
  model: 'mock-model', store: true, stream: true, reasoning: {effort: 'xhigh', summary: 'auto'},
  include: ['reasoning.encrypted_content', 'message.output_text.logprobs'],
  input: [
    {role: 'user', content: [{type: 'input_text', text: '你好'}, {type: 'input_image', image_url: 'data:image/png;base64,AAAA'}]},
    {type: 'reasoning', id: 'rs_old', encrypted_content: 'foreign-account-ciphertext', summary: []},
    {type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"x":1}'},
    {type: 'function_call_output', id: 'fco_1', call_id: 'call_1', output: 'result'},
    {type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_2', name: 'exec', input: 'a'},
    {type: 'custom_tool_call_output', id: 'ctco_1', call_id: 'call_2', output: 'ok'},
    {type: 'message', id: 'msg_old', role: 'assistant', phase: 'final_answer',
      content: [{type: 'output_text', text: 'done', annotations: [{type: 'file_citation', file_id: 'file_keep', index: 0, filename: 'evidence.txt'}]}]}
  ]
};


module.exports={listen,close,call,fixture,sample};
