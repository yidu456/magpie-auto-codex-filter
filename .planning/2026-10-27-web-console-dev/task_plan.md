# Task Plan: Magpie Web Console Dev

## Goal
Preserve the completed dev console and adapt selected V11 capabilities on dev-2, with a verified commit per step.

## Next Step
Phase20: record source acceptance, then atomicpush dev-2 with explicit395174d force-with-lease plus newannotatedv1.0.0 viaSSHHostyidu456. Browserfix83ec7b9 fullsuite450total448pass0fail2skip andindependentreview satisfied; versionc8957f5 aligned. Phase22 exact7chartidentityrewrite approved; verifyremoteattribution andpreservedmain/oldtags, thenwatchnativeformalbuild/publication. Userruntime untouched.

## Current Phase
Phase 20

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
**Status:** complete
- User approved combined high-contrast smooth curves, then requested implementation, pointer-position popover with bottom details retained, persistent step plan and local commit after each completed item.
- Task0: plan/baseline. Task1: smooth trends. Task2: exact-minute hover/touch/keyboard details. Task3: distributions and fixed240px precise tables. Task4: complete isolated acceptance and evidence.
- Existing metric semantics, authentication, CSP and runtime unchanged. No dependencies, push, tags, version bump or binary rebuild. Null/missing remains unobserved; curves do not invent statistics.
- Baseline clean dev-2 at50b0bf4; focused assets and manifest8/8 pass. Reference repository and previous preview remain read-only inputs.

- Phase16 final acceptance: Task1ca2ec02,Task22e120c0,Task39447b8e; final full suite445total443pass0fail2skip147710ms at stable document/source bytes. Complete isolated Chrome acceptance all chart flags true/pageErrors[],4widths/native touch/240px/sticky pass; scoped reviews approved. Local-only final acceptance commit; no new Release or binary rebuild.

### Phase 17: Local chart EXE candidate
**Status:** complete
- Build the approved1fbc046 source with existing native build.cjs into freshdist/dev-4; no version change or oldEXE overwrite.
- Validate standalone lifecycle and packaged browser in owned fixtures; compare embedded assets and preserved oldhashes.
- Record output/hash/limits, then hand off the local candidate; no push/tag/Release change.

- Phase17 acceptance:90313216bytes SHA256ea55beed8ab20ac3a2fe493c42a8c12f5ba2cc958f26e29672c11d106514a12c; Node24.12.0 package0.1.0-dev.1 native0.1.0.0 NotSigned. Build/identity/manifest11focusedpass; standalone lifecycle/assets/portable/restoration and full packaged browser chartflags/pageErrors[] pass. Owned consent cancellation/termination/restoration pass; independent build-record review approved. No real-provider calls or userprocess actions.

### Phase 18: Trend legend visibility switches
**Status:** in_progress
- Approved bounded design: native toggle buttons with aria-pressed, grey/struck-out hidden legends; hide corresponding curves/fill/markers, tooltipvisible-only while bottom/table stayscomplete; fixedoriginalscale. Page-session only, polling/navigation retain; reloadresetsallvisible; allofflegendstilloperable; keyboard/touchsupported.
- TDD actual browser/state checks; refreshmanifest, focused/full suites, isolatedmobile/keyboard/poll acceptance, independentreview andlocal featurecommit.
- Build freshdist/dev-5 from reviewedsource, packaged startup/fullbrowser acceptance, hashes/preservation andlocal recordcommit; no push/tag/version/configchange or oldEXE overwrite.

- Phase18 featuregatecomplete: focused17pass,full446total444pass0fail2skip156774ms,completebrowserlegendVisibility/allchartflags true/pageErrors[],4width/nativelegendtouch/focusretention pass. Independent reviewapproved. NewlocalEXEbuild/handoff stillpending.

### Phase 19: Owner-authenticated source push
**Status:** complete
- VerifySSHHostyidu456 authenticatesaccountyidu456; originowner/ref correct; setlocalfuturecommitidentity, neverrewriteexistingauthors.
- Validate source/manifest andremoteancestry, commitaccuratebookkeeping, fast-forwardpushonlydev-2withfollowTagsdisabled; no main/tag/EXE/runtimeupload.
- Verifyremotebranchhead andpreservedrefs; CIstartisnotCIcompletion. Keepunconfirmeddev-5runtimefilesunread/untouched.

