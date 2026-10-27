# Dev Console Verification - 2026-10-27

## Scope

Windows 11 x64 (10.0.22631), Node v24.12.0. Local development on `dev`, starting
from `cd68b07`. Tests use temporary Codex TOML files, isolated runtimes and local
mock HTTP/SSE upstreams. No paid models, real client takeover, legacy service stop,
remote push, merge or GitHub Actions execution.

## Initial Results (Before Portable Configuration)

- Baseline: 58 existing tests passed.
- Final `npm test`: 107 passed, 0 failed, 0 skipped.
- Policy tests cover three cleanup choices, each of seven recovery handler gates,
  frozen request revisions, compressed bypass bytes, invalid JSON bypass, immediate
  unbuffered delivery, late failure without replay, heartbeat OFF and active upload.
- Controller/API tests cover inert startup, attach/disable/disconnect, invalid and
  stale settings, atomic save failure, occupied/unowned port refusal, exact restore,
  preservation of user changes, recovery journal, active requests, failed restore,
  token/Host/Origin/cross-site/body-size rejection and abandoned exit responses.
- Launcher tests cover repeated launch, authenticated exit, unresponsive live owner,
  argument validation, refusal to overwrite a foreign legacy runtime, crash/reopen.
- Independent read-only reviews found three ownership/lifecycle issues; all were
  reproduced in failing regressions, fixed, retested and re-reviewed before commit.
- Browser checked desktop 1440px and mobile 390px; no horizontal mobile overflow.
  Verified one core switch, nine checkboxes, three radios, persistence after reload,
  invalid port feedback, actual fixture attach/mode/bypass/restore, buffering warning
  and dependency state, and packaged UI exit. Screenshots in ignored `.verification`.
- `npm run smoke:exe` passed with PATH excluding Node: embedded UI served, second
  launch reused the first PID, fixture requests were cleaned in always mode, raw
  bytes passed with core OFF, exact client address restored, process exited cleanly.
- EXE: `dist/MagpieFilter.exe`, 90,172,928 bytes (86.00 MiB), GUI subsystem 2.
- EXE SHA256: `f72f6edff90352ddf1c0ed864e9534db01cd3b5c6296487ece62ee412299b064`.
- Authenticode: NotSigned. Included Node license matches the build runtime.
- Dependency install audit reported 0 vulnerabilities; no production npm dependencies.

## Portable Configuration Acceptance

- Final `npm test`: 123 passed, 0 failed, 0 skipped.
- Fixed regressions for BOM config relaunch, pending token rotation and unpublished
  recovery errors. Occupied-port automatic activation stays diagnosable and allows
  correction without abandoning the management console.
- Config tests cover saved enabled startup, atomic persistence, external-edit
  rejection, web/filter/upstream port conflicts and restart-pending web settings.
- Independent review fixes were rechecked: policy saves no longer disable manual
  re-login after 403; browser-failure fallback points to the active credential cache
  rather than a pending inactive token. Credentials are not printed in that message.
- Isolated packaged Chromium smoke covers wrong/correct manual tokens, persistence
  after reload, invalid port, fixture attach/mode/bypass/restore, pending rotation,
  policy-save -> 403 -> manual re-login without reload, and authenticated exit.
  Desktop 1280px and mobile 390px screenshots checked; no page errors or overflow.
- `node scripts/smoke-exe.cjs dist/portable/MagpieFilter.exe` passes with PATH
  excluding Node. Covers fixed configured port, embedded assets, singleton,
  non-default filter port, exact mock restore, pending web port/token rotation,
  manually edited enabled startup and unchanged saved preference on exit.
- Separate copied-EXE check without `--runtime` confirms config and runtime resolve
  beside the EXE, not the current working directory. Uses a temporary workspace
  directory and a generated OFF configuration with an available web port.
- Windows ShellExecute dispatch accepted; standalone probe received browser HTTP
  requests. Packaged fixture also dispatched the default browser. This does not
  certify every Windows HTTP association or a clean second machine.
- Current EXE: `dist/portable/MagpieFilter.exe`, 90,185,216 bytes (86.01 MiB).
- SHA256: `06b5151c3239746748c7b70d2538cbe37e6c0418bba3ade2c11729b3d511da5d`.
- Authenticode: NotSigned. Built separately to preserve the running original EXE.
- User confirmed launching the portable build during handoff; its generated config
  and runtime are user-owned and were not modified or stopped by verification.

## Limitations

- Not verified on a clean second computer, against real Magpie/model accounts, or
  through the user's active Codex configuration. Performance/RSS was not benchmarked.
- Browser association dispatch and isolated packaged behavior are verified locally;
  actual user-session routing and browser behavior on other machines remain unverified.
- Full-buffer mode retains first-text latency in exchange for late-error recovery.
  Unbuffered/bypass modes intentionally do not provide the same replay protections.
- No WebSocket, Claude Code, auto-start, tray icon, auto-update or code signing.
- Dead-owner lock tombstones are retained as small identity records for race safety.
  A crash before a valid owner file is published requires manual diagnosis, not an
  unsafe guess that an unknown lock can be removed.
- State/diagnostic artifacts are private local files, not distributable source.
