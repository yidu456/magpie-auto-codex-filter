# Magpie Web Console Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. User requests sequential implementation and a commit after each completed task.

**Goal:** A local Chinese browser console and Windows EXE with live policies and independently selectable recovery handlers.

**Architecture:** Keep the existing proxy and configuration router. Separate immutable runtime policy from gateway identity, add an in-process controller and authenticated loopback management server, then embed the static UI in a single-executable launcher.

**Tech Stack:** Node.js 24.12+, CommonJS, node:test, HTTP, HTML/CSS/JavaScript; esbuild/postject only for building.

**Spec:** `docs/superpowers/specs/2026-10-27-web-console.md`

## Global Constraints

- Literal `dev` branch; sequential tasks; commit each verified deliverable; do not push.
- Windows, Node.js 24.12 or newer; no production npm dependencies.
- Codex + Magpie only; do not touch real client configuration or running services during development.
- Keep legacy CLI entry points and default behavior; no broad cleanup/error matching.
- Default core OFF on every process launch. Remember preferences, not activation.
- Exact recovery before disconnect/exit; never kill unknown processes.
- No paid model requests; mock upstreams and temporary fixtures only.
- Checkboxes do not disable trust-boundary validation, budgets, cancellation or tool-pair integrity.

## File map

- Existing `proxy.cjs`: per-request policy, selected retry gates, bypass and streaming.
- New `policy.cjs`: strict validation/defaults and immutable snapshots.
- New `console/controller.cjs`: settings, proxy lifecycle, exact config recovery and event history.
- New `console/server.cjs`: authenticated management API and whitelisted static assets.
- New `console/main.cjs`: CLI/EXE launcher, singleton identity, browser opening and runtime paths.
- New `console/ui/{index.html,app.css,app.js}`: browser control surface.
- Tests alongside modules; existing fixtures stay under the ignored test runtime.
- `scripts/build.cjs`, `package.json`, lockfile, Windows build workflow: reproducible EXE.

## Task 0: Plan and clean baseline

- [x] Read source, applicable instructions and prior assessment; create `dev` from clean `main`.
- [x] Run legacy tests: 58 passed, 0 failed.
- [x] Record approved scope, checkbox matrix, security boundaries and interfaces.
- [ ] Self-review plan against spec; commit `docs: plan local web console development`.

## Task 1: Immutable runtime policy and granular recovery

**Files:** create `magpie-auto-codex-filter/policy.cjs`, `policy.test.cjs`; modify `proxy.cjs`; add `policy-proxy.test.cjs`.

**Interfaces:** `normalizePolicy(value, mode='magpie-auto')` returns frozen `{enabled, cleanup, handlers, bufferResponse, heartbeat, revision}`; `makeProxy({getPolicy,...})` reads exactly once per model request; missing getter retains CLI defaults. Handlers have the seven keys in the spec. `server.stats` exposes existing counters to its owning controller.

- [ ] Write failing validation and actual mock-upstream tests: never/always/conditional; each disabled handler; invalid fields; in-flight policy snapshot during backoff.

```js
assert.throws(() => normalizePolicy({handlers: {unknown: true}}));
assert.throws(() => normalizePolicy({enabled: 'false'}));
// Mock HTTP429 once: disabled rateLimit -> 429, exactly one upstream call.
// Gate old request before retry, update getPolicy, release: old request retains its policy.
```

- [ ] Run `node --test magpie-auto-codex-filter/policy*.test.cjs`; confirm missing policy fails.
- [ ] Implement strict own-key/type validation; capture before body read; gate `schedule` by handler, preserve error classifiers/budgets; log revision on request-start.

```js
const policy = normalizePolicy(getPolicy?.(), mode);
const cleaningMode = policy.cleanup === 'always' ? 'ccswitch' : 'magpie';
// schedule() gets an explicit handler when transport/ALB/SSE share a budget.
```

- [ ] Run all tests and inspect diff; update progress; commit `feat: add hot runtime policies and recovery switches`.

## Task 2: Core bypass and optional streaming/heartbeat

**Files:** modify `proxy.cjs`; extend `policy-proxy.test.cjs`.

**Interfaces:** `enabled=false` preserves request body bytes and content encoding; removes only routing/hop-by-hop headers. `bufferResponse=false` bypasses SSE inspection, never replays once headers/output are forwarded. `heartbeat=false` disables synthesized progress only.

- [ ] Add failing tests for invalid-JSON passthrough, gzip byte equality, immediate SSE delivery before mock completion, late failure without replay, core snapshot while uploading, no synthetic heartbeat when disabled.

```js
// Upstream writes a first frame and waits on a test gate.
// The downstream must receive it before releasing completion when buffering is OFF.
assert.equal(upstreamAttempts, 1); // including a late response.failed
assert.deepEqual(receivedBytes, sentCompressedBytes); // core OFF
```