- Phase19 result: SSHyidu456 accountverified; sourcebranch50b0bf4 ->b5de91d pushedfast-forward andremoteSHAverified. Newrecordauthorship/committeryidu456 withverifiedpublicnoreplyID, historicalcommitunchanged. Remote maincd68b072,oldtag2bf245cf,newtagad8b0067 allpreserved. Fresh17focused/sourcehashgatepass. No EXE/runtimeupload,no tag/Releasechange,unknownruntimefilesuntouched. Finalcompletionrecord follows on samebranch; hostedCIcompletionpending.

### Phase 20: Formal version 1.0.0 build and publication
**Status:** in_progress
- User requests formal1.0.0 build; latest source395174d hostedrun40860730674 completed success. New v1.0.0 absent locally/remotely; branch synchronized and main/oldtags preserved.
- Step1: update package/lock version only with npm, refresh source manifest; validate semver/native numeric version, full local suite and independent review. No dependency/application/workflow change.
- Step2: commit reviewed metadata as yidu456, create annotated v1.0.0, atomically push only dev-2 plus that tag via Hostyidu456 without force/followtags.
- Step3: inspect four native tests/build/package/extracted smoke/consent jobs and gated publish; verify non-draft/non-prerelease/latest Release and exact eight assets/checksums. No local EXE rebuild or user runtime access.
- Prior dev-5 runtime provenance remains unresolved and independent of fresh hosted builds; retain unread/untouched.
- User reports GitHub still shows didingqd and requests yidu456 attribution. API verifies old codecommitf59a352 author/committerdidingqd via legacy8oo email, new395174d author/committeryidu456. Hold tag/push pending historical rewrite scope confirmation; switching SSH does not change historical author metadata.
- User explicitly confirms bounded chart-history rewrite plus force-update dev-2 on2026-10-29. Step2 now uses explicit force-with-lease for branch, atomic newtag push and nofollowtags; main/oldtags remain unchanged. Prerelease-era ancestors before50b0bf4 remain unchanged.

### Phase 21: Open browser once per actual service startup
**Status:** complete
- Diagnose only production browser dispatch callers; no user runtime/process access. main.cjs has startup dispatch and duplicate-singleton dispatch; no periodic browser dispatch found.
- TDD real main/config/server in owned temp fixture with only OS browser launch intercepted; assert firststartup1open, repeated/concurrent duplicates0extra, polling0extra, no-open0, true restart opens once.
- Remove duplicate browser dispatch only, keep identity/auth verification and safe singleton behavior; update README relaunch instructions and strict source manifest.
- Focused/full tests, independent review and separate fixcommit before formaltag.
- Acceptance: fix83ec7b9 asyidu456; regression4/4,focused27/27, full450total448pass0fail2skip177176ms, finalmanifest3/3 andwhitespacepass. Independentreview nofindings; fullsuitecondition satisfied. Actualuser'strigger notinspected; verifiedduplicatelaunchpath corrected withouttimerchanges.

### Phase 22: Bounded chart commit attribution
**Status:** in_progress
- Rewrite exactly seven commits975a40d throughf59a352 after50b0bf4 to verifiedyidu456 author/committer. Rechain descendants without changing their metadata/content; preserve original trees/messages/dates and all earlier commits.
- Save local backupref/privateold-newmap; CASupdate localdev-2 only if tip/tree verified. Dirty release metadata/fix edits remain untouched. No amend/reset/checkout/history deletion.
- Review mapping, preserved refs and source tree; force-with-lease remote395174d only when all gatespass, atomicwithv1.0.0. GitHub verify rewritten codeauthor/committeryidu456.
- Localrewrite395174d ->a7e1475 verified and independentlyapproved; newchartheads3a9f445/0ebd111/4803239/0c7ceea/f68d53f/92538cf/3767213. Backuprefs/codex-backups/dev-2-before-chart-attribution-20261029 preserved originaltip; allotherrefs anddirtyfilebytesunchanged. Remote notyetmodified.
