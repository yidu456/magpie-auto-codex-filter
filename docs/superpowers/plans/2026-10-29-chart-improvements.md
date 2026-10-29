# Magpie Chart Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Execute sequentially in the supplied dev-2 checkout; request independent review at each commit gate.

**Goal:** Implement the approved same-plot smooth charts with pointer-position detail popovers, retained bottom detail, high-contrast colors and fixed-height precise tables.

**Architecture:** Keep all rendering in the existing browser assets and consume the existing bounded metrics snapshots. No new dependency, API or backend metric. Shape-preserving interpolation connects measured samples only; pointer time selects the real minute bucket, not interpolated token/count values.

**Tech Stack:** Vanilla browser JavaScript, CSS, SVG, Node test runner, isolated Chromium fixture.

**Spec:** User-approved combined preview and follow-ups in this chat: five request-result/retry curves on one linear scale; smooth Token curves; deep colors; precise table240px; tooltip near mouse plus bottom detail retained.

## Global Constraints

- Work sequentially on dev-2; local commit after each completed item. No push, tag, version bump or binary rebuild.
- Preserve existing theme, authentication/CSP, runtime, startup settings, main/tag refs and delivered EXEs.
- Request curves: success, failed, canceled, unavailable, retries (actually dispatched), all on one shared linear count axis. Started remains in exact table; starts and finishes are not one cohort.
- Usage null is unobserved, zero is valid; missing minutes and invalid values break curves. No fake zero or invented minute-average latency.
- Smooth only the geometry, not the values. Bound cubic tangents to avoid overshoot/negative counts.
- Tooltip anchors to pointer, clamps/flips inside chart, shows exact minute values for all series. Missing minute says no observation rather than borrowing adjacent data.
- Bottom selected-minute detail stays visible; touch and keyboard have equivalent exact-value inspection. Leave hides popover but retains bottom value.
- Keep exact tables, fixed240px internal scrolling and sticky headers; mobile overflow belongs inside tables.
- Refresh strict SHA256SUMS.txt for all public edits/additions before each commit; LF bytes and fresh materialization gates stay intact.
- Test only isolated fixtures. Record fresh evidence and independent review before each commit; do not commit failing tests.

## Task 0: Plan And Baseline

- [x] Compare existing source and approved preview; restore selected planning state.
- [x] Confirm clean dev-2 at50b0bf4 and baseline assets/source-manifest8/8.
- [x] Record this plan and Phase16 bookkeeping; assets/manifest8/8, clean diff and independent plan review approved; commit plan only.

## Task 1: Same-Plot Smooth Trends

**Files:** console/ui/app.js, console/ui/app.css, console/ui/index.html, console/charts.test.cjs, SHA256SUMS.txt.
**Interfaces:** Existing trend(id, series, fields); add pure chartSegments(series,key) and smoothPath(points). Existing renderMetrics supplies five request fields and two usage fields. Preserve histogram until Task3.

- [x] Write failing tests against actual browser helpers: gaps/null/zero, bounded cubic endpoints/extrema, invalid values, single sample and unsorted/duplicate minutes.
- [x] Run node --test console/charts.test.cjs; confirm expected RED.
- [x] Implement bounded segments, monotone interpolation, responsive measured-width SVG, five deep-color request curves and two Token curves, independent HTML legends and proper units/grid/ticks. Add bottom detail targets for Task2.
- [x] Run focused tests plus assets and strict manifest gates; inspect isolated rendering at desktop/mobile. Update progress and plan.
- [x] Request independent review; fix important findings, reverify and commit feat: improve console trend charts.

## Task 2: Pointer Popover And Retained Detail

**Files:** console/ui/app.js, console/ui/app.css, console/charts.test.cjs, scripts/browser-smoke.js, SHA256SUMS.txt.
**Interfaces:** trend uses one transparent plot overlay and a per-container tooltip; pure minute lookup/tooltip placement helpers are directly tested. Keyboard left/right selects real minute, Escape dismisses popover. Poll/redraw must not leak handlers or destroy active selection unnecessarily.

- [x] Add failing unit/fixture checks: pointer-to-minute mapping including gaps/single bucket, exact zero/null formatting, tooltip clamping at all chart edges and old snapshot replacement.
- [x] Implement pointer-near tooltip with all series rows, guide and measured markers; update bottom selection at the same time. Safe text nodes only. Leave hides popover, touch/keyboard inspect values.
- [x] Verify focused tests plus isolated browser hover at left/right/zero/missing/empty, tooltip geometry, retained bottom text and keyboard/mobile behavior. Refresh manifest.
- [x] Review, update bookkeeping and commit feat: show chart details at pointer time.

## Task 3: Distributions And Fixed Precision Tables

**Files:** console/ui/app.js, console/ui/app.css, console/ui/index.html, console/charts.test.cjs, console/assets.test.cjs, scripts/browser-smoke.js, SHA256SUMS.txt.
**Interfaces:** histogram keeps real bounds/count/sum semantics, displays horizontal counts/share. Error-category ranking consumes errorsByKind, retains category/code exact tables and safe bounded labels.

- [x] Add RED checks for histogram consistency, eight labeled intervals, zero bins, count/share arithmetic, sorted error ranking, malicious labels and fixed-height table markup.
- [x] Replace vertical bins with horizontal rows and add sorted error-category bars. Keep mean/sample explanations; no percentile estimates. Wrap precise tables in details with240px internal scrolling/sticky headers; retain bottom chart detail outside tables.
- [x] Update existing histogram browser expectation deliberately; run focused and manifest tests, desktop/mobile/expanded-table visual acceptance.
- [x] Review, record evidence and commit feat: clarify metric distributions and precise tables.

## Task 4: Integration Acceptance And Handoff

**Files:** scripts/browser-smoke.js, docs/verification-phase16.md, SHA256SUMS.txt and selected planning files.

- [ ] Extend isolated browser acceptance for real metric fixtures: combined scales, smooth endpoints, pointer tooltip/all values, missing minutes and Token gaps, zero, repeated polls, safe text, keyboard/touch,240px tables and sticky headers; 1280/736/390/320 widths.
- [ ] Run complete browser harness and npm test at stable final bytes; run strict source manifest and git diff --check. Preserve/verify existing refs and EXE hashes read-only.
- [ ] Independent final review; repair and rerun relevant gates if needed.
- [ ] Record exact evidence/limits, mark Phase16 complete and commit docs: record chart acceptance. Report commit per item; no automatic push or release.
