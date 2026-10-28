# Confirmed Port Takeover and Native Releases

## Approval and Baseline

User approved the in-chat design with "continue" on 2026-10-28. Baseline cac5e33 on literal dev-2; fresh327/327 tests pass. This extends, not replaces, the completed V11 adaptation. Keep dev unchanged and work sequentially in the supplied checkout. During implementation the user added clear task-manager application identity and optional management authentication, default off but enableable. The final optional-auth request supersedes the preceding request to remove authentication entirely.

## Safety and Compatibility

- Preserve live user configurations/processes and existing dist/portable and root dist artifacts. Development termination tests may target only explicitly created fixture children. No real port takeover, remote push/tag/release, signing credential use or privilege elevation during this task.
- Keep core filtering, retry bounds, policy snapshots, four pages, protected management API, portable configuration and recovery ownership unchanged except the explicitly confirmed conflict flow.
- New local builds use dist/phase13 and never overwrite delivered dist/dev-2. Runtime remains dependency-free; reuse Node24.12.0, esbuild and postject.

## 1. Port Occupancy and Consent

Only an actual EADDRINUSE while explicitly enabling a fresh gateway listener can offer takeover. Core-filter preference changes never start a listener or offer takeover. No general-purpose kill endpoint or client-supplied PID is accepted. Preserve config/recovery checks before this boundary: an unowned filter URL, unresolved recovery journal, active owned requests or invalid settings must not be bypassed by killing another instance.

Inspect only listeners that can conflict with 127.0.0.1 at the requested port, including wildcard/dual-stack listeners. Report bounded process name, PID, available executable path, and a reason when termination is unsafe/unavailable. Never return command lines, environment, credentials or unrelated process inventory. Windows uses fixed PowerShell/CIM/network commands with numeric arguments; Linux uses /proc socket/inode and same-user process metadata; macOS uses system lsof/ps with fixed argv. Missing tools, inaccessible ownership, ambiguous multiple owners or incomplete identity fail closed for termination, not for error display.

Process identity includes PID, creation/start identity, executable and current-user ownership. Refuse self, parent/known ancestors, critical/system/root processes and unsupported identities. Before termination re-inspect the port and compare the full identity. If it changed, do not terminate either process: return a fresh conflict for new consent. If port is now free, retry activation without killing. Never escalate privileges or kill a process tree. Terminate only the one confirmed process, then wait boundedly for port release; a new occupant needs new consent. Surface access-denied, timeout and inspection failures.

Controller creates one bounded in-memory opaque challenge per conflict, valid60s, bound to exact validated candidate settings and revision. Confirm/cancel consumes it; settings changes/disconnect/close invalidate it. Recheck external config edits and all recovery/endpoint guards before the destructive operation. Startup never enables the gateway or terminates automatically. Persist no challenge, gateway-autostart or force preference. Failed/canceled gateway activation leaves the gateway off and filter preference unchanged.

Use existing authentication/Host/Origin/JSON limits for POST /api/port-conflict with {revision, challenge, confirm:boolean}. The server never trusts process identity supplied by the browser. A successful confirm reuses normal activation/persistence; failure must not claim enabled or destroy recovery data.

## 2. UI

Home retains charts and now two independent gateway/core switches (latest user refinement). On explicit gateway enable conflict show an accessible yes/no dialog with port, name, PID, path when available, and warning that forced termination can lose unsaved work. Default focus is No. No cancels with no termination; Yes confirms once and shows pending work. Unsafe/unidentified conflicts have no actionable Yes. Dialog text uses textContent, supports keyboard/Escape, and cannot submit twice. Authentication expiry/settings conflicts dismiss or invalidate stale consent. No other settings move onto home. Recovery-handler/heartbeat and other boolean filter options use accessible switch styling rather than square checkboxes; cleanup and delivery remain single-choice controls.

## 3. Native Portable Packages

Build natively on Windowsx64, macOSarm64, macOSx64 and Linuxx64. SEA contains Node and existing three UI assets. Windows output MagpieFilter.exe retains GUI subsystem. Unix output MagpieFilter has executable mode; macOS strips original signature before injecting NODE_SEA segment and applies ad-hoc signing afterward. Ad-hoc signing is not Apple notarization or publisher identity. Linux package targets glibc distributions, not Alpine/musl.

Archives are MagpieFilter-windows-x64.zip, MagpieFilter-macos-arm64.tar.gz, MagpieFilter-macos-x64.tar.gz and MagpieFilter-linux-x64.tar.gz. Each contains one top-level matching directory with executable, project and Node licenses, usage text, and internal SHA256SUMS.txt. Add a macOS double-click .command launcher and Unix shell launcher only if needed for clear portable startup; launchers resolve their own directory, quote paths and do not change shell profiles. Configuration/runtime remain executable-adjacent in a writable extracted directory; no installer/service/autostart. Archive creation must whitelist payloads, never copy configs/logs/runtime or the working tree.

Native CI runs full tests and packaged loopback smoke on each matching OS/architecture, including no-Node PATH, alternate cwd, singleton, old config, token rotation and exact restoration. Windows local execution is real; macOS/Linux here can only be source/fixture-validated unless native runners are actually run. Do not claim CI success before remote execution.

## 4. GitHub Actions Release

Replace the existing Windows-only artifact workflow with a native4-target build matrix (windows-2022, ubuntu-22.04, macos-15 and macos-15-intel, verified against runner documentation). Branch pushes on dev/dev-2 and manual dispatch build/test artifacts only. Push of a validated version tag vMAJOR.MINOR.PATCH with optional prerelease suffix triggers release after all targets pass. No release on pull requests/manual branch runs.

