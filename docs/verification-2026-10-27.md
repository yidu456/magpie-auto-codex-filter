# Dev Console Verification - 2026-10-27

## Scope

Windows 11 x64 (10.0.22631), Node v24.12.0. Local development on `dev`, starting
from `cd68b07`. Tests use temporary Codex TOML files, isolated runtimes and local
mock HTTP/SSE upstreams. No paid models, real client takeover, legacy service stop,
remote push, merge or GitHub Actions execution.

## Results

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

## Limitations

- Not verified on a clean second computer, against real Magpie/model accounts, or
  through the user's active Codex configuration. Performance/RSS was not benchmarked.
- Browser startup is implemented through the Windows shell; automated packaged
  smoke uses `--no-open` and opens the returned management origin in a controlled
  browser. A real Explorer double-click/default-browser acceptance check remains.
- Full-buffer mode retains first-text latency in exchange for late-error recovery.
  Unbuffered/bypass modes intentionally do not provide the same replay protections.
- No WebSocket, Claude Code, auto-start, tray icon, auto-update or code signing.
- Dead-owner lock tombstones are retained as small identity records for race safety.
  A crash before a valid owner file is published requires manual diagnosis, not an
  unsafe guess that an unknown lock can be removed.
- State/diagnostic artifacts are private local files, not distributable source.
