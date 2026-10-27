# Task Plan: Magpie Web Console Dev

## Goal
Build the approved local console and EXE on dev, with a verified commit per step.

## Next Step
Phase 8: portable unified configuration, fixed port and file-driven startup.

## Current Phase
Phase 8

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
- Work in supplied checkout on literal dev branch; no extra worktree or push.
- Sequential implementation, local mock tests only, preserve legacy runtime.
- Detailed task checklists: docs/superpowers/plans/2026-10-27-web-console.md.

### Phase 8: Portable configuration and startup
**Status:** in_progress
- Single EXE-adjacent config; web port/token/settings source of truth; atomic saves and external-edit conflict detection.
- First launch OFF; subsequent startup respects saved enabled state. Exit restores endpoints without changing startup preference.

### Phase 9: Manual authentication and packaged acceptance
**Status:** pending
- Token login at fixed URL, editable web settings, packaged tests and documentation.
