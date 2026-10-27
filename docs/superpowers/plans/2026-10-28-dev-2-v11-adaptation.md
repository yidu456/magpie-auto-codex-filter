# Magpie dev-2 V11 Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt V11 recovery, protected streaming and metrics without regressing current Magpie behavior, with theme-matched separate console pages and a separate EXE.

**Architecture:** Extend the current proxy/policy and authenticated controller; optional observer events feed one controller-owned recorder. Keep the existing HTML/CSS/JS shell and use query-based page navigation; do not add a server or dependencies.

**Tech Stack:** CommonJS, Node.js 24.12+, native node:test, HTTP loopback fixtures, plain HTML/CSS/JS, SVG, existing SEA build tooling.

**Spec:** docs/superpowers/specs/2026-10-27-dev-2-v11-adaptation-design.md

## Global Constraints

- Work sequentially in the supplied checkout on literal `dev-2`. Keep `dev` unchanged; no worktree, push or merge.
- Never change real Codex/Magpie configuration, stop user processes, invoke paid models or overwrite existing EXEs/config/runtime.
- Build only `dist/dev-2/MagpieFilter.exe`. Keep runtime dependency-free, Node.js 24.12+.
- Old version-1 config loads without rewrite; defaults stay core OFF and full buffering. Old unbuffered stays direct.
- Preserve Magpie store/context/compaction delegation, conditional invalid_encrypted_content cleanup, tool pairs, policy snapshots and handler exclusions.
- Same per-kind retry budgets, 20 extra attempts total, 30-minute deadline and Retry-After floor; no replay after output.
- No request/response bodies, secrets or tool arguments/results in metrics/logs. Optional observers cannot break requests.
- Charts match the current light blue/teal theme. Dashboard, request records and usage instructions are separate navigable pages.
- Use TDD, full regression runs, independent task review, and a local commit for each verified deliverable. Do not spawn nested workers or touch parent planning files.

### Task 1: Bounded relay recovery and original JSON bytes

**Files:** Modify `magpie-auto-codex-filter/proxy.cjs`; create `magpie-auto-codex-filter/relay.test.cjs`.

**Interfaces:** Preserve makeProxy/filterResponsesRequest exports and existing policy shape. Consume transport/streamIncomplete/azureResource/encryptedContent/availability handler flags. No downstream interface additions in this task.

- [ ] Write loopback tests which first receive a recoverable error and then success; separately test excluded errors and switches. Use test-support listen/close/call helpers. Hand-derived expectations include HTTP wrapped stream_disconnected and JSON gateway 502 => 2 upstream attempts; HTTP 401/403, quota, auth, invalid parameters, invalid_encrypted_content on 5xx, HTML/text/array/null 5xx => 1; disabled transport => 1; conditional HTTP400 encrypted history => 2. Include SSE gateway errors with transport disabled and no fallback to streamIncomplete.

```js
const cases = [
  [502, {error:{code:'cc_switch_upstream_error',message:'relay failed'}}, 2],
  [400, {error:{code:'stream_disconnected',message:'stream disconnected before completion'}}, 2],
  [503, {error:{code:'insufficient_quota',message:'quota exhausted'}}, 1],
  [500, {error:{code:'invalid_encrypted_content',message:'history invalid'}}, 1]
];
```

- [ ] Run `node --test magpie-auto-codex-filter/relay.test.cjs` and record expected red results.
- [ ] Implement exclusions before generic fallback, keeping targeted Azure/encrypted cleanup exceptions. Use `transport` for HTTP transport and SSE explicit cc_switch_forward_failed/bad_response/server_error; retain existing handlers for remaining categories. Do not mutate or reclassify disabled categories. Preserve decoded raw bytes for non-always cleanup:

```js
body = policy.cleanup === 'always' ? Buffer.from(JSON.stringify(filtered.body)) : raw;
```

- [ ] Add exact-byte tests for conditional and never modes, including noncanonical whitespace and gzip input, without changing core-OFF behavior. Run focused tests then `npm test`, review the diff, commit `fix: adapt bounded relay recovery and preserve request bytes`.

### Task 2: Protected SSE streaming and observer events

