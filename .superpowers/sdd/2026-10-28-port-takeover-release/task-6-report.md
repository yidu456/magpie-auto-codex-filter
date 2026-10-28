# Task 6: Optional local management authentication

Base: `8f8263a`, literal `dev-2`. Implements the latest default-off, enableable-auth request; no removal of internal proxy/admin/provider credentials.

## Configuration and runtime schema

- Version remains 1. New files contain `web: {port:18185, authEnabled:false, token:<random 64-hex>}`. A valid generated token is retained for later opt-in, never returned by an API.
- Legacy version1 files missing `web.authEnabled` normalize to `true` in memory. Reading preserves original bytes including BOM/spacing/newlines; no migration write. Explicit booleans only; null, strings, arrays, objects and numeric flags fail without rewriting the file. Normal save can materialize the normalized flag.
- `POST /api/web` remains `{revision, web:{port, authEnabled?, token?}}`. Omitted auth/token preserve configured values; unknown fields, invalid flags/token/ports, stale revision, external file edits and connection-port conflicts retain existing guards. Successful saves increment revision and invalidate port consent.
- Startup captures the immutable active web port/token/auth flag. Web saves do not change the running listener, required authentication or token. Normal stop/start is necessary, not duplicate launch.
- `/api/state` has `web:{port,activePort,authEnabled,activeAuthEnabled,restartRequired}`. `restartRequired` compares all three configured/active web values. There is no token in state.
- `service.json` has `{service,pid,instance,origin,authEnabled}` plus `token` only when active auth is on. Pending configured changes leave that record unchanged. Missing runtime auth flag is protected; malformed flags fail verification. Singleton checks still validate service/instance/PID and bounded state (8 MiB/1 second).
- Duplicate launch follows active runtime mode, not newly configured flag; off never reads/sends a fallback token. Browser launch uses `/` when off, `/#token=<active token>` only when protected (legacy records included).

## API and UI

- Same-host `GET /api/auth` returns exactly `{authRequired:boolean}`. It does not call controller status or return config, state, identity or tokens. Host, Origin and Sec-Fetch-Site checks run first. Wrong methods follow ordinary route/auth boundaries.
- Management auth off accepts requests without `x-console-token`; on retains timing-safe token checks. Both retain loopback binding, exact Host/Origin/Fetch metadata guards, JSON content type, 32 KiB limit, mutation/revision serialization, recovery ownership and one-use opaque port consent. Core/filter ownership stop tokens and provider keys are untouched.
- UI first discovers active auth without credentials. All four pages direct-load when off. Old token fragments are immediately stripped while retaining query; off clears stale sessionStorage and never saves/sends the fragment. Protected mode keeps manual/fragment login; successful fragment state verification precedes token storage. Off-mode 403 reports the actual trust error, not a login loop.
- Settings adds `web-auth-enabled` checkbox and explicit warning: off permits local programs to call management operations. `web-token-field` is hidden while the configured checkbox is off; password input stays masked. Hint distinguishes current and next-start auth and pending restart. No homepage controls added.

## TDD and verification

RED, before implementation:

1. `node --test --test-concurrency=1 console/configuration.test.cjs console/server.test.cjs`: 6 expected failures (missing default/legacy flag, rejected explicit booleans, absent discovery/off API); GREEN 11/11.
2. Launcher targeted RED: 4 expected failures (no runtime flag/token omission, off verifier rejected, off URL leaked fragment). Real child restart GREEN exercises off -> save auth on/token -> duplicate -> restart -> old token denied -> save auth off/new token -> duplicate -> restart -> no cached token.
3. `node scripts/run-optional-auth-browser.cjs` RED observed existing off-mode fragment saved in sessionStorage; later protected login visibility error caught and corrected. Final GREEN covers both real restarted modes and all four pages at desktop/mobile widths.

Commands (installed Chrome headless; `PLAYWRIGHT_MODULE=C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`):

- `npm test`: 386 tests, 384 passed, 0 failed, 2 platform skips, 172.9 seconds. Log `.verification/task-6-npm-test.log`. Includes production native Windows owned-child consent in auth-on and auth-off modes, cancel preservation and one confirmed tracked kill per fixture, exact restore, internal proxy/CLI regressions and source manifests.
- `node scripts/run-browser-smoke.cjs`: GREEN protected four-page desktop/mobile navigation, manual/fragment login, pending rotation, policy drafts/re-login, mock filter/bypass/restore, metrics and safe metadata; no page errors. Log `.verification/task-6-protected-browser.log`.
- `node scripts/run-port-conflict-browser.cjs`: GREEN yes/no/Escape, stale revision/409, auth403 re-login, unsafe owner, pending double click, startup explicit action, no page errors; exactly one owned fixture child termination. Log `.verification/task-6-consent-browser.log`.
- `node scripts/run-optional-auth-browser.cjs`: GREEN defaultoff four pages desktop/mobile, no off credential, old fragment/session cleanup, off403 no login loop, off one-use consent/Escape, enable/disable real restarts, protected manual/fragment login/four pages, pending token rotation/singleton, no token/state leak or page errors. Log `.verification/task-6-optional-browser.log`.
- `node --test scripts/source-manifest.test.cjs` and `git diff --check`: GREEN after final public SHA update. New public harness included; private task report excluded.

Scoped self-review checks validation/fail-closed defaults, active/configured separation, token cache disclosure, discovery ordering, production facade, restart/singleton paths, UI consent without token, accessibility, cleanup and compatible fixtures. Parent performs independent review. Existing protected fixture explicitly sets auth on; packaged smoke now checks legacy-on and copied explicit-off, but rebuilt executable execution is deferred.

## Deferred and residual risks

- No build or packaged execution, no release/remote/native Unix execution, no branding or forced-disconnect code. Existing EXEs/configs/processes/models remain untouched. Unix listener/archive tests are the two Windows skips. Task7 must rebuild final artifacts before claiming packaged auth support.
- Observed existing management-exit lifecycle limitation: with a live Chromium speculative connection pool, API `/api/exit` returns `{exiting:true}` but `main.cjs` can remain awaiting `server.close()` with `service.json` present for more than 15 seconds. Navigating away alone did not suffice; closing the browser pool allowed ordinary clean exit/restart. The auth restart harness therefore closes its owned browser before API exit, matching the established browser runner. No shutdown semantics changed here; carry this concrete lifecycle risk into Task8/final acceptance. Cleanup preserves primary errors and attempts every owned child/resource cleanup even if browser close fails.
- Off is intentionally less protected against local programs, not LAN binding: UI/docs warn about this. No generated token is exposed over discovery/state or off runtime cache.
