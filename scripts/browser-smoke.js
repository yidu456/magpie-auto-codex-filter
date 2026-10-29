async (page, {screenshots = '.verification/task-4-browser', only} = {}) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const token = 'ab'.repeat(32), origin = new URL(page.url()).origin;
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use an isolated local UI fixture.');
  const fixture = await page.evaluate(async token => {
    const r = await fetch('/api/state', {headers: {'x-console-token': token}}); return r.json();
  }, token);
  check(fixture.settings?.configPath.includes('ui-fixture-') && fixture.settings.configPath.endsWith('mock-codex.toml'), 'Refuse non-fixture mutations.');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const visiblePage = async name => {
    await page.locator('#page-' + name).waitFor({state: 'visible'});
    for (const other of ['dashboard', 'settings', 'records', 'help'].filter(x => x !== name)) check(await page.locator('#page-' + other).isHidden(), 'Pages must be separate: ' + other);
    check(await page.locator('nav a[aria-current=page]').count() === 1, 'Exactly one current navigation link required');
  };
  const go = async name => { await page.locator('nav a[data-page=' + name + ']').click(); await visiblePage(name); };
  const settled = () => page.waitForFunction(() => !document.getElementById('enabled').disabled);
  await page.evaluate(() => sessionStorage.clear()); await page.goto(origin + '/');
  await page.locator('#login').waitFor({state: 'visible'});
  check(await page.locator('#controls').isHidden(), 'Unauthenticated controls visible');
  await page.locator('#login-token').fill('ff'.repeat(32)); await page.locator('#login-submit').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('令牌无效'));
  await page.locator('#login-token').fill(token); await page.locator('#login-submit').click();
  await page.locator('#controls').waitFor({state: 'visible'}); await settled();
  const result = {manualLogin: true};
  if (!only || only === 'identity') {
    await go('settings');
    check(await page.locator('#application-name').textContent() === 'Magpie Filter', 'Application name missing');
    check(await page.locator('#application-pid').textContent() === String(fixture.application.pid), 'PID must be raw, not locale formatted');
    check(await page.locator('#application-executable').textContent() === fixture.application.executable, 'Settings must identify the actual executable');
    const malicious = '<img src=x onerror="globalThis.identityPwned=1">', executable = malicious + 'long-path'.repeat(5000);
    let pid = 1234567;
    await page.route('**/api/state', async route => {
      const response = await route.fetch(), live = await response.json();
      await route.fulfill({response, json: {...live, application: {...live.application, name: malicious.repeat(20), pid, executable}}});
    });
    await page.waitForFunction(() => document.getElementById('application-pid').textContent === '1234567');
    check(await page.locator('#application-name').textContent() === malicious.repeat(20).slice(0, 256), 'Application name must be bounded literal text');
    check(await page.locator('#application-executable').textContent() === executable.slice(0, 32768), 'Executable must be bounded literal text');
    check(await page.locator('#page-settings img').count() === 0 && !await page.evaluate(() => globalThis.identityPwned), 'Application identity executed HTML');
    pid = -1;
    await page.waitForFunction(() => document.getElementById('application-pid').textContent === '不可用');
    await page.unroute('**/api/state');
    await page.reload(); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
    result.applicationIdentity = result.safeIdentityText = true;
  }
  if (!only || only === 'navigation') {
    await go('dashboard');
    check(await page.locator('#connection-form').isHidden() && await page.locator('#delivery-mode').isHidden(), 'Home must show charts/core only, not other settings');
    check(await page.locator('#page-dashboard input, #page-dashboard select, #page-dashboard button').count() === 2, 'Home must contain only gateway/core switches');
    await go('settings');
    for (const id of ['connection-form', 'web-form', 'modes', 'delivery-mode', 'exit']) check(await page.locator('#' + id).isVisible(), 'Settings control missing: ' + id);
    await page.locator('nav a[href="/?page=records"]').click(); await visiblePage('records');
    check(new URL(page.url()).search === '?page=records', 'Records URL must be navigable');
    check(await page.locator('#page-title').evaluate(el => el === document.activeElement), 'Navigation must focus heading');
    await page.locator('nav a[href="/?page=help"]').click(); await visiblePage('help');
    await page.goBack(); await visiblePage('records'); await page.goBack(); await visiblePage('settings'); await page.goBack(); await visiblePage('dashboard');
    await page.goForward(); await visiblePage('settings'); await page.goForward(); await visiblePage('records');
    await page.reload(); await visiblePage('records');
    await page.evaluate(() => sessionStorage.clear());
    const response = await page.goto(origin + '/?page=help#token=' + token);
    check(response.status() === 200, 'Direct help link must load shell'); await visiblePage('help');
    check(new URL(page.url()).search === '?page=help' && new URL(page.url()).hash === '', 'Fragment login must retain query and remove token');
    await page.reload(); await visiblePage('help');
    for (const [name, route] of [['dashboard', '/'], ['settings', '/?page=settings'], ['records', '/?page=records'], ['help', '/?page=help']]) {
      check((await page.goto(origin + route)).status() === 200, 'Direct page not served: ' + name);
      await visiblePage(name); await page.reload(); await visiblePage(name);
    }
    await page.locator('nav a[data-page=settings]').focus(); await page.keyboard.press('Enter'); await visiblePage('settings');
    check(await page.locator('#page-title').evaluate(el => el === document.activeElement), 'Keyboard navigation must focus heading');
    await go('help');
    for (const route of ['/?page=unknown', '/records', '/help', '/app.js?page=help']) {
      check((await page.request.get(origin + route, {headers: {'x-console-token': token}})).status() === 404, 'Unknown route not rejected: ' + route);
    }
    await page.setViewportSize({width: 390, height: 844});
    for (const href of ['/', '/?page=settings', '/?page=records', '/?page=help']) check(await page.locator('nav a[href="' + href + '"]').isVisible(), 'Mobile navigation hides page: ' + href);
    result.navigation = true;
  }
  await page.goto(origin + '/'); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
  if (!only || only === 'policy') {
    await go('settings');
    check(await page.locator('#delivery-mode').count() === 1, 'Three-choice delivery selector missing');
    await page.locator('[data-handler=rateLimit]').uncheck(); await settled();
    for (const [mode, bufferResponse, protectStreamStart, heartbeatDisabled] of [['protected', false, true, false], ['direct', false, false, true], ['full', true, false, false], ['protected', false, true, false]]) {
      await page.locator('#delivery-mode').selectOption(mode); await settled();
      await page.reload(); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
      check(await page.locator('#delivery-mode').inputValue() === mode, 'Delivery mode did not persist: ' + mode);
      check(await page.locator('#heartbeat').isDisabled() === heartbeatDisabled, 'Heartbeat availability wrong: ' + mode);
      const saved = await page.evaluate(async token => (await (await fetch('/api/state', {headers: {'x-console-token': token}})).json()).settings.policy, token);
      check(saved.bufferResponse === bufferResponse && saved.protectStreamStart === protectStreamStart, 'Wrong delivery booleans: ' + mode);
    }
    check(!await page.locator('[data-handler=rateLimit]').isChecked(), 'Handler preference did not persist');
    await page.locator('#port').fill('1'); await page.locator('#save-connection').click();
    check(await page.locator('#port').evaluate(input => !input.validity.valid), 'Invalid filter port accepted');
    await page.locator('#port').fill(String(fixture.settings.port));
    await page.locator('#upstream').fill(fixture.settings.upstream + '/draft');
    await page.waitForTimeout(1700); check(await page.locator('#upstream').inputValue() === fixture.settings.upstream + '/draft', 'Polling discarded connection draft');
    await go('dashboard'); await page.locator('#gateway').click();
    check((await page.locator('#notice').textContent()).includes('先保存'), 'Core ON accepted unsaved connection');
    check(!await page.locator('#gateway').isChecked(), 'Gateway ON did not roll back');
    await go('settings'); await page.locator('#upstream').fill(fixture.settings.upstream); await page.locator('#save-connection').click(); await settled();
    await go('dashboard'); await page.locator('#enabled').check(); await settled();
    check(!await page.locator('#gateway').isChecked(), 'Core preference must never start gateway');
    check((await page.locator('#core-state').textContent()) === '未生效', 'Disconnected core must be inactive');
    await page.locator('#gateway').check();
    await page.waitForFunction(() => document.getElementById('connection-state').textContent === '配置已接入');
    await go('settings'); check(await page.locator('#port').isDisabled(), 'Connected port must not be editable');
    await page.locator('[name=cleanup][value=never]').check(); await settled();
    check(await page.locator('[data-handler=encryptedContent]').isDisabled(), 'Cleanup handler exclusion lost');
    await go('dashboard'); await page.locator('#enabled').uncheck(); await settled();
    check((await page.locator('#core-description').textContent()).includes('直通'), 'Bypass guidance missing');
    await page.locator('#gateway').uncheck(); await settled();
    check(!await page.locator('#enabled').isChecked(), 'Disconnect must preserve core choice');
    await go('settings');
    await page.locator('#web-token').fill('cd'.repeat(32));
    const nextWebPort = [19385, 19386, 19387, 19388].find(port => ![fixture.web.port, fixture.settings.port, Number(new URL(fixture.settings.upstream).port)].includes(port));
    await page.locator('#web-port').fill(String(nextWebPort));
    await page.waitForTimeout(1700); check(await page.locator('#web-token').inputValue() === 'cd'.repeat(32), 'Polling discarded web draft');
    await page.locator('#save-web').click();
    await page.waitForFunction(() => document.getElementById('web-hint').textContent.includes('重启本程序后生效'));
    await page.reload(); await page.locator('#controls').waitFor({state: 'visible'}); await settled();
    check(await page.locator('#web-token').inputValue() === '', 'Token must not be echoed');
    check((await page.locator('#web-hint').textContent()).includes('重启本程序'), 'Pending rotation lost');
    await page.locator('[name=cleanup][value=always]').check(); await settled();
    await page.route('**/api/state', route => route.fulfill({status: 403, contentType: 'application/json', body: '{"error":"expired"}'}));
    await page.locator('#login').waitFor({state: 'visible'});
    check(await page.locator('#login-token').isEnabled(), 'Policy save left re-login input disabled');
    check(await page.locator('#login-submit').isEnabled(), 'Policy save left re-login button disabled');
    await page.unroute('**/api/state');
    await page.locator('#login-token').fill(token); await page.locator('#login-submit').click();
    await page.locator('#controls').waitFor({state: 'visible'}); await settled();
    check(await page.locator('#delivery-mode').inputValue() === 'protected', 'Protected mode lost after re-login');
    result.policyPersistence = result.fixtureAttachBypassRestore = result.pendingRotation = true;
  }
  if (!only || only === 'metrics') {
    await go('dashboard');
    check(await page.locator('#daily-started').count() === 1, 'Daily observed metrics missing');
    check(await page.locator('#daily-started').textContent() === '0', 'Valid empty aggregate must show measured zero');
    check(await page.locator('#token-input').textContent() === '未观测', 'Empty provider usage must not show zero');
    check((await page.locator('#request-chart').textContent()).includes('暂无'), 'Empty process must show no curve');
    if (!only) {
      result.emptyProcessScreenshots = [];
      for (const [width, height, size] of [[1280, 1000, 'desktop'], [390, 844, 'mobile']]) {
        await page.setViewportSize({width, height});
        const file = screenshots.replace(/[\\/]$/, '') + '/task-4-empty-' + size + '.png';
        await page.screenshot({path: file, fullPage: true}); result.emptyProcessScreenshots.push(file);
      }
    }
    const malicious = '<img src=x onerror="globalThis.pwned=1">' + 'very-long-model-'.repeat(5);
    const snapshot = structuredClone(fixture.metrics);
    snapshot.totals = {...snapshot.totals, started: 5, finished: 5, success: 2, failed: 1, canceled: 1, unavailable: 1, kept: 12, removed: 3, removedItemIds: 2, cleanups: 1, usageRequests: 2, inputTokens: 12, outputTokens: 4, totalTokens: 16, cachedInputTokens: 3};
    snapshot.retry = {scheduled: 4, dispatched: 3, recoveredRequests: 1, exhausted: 1, plannedWaitMs: 2125.5, recoveredByKind: {transport: 1}};
    snapshot.latency = {ttfb: {boundsMs: [100, 500, 1000, 3000, 10000, 30000, 60000], counts: [1, 0, 1, 0, 0, 0, 0, 0], count: 2, sumMs: 1000}, duration: {boundsMs: [100, 500, 1000, 3000, 10000, 30000, 60000], counts: [0, 0, 0, 2, 0, 0, 0, 0], count: 2, sumMs: 4000}};
    const minute = Math.floor(Date.now() / 60000) * 60000;
    snapshot.series = [{minute: minute - 120000, started: 2, success: 1, failed: 1, canceled: 0, unavailable: 0, retries: 1, inputTokens: null, outputTokens: null}, {minute, started: 3, success: 1, failed: 0, canceled: 1, unavailable: 1, retries: 2, inputTokens: 12, outputTokens: 4}];
    snapshot.errorsByCode = {[malicious]: 2, rate_limit_exceeded: 1}; snapshot.errorsByKind = {transport: 2, rateLimit: 1, [malicious]: 1}; snapshot.byModel = {[malicious]: 3, other: 2};
    const record = {requestId: 'fixture:1:1', startedAt: new Date(minute).toISOString(), finishedAt: null, model: null, enabled: false, streaming: null, policyRevision: 0, phase: 'upstream', status: null, ttfbMs: null, durationMs: null, outcome: null, usage: null, usageState: 'pending', observationAvailable: false, retryScheduled: 1, retryDispatched: 0, retryKinds: [], errorCode: null, errorKind: null};
    snapshot.active = [{...record, elapsedMs: 1234}];
    snapshot.recent = [{...record, requestId: 'fixture:1:2', model: malicious, enabled: true, streaming: true, phase: 'finished', finishedAt: new Date().toISOString(), status: 200, ttfbMs: 100, durationMs: 2000, outcome: 'success', usageState: 'observed', observationAvailable: true, usage: {input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: {cached_tokens: 3}}, retryScheduled: 4, retryDispatched: 3, errorCode: malicious, errorKind: 'transport'}];
    let injected = snapshot;
    const diagnostics = {...fixture.diagnostics, logs: {...fixture.diagnostics.logs, droppedLines: 2}, persistence: {...fixture.diagnostics.persistence, loadError: 'INVALID_SNAPSHOT'}};
    await page.route('**/api/state', async route => {
      const response = await route.fetch(), live = await response.json();
      await route.fulfill({response, json: {...live, stats: {requests: 999, activeRequests: 999}, metrics: injected, diagnostics, events: [...live.events, {time: new Date(minute).toISOString(), requestId: malicious, event: malicious, errorCode: malicious}]}});
    });
    await page.reload(); await page.locator('#controls').waitFor({state: 'visible'});
    check(await page.locator('#daily-started').textContent() === '5', 'Daily metrics must not use proxy stats');
    check((await page.locator('#ttfb-summary').textContent()).includes('500 ms'), 'TTFB mean must derive from observed sum/count');
    check((await page.locator('#duration-summary').textContent()).includes('2,000 ms'), 'Duration mean incorrect');
    check(await page.locator('#ttfb-chart .distribution-row').count() === 8, 'Horizontal histogram must render all eight observed bins');
    check((await page.locator('#ttfb-chart .distribution-value').first().textContent()) === '1 / 50%', 'Distribution needs exact count and sample share');
    check(await page.locator('#ttfb-chart .distribution-fill').nth(1).evaluate(el => el.style.width === '0%'), 'Zero bins must stay zero');
    check((await page.locator('#error-kind-chart .distribution-label').first().textContent()).includes('网络'), 'Error categories must rank by observed occurrence count');
    const precise = page.locator('#page-dashboard .precision-data');
    for (let i = 0; i < await precise.count(); i++) await precise.nth(i).locator('summary').click();
    for (const width of [1280, 736, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      check(await page.locator('.precision-table').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height === 240)), 'Precise tables must keep240px at width' + width);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Expanded tables must not overflow page width' + width);
      await page.waitForFunction(() => ['request-chart', 'token-chart'].every(id => { const el = document.getElementById(id); return el.querySelector('svg').viewBox.baseVal.width === el.clientWidth; }));
    }
    const latencyTable = page.locator('#ttfb-rows').locator('xpath=ancestor::div[contains(@class,"precision-table")]');
    await latencyTable.scrollIntoViewIfNeeded();
    check(await latencyTable.evaluate(el => { el.scrollTop = 100; const top = el.getBoundingClientRect().top, head = el.querySelector('th').getBoundingClientRect().top; return el.scrollTop > 0 && Math.abs(head - top) < 2; }), 'Precise table headers must remain sticky during scrolling');
    check(await page.locator('#token-chart-detail').count() === 1 && await page.locator('#token-chart-detail').evaluate(el => !el.closest('details')), 'Bottom detail must stay outside collapsed precise tables');
    result.horizontalDistributionsAndFixedTables = true;
    check(await page.locator('#token-chart .chart-overlay').count() === 1, 'Token plot needs one inspection overlay');
    async function hoverMinute(id, fraction, vertical = .5) {
      const plot = page.locator('#' + id + ' .chart-overlay'); await plot.scrollIntoViewIfNeeded();
      const box = await plot.boundingBox();
      await page.mouse.move(box.x + 4 + fraction * (box.width - 8), box.y + vertical * box.height);
      return box;
    }
    await hoverMinute('token-chart', 1, .95);
    check((await page.locator('#token-chart-detail').textContent()).includes('输入 Token：12'), 'Bottom detail needs exact input usage');
    check((await page.locator('#token-chart .chart-tooltip').textContent()).includes('输出 Token4'), 'Pointer tooltip needs exact output usage');
    const tooltipBox = await page.locator('#token-chart .chart-tooltip').boundingBox(), chartBox = await page.locator('#token-chart').boundingBox();
    check(tooltipBox.x >= chartBox.x && tooltipBox.x + tooltipBox.width <= chartBox.x + chartBox.width + 1 && tooltipBox.y >= chartBox.y && tooltipBox.y + tooltipBox.height <= chartBox.y + chartBox.height + 1, 'Tooltip must stay inside chart');
    await hoverMinute('token-chart', .5);
    check((await page.locator('#token-chart-detail').textContent()).includes('无该分钟观测'), 'Missing minute must not borrow neighbors');
    check(await page.locator('#token-chart .chart-marker').count() === 0, 'Missing minute cannot have measured markers');
    await hoverMinute('token-chart', 0);
    check((await page.locator('#token-chart .chart-tooltip').textContent()).includes('未观测'), 'Unknown usage cannot be zero');
    const retained = await page.locator('#token-chart-detail').textContent();
    await page.waitForTimeout(1700); await page.mouse.move(0, 0);
    check(await page.locator('#token-chart .chart-tooltip').isHidden(), 'Leave must hide floating detail');
    check(await page.locator('#token-chart-detail').textContent() === retained, 'Leave must retain bottom detail');
    await page.locator('#token-chart').focus(); await page.keyboard.press('ArrowRight');
    check((await page.locator('#token-chart-detail').textContent()).includes('输入 Token：12'), 'Keyboard must select real observed minutes');
    await page.keyboard.press('Escape'); check(await page.locator('#token-chart .chart-tooltip').isHidden(), 'Escape must dismiss floating detail');
    injected = {...snapshot, series: snapshot.series.map(row => row.minute === minute ? {...row, inputTokens: 30, outputTokens: 0} : row)};
    await page.waitForFunction(() => document.getElementById('token-chart-detail').textContent.includes('输入 Token：30'));
    check((await page.locator('#token-chart-detail').textContent()).includes('输出 Token：0'), 'Polling must update retained selection and preserve true zero');
    check(await page.locator('#token-chart').evaluate(el => el === document.activeElement), 'Polling cannot destroy keyboard focus');
    const touchBox = await hoverMinute('token-chart', 1);
    await page.locator('#token-chart .chart-overlay').dispatchEvent('pointerdown', {pointerType: 'touch', clientX: touchBox.x + touchBox.width - 4, clientY: touchBox.y + 20});
    check(await page.locator('#token-chart .chart-tooltip').isVisible(), 'Touch must inspect minute values');
    injected = {...snapshot, series: [0, 1, 2].map((i) => ({minute: minute - (2 - i) * 60000, success: [0, 3, 0][i], failed: [1, 0, 1][i], canceled: 0, unavailable: 0, retries: [0, 3, 0][i], inputTokens: [0, 20, 10][i], outputTokens: [0, 5, 2][i]}))};
    await page.waitForFunction(() => document.querySelector('#request-chart [data-series="success"]').getAttribute('d').includes(' C'));
    const sharedScale = await page.locator('#request-chart').evaluate(el => {
      const paths = [...el.querySelectorAll('.chart-line')];
      return paths.length === 5 && !el.querySelector('[data-series="started"]') && paths.every(path => path.getAttribute('d').includes(' C'))
        && el.querySelector('[data-series="success"]').getAttribute('d') === el.querySelector('[data-series="retries"]').getAttribute('d');
    });
    check(sharedScale, 'Five result/retry curves must share a linear scale and preserve common endpoints');
    await hoverMinute('token-chart', 0);
    check((await page.locator('#token-chart-detail').textContent()).includes('输入 Token：0'), 'Measured zero token bucket must remain inspectable');
    await hoverMinute('token-chart', 1);
    check((await page.locator('#token-chart-detail').textContent()).includes('输入 Token：10'), 'Curve tooltip must report measured endpoint, not interpolation');
    result.combinedSmoothSharedScale = true;
    injected = {...snapshot, series: [{minute: minute + 60000, inputTokens: 7, outputTokens: 2}]};
    await page.waitForFunction(() => document.getElementById('token-chart-detail').textContent.includes('已移出'));
    await hoverMinute('token-chart', .5);
    check((await page.locator('#token-chart-detail').textContent()).includes('输入 Token：7'), 'Single bucket must remain inspectable');
    check(await page.locator('#token-chart .chart-marker').count() === 2, 'Single bucket needs exact measured markers');
    injected = {...snapshot, series: []};
    await page.waitForFunction(() => !document.querySelector('#token-chart .chart-overlay'));
    check(await page.locator('#token-chart .chart-tooltip').count() === 0, 'Empty replacement must remove stale floating values');
    check((await page.locator('#token-chart-detail').textContent()).includes('无该分钟观测'), 'Empty replacement must not retain stale measured values');
    injected = snapshot;
    result.pointerAndRetainedDetails = true;
    check((await page.locator('#token-input').textContent()) === '12', 'Input token observation missing');
    check((await page.locator('#retry-wait').textContent()).includes('2,125.5 ms'), 'Planned wait must not become measured waiting');
    check((await page.locator('#history-kept').textContent()) === '12', 'Retained input items missing');
    check((await page.locator('#metric-diagnostics').textContent()).includes('INVALID_SNAPSHOT'), 'Persistence warning missing');
    check((await page.locator('#model-rows').textContent()).includes(malicious), 'Model must render literally');
    check((await page.locator('#error-code-rows').textContent()).includes(malicious), 'Error code must render literally');
    check((await page.locator('#error-kind-chart').textContent()).includes(malicious.slice(0, 80)), 'Error ranking must render bounded untrusted labels literally');
    check((await page.locator('#error-kind-rows').textContent()).includes(malicious), 'Exact category table must retain full literal labels');
    check(await page.locator('#controls img').count() === 0 && !await page.evaluate(() => globalThis.pwned), 'Dynamic metadata executed HTML');
    injected = {...snapshot, totals: {...snapshot.totals, started: 6}, active: [{...snapshot.active[0], elapsedMs: 2234}]};
    await page.waitForFunction(() => document.getElementById('daily-started').textContent === '6');
    await page.locator('nav a[href="/?page=records"]').click(); await visiblePage('records');
    check((await page.locator('#active-rows').textContent()).includes('2,234 ms'), 'Elapsed metrics must refresh without revision change');
    check((await page.locator('#active-rows').textContent()).includes('未知'), 'Missing model/streaming metadata must be named');
    check((await page.locator('#recent-rows').textContent()).includes(malicious), 'Recent metadata must render literally');
    check((await page.locator('#recent-rows').textContent()).includes('已观测'), 'Request usage state missing');
    check((await page.locator('#events').textContent()).includes(malicious), 'Diagnostic events must render literally');
    const scrollRegion = page.locator('#page-records .record-table').first();
    await page.setViewportSize({width: 390, height: 844});
    await scrollRegion.focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#page-records .record-table').scrollLeft > 0);
    injected = {...snapshot, totals: {...snapshot.totals, inputTokens: null, outputTokens: 0, totalTokens: null, cachedInputTokens: null}};
    await page.locator('nav a[href="/"]').click(); await visiblePage('dashboard');
    await page.waitForFunction(() => document.getElementById('token-input').textContent.includes('未观测'));
    check(await page.locator('#token-output').textContent() === '0', 'Measured zero must remain zero');
    injected = undefined;
    await page.waitForFunction(() => document.getElementById('daily-started').textContent.includes('不可用'));
    check((await page.locator('#ttfb-summary').textContent()).includes('未观测'), 'Missing latency must not invent zeros');
    check((await page.locator('#request-chart').textContent()).includes('暂无'), 'Empty chart must be visible');
    if (!only) {
      result.emptyScreenshots = [];
      for (const [width, height, size] of [[1280, 1000, 'desktop'], [390, 844, 'mobile']]) {
        await page.setViewportSize({width, height});
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unavailable metrics horizontal overflow');
        const file = screenshots.replace(/[\\/]$/, '') + '/task-4-unavailable-' + size + '.png';
        await page.screenshot({path: file, fullPage: true}); result.emptyScreenshots.push(file);
      }
    }
    injected = {...snapshot, active: [{requestId: null, model: null}], recent: [{requestId: null, model: null}], latency: {ttfb: {count: 1, sumMs: -1, boundsMs: [], counts: []}}, series: [{minute: null, inputTokens: -1}], totals: {...snapshot.totals, started: 7, inputTokens: -1}};
    await page.waitForFunction(() => document.getElementById('daily-started').textContent === '7');
    check(await page.locator('#token-input').textContent() === '未观测', 'Invalid token number fabricated a measurement');
    check((await page.locator('#ttfb-summary').textContent()).includes('未观测'), 'Malformed histogram fabricated latency');
    await page.locator('nav a[href="/?page=records"]').click(); await visiblePage('records');
    check((await page.locator('#active-rows').textContent()).includes('未知'), 'Partial request metadata must remain unknown');
    await page.locator('nav a[href="/"]').click(); await visiblePage('dashboard');
    injected = {...snapshot, totals: {...snapshot.totals, started: 6}};
    await page.waitForFunction(() => document.getElementById('daily-started').textContent === '6');
    result.safeMetadata = result.metricsRefreshWithoutRevision = result.observedAndUnavailable = true;
  }
  if (!only) {
    result.screenshots = [];
    for (const [width, height, size] of [[1280, 1000, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({width, height});
      for (const [name, href] of [['dashboard', '/'], ['settings', '/?page=settings'], ['records', '/?page=records'], ['help', '/?page=help']]) {
        await page.locator('nav a[href="' + href + '"]').click(); await visiblePage(name);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), size + ' horizontal overflow: ' + name);
        const file = screenshots.replace(/[\\/]$/, '') + '/task-4-' + name + '-' + size + '.png';
        await page.screenshot({path: file, fullPage: true}); result.screenshots.push(file);
      }
    }
    result.mobileLayout = true;
  }
  check(errors.length === 0, errors.join('\n')); result.pageErrors = errors;
  return result;
}
