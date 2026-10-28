# Confirmed Port Takeover and Native Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Confirm identified filter-port termination and publish tested native portable packages through GitHub Actions.
**Architecture:** Add a narrow platform process inspector/terminator, bind consent in the existing controller/API, and extend native SEA build plus a gated release workflow. No new runtime dependencies.
**Tech Stack:** CommonJS, Node24.12.0, node:test, existing browser fixtures, PowerShell/CIM, procfs, lsof/ps, postject, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-10-28-port-takeover-release-design.md

**Updated order after user refinements:** Tasks1,2,3,6,8,7,4,5. Tasks6-8 are inserted before final branding rebuild/release/acceptance; their IDs keep completed task ledgers stable.

## Global Constraints

- Work sequentially on literal dev-2; preserve dev, real configurations/processes and existing EXEs. No push/tag/release execution, privilege escalation, process-tree kill or paid model calls.
- Termination tests target only explicitly created fixture children. Runtime dependency-free; no arbitrary PID kill API or persisted force preference.
- New local build output dist/phase13 only. Keep four-page layout, protected management API, configuration/recovery guards, singleton, policy defaults and proxy behavior.
- Follow TDD and independent step review; commit verified scoped files plus updated public source checksums. Parent owns planning documents; workers do not edit them or spawn subagents.
- Author native macOS/Linux CI but do not claim native execution on Windows. No Apple notarization/Windows certificate signing.

### Task 1: Safe platform port-owner adapter

**Files:** create console/port-owner.cjs and console/port-owner.test.cjs; update SHA256SUMS.txt.
**Interface:** createPortOwner() returns async inspect(port) -> {port,owner:null|{pid,name,executable,started},canTerminate,reason}; async terminate(port,expectedOwner) revalidates port+identity+same-user+safety then terminates one process and waits boundedly. Return metadata only; throw stable coded failures. Test seams may inject platform, process command/read/kill and clocks while default remains native. Export only needed adapter/parser seams.

- [x] Write failing parser/identity tests for Windows CIM/TCP, Linux procfs/socket owners and macOS lsof/ps outputs. Include wildcardIPv4/IPv6, owner permission failures, PID reuse/start change, multiple owners, missing executable/name, own/root/system/ancestor refusal, hostile names and malformed/truncated output.
- [x] RED, then implement fixed-command bounded inspection, same-user safety and revalidated termination. Use numeric validated port/PID, no shell-built untrusted paths/command lines. Windows use process handle/start identity; Unix revalidate immediately before SIGKILL, never process group. Bound time/output and post-kill release wait.
- [x] Real Windows integration test creates a disposable listening child under test control, inspects and terminates only that child; a separate unrelated fixture survives. Assert changed identity leads to zero kill calls: `await assert.rejects(adapter.terminate(port,oldIdentity)); assert.equal(kills.length,0)`.
- [x] Run adapter tests and full npm test with refreshed manifest; self-review and commit. Report exact stable errors/interface/OS evidence for Task2.

### Task 2: Controller/API consent and four-page UI

**Files:** console/controller.cjs, server.cjs, ui/index.html/app.js/app.css, tests; scripts/browser-smoke.js/fixture only as needed; SHA256SUMS.txt.
**Consumes:** createPortOwner inspect/terminate from Task1; adapter injectable in controller tests.
**Produces:** EADDRINUSE error/status conflict metadata with opaque60s challenge; controller.resolvePortConflict({revision,challenge,confirm}); authenticated POST /api/port-conflict.

- [x] RED tests: normal enable occupied listener issues safe conflict and saves nothing; no/expired/reused/wrong token/revision never kill; forged PID/settings rejected; external edit/unowned route/recovery guard checked before kill; changed owner demands fresh consent; successful owned-child confirmation terminates once and enables, timeout/permission error stays failed. Startup reports conflict without termination.
- [x] Implement one in-memory challenge bound to exact validated settings/revision, consume before action, invalidate on mutation/close. Keep serial mutation ordering. On confirm recheck disk/config safety, call adapter, retry normal apply; new occupancy prompts fresh identity rather than second kill.
- [x] Preserve auth/Host/Origin/32KiB limits, return structured safe conflict only for intended errors. Unknown POST fields rejected. Test authenticated management yes/no and409 conflicts.
- [x] Add accessible dialog with default No, escaped process/port/path details, loss warning, disabled Yes for unsafe owners, pending/double-click protection, Escape cancellation. Interactive enable opens it; startup uses explicit resolve action. No extra settings on home. Browser RED then GREEN for yes/no/escape/stale/403/relogin and desktop390px layout using owned fixtures only.
- [x] Full npm test/manifest/browser, scoped self-review and commit. Report API/error schema and acceptance for packaging.

### Task 3: Native4-target build and portable archives