**Files:** Modify `magpie-auto-codex-filter/proxy.cjs`, `magpie-auto-codex-filter/policy.cjs`, related policy/config tests; create `magpie-auto-codex-filter/streaming.test.cjs`. A focused SSE helper file is allowed if it keeps parser state bounded and shared without duplicating forwarding logic.

**Interfaces:** Add optional `protectStreamStart: boolean = false` to normalizePolicy. Add optional makeProxy `observe(event, data)` callback, isolated from forwarding errors. Events required downstream: request-started (requestId, model, enabled, streaming, policyRevision), filtered/history-preserved (kept, removed, removedItemIds), history-cleanup, forwarded (ttfbMs, status), response-usage (usage), retry-scheduled/dispatched/accepted/exhausted, http-error/stream-error/transport-error, request-progress (phase), request-finished (outcome,durationMs). Preserve existing log callbacks; emit each observation once. Controller will namespace proxy-local request IDs at integration.

- [ ] Write failing tests for default old config behavior, early Azure/gateway recovery with protected mode, first delta before completion, no late replay/cleanup, completion without delta and usage once. Include fragmented UTF-8/CRLF frames, null/array/untyped SSE, event-looking text, malformed/oversized passive frames, gzip, cancel/deadline, observer exceptions and full-buffer precedence.

```js
const protectedPolicy = {bufferResponse:false, protectStreamStart:true};
assert.equal(normalizePolicy({bufferResponse:false}).protectStreamStart, false);
```

- [ ] Run focused tests and observe RED. Implement bounded SSE state transitions: inspect prelude -> forward once -> passive terminal/usage inspection; full mode retains entire-round semantics. No unbounded complete-response retention after delivery. Use pipe/backpressure and drain-aware prelude handling. Preserve original direct response bytes, including compressed bytes; passive inspection, if any, must not alter forwarding.
- [ ] Emit lifecycle observations including uploads, rejected/failed/canceled requests and core bypass. Do not claim a directly forwarded SSE failed/completed based on HTTP200 alone. Skip usage parsing for core OFF; stream observation overflow must remain bounded and visible as unavailable metadata rather than fabricate success/usage.
- [ ] Extend tests for existing policy snapshots, enabled handlers, heartbeat only during protected pre-output/full wait, incomplete streams and zero active count. Run focused tests then `npm test`, review, commit `feat: add compatible protected response streaming`.

### Task 3: Recorder, persistence and asynchronous console logging

**Files:** Create `console/metrics.cjs`, `console/metrics.test.cjs`, `console/log-writer.cjs`, `console/log-writer.test.cjs`; modify `console/controller.cjs`, `console/controller.test.cjs`, `console/server.test.cjs` as needed.

**Interfaces:** `createRecorder({now = Date.now} = {})` returns `observe(event,data)`, `snapshot()`, `serialize()`, `hydrate(saved)`. Use the event contract from Task 2; snapshot includes date, totals, retry, errorsByCode/errorsByKind, latency histograms, series, active, recent. `createLogWriter(filename, options)` returns `write(line)`, async `flush()`, diagnostics; controller owns disposal/flush and per-minute persistence. `controller.status()` adds metrics and diagnostics without changing revision/settings/web semantics.

- [ ] Write failing lifecycle, cross-midnight, bounds, hydration and privacy tests with injected time. Assert hand-derived counts:

```js
recorder.observe('request-started', {requestId:1,model:'mock',enabled:true});
recorder.observe('forwarded', {requestId:1,ttfbMs:10,status:200});
recorder.observe('request-finished', {requestId:1,outcome:'success',durationMs:30});
assert.equal(recorder.snapshot().totals.success, 1);
```

