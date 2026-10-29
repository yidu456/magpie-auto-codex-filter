# Phase 14 hosted CI repairs

## Scope

Verified application repair: `57cb5d0` on dev-2, Node v24.12.0. Windows source-byte compatibility and Linux post-kill observation were repaired in ec98ba7; macOS basename metadata in 1d84b71; Windows empty-port compiler dependency in 57cb5d0. All changes received independent review and targeted RED/GREEN regression verification.

- Source checksums remain strict actual-byte hashes. Git materialization is tested with core.autocrlf=true and false, preserving intentional CRLF Windows launchers.
- Linux retries only uncertain observations after the single confirmed kill, within the existing five-second deadline. A fresh successful empty snapshot is still required; replacement owners require new consent.
- macOS comm may be a basename for ancestors. Parsing accepts bounded valid metadata, while strong-identity/path safety gates and macOS display-only/manual-quit behavior remain intact.
- Windows compiles native handle helpers only if a fresh successful listener query finds owners. Empty-port checks do not need compilation. Occupied-port identity checks, protection, handle retention and deadlines remain unchanged.

## Native evidence

[Actions run 40813226587](https://github.com/yidu456/magpie-auto-codex-filter/actions/runs/40813226587) built source commit 57cb5d0. Every target passed npm test, native SEA build, archive packaging/extraction, standalone smoke without Node PATH, and tracked-process consent smoke.

| Target | Passed | Failed | Platform-specific skips | Artifact upload |
| --- | ---: | ---: | ---: | --- |
| Windows x64 | 432 | 0 | 2 | Passed |
| Linux x64 | 430 | 0 | 4 | Passed |
| macOS arm64 | 430 | 0 | 4 | Passed |
| macOS x64 | 430 | 0 | 4 | Failed: CreateArtifact network timeout |

There are 434 total tests per target. Skips are explicit platform-specific tests, not disabled failing tests. The macOS x64 upload exhausted the action's existing five attempts while requesting CreateArtifact; all application stages had already passed. Consequently the workflow conclusion is failure, not successful four-artifact delivery. No quota or permission error appeared in that upload log. No application or workflow bypass was added to mask this external failure.

The earlier run40811587642 supplied exact macOS ancestor diagnostics on both architectures; run40812232873 then passed all Unix targets, exposing a Windows inspection/timeout instability. Final57cb5d0 native Windows passed all application and upload stages. The Windows diagnostic fixture retains fixed commands, failure-only bounded output and SID redaction.

## Successful hosted retry

[Actions run 40815029667](https://github.com/yidu456/magpie-auto-codex-filter/actions/runs/40815029667) at d025e6e succeeded for all four targets, including artifact upload. The same 434-test totals and platform skips apply. Native builds, packaged/extracted standalone smoke and tracked-process consent smoke all passed. Publish correctly skipped because this was a branch push, not a version tag.

All four nonexpired artifacts were downloaded and passed the existing strict verifyArtifacts checks: exact artifact directories and archive names, regular files, and external archive checksums. Windows payload inventory and internal checksums are a separate prepareAssets publication gate, not a verifyArtifacts claim. This completes archive-level download validation for d025e6e, not a GitHub Release and not validation of subsequent source changes.

## Local follow-up repairs

The resumed local suite at d025e6e finished with 434 total, 428 passed, 4 failed and 2 platform skips. One management test failed in fixture teardown with ENOTEMPTY, not in the authentication assertion. The other three failures involved Windows inspection or consent. These local failures are retained separately from the successful hosted run.

- Fixture deletion ran before asynchronous controller/server disposers, racing final metrics/log writes. A regression first failed deterministically, then passed after deletion was appended behind awaited body-registered disposers. Existing realpath containment and temporary-basename checks remain. Helper, controller and management tests pass 28/28.
- An owned native probe localized INSPECTION to an ancestor cycle. A recycled creator PID formed a stale cyclic chain. The helper now reads creation/parent metadata from one held native handle or CIM record, records all reachable PIDs, and accepts the complete protected set only for a cycle accompanied by a timestamp discontinuity. A newer timestamp alone never truncates the walk; clock rollback still protects the reachable grandparent. Unqualified cycles, missing/invalid creation metadata and depth exhaustion fail closed. Microsecond normalization uses exact integer remainder only for ancestry; full-resolution termination identity is unchanged.
- The actual-helper regression covers 14 native/CIM, stale-cycle, rollback, precision, missing-metadata, depth and handle-closure scenarios. Targeted native port and production consent suites pass 35/36 with one explicit Unix platform skip. Both repairs received independent review without actionable findings.
- The fresh local full suite passes: 437 total, 435 passed, 0 failed, 2 native Unix skips, 147475 ms. A new four-platform source CI run is still required for these follow-up changes. The ancestry walk does not reconstruct historical grandparents beyond an exited/reused-process gap.

## Delivery boundaries

- No local executable was rebuilt or uploaded; source-only dev-2 pushes trigger the existing Actions matrix. main and the original v0.1.0-dev tag remain unchanged.
- Preserved local dev-2 EXE SHA256: 4db96d472338365d1adb51da103c061198bfcb39c2a40b5d26d3cb701fd90157.
- Preserved local dev-3 EXE SHA256: eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935. This previous candidate does not include Phase14 repairs; its historical acceptance remains in verification-phase13.md.
- Interrupted runs are not counted as passing. The resumed d025e6e local run failed as recorded; the fresh follow-up full suite passes as recorded. The d025e6e hosted artifact retry succeeded.
- No GitHub Release is claimed. Publication requires a new authorized version tag after complete artifact-only validation; the old tag must never move.
- Native fixtures use isolated mock configuration and tracked loopback processes only. Real clients, provider calls, paid requests, user configuration migration and real-user process termination were not tested.
- Windows is unsigned; macOS has only ad-hoc signing, not notarization. Linux remains x64 glibc, not musl. macOS occupying processes require manual quit; the documented Linux identity-check/SIGKILL race remains.
