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
  if (!only || only === 'navigation') {
    await visiblePage('dashboard');
    check(await page.locator('#connection-form').isHidden() && await page.locator('#delivery-mode').isHidden(), 'Home must show charts/core only, not other settings');
    check(await page.locator('#page-dashboard input, #page-dashboard select, #page-dashboard button').count() === 1, 'Home contains controls other than core switch');
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
    await go('dashboard'); await page.locator('#enabled').click();
    check((await page.locator('#notice').textContent()).includes('先保存'), 'Core ON accepted unsaved connection');
    check(!await page.locator('#enabled').isChecked(), 'Core ON did not roll back');
    await go('settings'); await page.locator('#upstream').fill(fixture.settings.upstream); await page.locator('#save-connection').click(); await settled();
    await go('dashboard'); await page.locator('#enabled').check();
    await page.waitForFunction(() => document.getElementById('connection-state').textContent === '配置已接入');
    await go('settings'); check(await page.locator('#port').isDisabled(), 'Connected port must not be editable');
    await page.locator('[name=cleanup][value=never]').check(); await settled();
    check(await page.locator('[data-handler=encryptedContent]').isDisabled(), 'Cleanup handler exclusion lost');
    await go('dashboard'); await page.locator('#enabled').uncheck(); await settled();
    check((await page.locator('#core-description').textContent()).includes('直通'), 'Bypass guidance missing');
    await go('settings'); await page.locator('#disconnect').click(); await settled();
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
    snapshot.errorsByCode = {[malicious]: 2, rate_limit_exceeded: 1}; snapshot.errorsByKind = {transport: 2, rateLimit: 1}; snapshot.byModel = {[malicious]: 3, other: 2};
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
    check(await page.locator('#ttfb-chart svg rect').count() === 8, 'Native histogram must render all eight observed bins');
    check((await page.locator('#token-input').textContent()) === '12', 'Input token observation missing');
    check((await page.locator('#retry-wait').textContent()).includes('2,125.5 ms'), 'Planned wait must not become measured waiting');
    check((await page.locator('#history-kept').textContent()) === '12', 'Retained input items missing');
    check((await page.locator('#metric-diagnostics').textContent()).includes('INVALID_SNAPSHOT'), 'Persistence warning missing');
    check((await page.locator('#model-rows').textContent()).includes(malicious), 'Model must render literally');
    check((await page.locator('#error-code-rows').textContent()).includes(malicious), 'Error code must render literally');
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