- [ ] Run targeted tests, confirm failure; implement bypass using existing forwarding/cancellation path, bounded raw request reading and preserved routing validation.
- [ ] Run all tests, review against legacy tests; commit `feat: add core bypass and selectable stream buffering`.

## Task 3: Controller and secure management API

**Files:** create `console/controller.cjs`, `console/server.cjs`, `console/controller.test.cjs`, `console/server.test.cjs`.

**Interfaces:** `createController({runtime})` -> `{status(), update({revision,settings}), disconnect(), close()}`. `status` returns `{settings,revision,attached,state,stats,events}` without auth/body data. Settings include `{client:'codex',configPath,upstream,port,policy}`; activation is in `policy.enabled`. `createManagementServer({controller,token,assets,onExit})` returns an unbound HTTP server. API `GET /api/state`, `POST /api/settings`, `POST /api/disconnect`, `POST /api/exit`; header `x-console-token`.

- [ ] Test new controller is inert, first enable attaches only fixture addresses, disable preserves attachment and bypasses, disconnect restores exact addresses, failures preserve ownership, restart recovery, endpoint changes while attached rejected, stale revision rejected.

```js
assert.equal(fs.readFileSync(config, 'utf8'), original); // before enable
await controller.update({revision: 0, settings: configured});
await controller.disconnect();
assert.equal(fs.readFileSync(config, 'utf8'), original);
```

- [ ] Test management auth/Origin/Host/cross-site/body limit/unknown paths and keys; API never returns its token or request payload.
- [ ] Run failing tests; implement controller using stable `mode='magpie-auto'`, ConfigRouter, journal-before-attach, atomic settings, serialized API mutations and bounded events.
- [ ] Run all tests and review recovery/error paths; commit `feat: add secure local console service and configuration recovery`.

## Task 4: Chinese browser control surface

**Files:** create `console/ui/index.html`, `app.css`, `app.js`; add UI integration coverage to server tests and browser smoke script.

**Interfaces:** UI uses only documented API, sessionStorage token from fragment, full settings + expected revision per save. Every switch displays saved/effective state and disabled dependencies; dirty forms are not overwritten by status polling.

- [ ] Add server asset delivery/security tests and browser assertions for labeled core switch, mode radios, nine checkboxes, error feedback and saved setting round-trip.

```js
// Browser: uncheck rate limit, save, reload, assert unchecked and persisted API value.
// Browser: set invalid port, assert error and unchanged active settings.
// Browser: at 390px width assert document.scrollWidth <= innerWidth.
```

- [ ] Implement compact responsive UI using spec tokens, no CDN or UI dependencies, safe textContent rendering.
- [ ] Verify keyboard interaction and desktop/mobile screenshot; run test suite; commit `feat: add responsive Chinese filter control panel`.

## Task 5: Launcher and single Windows EXE

**Files:** create `console/main.cjs`, `console/launcher.test.cjs`, `scripts/build.cjs`, build smoke tests, `package.json`, lockfile, `.github/workflows/windows-build.yml`; update `.gitignore`.

**Interfaces:** `node console/main.cjs [--runtime PATH] [--no-open]` starts console with core OFF; same EXE args work. Default runtime under LOCALAPPDATA/MagpieFilterConsole; `--runtime` permits isolated tests. `--no-open` is for explicit headless testing. SEA embeds UI through build-time asset bundling. Singleton record uses process identity/token/management URL; mismatched or live-unresponsive records fail safely.

- [ ] Add launcher integration test using spawned real process, fixture runtime, authenticated exit and second-launch PID equality.
- [ ] Implement launch locks, stale-process verification, browser opening without shell interpolation, graceful signals and exact cleanup.
- [ ] Pin build dependencies, bundle one CJS entry, generate SEA blob, inject into copied node.exe, set GUI subsystem with validated PE offsets, write SHA256 and license artifacts.

```powershell
npm ci
npm run build
node --test console/launcher.test.cjs
node scripts/smoke-exe.cjs dist/MagpieFilter.exe
```

- [ ] Verify packaged no-Node startup, duplicate launch and safe exit with isolated runtime; commit `build: package local console as a Windows executable`.

## Task 6: End-to-end validation and handoff

**Files:** update README, source integrity manifest, plan/progress; fix any verified defects with regression tests before final commit.

- [ ] Run all node tests; repeat packaged lifecycle and browser round-trip using only fixtures/mock server.
- [ ] Review full diff for auth leaks, shared-state races, stale backups, unsupported claims and CLI regressions.
- [ ] Document exact start/stop behavior, checkbox limits, legacy-service conflict, first-client-restart caveat, unsigned EXE and measured artifact size.
- [ ] Regenerate SHA256SUMS from tracked release source (excluding runtime/artifacts); verify all entries and `git diff --check`.
- [ ] Commit `docs: verify dev console and document safe usage`; report commits, tests, artifact and remaining real-client verification gap. Leave `dev` unmerged/unpushed.
