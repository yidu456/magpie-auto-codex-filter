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

## Delivery boundaries

- No local executable was rebuilt or uploaded; source-only dev-2 pushes trigger the existing Actions matrix. main and the original v0.1.0-dev tag remain unchanged.
- Preserved local dev-2 EXE SHA256: 4db96d472338365d1adb51da103c061198bfcb39c2a40b5d26d3cb701fd90157.
- Preserved local dev-3 EXE SHA256: eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935. This previous candidate does not include Phase14 repairs; its historical acceptance remains in verification-phase13.md.
- An interrupted local full suite has no final result and is not counted as passing. A fresh rerun and artifact-only retry are pending when this record is written.
- No GitHub Release is claimed. Publication requires a new authorized version tag after complete artifact-only validation; the old tag must never move.
- Native fixtures use isolated mock configuration and tracked loopback processes only. Real clients, provider calls, paid requests, user configuration migration and real-user process termination were not tested.
- Windows is unsigned; macOS has only ad-hoc signing, not notarization. Linux remains x64 glibc, not musl. macOS occupying processes require manual quit; the documented Linux identity-check/SIGKILL race remains.