- [ ] RED, then implement bounded sanitized metadata, 180 minute buckets and 200 recent records. Bound error-code/model dimensions and persisted snapshot size; validate finite nonnegative counts and object schemas; ignore/report corrupt snapshots without blocking startup. Tokens reflect only observed valid response.completed usage; missing/bypass usage stays null/unavailable. Retry recovered counts require final success. Attribute events at midnight correctly and preserve in-flight records. Keep observer failures isolated.
- [ ] Write failing log tests for batching, ordered flush, rotation, I/O errors, queue bounds and queued close. Implement serialized asynchronous appends/rotation, retained existing log limits, bounded queue and diagnostics. Never write request bodies.
- [ ] Integrate recorder outside proxy creation so detach/reconnect retains totals; namespace request IDs per proxy instance. Hydrate same-day `metrics.json`, atomically save once/minute and close; diagnostics nonfatal and secrets excluded. Stop timer and drain logs on close only after safe config restore; failed restore keeps service usable.
- [ ] Test management authentication still protects metrics, revision independence, reconnect ID collisions, old configuration read without rewrite and normal close persistence. Run focused tests then `npm test`, review, commit `feat: integrate bounded console metrics and async logs`.

### Task 4: Theme-matched charts and separate pages

**Files:** Modify `console/ui/index.html`, `console/ui/app.js`, `console/ui/app.css`, `console/assets.cjs`, asset/server tests and `scripts/browser-smoke.js`; add a focused UI metrics module/test only if needed and wire SEA assets if added.

**Interfaces:** Consume status.metrics/diagnostics from Task 3. Navigation routes are `/`, `/?page=records`, `/?page=help`. Use the same static shell and existing authenticated `/api/state`; whitelist query pages, preserve token fragment login independently. Three delivery selector values map to the booleans from Task 2.

- [ ] Add failing route/UI regression checks for valid direct page loads and unknown paths, protected delivery save/reload, login after save, metrics changes without settings revision change, and safe text rendering. Use isolated fixture and real browser for UI behavior; do not rely only on source-string assertions.

```js
const modes = {
  full:{bufferResponse:true,protectStreamStart:false},
  protected:{bufferResponse:false,protectStreamStart:true},
  direct:{bufferResponse:false,protectStreamStart:false}
};
```

- [ ] Implement separate dashboard/records/help page panels with URL history/back/forward, refresh/direct links, aria-current, focus handling, and accessible mobile links. Keep all controls on dashboard, active/recent/events on records, detailed guidance on help. Keep operational notices near relevant controls, not long help content on home.
- [ ] Replace buffering checkbox with delivery selector; preserve existing cleanup and handlers, widen transport description to actual recovery coverage. Bind heartbeat availability to full/protected. Keep form dirty state, pending web settings and manual re-login behavior intact.
- [ ] Render native SVG charts using current CSS variables (light blue/teal, no upstream dark theme), daily KPIs, latency distributions, tokens, retry effects and error tables. Add visible empty/unavailable states, textual values and no unsafe HTML for dynamic strings.
- [ ] Run `npm test`; use isolated browser fixture at desktop and 390px for all three pages, direct/reload/back, charts and long text, no overflow, malicious model/error text literal, policy changes and pending token rotation. Inspect screenshots. Review, commit `feat: split console pages and add theme-matched metrics`.

### Task 5: Packaged regression, documentation and handoff

**Files:** Modify `scripts/smoke-exe.cjs` or add narrowly scoped packaged smoke coverage, `README.md`, `SHA256SUMS.txt`, `package.json` version only if useful; build ignored `dist/dev-2` artifacts.

**Interfaces:** Existing build({outputDirectory}) and fixture helpers remain authoritative; keep user-running old outputs untouched.

- [ ] Extend isolated EXE tests for loading a literal old config and selecting protected streaming, separate pages, metrics restore, bypass and exact config restoration. Add tests before changes to any test fixture helpers; no real client or paid service calls.
- [ ] Build and smoke using:

```powershell
node -e "require('./scripts/build.cjs').build({outputDirectory:'dist/dev-2'}).catch(e=>{console.error(e);process.exitCode=1})"
node scripts/smoke-exe.cjs dist/dev-2/MagpieFilter.exe
```

- [ ] Run complete tests, source manifest checks, packaged browser acceptance, copied-EXE alternate cwd/no-Node-PATH startup, singleton, pending token/port rotation, config read without rewrite and exact endpoint restoration. Confirm unsigned status and hash; do not launch the output against real config.
- [ ] Document new behavior, page navigation, usage measurement limits, default compatibility, rollback pair and safe manual transition. Commit source/tests/docs, perform final branch review, fix reviewed regressions and rebuild if production code changed. Leave dev-2 local/unmerged and deliver exact EXE path/test evidence.