**Files:** scripts/build.cjs/build.test.cjs, smoke-exe.cjs, new scripts/package-release.cjs/tests as needed, browser/launcher tests where OS assumptions exist, package.json commands if needed, SHA256SUMS.txt.
**Interface:** preserve build({outputDirectory}); accept supported native win32x64/darwinarm64/darwinx64/linuxx64 and return output metadata. packageRelease({outputDirectory,releaseDirectory}) creates whitelisted platform archive plus checksums; standalone script argv supported. No cross-compiling host binary under a foreign name.

- [x] RED tests for platform/arch gating, file naming/modes, macOS codesign remove->postject NODE_SEA->ad-hoc sign order, Windows PE-only handling, archive whitelist/path spaces and invalid target refusal. Expected targets exactly `windows-x64`, `macos-arm64`, `macos-x64`, `linux-x64`.
- [x] Implement native SEA branches using official Node24.12 guidance. Preserve executable permissions/Unix launchers, executable-adjacent config, license matching, bounded archive subprocesses. Create zip Windows/tar.gz Unix with fixed top-level directory and payload whitelist; exclude all runtime/config data.
- [x] Make packaged smoke actually cross-platform: PATH without Node, OS-aware executable naming/copy mode, signalCode cleanup, no Windows-only path assumptions. Make full test suite native-platform compatible without skipping actual non-Windows functionality; conditionalize only truly Windows PE/browser cases.
- [x] Local Windows build to dist/phase13; archive, inspect entries, run packaged smoke plus all4-page browser and explicit port-owner yes/no acceptance; no real processes. Full tests/manifest, commit; report unexecuted native OS limitations.

### Task 4: Native matrix and gated automatic Release

**Files:** .github/workflows/windows-build.yml (rename optional), scripts/release.cjs and tests if needed, SHA256SUMS.txt.
**Consumes:** build/package/smoke commands from Task3; exact four target archives.

- [ ] Verify current official runner/action/gh CLI docs; Context7 quota may be unavailable, use official source directly. RED tests for tag validation, exact artifact/checksum inventory, safe argv, prerelease designation, existing published-release refusal, upload failure leaves draft, and branch/PR cannot publish. Use process mocks, never a real release.
- [ ] Implement matrix Windows2022x64/Ubuntu22.04x64/macOS15arm64/macOS15-intelx64. Pin supported official actions, setup Node24.12.0 architecture, `npm ci --ignore-scripts`, full tests, native build/package and executable smoke. Public archive-only artifact uploads and finite job timeouts.
- [ ] Branch dev/dev-2 and manual runs artifact-only; valid vMAJOR.MINOR.PATCH[-suffix] tag triggers publish only after every build succeeds. Publish job alone contents:write/GH_TOKEN, verified existing tag, exact4 archive download+hash validation, draft->upload->publish. Include Windows EXE/licenses/aggregateSHA256SUMS; prereleases not latest; no overwrite published releases.
- [ ] Validate YAML/action references, run process-mocked release tests/full npm/manifest; independent review and commit. No remote workflow dispatch/tag/push.

### Task 5: Documentation, final acceptance and handoff

**Files:** README.md, docs/verification-phase13.md if useful, SHA256SUMS.txt; isolated build artifacts ignored.

- [ ] Document conflict yes/no, identity change/permission/critical-process refusal, forced-stop data-loss/recovery limitations; show platform launch commands and extraction/writable-dir requirements, Linux glibc/macOS ad-hoc-notarization limits.
- [ ] Document workflow tag release versus branch artifacts, architectures, asset names, minimal GITHUB_TOKEN permissions, no user secrets/PAT and how to run manually without publishing. State native CI unexecuted until user pushes.
- [ ] Fresh full suite/source manifest, isolated Windows archive/executable/browser/port-conflict acceptance and artifact hashes. If production changed since Task3 rebuild only own dist/phase13 output. Confirm preserved existing EXE hashes. Commit docs; final whole-change review and scoped fix/rebuild if required.
- [ ] Leave branch local/unmerged, exact output/workflow paths and actual evidence; do not claim release exists or macOS/Linux validated before native runner evidence.

### Task 6: Optional management authentication, default off

**Files:** console/configuration.cjs/controller.cjs/server.cjs/main.cjs/UI; corresponding tests; browser/smoke fixtures; SHA256SUMS.txt.
**Interface:** web.authEnabled boolean; new configs false, old missing field true in memory without rewriting. Active flag captured at startup and persisted in service record; GET /api/auth returns only {authRequired:boolean} after existing host/origin guards. Web saves remain restart-only.

