# Phase 13 Verification Record

This record describes the local `dev-2` runtime/workflow baseline at `544340d` and the Windows x64 candidate already built in `dist/dev-3`. It is evidence for a local handoff, not a claim that a GitHub Release exists.

## Delivered Windows candidate

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/dev-3/MagpieFilter.exe` | 90,297,344 | `eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935` |
| `dist/phase13/final/MagpieFilter.exe` | 90,297,344 | `eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935` |
| `dist/phase13/final/release/MagpieFilter-windows-x64.zip` | 33,636,639 | `1f8573946cfcb5d33ec99673be623e8abecae27d7448dda2ca778fc88021b319` |
| preserved `dist/dev-2/MagpieFilter.exe` | 90,255,872 | `4db96d472338365d1adb51da103c061198bfcb39c2a40b5d26d3cb701fd90157` |

The candidate was built natively on Windows x64 with Node `v24.12.0`, package version `0.1.0-dev` and numeric file/product version `0.1.0.0`. Its embedded runtime and UI are standalone. The archive has one `MagpieFilter-windows-x64` top-level directory and only `MagpieFilter.exe`, `LICENSE.txt`, `NODE-LICENSE.txt`, `START-HERE.txt`, and internal `SHA256SUMS.txt`; all four internal checksum rows were checked against the extracted bytes. The executable extracted into the fresh takeover directory has the same hash as `dist/dev-3`; standalone smoke separately copies it to an alternate/spaced path to test executable-adjacent behavior.

The `dist/dev-3/SHA256SUMS.txt` executable row matches the candidate. `LICENSE.txt` is SHA-256 `ffe3f589bbaf142ad385827bfeebaf692afd9e6e8ef767ad0d79968881d18e30`; `NODE-LICENSE.txt` is SHA-256 `537308465103a306d0e3eecf42632b4ff1b48aaaec044e9fc10a78c81fd00b34`. Configuration, `.magpie-filter`, logs and browser state created by isolated acceptance are runtime state, not distributable payloads.

No executable runtime, native build or packaging source changed after this native build. The later `2024d60` change corrected browser-harness navigation setup, `4649cf0` corrected a test expectation, and `544340d` added the workflow/release helper. Therefore no rebuild was needed, and both the candidate and preserved live `dist/dev-2` hashes remained unchanged.

## Fresh source verification

Environment: Windows, Node `v24.12.0`, serial test execution.

- `npm test`: 421 tests, 419 passed, 0 failed/cancelled, 2 skipped, 208,454 ms. Log: `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-full-test.log`.
- The skips are the native Unix listener/termination case and native Unix archive-mode/alternate-cwd case. They are platform skips, not ignored Windows failures.
- The suite includes actual Windows resource/image identity, one tracked disposable listener termination with an unrelated fixture surviving, both optional-auth production consent modes, gateway/core lifecycle, forced disconnect, release inventory/gating, and the source manifest.
- `actionlint 1.7.12 .github/workflows/windows-build.yml`: exit 0 with no diagnostics. The workflow was also parsed for its exact four matrix rows, triggers, dependency gate, timeouts and permission boundaries.
- The final documentation checksum refresh is verified separately with `node --test scripts/source-manifest.test.cjs`; the root `SHA256SUMS.txt` is the distributable-source manifest, not an artifact signature or publisher identity.

## Isolated Windows acceptance

The final acceptance commands used a newly extracted executable at `.verification/phase13-takeover-Vre19z/MagpieFilter-windows-x64/MagpieFilter.exe`. It was rehashed before execution and equals `dist/dev-3`. Every command below finished with exit 0, used fresh fixture runtime directories, did not point at real Codex configuration, and did not call a model:

| Command | Result | Log |
| --- | --- | --- |
| `node scripts/smoke-exe.cjs <EXE>` | Standalone lifecycle and native identity passed | `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-exe-smoke.log` |
| `node scripts/run-browser-smoke.cjs <EXE>` | Full four-page desktop/mobile browser acceptance passed; no page errors | `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-browser.log` |
| `node scripts/run-gateway-browser.cjs <EXE>` | Four gateway/core states and forced-disconnect cases passed; no page errors | `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-gateway.log` |
| `node scripts/run-optional-auth-browser.cjs <EXE>` | Default-off, legacy-protected and restart/auth cases passed; no page errors | `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-auth.log` |
| `node scripts/smoke-port-consent.cjs <EXE> --browser` | Production browser consent passed; No preserved and Yes stopped only tracked PID 44276; exact restore passed | `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-port-consent.log` |

Archive extraction and verification are recorded in `.superpowers/sdd/2026-10-28-port-takeover-release/takeover-archive.json`: exact five-file payload, all internal checksum rows, fresh extracted path, candidate byte count/hash, archive hash, and preserved `dist/dev-2` hash all passed.

The fresh standalone smoke covered no-Node `PATH`, alternate current directory, embedded assets, exact old-config read-only behavior, both auth modes, singleton, web-only startup, explicit gateway/filter/bypass, protected early recovery/late no-replay, pending token rotation, adjacent configuration, exact route restoration and clean exit. Native inspection reported `Magpie Filter`, image `MagpieFilter.exe`, tracked PID 37612, exact extracted path, and file/product version `0.1.0.0`.

The fresh browser smoke covered manual/fragment authentication, application identity and bounded hostile metadata, four direct/history routes, independent gateway/core controls, policy persistence, bypass/restore, pending rotation, metrics and no page errors. The gateway smoke covered keyboard switching, duplicate-instance preservation, old enabled configuration starting web-only, six non-completing request modes, Force No/Yes, bounded upstream cancellation, no delayed replay and exact restore. Optional-auth covered no credential while off, no login loop after an off-mode origin rejection, one-use consent, real enable/disable restarts, protected login, pending rotation/singleton, polling and hidden invalid-token handling.

The parent visually inspected the fresh desktop Dashboard and mobile Settings captures: the two switches, application identity, PID and executable path were readable, with no observed clipping or horizontal layout failure. A fresh signature check reported `NotSigned`; this does not claim a particular Task Manager grouping or a publisher certificate. The production consent harness terminated only its explicitly created/tracked child; no user process was selected or stopped.

## Behavior accepted

- Every new process starts management-only: gateway off and effective core filtering off. Core preference and gateway connection are independent; gateway on/core off is transparent byte forwarding, while core on/gateway off is an inactive saved preference.
- New portable configurations explicitly use `web.authEnabled:false` but retain a generated token for later opt-in. A legacy version 1 file missing the field is treated as protected without rewriting its bytes. Port/auth/token changes take effect after restart; active and configured auth state remain distinct.
- Port takeover exists only after an explicit gateway enable reaches a real bind conflict. One-use consent is bound to exact server-side identity/settings. Self, ancestry, critical/system/root, ambiguous, foreign-user, incomplete or changed identities fail closed. macOS is display-only/manual-quit because available start identity is too coarse.
- Gateway disconnect first restores owned client addresses and then force-cancels this proxy's upload, buffering, streaming, bypass and retry sockets. It cannot undo provider work or tool effects already executed. Restoration failure keeps the listener and recovery journal for repair. Normal Exit still refuses active requests; disconnect first when interruption is intended.
- Windows identity is native VERSIONINFO, not a renamed UI label. Unix keeps the native executable name and packaged process title. Settings reports the actual application name, PID and executable path.

## CI and release boundary

The workflow builds Windows x64, Linux x64, macOS arm64 and macOS x64 natively. Branch pushes to `dev`/`dev-2` and manual dispatch produce artifacts only. Only a validated existing `vMAJOR.MINOR.PATCH[-prerelease]` tag push can reach the publish job after all native jobs pass.

The exact public Release inventory is four archives (`MagpieFilter-windows-x64.zip`, `MagpieFilter-linux-x64.tar.gz`, `MagpieFilter-macos-arm64.tar.gz`, `MagpieFilter-macos-x64.tar.gz`), standalone `MagpieFilter.exe`, `LICENSE.txt`, `NODE-LICENSE.txt`, and aggregate `SHA256SUMS.txt`. Global permissions are `contents:read`; only publish receives `contents:write`, and only the helper step receives the automatic short-lived repository token. No PAT or user secret is required.

The helper verifies the existing tag plus the exact four current-run artifact directories, archive names and external checksums before remote mutation. On the Windows publish runner it additionally inspects the Windows ZIP's exact payload and internal checksums before extracting the three standalone Windows assets. The other three archives are produced, extracted and smoked on their matching native jobs; the publish helper does not inspect their internal payloads. It creates a draft, uploads and verifies all eight assets, then publishes. A failed upload leaves a resumable matching draft; a rerun may replace only that draft's expected assets. It refuses an existing published release and never overwrites it. Upload and final publication are not atomic.

No push, tag, workflow dispatch, remote upload or Release creation was performed. Native macOS/Linux builds and smokes have not run, so their executable mode, process behavior, glibc compatibility and hosted-runner packaging remain pending real native CI. macOS output is ad-hoc signed only, not notarized; Linux targets glibc x64, not musl. Windows is unsigned and has no publisher-certificate claim.

## Handoff limits

- Extract an archive completely into a fresh writable directory. Configuration and recovery state are executable-adjacent; never run inside an archive or migrate a live `.magpie-filter` directory.
- Do not publish runtime/configuration/log/browser state. Root source checksums, per-build executable checksums, per-archive checksums and the aggregate Release manifest have different scopes.
- Before a real release, run an artifact-only workflow on all four native targets, inspect each exact archive and checksum, and execute both standalone and owned-consent smoke on its matching runner.
- Before switching a real client, finish current work, use the old instance's normal restore/exit path, retain its EXE/config rollback pair, then start the candidate from a separate directory. Never run two filters against the same client configuration.
