# Task Plan: Magpie Web Console Dev

## Goal
Preserve the completed dev console and adapt selected V11 capabilities on dev-2, with a verified commit per step.

## Next Step
Execute approved Phase13 plan: safe port-owner adapter, explicit controller/UI consent, native packages, gated GitHub release workflow, final acceptance. No remote publishing or real-user process termination.

## Current Phase
Phase 13

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
**Status:** in_progress
- User requested GitHub Actions automatic Release packages for Windows, macOS and Linux, plus explicit yes/no termination of identified filter-port owner before enabling.
- Proposed Windowsx64/macOSarm64+x64/Linuxx64, embedded runtime, v* tag releases; identity revalidation, no silent privilege escalation/critical-process termination/recovery bypass.
- User approved with continue on2026-10-28. Plan: docs/superpowers/plans/2026-10-28-port-takeover-release.md. Native macOS/Linux CI execution and remote release remain unperformed.