Build jobs use contents:read and no release credentials. One gated publish job uses contents:write with GITHUB_TOKEN, downloads only this run's expected artifacts, verifies exact inventory/checksums, then creates a draft release for the existing tag, uploads all assets and publishes only after successful upload. Existing published releases are not overwritten; rerun either verifies/skips or fails clearly. Prerelease suffix marks prerelease/not latest. Quote all user-controlled tag/ref values via env/argv, never interpolate into shell source. Release assets include four archives, Windows EXE, licenses and aggregate SHA256SUMS. No PAT, repository setting change or remote dispatch required to author this workflow.

## 5. Optional Local Management Authentication

Keep token authentication available. New portable configs explicitly write web.authEnabled:false and retain a generated valid management token for later opt-in. Legacy version1 config missing authEnabled normalizes to true without rewriting bytes, preserving its previous security posture. Explicit true/false only; reject malformed fields. Model/provider keys and internal filter ownership/stop tokens are unrelated and unchanged.

The setting lives on Settings beside web port/token; saving authEnabled/port/token takes effect after normal restart, matching existing web settings semantics. Status exposes configured and active auth flags without token; restartRequired includes auth changes. Active-auth-off accepts management requests without x-console-token; active-auth-on enforces current token exactly as before. Loopback binding, exact Host/Origin/Sec-Fetch-Site/JSON limits, and one-use port consent remain mandatory in both modes. Authentication off means local programs can call management operations; UI/docs must say so. No LAN binding or automatic privilege changes.

UI discovers only {authRequired:boolean} through a tiny same-host GET /api/auth endpoint (no state, token, PID or configuration). Off opens all four pages directly, sends no unnecessary token, and does not show login. On prompts/auto-logins with existing flow; 403 from bad origin must not create a login loop in off mode. Old token fragments are removed from the URL; off mode does not store them. Duplicate launcher verification follows the active mode in the runtime record while validating service/instance/PID and retaining bounded read. Old runtime records missing the flag are treated as protected. Cache token only when active authentication requires it; avoid leaking/exposing generated token while off.

## 6. Application Identity

Packaged Windows task-manager/file metadata must identify Magpie Filter, not Node.js JavaScript Runtime. Set FileDescription/ProductName to Magpie Filter, InternalName MagpieFilter, OriginalFilename MagpieFilter.exe, and consistent numeric file version/product version derived from package version. Preserve bundled Node license and never claim publisher certificate identity. Update PE VERSIONINFO in the owned build copy before SEA injection; keep original node executable untouched. Use native Windows resource APIs and existing Node/PowerShell build tooling rather than adding runtime dependencies.

Packaged Unix sets an appropriate process title while keeping native executable name. Settings shows application name, raw PID and executable path so multiple copies can be distinguished; these are not secrets and remain subject to configured management auth. Do not label source node invocations as a different executable. Verify real built file metadata and a controlled launched process; task-manager grouping can vary by Windows version, so provide exact Details image name/PID rather than claiming a visual grouping not observed.

## 7. Forced Disconnect Versus Core Bypass

Latest user refinement supersedes prior automatic enabled startup: every new console process starts web-only, gateway off and effective core filtering off, regardless of an older saved enabled preference. Preserve existing configuration bytes on read; do not add an autostart option or silently rewrite old config. Existing cleanup/handler/delivery preferences remain. Runtime initial core state may normalize off without rewriting saved bytes; ordinary subsequent user saves can persist current settings. Reopening an already-running singleton does not reset it.

Gateway and core filtering are independent. An explicit gateway-on action starts the listener and attaches addresses using validated saved connection settings, even when core is off. Core-on alone while gateway is off only updates the preference and never listens/attaches/inspects a port. Gateway-on/core-off forwards new requests byte-transparently without cleanup/retry/SSE interception; gateway-on/core-on processes new requests. Gateway-off/core-on is inactive and must be labeled as such. Existing requests retain captured core policy until forced gateway disconnect. Turning gateway off does not silently change the current core preference; reopening gateway uses that current preference.

User explicitly requires gateway disconnect to cancel active work instead of refusing while requests are in flight. Consent for port conflicts belongs to gateway enable only, not core toggle. Add a strict explicit connect API, reuse existing disconnect API for gateway off, and retain normal configuration update semantics without implicit connection side effects.

The gateway-off/disconnect action is relabeled and confirms interruption. It restores owned client addresses first, then stops admission and closes all gateway client sockets to trigger existing upstream/retry/heartbeat cancellation; wait boundedly for shutdown and zero active requests. It must not wait for the model's natural completion. Pending uploads, full buffering, direct/protected streaming and backoff are canceled, with no replay. Socket cleanup must include idle and newly arriving connections while closing; only this proxy's connections, not processes or other servers.

If restoration fails, keep runtime/recovery records and report failure rather than close a gateway still referenced by the client; service remains usable to repair/retry. Forced disconnect applies only after safe restore validation. Normal program Exit retains its current active-request guard unless separately requested; users can force disconnect first then exit. No changes to legacy CLI shutdown. In-progress port-owner termination remains serialized and noncancelable once issued; force disconnect queues behind it, not falsely claims to revoke another process's termination.

## Verification and Limits

Test first: command/parser fixtures, identity replacement, denied/ambiguous/system processes, stale/double consent, auth and external-edit guard, real owned Windows child termination, no path/secret leakage, frontend yes/no/escape, archive file inventory and executable bits, native build decision seams and release trigger/publish gating. Run full local suite, source manifest, isolated Windows build/packaged browser/lifecycle. Independent review per step and final change-set review. Preserve explicit untested macOS/Linux native and remote-release limits.