- [x] RED config tests newfalse,legacytrue/readbytesunchanged,explicittruefalse/malformed; server off accepts no token, on rejects, both reject hostile Host/Origin/Fetch metadata, discovery leaks no state/token. Internal proxy/CLI token tests unchanged.
- [x] Implement normalization, active/configured state, restart pending, facade/duplicate launcher/open URL behavior. Runtime flag missing means protected; token cache only when active on. Do not remove token setting/login code needed when on.
- [x] UI first probes minimal auth endpoint, off direct-load all4pages, on current login; settings checkbox+clear local-access warning, token hidden by default, auth change restart hint. New config token still generated but never returned. Handle old token fragment and stale sessionStorage safely.
- [x] Browser RED/GREEN for fresh defaultoff/no login, enable/save/restart/protected login, disable/save/restart/off, pending rotation/singleton, port consent still mandatory. Update fixture defaults explicitly where existing protected-login regression needs on. Adapt source/packaged smoke to verify both modes; only owned fixtures.
- [x] Full npm/manifest/source browser consent and fourpage pass; commit report with API/migration semantics. Rebuild deferred until Task7 branding to avoid duplicate packaging.

### Task 7: Recognizable packaged application identity

**Files:** scripts/build.cjs, focused Windows resource helper/tests, console/main.cjs/UI/settings identity/tests, SHA256SUMS.txt.
**Interface:** build output VERSIONINFO names Magpie Filter; application status adds name/executable beside existing PID/service/instance. No runtime dependency.

- [ ] RED tests version-resource encoding/alignment and API invocation only ownedWindowsoutput, non-Windows noPEedit, consistent version parsed from package.json, process metadata fields are bounded and rawPID rendered without separators.
- [ ] Implement minimal Node buffer VERSIONINFO plus fixed Windows UpdateResource helper or equivalent native build-only resource method. Apply before injection and verify resources survive SEA. No downloaded opaque resource editor/newruntime deps/certificate claims. Unix packaged process.title only, source invocation accurately identified.
- [ ] Settings display name/PID/executable, preserve home controls rule. Add browser assertions safe rendering and actual Windows fileVersionInfo checks; launch only fixture EXE and verify image filename/PID without killing user processes.
- [ ] Fresh build/package under dist/phase13/final (do not overwrite earlier built outputs), extractedEXE real noNodePATH, both authmodes and consent, metadata/archivechecksum/browser checks. Fulltests/manifest, localcommit/report exactCIcommands; workflow Task4 consumes final interfaces.

### Task 8: Web-only startup, separate gateway/core switches and forced disconnect

**Files:** console/controller.cjs/UI/related tests; proxy cancellation seam only if existing closeAllConnections fails proven cases; browser/smoke fixtures; SHA256SUMS.txt.
**Interface:** strict controller.connect({revision}) / POST /api/connect starts gateway independently; controller.update never implicitly starts it. Existing disconnect / POST /api/disconnect force-cancels only this gateway after safe restore and preserves current core preference. Every newprocess starts gateway/coreOFF without rewriting config; singleton reopen preserves live state. Close/Exit active-request guard unchanged.

- [ ] RED oldconfigenabledtrue startup still webonly/coreOFF and byteidentical; singletonrepeat preserves livechoices. Four gateway/core combinations, coreupdates never bind, gatewayconnectcoreOFF bypass, coreON processes only newrequests. Portchallenge only gatewayconnect, mainfacade forwardsconnect; strictrevision/unknownfields/authTrust protections. Update all previous tests/fixtures that assumed implicit filterenable connection or autostart, preserve old regression meaning through explicit connect.
- [ ] RED active upload/fullbuffer/protected/direct/backoff/bypass requests: disconnect completes boundedly without provider completion, upstream aborted, no later retry, counters zero, exact restored TOML/listener closed. Failedrestore keeps records/listener, no falsely successful response. Close remains guarded. Use actual loopback sockets and cancellation evidence, not timeout sleeps alone.
- [ ] Minimal stop sequence settransitioning+stoprouter timer/restore/stopadmission/closeAllConnections/await close; ensure graceful paths keep semantics and exceptions cannot discard backup or strand state. Reuse existing proxy resclose/reqabort cancellation; add only proven missing cancellation hooks.
- [ ] Keep effective initialcoreOFF separate from read-onlyoldconfig contents; no newpersistedgateway/autostart setting. Disconnect preserves core preference; gatewaytoggle status derives actual listener, not core bool. CoreOFF connected preserves compressed rawbytes and inbanderrors, no mutation existingrequestpolicy. Finalconfigguardbeforeporttermination remains authoritative.
- [ ] Homepage two labeled switches gateway/core pluscharts only; handlers/heartbeat booleans switchstyled with role=switch/nativechecked/accessiblename/keyboard, no customunlabeleddiv. Singlechoice cleanup/deliveryunchanged. GatewayOFF/coreON status saysinactive; gatewayON/coreOFF saysbypass. GatewayOFF confirmsforceinterrupt with No preservingconnection/request. Update help and browserall4combinations, fresh/restartwebonly, activeforceyes/no, occupiedgatewayconsent, protected/offauth. Fulltests+manifest+sourcebrowser scopedcommit/report; Task7 finalbuildvalidates.
- [ ] Fix proven managementExit speculative idleTCP hang narrowly after normalcontrollerclose succeeds: ownedmanagementsocket tracking/bounded teardown followingexitresponse, no change activefilterExitguard. DirectidleTCP real launcher regression; do not hide with browsercloseonly.
