'use strict';
const $ = id => document.getElementById(id);
const tokenFromUrl = new URLSearchParams(location.hash.slice(1)).get('token');
if (new URLSearchParams(location.hash.slice(1)).has('token')) history.replaceState(null, '', location.pathname + location.search);
let token = null, authRequired = null;
let state, busy = false, dirty = false, webDirty = false, exited = false, poll;
let dialogConsent = null, consentTimer;
const policyInputs = [...document.querySelectorAll('[name=cleanup], [data-handler]'), $('enabled'), $('delivery-mode'), $('heartbeat')];
const deliveryModes = {full: {bufferResponse: true, protectStreamStart: false}, protected: {bufferResponse: false, protectStreamStart: true}, direct: {bufferResponse: false, protectStreamStart: false}};
const pages = {dashboard: ['过滤控制台', '今日观测与网关 / 核心开关，其他配置在设置页。'], settings: ['过滤设置', '接入、保护与交付偏好，仅作用于新请求。'], records: ['请求记录', '关注正在处理的阶段与最终结果，不保留模型正文。'], help: ['使用说明', '接入、恢复边界，以及指标能说明什么。']};
function showPage(focus = false) {
  const query = new URLSearchParams(location.search).get('page');
  const page = Object.hasOwn(pages, query) ? query : 'dashboard';
  for (const name of Object.keys(pages)) $('page-' + name).hidden = name !== page;
  for (const link of document.querySelectorAll('nav a[data-page]')) {
    const current = link.dataset.page === page;
    link.classList.toggle('current', current);
    if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  [$('page-title').textContent, $('page-description').textContent] = pages[page];
  document.title = pages[page][0] + ' · Magpie Filter';
  if (focus) { $('page-title').focus({preventScroll: true}); window.scrollTo(0, 0); }
}
for (const link of document.querySelectorAll('nav a[data-page], .brand')) link.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (location.pathname + location.search !== link.getAttribute('href')) history.pushState(null, '', link.getAttribute('href'));
  showPage(true);
});
window.addEventListener('popstate', () => showPage(true));
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
    headers: {'content-type': 'application/json', ...(authRequired && token ? {'x-console-token': token} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) {
      dismissConsent();
      if (authRequired === true) {
        token = null; sessionStorage.removeItem('console-token'); state = null;
        $('login').hidden = false; $('controls').hidden = true;
        $('connection-state').textContent = '需要登录';
      }
    }
    throw Object.assign(new Error(response.status === 403 && authRequired === true ? '令牌无效或已过期，请输入当前生效的管理令牌。' : result.error || '本地服务返回错误'),
      {status: response.status, code: result.code, conflict: result.conflict});
  }
  return result;
}
function readConnection() {
  return {...state.settings, client: $('client').value, configPath: $('config-path').value.trim(),
    upstream: $('upstream').value.trim(), port: Number($('port').value)};
}
const kinds = {resource: '资源 / 历史', rateLimit: '临时限流', transport: '网络 / 中继 / 断流', availability: '无可用渠道', local: '本地', other: '其他'};
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const number = (value, missing = '不可用') => finite(value) ? value.toLocaleString('zh-CN', {maximumFractionDigits: 1}) : missing;
const ms = value => finite(value) ? number(value) + ' ms' : '未观测';
const label = (value, missing = '未知') => typeof value === 'string' && value.length ? value : missing;
function time(value) {
  if (typeof value !== 'string' && !finite(value)) return '时间未知';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', {hour12: false}) : '时间未知';
}
function table(id, rows, columns, empty = '暂无记录。') {
  const body = $(id); body.replaceChildren();
  if (!rows.length) {
    const cell = body.insertRow().insertCell(); cell.colSpan = columns; cell.className = 'empty'; cell.textContent = empty;
  }
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
}
function dimensions(id, values, translated = false, empty = '暂无事件。') {
  const rows = values && typeof values === 'object' && !Array.isArray(values) ? Object.entries(values).slice(0, 101) : [];
  table(id, rows.map(([key, value]) => [translated && Object.hasOwn(kinds, key) ? kinds[key] : key, number(value)]), 2, empty);
}
function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function chartShell(id, title, width = 560, height = 190) {
  const container = $(id); container.replaceChildren();
  const svg = svgElement('svg', {viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': title});
  svg.append(svgElement('title', {}, title)); container.append(svg); return svg;
}
function emptyChart(id, message) {
  const container = $(id), text = document.createElement('p');
  text.className = 'empty-chart'; text.textContent = message; container.replaceChildren(text);
}
function chartSegments(series, key) {
  const parts = []; let part = [], previous = -1;
  for (const bucket of series) {
    if (!bucket || !finite(bucket.minute) || !Number.isInteger(bucket.minute) || bucket.minute % 60000 || bucket.minute <= previous) continue;
    const adjacent = bucket.minute === previous + 60000; previous = bucket.minute;
    if (!finite(bucket[key]) || !adjacent) { if (part.length) parts.push(part); part = []; }
    if (finite(bucket[key])) part.push(bucket);
  }
  if (part.length) parts.push(part); return parts;
}
function smoothPath(points) {
  if (!points.length) return '';
  let path = 'M' + points[0].x + ',' + points[0].y;
  if (points.length === 1) return path;
  const slopes = points.slice(1).map((b, i) => (b.y - points[i].y) / (b.x - points[i].x));
  const tangents = points.map((_, i) => {
    if (!i) return slopes[0]; if (i === points.length - 1) return slopes.at(-1);
    const a = slopes[i - 1], b = slopes[i]; return a * b > 0 ? 2 * a * b / (a + b) : 0;
  });
  // Bound the connection to measured extrema; smoothing must not invent peaks.
  slopes.forEach((slope, i) => {
    if (!slope) { tangents[i] = tangents[i + 1] = 0; return; }
    const a = tangents[i] / slope, b = tangents[i + 1] / slope, length = Math.hypot(a, b);
    if (length > 3) { tangents[i] = 3 * a / length * slope; tangents[i + 1] = 3 * b / length * slope; }
  });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], third = (b.x - a.x) / 3;
    path += ` C${a.x + third},${a.y + third * tangents[i - 1]} ${b.x - third},${b.y - third * tangents[i]} ${b.x},${b.y}`;
  }
  return path;
}
const trendViews = new Map();
function chartMinute(series, position, left, right) {
  if (!series.length) return null;
  const first = series[0].minute, last = series.at(-1).minute;
  const ratio = right > left ? Math.max(0, Math.min(1, (position - left) / (right - left))) : 0;
  return first + Math.round((last - first) * ratio / 60000) * 60000;
}
function minuteDetails(series, minute, fields) {
  const bucket = series.find(row => row.minute === minute);
  const outside = series.length && (minute < series[0].minute || minute > series.at(-1).minute);
  return {bucket, message: bucket ? '' : outside ? '该分钟已移出观测窗口。' : '无该分钟观测；不借用相邻数据。',
    rows: fields.map(([key, name]) => [name, number(bucket?.[key], '未观测')])};
}
function tooltipPosition(x, y, width, height, boxWidth, boxHeight) {
  return {left: Math.max(8, Math.min(width - boxWidth - 8, x + 12 + boxWidth <= width - 8 ? x + 12 : x - boxWidth - 12)),
    top: Math.max(8, Math.min(height - boxHeight - 8, y + 12 + boxHeight <= height - 8 ? y + 12 : y - boxHeight - 12))};
}
function inspectTrend(id, view) {
  const {detail, tooltip, guide, series, fields} = view;
  if (!detail) return;
  if (view.minute === undefined) { detail.textContent = '悬停或轻触曲线查看分钟值；聚焦后用左右方向键选择，Esc 收起浮层。'; return; }
  const data = minuteDetails(series, view.minute, fields), title = time(view.minute).slice(0, 5);
  detail.textContent = title + ' · ' + (data.message || data.rows.map(([name, value]) => name + '：' + value).join(' · '));
  if (!tooltip) return;
  tooltip.hidden = !view.inspect; guide.replaceChildren();
  if (!view.inspect) return;
  const heading = document.createElement('strong'); heading.textContent = title + ' / 分钟观测';
  tooltip.replaceChildren(heading);
  if (data.message) { const text = document.createElement('p'); text.textContent = data.message; tooltip.append(text); }
  for (const [index, [name, value]] of data.rows.entries()) {
    const row = document.createElement('div'), label = document.createElement('span'), amount = document.createElement('b');
    label.className = 'color-' + index; label.textContent = name; amount.textContent = value; row.append(label, amount); tooltip.append(row);
  }
  if (view.minute >= series[0].minute && view.minute <= series.at(-1).minute) {
    const x = view.x(view.minute);
    guide.append(svgElement('line', {x1: x, x2: x, y1: view.top, y2: view.bottom, class: 'chart-guide'}));
    fields.forEach(([key], index) => { if (finite(data.bucket?.[key])) guide.append(svgElement('circle', {cx: x, cy: view.y(data.bucket[key]), r: 4, class: 'chart-marker color-' + index})); });
  }
  const box = tooltip.getBoundingClientRect(), container = $(id);
  const position = tooltipPosition(view.anchor.x, view.anchor.y, container.clientWidth, container.clientHeight, box.width, box.height);
  tooltip.style.left = position.left + 'px'; tooltip.style.top = position.top + 'px';
}
function trend(id, series, fields) {
  let view = trendViews.get(id);
  if (!view) {
    view = {}; trendViews.set(id, view);
    const container = $(id); container.tabIndex = 0; container.setAttribute('role', 'group');
    container.setAttribute('aria-label', '分钟趋势；左右方向键查看精确数据'); container.setAttribute('aria-describedby', id + '-detail');
    const hide = () => { view.inspect = false; inspectTrend(id, view); };
    const pointer = event => {
      if (!view.svg || !view.series.length) return;
      const svg = view.svg.getBoundingClientRect(), x = event.clientX - svg.left, y = event.clientY - svg.top;
      if (x < view.left || x > view.right || y < view.top || y > view.bottom) { hide(); return; }
      const box = container.getBoundingClientRect();
      view.minute = chartMinute(view.series, x, view.left + 4, view.right - 4);
      view.anchor = {x: event.clientX - box.left, y: event.clientY - box.top}; view.inspect = true; inspectTrend(id, view);
    };
    container.addEventListener('pointermove', pointer); container.addEventListener('pointerdown', pointer);
    container.addEventListener('pointerleave', hide); container.addEventListener('blur', hide);
    container.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hide(); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !view.series.length || !view.svg) return;
      event.preventDefault();
      const index = view.series.findIndex(row => row.minute === view.minute);
      const next = index < 0 ? event.key === 'ArrowLeft' ? view.series.length - 1 : 0 : Math.max(0, Math.min(view.series.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      view.minute = view.series[next].minute;
      const svg = view.svg.getBoundingClientRect(), box = container.getBoundingClientRect();
      view.anchor = {x: view.x(view.minute), y: svg.top - box.top + view.top}; view.inspect = true; inspectTrend(id, view);
    });
    view.observer = new ResizeObserver(() => { if (view.series) drawTrend(id, view); });
    view.observer.observe($(id));
  }
  Object.assign(view, {series, fields}); drawTrend(id, view);
}
function drawTrend(id, view) {
  const {series, fields} = view;
  if (!series.length || !series.some(bucket => fields.some(([key]) => finite(bucket[key])))) {
    emptyChart(id, '暂无可用分钟观测；不会补造缺失数据。');
    view.svg = view.tooltip = null; view.inspect = false;
    view.detail = document.createElement('p'); view.detail.id = id + '-detail'; view.detail.className = 'chart-detail';
    $(id).append(view.detail); inspectTrend(id, view); return;
  }
  const width = $(id).clientWidth; if (!width) return;
  const height = 290, left = 52, right = width - 14, top = 30, bottom = 248;
  const svg = chartShell(id, fields.map(([, name]) => name).join('、') + '分钟趋势，共用线性刻度；平滑不改变分钟值', width, height);
  const max = Math.max(1, ...series.flatMap(bucket => fields.map(([key]) => finite(bucket[key]) ? bucket[key] : 0)));
  const magnitude = 10 ** Math.floor(Math.log10(max / 4)), step = Math.max(1, Math.ceil(max * 1.1 / 4 / magnitude) * magnitude), ceiling = step * 4;
  const first = series[0].minute, last = series.at(-1).minute;
  const x = minute => first === last ? (left + right) / 2 : left + 4 + (minute - first) / (last - first) * (right - left - 8);
  const y = value => bottom - value / ceiling * (bottom - top);
  svg.append(svgElement('text', {x: left, y: 17, class: 'chart-label'}, id === 'token-chart' ? 'Token / 分钟' : '次 / 分钟'));
  for (let i = 0; i <= 4; i++) {
    const value = step * i;
    svg.append(svgElement('line', {x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-axis'}),
      svgElement('text', {x: left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label'}, value >= 1000 ? number(value / 1000) + 'k' : number(value)));
  }
  const legend = document.createElement('div'); legend.className = 'chart-legend';
  fields.forEach(([key, name], index) => {
    for (const part of chartSegments(series, key)) {
      const path = smoothPath(part.map(bucket => ({x: x(bucket.minute), y: y(bucket[key])})));
      if (id === 'token-chart' && index === 0 && part.length > 1) svg.append(svgElement('path', {d: path + ` L${x(part.at(-1).minute)},${bottom} L${x(part[0].minute)},${bottom} Z`, class: 'chart-area color-' + index}));
      svg.append(svgElement('path', {d: path, class: 'chart-line color-' + index, 'data-series': key}));
      if (part.length === 1) {
        const bucket = part[0], point = svgElement('circle', {cx: x(bucket.minute), cy: y(bucket[key]), r: 3, class: 'chart-point color-' + index});
        point.append(svgElement('title', {}, time(bucket.minute) + ' ' + name + '：' + number(bucket[key]))); svg.append(point);
      }
    }
    const item = document.createElement('span'), swatch = document.createElement('i'); swatch.className = 'legend-swatch color-' + index;
    item.append(swatch, document.createTextNode(name)); legend.append(item);
  });
  $(id).prepend(legend);
  const tickCount = first === last ? 1 : width < 430 ? 3 : 5;
  for (let i = 0; i < tickCount; i++) {
    const minute = tickCount === 1 ? first : first + (last - first) * i / (tickCount - 1);
    svg.append(svgElement('text', {x: x(minute), y: 274, 'text-anchor': tickCount === 1 ? 'middle' : !i ? 'start' : i === tickCount - 1 ? 'end' : 'middle', class: 'chart-label'}, time(minute).slice(0, 5)));
  }
  const detail = document.createElement('p'); detail.id = id + '-detail'; detail.className = 'chart-detail';
  detail.setAttribute('aria-live', 'polite');
  const guide = svgElement('g', {'aria-hidden': 'true'}), overlay = svgElement('rect', {x: left, y: top, width: right - left, height: bottom - top, class: 'chart-overlay'});
  const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.hidden = true; tooltip.setAttribute('aria-hidden', 'true');
  svg.append(guide, overlay); $(id).append(tooltip, detail);
  Object.assign(view, {svg, detail, guide, tooltip, x, y, left, right, top, bottom}); inspectTrend(id, view);
}
function histogram(id, histogram) {
  const valid = histogram && finite(histogram.count) && histogram.count > 0 && finite(histogram.sumMs)
    && Array.isArray(histogram.boundsMs) && histogram.boundsMs.length === 7 && histogram.boundsMs.every((v, i, a) => finite(v) && (!i || v > a[i - 1]))
    && Array.isArray(histogram.counts) && histogram.counts.length === 8 && histogram.counts.every(finite);
  if (!valid) {
    emptyChart(id + '-chart', '暂无延迟样本。'); $(id + '-summary').textContent = '未观测到有效延迟；不推算均值或百分位。';
    table(id + '-rows', [], 2, '暂无延迟样本。'); return;
  }
  const bounds = histogram.boundsMs;
  const rows = histogram.counts.map((count, i) => [i === 0 ? '0–' + number(bounds[0]) + ' ms' : i === 7 ? '> ' + number(bounds[6]) + ' ms' : '> ' + number(bounds[i - 1]) + '–' + number(bounds[i]) + ' ms', number(count)]);
  $(id + '-summary').textContent = '平均 ' + ms(histogram.sumMs / histogram.count) + '；' + number(histogram.count) + ' 个样本。区间右端包含边界，不提供推算百分位。';
  table(id + '-rows', rows, 2);
  const svg = chartShell(id + '-chart', (id === 'ttfb' ? '首次实际交付' : '总时长') + '分布；具体区间与样本数见下方表格');
  const max = Math.max(1, ...histogram.counts);
  svg.append(svgElement('path', {d: 'M36 22V148H548', class: 'chart-axis'}));
  histogram.counts.forEach((count, i) => {
    const height = count / max * 116, x = 48 + i * 62;
    const bar = svgElement('rect', {x, y: 148 - height, width: 38, height, rx: 3, class: 'chart-bar color-' + (id === 'ttfb' ? 0 : 1)});
    bar.append(svgElement('title', {}, rows[i].join('：'))); svg.append(bar);
    svg.append(svgElement('text', {x: x + 19, y: 140 - height, 'text-anchor': 'middle', class: 'chart-label'}, number(count)));
    svg.append(svgElement('text', {x: x + 19, y: 172, 'text-anchor': 'middle', class: 'chart-label'}, i === 7 ? '>60s' : '≤' + number(bounds[i] / 1000) + 's'));
  });
}
function records(id, items, active = false) {
  const phases = {upload: '接收上传', upstream: '等待上游', backoff: '退避等待', streaming: '正在交付', finished: '已结束'};
  const outcomes = {success: '成功', failed: '失败', canceled: '取消', unavailable: '结果不可观测'};
  table(id, items.map(record => {
    const usage = record.usage;
    const usageState = {pending: '等待观测', observed: '已观测', unavailable: '未观测 / 不可用'}[record.usageState] || '观测状态未知';
    return [label(record.requestId) + '\n模型：' + label(record.model),
      active ? phases[record.phase] || label(record.phase) : (outcomes[record.outcome] || '结果未知') + '\nHTTP ' + number(record.status, '未知') + '\n' + label(record.errorCode, '无已记录错误') + '\n' + (Object.hasOwn(kinds, record.errorKind) ? kinds[record.errorKind] : '无已记录错误类别'),
      '开始 ' + time(record.startedAt) + (active ? '\n已耗时 ' + ms(record.elapsedMs) : '\n结束 ' + time(record.finishedAt) + '\n总时长 ' + ms(record.durationMs)) + '\n首交付 ' + ms(record.ttfbMs),
      (record.enabled === true ? '核心启用' : record.enabled === false ? '核心关闭' : '核心状态未知') + '\n' + (record.streaming === true ? '流式请求' : record.streaming === false ? '非流式请求' : '流式未知') + '\n策略版本 ' + number(record.policyRevision, '未知') + '\n' + (record.observationAvailable === true ? '检查可用' : record.observationAvailable === false ? '检查不可用' : '检查可用性未知'),
      '计划 ' + number(record.retryScheduled) + ' / 执行 ' + number(record.retryDispatched) + '\n' + (Array.isArray(record.retryKinds) && record.retryKinds.length ? record.retryKinds.map(kind => Object.hasOwn(kinds, kind) ? kinds[kind] : label(kind)).join('、') : '无已记录重试类别'),
      usageState + '\n输入 ' + number(usage?.input_tokens, '未观测') + ' / 输出 ' + number(usage?.output_tokens, '未观测') + '\n缓存 ' + number(usage?.input_tokens_details?.cached_tokens, '未观测') + ' / 总量 ' + number(usage?.total_tokens, '未观测')];
  }), 6, active ? '没有保留的活动请求。' : '暂无最近结束记录；进程重启后从新请求开始记录。');
}
function renderMetrics(metrics, diagnostics) {
  const totals = metrics?.totals, retry = metrics?.retry;
  $('metrics-date').textContent = label(metrics?.date, '日期不可用');
  for (const key of ['started', 'success', 'failed', 'canceled', 'unavailable']) $('daily-' + key).textContent = number(totals?.[key]);
  $('daily-recovered').textContent = number(retry?.recoveredRequests);
  for (const [id, key] of [['token-input', 'inputTokens'], ['token-output', 'outputTokens'], ['token-cached', 'cachedInputTokens'], ['token-total', 'totalTokens']]) $(id).textContent = number(totals?.[key], '未观测');
  $('token-coverage').textContent = '有效 usage 观测：' + number(totals?.usageRequests) + ' 条请求。仅计已观测值；可选缓存与总量可能只覆盖部分观测，非账单。核心关闭时不解析 Token。';
  for (const [id, key] of [['retry-scheduled', 'scheduled'], ['retry-dispatched', 'dispatched'], ['retry-recovered', 'recoveredRequests'], ['retry-exhausted', 'exhausted']]) $(id).textContent = number(retry?.[key]);
  $('retry-wait').textContent = ms(retry?.plannedWaitMs);
  for (const [id, key] of [['history-kept', 'kept'], ['history-removed', 'removed'], ['history-ids', 'removedItemIds'], ['history-cleanups', 'cleanups']]) $(id).textContent = number(totals?.[key]);
  dimensions('recovery-kind-rows', retry?.recoveredByKind, true);
  dimensions('error-kind-rows', metrics?.errorsByKind, true); dimensions('error-code-rows', metrics?.errorsByCode);
  dimensions('model-rows', metrics?.byModel, false, '暂无已结束的模型请求。');
  const series = []; let previous = -1;
  for (const bucket of Array.isArray(metrics?.series) ? metrics.series.slice(-180) : []) {
    if (bucket && finite(bucket.minute) && Number.isInteger(bucket.minute) && !(bucket.minute % 60000) && bucket.minute > previous) { series.push(bucket); previous = bucket.minute; }
  }
  trend('request-chart', series, [['success', '成功'], ['failed', '失败'], ['canceled', '取消'], ['unavailable', '不可观测'], ['retries', '实际重试']]);
  trend('token-chart', series, [['inputTokens', '输入 Token'], ['outputTokens', '输出 Token']]);
  $('request-series-summary').textContent = series.length ? series.length + ' 个有事件的分钟窗口；空白分钟不补造事件，数据见表。' : '暂无分钟记录，重启后曲线重新开始。';
  $('token-series-summary').textContent = '只绘制有观测的值；缺失 usage 不当作零。';
  table('request-series-rows', series.map(bucket => [time(bucket.minute), number(bucket.started), number(bucket.success), number(bucket.failed), number(bucket.canceled) + ' / ' + number(bucket.unavailable), number(bucket.retries)]), 6);
  table('token-series-rows', series.map(bucket => [time(bucket.minute), number(bucket.inputTokens, '未观测'), number(bucket.outputTokens, '未观测')]), 3);
  histogram('ttfb', metrics?.latency?.ttfb); histogram('duration', metrics?.latency?.duration);
  const active = Array.isArray(metrics?.active) ? metrics.active.slice(0, 1000).filter(record => record && typeof record === 'object') : [];
  const recent = Array.isArray(metrics?.recent) ? metrics.recent.slice(0, 200).filter(record => record && typeof record === 'object') : [];
  const older = active.filter(record => finite(record.policyRevision) && record.policyRevision !== state.revision).length;
  $('request-count').textContent = metrics ? active.length + ' 条保留活动记录' : '记录不可用';
  $('inflight').textContent = !metrics ? '请求观测不可用。' : active.length ? `保留 ${active.length} 条活动请求${older ? `，其中 ${older} 条仍使用旧版策略` : ''}。进行中的请求不因核心切换中断；关闭网关会强制中断；超限未保留请求见诊断。` : '没有保留的活动请求。';
  records('active-rows', active, true); records('recent-rows', recent);
  const logs = diagnostics?.logs, persistence = diagnostics?.persistence, recorder = metrics?.diagnostics;
  const warnings = [];
  if (!metrics || !diagnostics) warnings.push('部分指标或诊断不可用');
  if (logs?.droppedLines) warnings.push('日志丢弃 ' + number(logs.droppedLines) + ' 行');
  if (logs?.writeErrors) warnings.push('日志写入错误 ' + number(logs.writeErrors) + ' 次，最近：' + label(logs.lastError, '已恢复'));
  if (persistence?.loadError) warnings.push('日汇总加载警告：' + label(persistence.loadError));
  if (persistence?.writeErrors) warnings.push('日汇总写入错误 ' + number(persistence.writeErrors) + ' 次，最近：' + label(persistence.lastError, '已恢复'));
  if (recorder?.droppedActive) warnings.push('超限未保留活动请求 ' + number(recorder.droppedActive) + ' 条');
  if (recorder?.invalidEvents) warnings.push('无效观测 ' + number(recorder.invalidEvents) + ' 次');
  if (recorder?.corruptSnapshots) warnings.push('无效汇总快照 ' + number(recorder.corruptSnapshots) + ' 次');
  $('metric-diagnostics').textContent = warnings.length ? warnings.join('；') + '。请求转发不受阻塞。' : '未发现记录诊断异常。日汇总同日可恢复；分钟曲线和最近记录仅保留于当前进程。';
  $('metric-diagnostics').classList.toggle('warning', !!warnings.length);
  const rows = [['日志排队', number(logs?.queuedLines) + ' 行 / ' + number(logs?.queuedBytes) + ' 字节'], ['日志丢弃 / 写入错误', number(logs?.droppedLines) + ' / ' + number(logs?.writeErrors)], ['日志写入批次 / 轮转', number(logs?.writes) + ' / ' + number(logs?.rotations)], ['日志最近错误', label(logs?.lastError, logs ? '无' : '不可用')], ['日汇总加载警告', label(persistence?.loadError, persistence ? '无' : '不可用')], ['日汇总写入错误 / 最近错误', number(persistence?.writeErrors) + ' / ' + label(persistence?.lastError, persistence ? '无' : '不可用')], ['最近日汇总保存', label(persistence?.lastSavedAt, '尚未保存 / 不可用')], ['无效观测 / 超限活动 / 无效快照', number(recorder?.invalidEvents) + ' / ' + number(recorder?.droppedActive) + ' / ' + number(recorder?.corruptSnapshots)]];
  $('diagnostics').replaceChildren();
  for (const [key, value] of rows) {
    const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = key; detail.textContent = value; $('diagnostics').append(term, detail);
  }
}
function render() {
  if (!state) return;
  if (dialogConsent && !busy && (state.revision !== dialogConsent.revision
    || state.portConflict?.challenge !== dialogConsent.challenge || Date.now() >= dialogConsent.expiresAt)) dismissConsent();
  const working = busy || state.transitioning;
  $('login').hidden = true; $('controls').hidden = false;
  const settings = state.settings, policy = settings.policy;
  $('connection-state').textContent = states[state.state] || state.state;
  $('connection-state').classList.toggle('on', state.attached);
  $('gateway').checked = state.connected; $('gateway').disabled = working;
  $('gateway-state').textContent = state.connected ? '已开启' : '已关闭';
  $('gateway-lamp').classList.toggle('on', state.connected);
  $('gateway-description').textContent = state.connected ? '网关已接入。关闭会先恢复地址，再强制中断活动请求，保留核心选择。' : '网关关闭，不监听、不接入。开启使用已保存的接入设置，与核心选择独立。';
  $('core-state').textContent = policy.enabled ? state.connected ? '已开启' : '未生效' : '已关闭';
  $('core-lamp').classList.toggle('on', policy.enabled && state.connected);
  $('core-description').textContent = policy.enabled && !state.connected ? '核心已选开启，但网关关闭，当前未生效。开启网关后才处理新请求。'
    : policy.enabled ? '勾选的保护已启用。设置即时作用于新请求，进行中的请求保持原策略。'
    : state.connected ? '当前已接入，但绕过过滤核心：请求直通 Magpie，不清理、不重试、不暂存。' : '网关与核心均关闭。可独立选择核心；只有开启网关才接入客户端。';
  if (!dirty) {
    $('client').value = settings.client; $('config-path').value = settings.configPath;
    $('upstream').value = settings.upstream; $('port').value = settings.port;
  }
  for (const input of document.querySelectorAll('#connection-form input, #connection-form select')) input.disabled = working || state.connected;
  $('save-connection').disabled = working || state.connected;
  $('disconnect').disabled = working || (!state.connected && !state.connection && !state.lastError);
  $('exit').disabled = working;
  $('resolve-port').hidden = state.connected || !(state.portConflict || /EADDRINUSE|Port owner changed/.test(state.lastError || ''));
  $('resolve-port').disabled = working || dirty;
  $('port-conflict-no').disabled = working;
  $('port-conflict-yes').disabled = working || !dialogConsent?.canTerminate;
  $('config-file').textContent = state.configFile;
  $('application-name').textContent = typeof state.application?.name === 'string' ? state.application.name.slice(0, 256) : '不可用';
  $('application-pid').textContent = Number.isSafeInteger(state.application?.pid) && state.application.pid > 0 ? String(state.application.pid) : '不可用';
  $('application-executable').textContent = typeof state.application?.executable === 'string' ? state.application.executable.slice(0, 32768) : '不可用';
  if (!webDirty) { $('web-port').value = state.web.port; $('web-auth-enabled').checked = state.web.authEnabled; }
  $('web-token-field').hidden = !$('web-auth-enabled').checked;
  for (const input of document.querySelectorAll('#web-form input, #web-form button')) input.disabled = working;
  $('web-token').disabled = working || $('web-token-field').hidden;
  $('web-hint').textContent = state.web.restartRequired
    ? '已保存，重启本程序后生效。当前地址：' + location.origin + '；下次地址：http://127.0.0.1:' + state.web.port + '/。退出后再双击 EXE。'
    : '当前地址：' + location.origin + '/。网页端口默认 18185，与过滤端口分开。';
  $('web-hint').textContent += ' 当前管理鉴权：' + (state.web.activeAuthEnabled ? '开启' : '关闭') + '；下次启动：' + (state.web.authEnabled ? '开启' : '关闭') + '。';
  for (const input of policyInputs) input.disabled = working;
  $('enabled').checked = policy.enabled;
  for (const input of document.querySelectorAll('[name=cleanup]')) input.checked = input.value === policy.cleanup;
  for (const input of document.querySelectorAll('[data-handler]')) {
    input.checked = policy.handlers[input.dataset.handler];
    if (input.dataset.handler === 'encryptedContent') input.disabled ||= policy.cleanup !== 'conditional';
    if (input.dataset.handler === 'streamIncomplete') input.disabled ||= !(policy.bufferResponse || policy.protectStreamStart);
  }
  const mode = policy.bufferResponse ? 'full' : policy.protectStreamStart ? 'protected' : 'direct';
  $('delivery-mode').value = mode; $('heartbeat').checked = policy.heartbeat;
  $('heartbeat').disabled ||= mode === 'direct';
  $('delivery-description').textContent = {full: '等本轮成功再交付正文和工具事件，失败尝试不会泄露。', protected: '首次内容增量前检查早期错误，再持续流式交付；正文交付后不重放。', direct: '即时转发，不拦截流内错误；核心关闭时也始终直通。'}[mode];
  $('stream-warning').hidden = policy.bufferResponse;
  $('stream-warning').textContent = mode === 'protected' ? '保护首段只恢复交付前的早期错误。首次内容交付后不再重试、清理或重放工具；晚期失败仍记作失败。' : '直接流式不拦截流内错误，开始转发后不再重试，也无法撤回已交付的工具事件。';
  $('revision').textContent = '已生效 · 版本 ' + state.revision;
  renderMetrics(state.metrics, state.diagnostics);
  $('connection-hint').textContent = dirty ? '有未保存的接入设置。保存后再开启网关。'
    : state.connected ? '已连接：改端口前先断开并恢复，重新接入后重启 Codex。' : '默认端口 18184，可更改。更改端口并重新接入后，需要重启 Codex。';
  const body = $('events'); body.replaceChildren();
  const recent = (state.events || []).slice(-60).reverse();
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
function dismissConsent() {
  clearTimeout(consentTimer); dialogConsent = null;
  if ($('port-conflict-dialog').open) $('port-conflict-dialog').close();
}
function openConsent(conflict) {
  if (!state || authRequired && !token || busy || state.transitioning || !conflict || conflict.revision !== state.revision
    || state.portConflict?.challenge !== conflict.challenge || Date.now() >= conflict.expiresAt) return;
  dismissConsent(); dialogConsent = conflict;
  const owner = conflict.owner;
  $('port-conflict-details').textContent = ['端口：127.0.0.1:' + conflict.port, '进程：' + label(owner?.name, '无法识别'),
    'PID：' + (Number.isSafeInteger(owner?.pid) && owner.pid > 0 ? String(owner.pid) : '无法识别'), '路径：' + label(owner?.executable, '不可用')].join('\n');
  $('port-conflict-reason').textContent = conflict.canTerminate ? '此次确认仅有效 60 秒。进程身份变化后必须重新确认。'
    : '无法安全结束该进程（' + label(conflict.reason, 'IDENTITY_UNAVAILABLE') + '）。请手动退出占用进程后重试。';
  $('port-conflict-progress').textContent = '';
  render(); $('port-conflict-dialog').showModal(); $('port-conflict-no').focus();
  consentTimer = setTimeout(() => {
    if (busy) return;
    dismissConsent(); notice('端口确认已过期，请重新尝试接入。', true);
  }, Math.max(0, conflict.expiresAt - Date.now()));
}
async function resolveConsent(confirm) {
  if (busy || state?.transitioning || !dialogConsent || confirm && !dialogConsent.canTerminate) return;
  const consent = dialogConsent; let fresh;
  busy = true; render();
  $('port-conflict-progress').textContent = confirm ? '正在重新核对进程并等待端口释放，请勿重复操作。已发出的操作不会因网页断开而撤销。' : '正在取消确认，不会结束进程。';
  try {
    state = await api('/api/port-conflict', {revision: consent.revision, challenge: consent.challenge, confirm});
    notice(confirm ? '网关已开启。新请求使用当前核心选择。' : '已保留占用进程，启用偏好未改变。');
  } catch (error) {
    fresh = error.conflict;
    notice('未完成：' + error.message + (error.status ? '' : '。请求结果尚未确认；已发出的操作不会因网页断开而撤销。'), true);
    if (authRequired === false || token) { try { state = await api('/api/state'); } catch {} }
  } finally { busy = false; dismissConsent(); render(); }
  if (fresh) openConsent(fresh);
}
$('port-conflict-no').addEventListener('click', () => resolveConsent(false));
$('port-conflict-yes').addEventListener('click', () => resolveConsent(true));
$('port-conflict-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!busy) resolveConsent(false); });
$('resolve-port').addEventListener('click', () => {
  if (state?.portConflict) openConsent(state.portConflict);
  else if (state) gateway(true);
});
async function apply(settings) {
  if (busy || !state || state.transitioning) return;
  dismissConsent(); let conflict;
  busy = true;
  for (const control of document.querySelectorAll('#controls input, #controls select, #controls button')) control.disabled = true;
  try {
    state = await api('/api/settings', {revision: state.revision, settings});
    notice('已应用。新请求使用版本 ' + state.revision + '，已有请求保持原策略。');
  } catch (error) {
    conflict = error.conflict;
    notice('未应用：' + error.message, true);
    try { state = await api('/api/state'); } catch {}
  } finally { busy = false; render(); }
  if (conflict) openConsent(conflict);
}
for (const input of policyInputs) input.addEventListener('change', async () => {
  if (!state || busy) { render(); return; }
  const policy = {...state.settings.policy, handlers: {...state.settings.policy.handlers}};
  if (input.name === 'cleanup') policy.cleanup = input.value;
  else if (input.dataset.handler) policy.handlers[input.dataset.handler] = input.checked;
  else if (input.id === 'delivery-mode') {
    if (input.value === 'direct' && !confirm('直接流式不拦截流内错误，已交付的正文和工具事件不能撤回。确定切换？')) { render(); return; }
    Object.assign(policy, deliveryModes[input.value]);
  } else {
    policy[input.id] = input.checked;
  }
  await apply({...state.settings, policy});
});
$('connection-form').addEventListener('input', () => { dirty = true; $('connection-hint').textContent = '有未保存的接入设置。保存后再开启网关。'; });
$('connection-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state || !$('connection-form').reportValidity()) return;
  const draft = readConnection();
  await apply(draft);
  if (state && ['configPath', 'upstream', 'port', 'client'].every(key => state.settings[key] === draft[key])) {
    dirty = false;
    notice('接入设置已保存。更改过滤端口后，重新开启接入并重启 Codex 才能使用新地址。');
  }
  render();
});
$('web-form').addEventListener('input', () => {
  webDirty = true; $('web-token-field').hidden = !$('web-auth-enabled').checked;
  $('web-token').disabled = $('web-token-field').hidden;
});
$('web-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !state || !$('web-form').reportValidity()) return;
  const web = {port: Number($('web-port').value), authEnabled: $('web-auth-enabled').checked};
  if (!$('web-token').disabled && $('web-token').value.trim()) web.token = $('web-token').value.trim();
  busy = true; render();
  try {
    state = await api('/api/web', {revision: state.revision, web});
    webDirty = false; $('web-token').value = '';
    notice('网页设置已保存。退出本程序后再次双击 EXE，新端口或令牌才会生效。');
  } catch (error) {
    notice('未保存：' + error.message, true);
    try { state = await api('/api/state'); } catch {}
  } finally { busy = false; render(); }
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !$('login-form').reportValidity()) return;
  token = $('login-token').value.trim(); busy = true; $('login-submit').disabled = true;
  try {
    state = await api('/api/state'); sessionStorage.setItem('console-token', token);
    $('login-token').value = ''; dirty = webDirty = false; render();
    notice(state.lastError ? '需要处理：' + state.lastError : '登录成功，已读取保存的配置。', !!state.lastError);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; $('login-submit').disabled = false; render(); }
});
async function gateway(enabled) {
  if (busy || !state || state.transitioning) { render(); return; }
  if (enabled && dirty) { notice('请先保存接入设置，再开启网关。', true); render(); return; }
  if (!enabled && !confirm('关闭网关会先恢复客户端地址，再强制中断上传、等待和流式请求，不等待模型完成。保留核心选择。确定关闭？')) { render(); return; }
  dismissConsent(); let conflict;
  busy = true; render();
  $('gateway').checked = enabled;
  try {
    state = await api(enabled ? '/api/connect' : '/api/disconnect', {revision: state.revision});
    notice(enabled ? '网关已开启，新请求使用当前核心选择。' : '网关已关闭，活动请求已中断，地址已恢复。Codex 可能需要重开。');
  } catch (error) {
    conflict = error.conflict; notice('网关未切换：' + error.message, true);
    try { state = await api('/api/state'); } catch {}
  } finally { busy = false; render(); }
  if (conflict) openConsent(conflict);
}
$('gateway').addEventListener('change', () => gateway($('gateway').checked));
$('disconnect').addEventListener('click', () => gateway(false));
$('exit').addEventListener('click', async () => {
  if (busy || !state || !confirm('退出会恢复客户端地址并停止本地服务。确定退出？')) return;
  busy = true; render();
  try { await api('/api/exit', {revision: state.revision}); exited = true; clearTimeout(poll); notice('程序已退出，地址已恢复。可以关闭此网页。'); $('connection-state').textContent = '程序已退出'; }
  catch (error) { notice('未退出：' + error.message, true); busy = false; render(); }
});
async function refresh() {
  if (exited) return;
  if (!busy && (authRequired === false || token)) {
    try {
      const next = await api('/api/state');
      if (!busy && (!state || next.revision >= state.revision)) {
        const first = !state; state = next; render();
        if (state.portConflictPending) notice('正在处理已确认的端口占用；等待操作完成，请勿重复操作。');
        else if (state.lastError) notice('需要处理：' + state.lastError, true);
        else if (first) notice('新进程仅启动网页，网关与核心均关闭；再次打开同一运行实例保留当前选择。');
      }
    } catch (error) { notice('无法连接或尚未登录：' + error.message, true); }
  }
  if (!exited) poll = setTimeout(refresh, document.hidden ? 5000 : 1500);
}
showPage();
async function initialize() {
  try {
    const discovery = await api('/api/auth');
    if (typeof discovery.authRequired !== 'boolean') throw new Error('无法确认本地管理鉴权状态。');
    authRequired = discovery.authRequired;
    if (authRequired) {
      token = tokenFromUrl || sessionStorage.getItem('console-token');
      $('login').hidden = !!token;
      if (!token) { $('connection-state').textContent = '需要登录'; notice('请输入 EXE 同目录配置文件中的 web.token，或再次双击 EXE 自动登录。'); }
      if (tokenFromUrl) {
        state = await api('/api/state'); sessionStorage.setItem('console-token', token); render();
      }
    } else { sessionStorage.removeItem('console-token'); $('login').hidden = true; }
  } catch (error) { notice('无法连接：' + error.message, true); }
  finally { if (authRequired !== null) refresh(); }
}
initialize();
