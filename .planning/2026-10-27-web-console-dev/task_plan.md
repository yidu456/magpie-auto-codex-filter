# Task Plan: Magpie Web Console Dev

## Goal
Preserve the completed dev console and adapt selected V11 capabilities on dev-2, with a verified commit per step.

## Next Step
Phase16 approved: implement combined smooth request/Token curves, pointer-near tooltip plus retained bottom detail, horizontal distributions and fixed240px precision tables. Sequential reviewed local commit per item; detailed checklist in docs/superpowers/plans/2026-10-29-chart-improvements.md. Phase15 Release, refs and local EXEs preserved. Plan/baseline commit first, then Task1.

## Current Phase
Phase 16

## Phases

### Phase 1: Plan and baseline
**Status:** complete
- Spec and implementation plan in docs/superpowers; 58 baseline tests pass.

### Phase 2: Runtime policy and recovery switches
**Status:** complete

### Phase 3: Bypass and streaming
**Status:** complete

### Phase 4: Controller and API
**Status:** complete

### Phase 5: Browser UI
**Status:** complete

### Phase 6: Launcher and EXE
**Status:** complete

### Phase 7: Validation and handoff
**Status:** complete

## Decisions
- Work in supplied checkout; dev was used through Phase 10, then user explicitly selected literal dev-2. No extra worktree or push.
- Sequential implementation, local mock tests only, preserve legacy runtime.
- Detailed task checklists: docs/superpowers/plans/2026-10-27-web-console.md.

### Phase 8: Portable configuration and startup
**Status:** complete
- Single EXE-adjacent config; web port/token/settings source of truth; atomic saves and external-edit conflict detection.
- First launch OFF; subsequent startup respects saved enabled state. Exit restores endpoints without changing startup preference.

### Phase 9: Manual authentication and packaged acceptance
**Status:** complete
- Token login at fixed URL, editable web settings, packaged tests and documentation.
- Preserve active-token relaunch during pending rotation; surface recovery failures in the console.
- Verify ShellExecute browser dispatch, fixed-port startup and non-default filter port using isolated fixtures.

### Phase 10: Upstream V11 comparison
**Status:** complete
- Inspect local upstream HEAD 837f793 versus V10 and standalone dev HEAD 2649f98.
- Cross-check streaming, history, retry, metrics, and UI behavior in source and tests.
- Report additions, overlaps, and integration boundaries; no merge or live service changes.

### Phase 11: dev-2 adaptation design
**Status:** complete
- User approved selective V11 adaptation and explicitly requested literal dev-2.
- Created dev-2 from dev 2649f98 in the supplied checkout; dev remains unchanged.
- Full baseline suite passes 123/123. Compatibility design written for review before implementation.
- Spec: docs/superpowers/specs/2026-10-27-dev-2-v11-adaptation-design.md.

### Phase 12: dev-2 implementation and acceptance
**Status:** complete
- User approved design and requested theme-matched charts plus separate request-record/help pages.
- Plan: docs/superpowers/plans/2026-10-28-dev-2-v11-adaptation.md.
- Sequential task implementation with isolated review; preserve running instances and original dev.
- Four pages implemented; final branch review and singleton size correction approved, rebuilt EXE verified. Full327/327 plus isolated source/packaged browser and standalone lifecycle acceptance.

### Phase 13: Cross-platform release and confirmed port takeover
**Status:** complete
- User requested GitHub Actions automatic Release packages for Windows, macOS and Linux, plus explicit yes/no termination of identified filter-port owner before enabling.
- Proposed Windowsx64/macOSarm64+x64/Linuxx64, embedded runtime, v* tag releases; identity revalidation, no silent privilege escalation/critical-process termination/recovery bypass.
- User approved with continue on2026-10-28. Plan: docs/superpowers/plans/2026-10-28-port-takeover-release.md. Native macOS/Linux CI execution and remote release remain unperformed.
- Completed on2026-10-29: all eight tasks and independent final review approved; exact Windows candidate/archive hashes and limits in docs/verification-phase13.md. No user process/configuration or delivered binary was changed during final workflow/docs work.

### Phase 14: Hosted CI compatibility fixes
**Status:** complete
- User authorized source push to yidu456, followed by fixing the failed hosted run. Branch dev-2 and v0.1.0-dev now exist at e6a1230; main unchanged. No Release exists.
- Diagnose all four native jobs from retained logs. Windows mismatch reproduced exactly by LF-to-CRLF conversion; Unix inspection/termination and browser shutdown assertions need focused regression coverage.
- Keep strict checksums and pre-termination safety gates, macOS display-only behavior, bounded waiting and complete native tests. Do not skip failures, elevate privileges or alter user processes/configurations.
- Fix and verify scoped code/tests/manifest, independent review, then source-only branch CI validation. Preserve v0.1.0-dev and delivered dev2/dev3 binaries; no local rebuild or new release until native CI passes.

- Phase14 final acceptance at a31156b: local435pass2skip; Windows hosted435pass2skip, Linux/macOS each432pass5skip, all0fail/437total. Native40817990959 complete success including four uploads; downloaded archives verified. Scoped independent reviews and final evidence-only review approved.

### Phase 15: New prerelease tag and hosted publication
**Status:** complete
- User authorized new release tag on2026-10-29; selected v0.1.0-dev.1 from the preceding recommendation.
- Step1: npm version --no-git-tag-version --ignore-scripts updates package.json and package-lock.json; refresh SHA256SUMS.txt. Validate tag/version/lock alignment, native Windows version encoding and full local suite; independent review. No dependency, application or workflow change.
- Step2: commit metadata on dev-2, verify new tag absent locally/remotely, create annotated tag, atomic push of dev-2 plus the new tag only. Never move old tag/main.
- Step3: watch tag Actions through four native suite/build/package/extracted smoke/consent/upload jobs and publish; verify non-draft prerelease tag, exact eight assets and published checksums. Retain failed/draft evidence without bypass if any gate fails. No local binary rebuild, real-provider calls or user-process termination.

- Phase15 final acceptance: Release https://github.com/yidu456/magpie-auto-codex-filter/releases/tag/v0.1.0-dev.1 is non-draft/prerelease, exactly8assets. Tag40820263107 and branch40820262868 succeed; Windows435pass2skip and Unix432pass5skip/437total, all0fail. Downloaded629-byte aggregate SHA256SUMS matches its GitHub digest; seven rows match the other uploaded asset digests. No full binary redownload claimed.

### Phase 16: Approved chart improvements
**Status:** in_progress
- User approved combined high-contrast smooth curves, then requested implementation, pointer-position popover with bottom details retained, persistent step plan and local commit after each completed item.
- Task0: plan/baseline. Task1: smooth trends. Task2: exact-minute hover/touch/keyboard details. Task3: distributions and fixed240px precise tables. Task4: complete isolated acceptance and evidence.
- Existing metric semantics, authentication, CSP and runtime unchanged. No dependencies, push, tags, version bump or binary rebuild. Null/missing remains unobserved; curves do not invent statistics.
- Baseline clean dev-2 at50b0bf4; focused assets and manifest8/8 pass. Reference repository and previous preview remain read-only inputs.
