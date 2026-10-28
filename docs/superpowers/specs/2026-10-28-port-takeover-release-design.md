# Confirmed Port Takeover and Native Releases

## Approval and Baseline

User approved the in-chat design with "continue" on 2026-10-28. Baseline cac5e33 on literal dev-2; fresh327/327 tests pass. This extends, not replaces, the completed V11 adaptation. Keep dev unchanged and work sequentially in the supplied checkout.

## Safety and Compatibility

- Preserve live user configurations/processes and existing dist/portable and root dist artifacts. Development termination tests may target only explicitly created fixture children. No real port takeover, remote push/tag/release, signing credential use or privilege elevation during this task.
- Keep core filtering, retry bounds, policy snapshots, four pages, protected management API, portable configuration and recovery ownership unchanged except the explicitly confirmed conflict flow.
- New local builds use dist/phase13 and never overwrite delivered dist/dev-2. Runtime remains dependency-free; reuse Node24.12.0, esbuild and postject.

## 1. Port Occupancy and Consent

Only an actual EADDRINUSE while creating a fresh filter listener can offer takeover. No general-purpose kill endpoint or client-supplied PID is accepted. Preserve config/recovery checks before this boundary: an unowned filter URL, unresolved recovery journal, active owned requests or invalid settings must not be bypassed by killing another instance.

Inspect only listeners that can conflict with 127.0.0.1 at the requested port, including wildcard/dual-stack listeners. Report bounded process name, PID, available executable path, and a reason when termination is unsafe/unavailable. Never return command lines, environment, credentials or unrelated process inventory. Windows uses fixed PowerShell/CIM/network commands with numeric arguments; Linux uses /proc socket/inode and same-user process metadata; macOS uses system lsof/ps with fixed argv. Missing tools, inaccessible ownership, ambiguous multiple owners or incomplete identity fail closed for termination, not for error display.

Process identity includes PID, creation/start identity, executable and current-user ownership. Refuse self, parent/known ancestors, critical/system/root processes and unsupported identities. Before termination re-inspect the port and compare the full identity. If it changed, do not terminate either process: return a fresh conflict for new consent. If port is now free, retry activation without killing. Never escalate privileges or kill a process tree. Terminate only the one confirmed process, then wait boundedly for port release; a new occupant needs new consent. Surface access-denied, timeout and inspection failures.

Controller creates one bounded in-memory opaque challenge per conflict, valid60s, bound to exact validated candidate settings and revision. Confirm/cancel consumes it; settings changes/disconnect/close invalidate it. Recheck external config edits and all recovery/endpoint guards before the destructive operation. Startup may report conflict but cannot terminate automatically. Persist no challenge and no force preference. A failed activation does not save enabled=true; cancel leaves the existing disabled preference untouched. Startup enabled preference remains as before, but UI must show not-connected/conflict honestly.

Use existing authentication/Host/Origin/JSON limits for POST /api/port-conflict with {revision, challenge, confirm:boolean}. The server never trusts process identity supplied by the browser. A successful confirm reuses normal activation/persistence; failure must not claim enabled or destroy recovery data.

## 2. UI

Home retains charts and core switch. On an interactive enable conflict show an accessible yes/no dialog with port, name, PID, path when available, and warning that forced termination can lose unsaved work. Default focus is No. No cancels with no termination; Yes confirms once and shows pending work. Unsafe/unidentified conflicts have no actionable Yes. Dialog text uses textContent, supports keyboard/Escape, and cannot submit twice. Authentication expiry/settings conflicts dismiss or invalidate stale consent. Startup conflicts are surfaced with an explicit user action rather than repeated automatic dialogs. No other settings move onto home.

## 3. Native Portable Packages

Build natively on Windowsx64, macOSarm64, macOSx64 and Linuxx64. SEA contains Node and existing three UI assets. Windows output MagpieFilter.exe retains GUI subsystem. Unix output MagpieFilter has executable mode; macOS strips original signature before injecting NODE_SEA segment and applies ad-hoc signing afterward. Ad-hoc signing is not Apple notarization or publisher identity. Linux package targets glibc distributions, not Alpine/musl.

Archives are MagpieFilter-windows-x64.zip, MagpieFilter-macos-arm64.tar.gz, MagpieFilter-macos-x64.tar.gz and MagpieFilter-linux-x64.tar.gz. Each contains one top-level matching directory with executable, project and Node licenses, usage text, and internal SHA256SUMS.txt. Add a macOS double-click .command launcher and Unix shell launcher only if needed for clear portable startup; launchers resolve their own directory, quote paths and do not change shell profiles. Configuration/runtime remain executable-adjacent in a writable extracted directory; no installer/service/autostart. Archive creation must whitelist payloads, never copy configs/logs/runtime or the working tree.

Native CI runs full tests and packaged loopback smoke on each matching OS/architecture, including no-Node PATH, alternate cwd, singleton, old config, token rotation and exact restoration. Windows local execution is real; macOS/Linux here can only be source/fixture-validated unless native runners are actually run. Do not claim CI success before remote execution.

## 4. GitHub Actions Release

Replace the existing Windows-only artifact workflow with a native4-target build matrix (windows-2022, ubuntu-22.04, macos-15 and macos-15-intel, verified against runner documentation). Branch pushes on dev/dev-2 and manual dispatch build/test artifacts only. Push of a validated version tag vMAJOR.MINOR.PATCH with optional prerelease suffix triggers release after all targets pass. No release on pull requests/manual branch runs.

Build jobs use contents:read and no release credentials. One gated publish job uses contents:write with GITHUB_TOKEN, downloads only this run's expected artifacts, verifies exact inventory/checksums, then creates a draft release for the existing tag, uploads all assets and publishes only after successful upload. Existing published releases are not overwritten; rerun either verifies/skips or fails clearly. Prerelease suffix marks prerelease/not latest. Quote all user-controlled tag/ref values via env/argv, never interpolate into shell source. Release assets include four archives, Windows EXE, licenses and aggregate SHA256SUMS. No PAT, repository setting change or remote dispatch required to author this workflow.

## Verification and Limits

Test first: command/parser fixtures, identity replacement, denied/ambiguous/system processes, stale/double consent, auth and external-edit guard, real owned Windows child termination, no path/secret leakage, frontend yes/no/escape, archive file inventory and executable bits, native build decision seams and release trigger/publish gating. Run full local suite, source manifest, isolated Windows build/packaged browser/lifecycle. Independent review per step and final change-set review. Preserve explicit untested macOS/Linux native and remote-release limits.
