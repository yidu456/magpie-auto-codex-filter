'use strict';
const $ = id => document.getElementById(id);
const tokenFromUrl = new URLSearchParams(location.hash.slice(1)).get('token');
if (tokenFromUrl) { sessionStorage.setItem('console-token', tokenFromUrl); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('console-token');
let state, busy = false, dirty = false, exited = false, poll;
const policyInputs = [...document.querySelectorAll('[name=cleanup], [data-handler]'), $('enabled'), $('buffer-response'), $('heartbeat')];
const names = {'config-state': '接入状态', 'settings-applied': '设置已应用', 'request-started': '请求开始',
  'request-finished': '请求结束', 'history-preserved': '保留历史', filtered: '请求处理', 'history-cleanup': '清理历史',
  'http-error': 'HTTP 错误', 'stream-error': '流式错误', 'transport-error': '连接异常', 'retry-scheduled': '等待重试',
  'retry-dispatched': '发起重试', 'retry-accepted': '重试恢复', 'retry-exhausted': '重试耗尽',
  'recovery-disabled': '该项处理已关闭', 'cleanup-refused': '无法安全清理', 'request-progress': '等待上游',
  'config-attached': '已接入配置', disconnected: '已断开并恢复', blocked: '请求被拒绝', recovered: '异常退出恢复'};
const states = {idle: '未接入', filtering: '配置已接入', 'waiting-for-codex-config': '等待 Codex 配置',
  'waiting-for-magpie': '配置未指向 Magpie', 'waiting-for-supported-provider': '没有支持的客户端配置',
  'needs-attention': '需要处理', restored: '地址已恢复', closed: '程序已退出'};
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(route, body) {
  const response = await fetch(route, {method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: {'x-console-token': token || '', 'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地服务返回错误');
  return result;
}
function readConnection() {
  return {...state.settings, client: $('client').value, configPath: $('config-path').value.trim(),
    upstream: $('upstream').value.trim(), port: Number($('port').value)};
}
function render() {
  if (!state) return;
  const settings = state.settings, policy = settings.policy, stats = state.stats;
  $('connection-state').textContent = states[state.state] || state.state;
  $('connection-state').classList.toggle('on', state.attached);
  $('core-state').textContent = policy.enabled ? '已开启' : '已关闭';
  $('core-lamp').classList.toggle('on', policy.enabled);
  $('core-description').textContent = policy.enabled ? '勾选的保护已启用。设置即时作用于新请求，进行中的请求保持原策略。'
    : state.connected ? '当前已接入，但绕过过滤核心：请求直通 Magpie，不清理、不重试、不暂存。' : '尚未接入客户端。先确认接入设置，再开启核心过滤。';
  if (!dirty) {
    $('client').value = settings.client; $('config-path').value = settings.configPath;
    $('upstream').value = settings.upstream; $('port').value = settings.port;
  }
  for (const input of document.querySelectorAll('#connection-form input, #connection-form select')) input.disabled = busy || state.connected;
  $('save-connection').disabled = busy || state.connected;
  $('disconnect').disabled = busy || (!state.connected && !state.connection && !state.lastError);
  $('exit').disabled = busy;
  for (const input of policyInputs) input.disabled = busy;
  $('enabled').checked = policy.enabled;
  for (const input of document.querySelectorAll('[name=cleanup]')) input.checked = input.value === policy.cleanup;
  for (const input of document.querySelectorAll('[data-handler]')) {
    input.checked = policy.handlers[input.dataset.handler];
    if (input.dataset.handler === 'encryptedContent') input.disabled ||= policy.cleanup !== 'conditional';
    if (input.dataset.handler === 'streamIncomplete') input.disabled ||= !policy.bufferResponse;
  }
  $('buffer-response').checked = policy.bufferResponse; $('heartbeat').checked = policy.heartbeat;
  $('heartbeat').disabled ||= !policy.bufferResponse;
  $('stream-warning').hidden = policy.bufferResponse;
  $('revision').textContent = '已生效 · 版本 ' + state.revision;
  $('policy-version').textContent = state.revision;
  $('active-count').textContent = stats.activeRequests || 0;
  $('request-count').textContent = (stats.requests || 0) + ' 条请求';
  $('reasoning-count').textContent = stats.removedReasoningItems || 0;
  $('retry-count').textContent = ['resourceRetries', 'rateLimitRetries', 'transportRetries', 'availabilityRetries'].reduce((sum, key) => sum + (stats[key] || 0), 0);
  const older = state.activePolicies.filter(x => x.policyRevision !== state.revision).length;
  $('inflight').textContent = stats.activeRequests ? `正在处理 ${stats.activeRequests} 条请求${older ? `，其中 ${older} 条仍使用旧版策略` : ''}。进行中的请求不会因切换而中断。` : '没有进行中的请求。';
  $('connection-hint').textContent = dirty ? '有未保存的接入设置。保存后再开启总开关。'
    : state.connected ? '已连接：如需更换地址或路径，请先断开并恢复。' : '接入后更改地址或路径，需先断开并恢复配置。';
  const body = $('events'); body.replaceChildren();
  const recent = state.events.slice(-60).reverse();
  if (!recent.length) {
    const row = body.insertRow(), cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty';
    cell.textContent = '尚无记录。开启接入后，这里会显示经过过滤器的请求。';
  }
  for (const event of recent) {
    const row = body.insertRow();
    const details = ['handler', 'errorCode', 'code', 'state', 'phase', 'outcome', 'retry', 'delayMs', 'durationMs', 'policyRevision']
      .filter(key => event[key] !== undefined).map(key => key + '=' + event[key]).join('  ');
    for (const value of [new Date(event.time).toLocaleTimeString('zh-CN', {hour12: false}), event.requestId ? '#' + event.requestId : '—', names[event.event] || event.event, details || '—']) row.insertCell().textContent = value;
  }
}
async function apply(settings) {
  if (busy || !state) return;
  busy = true;
  for (const control of document.querySelectorAll('input, select, button')) control.disabled = true;
  try {
    state = await api('/api/settings', {revision: state.revision, settings});
    notice('已应用。新请求使用版本 ' + state.revision + '，已有请求保持原策略。');
  } catch (error) {
    notice('未应用：' + error.message, true);
    try { state = await api('/api/state'); } catch {}
  } finally { busy = false; render(); }
}
for (const input of policyInputs) input.addEventListener('change', async () => {
  if (!state || busy) { render(); return; }
  if (input.id === 'enabled' && input.checked && dirty) { notice('请先保存接入设置，再开启总开关。', true); render(); return; }
  const policy = {...state.settings.policy, handlers: {...state.settings.policy.handlers}};
  if (input.name === 'cleanup') policy.cleanup = input.value;
  else if (input.dataset.handler) policy.handlers[input.dataset.handler] = input.checked;
  else {
    const key = {enabled: 'enabled', 'buffer-response': 'bufferResponse', heartbeat: 'heartbeat'}[input.id];
    if (key === 'bufferResponse' && !input.checked && !confirm('关闭整轮暂存后会直接显示流式输出，但流中失败不能再重试，也不能撤回已交付的工具事件。确定关闭？')) { render(); return; }
    policy[key] = input.checked;
  }
  await apply({...state.settings, policy});
});
$('connection-form').addEventListener('input', () => { dirty = true; $('connection-hint').textContent = '有未保存的接入设置。保存后再开启总开关。'; });
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state || !$('connection-form').reportValidity()) return;
  const draft = readConnection();
  await apply(draft);
  if (['configPath', 'upstream', 'port', 'client'].every(key => state.settings[key] === draft[key])) dirty = false;
  render();
});
$('disconnect').addEventListener('click', async () => {
  if (busy || !state) return;
  busy = true; render();
  try { state = await api('/api/disconnect', {revision: state.revision}); notice('已断开并恢复本程序改写的地址。Codex 可能需要重开以读取原地址。'); }
  catch (error) { notice('未断开：' + error.message, true); }
  finally { busy = false; render(); }
});
$('exit').addEventListener('click', async () => {
  if (busy || !state || !confirm('退出会恢复客户端地址并停止本地服务。确定退出？')) return;
  busy = true; render();
  try { await api('/api/exit', {revision: state.revision}); exited = true; clearTimeout(poll); notice('程序已退出，地址已恢复。可以关闭此网页。'); $('connection-state').textContent = '程序已退出'; }
  catch (error) { notice('未退出：' + error.message, true); busy = false; render(); }
});
async function refresh() {
  if (exited) return;
  if (!busy) {
    try {
      const next = await api('/api/state');
      if (!busy && (!state || next.revision >= state.revision)) {
        const first = !state; state = next; render();
        if (state.lastError) notice('需要处理：' + state.lastError, true);
        else if (first) notice('控制台已就绪。总开关默认关闭，调整设置不会自动接管客户端。');
      }
    } catch (error) { notice('无法连接或会话已失效，请重新双击 EXE 打开控制台。' + error.message, true); }
  }
  if (!exited) poll = setTimeout(refresh, document.hidden ? 5000 : 1500);
}
refresh();
