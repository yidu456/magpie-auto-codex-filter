# Phase 16: Console Chart Acceptance

Date: 2026-10-29. Branch: `dev-2`. Scope: approved chart improvements only.

## Sequential Delivery

| Step | Local commit | Scope |
| --- | --- | --- |
| Plan | `975a40d` | Approved design, measurement boundaries and per-step gates |
| Task 1 | `ca2ec02` | Shared-scale request curves, smooth Token curves and deep colors |
| Task 2 | `2e120c0` | Pointer-position tooltip and retained bottom detail |
| Task 3 | `9447b8e` | Horizontal distributions and fixed-height precision tables |
| Task 4 | This acceptance commit | Extended isolated browser checks and evidence |

Each implementation step passed its focused tests and independent review before
its local commit. Application assets are frozen at `9447b8e`; Task 4 changes only
acceptance tests, documentation, checksums and planning bookkeeping.

## Measurement And Interaction

- Success, failed, canceled, unavailable and actually dispatched retries share
  one linear count axis. Started counts remain in the exact table. Results use
  finish minutes and retry dispatches use dispatch minutes, not one start cohort.
- Shape-preserving cubic geometry connects observed samples without inventing
  peaks or negative counts. Missing minutes and unknown usage break connections;
  measured zero remains zero. Token input has a restrained fill; requests do not.
- Pointer time rounds to the corresponding minute on the real timeline. A gap
  reports no observation instead of borrowing neighboring values. All series are
  present in the pointer-near tooltip. Only measured values get guide markers.
- Leaving or pressing Escape hides the floating detail, not the bottom selection.
  Polling refreshes that selection from the new snapshot; expired or empty data
  cannot leave stale measured values. Left/right keys inspect real buckets, and
  the chart container retains keyboard focus through redraws. Touch also inspects.
- Eight horizontal latency bins show observed counts and sample shares. Counts
  must sum to the sample count. Means retain sum/count semantics; no percentile
  or minute-average latency is inferred. Error rankings count occurrences, not
  failed requests, and bound unknown bar labels to 80 characters. Exact tables
  retain full literal labels.
- All eight dashboard precision tables use native disclosures, fixed 240px
  internal scroll regions and sticky headers. Bottom chart details remain outside
  disclosures. Horizontal overflow stays inside tables on small screens.

## Verification

| Gate | Result |
| --- | --- |
| Full `npm test` | 445 total, 443 passed, 0 failed, 2 skipped |
| Chart/assets/strict source manifest | 16 passed, 0 failed |
| Complete isolated browser harness | Passed, `pageErrors: []` |
| Viewports | 1280, 736, 390 and 320px; no page-width overflow |
| Source materialization | Manifest hashes survive fresh Git checkouts with autocrlf on and off |
| Whitespace | `git diff --check` passed |

The two skipped tests are native Unix listener inspection and native Unix archive
launcher-mode tests, not chart failures. This run is on Windows using Chromium
via the installed Chrome channel. No new dependency was installed.

The committed browser harness verifies shared geometry for equal request/retry
data, all five cubic paths, exact Token endpoints/zero, null and missing minutes,
single buckets, polling, old/empty snapshot replacement, tooltip bounds, keyboard
focus, safe labels, fixed table height and sticky headers. It also exercises the
existing login, navigation, settings, consent and owned-fixture restoration cases.

Task-private `visual-check.cjs` additionally uses a native touchscreen-enabled
browser context and checks 48 edge/time hover positions across both charts and
the four viewport widths. Actual-render screenshots were inspected for mobile
requests, desktop Token gaps, pointer details, horizontal latency bins and a
scrolled 320px precision table. These are synthetic isolated fixtures, not live
provider measurements.

## Failures Resolved During Acceptance

- The metrics-only harness inherited a narrow viewport from an earlier navigation
  case. Its record-table keyboard-scroll check now explicitly selects 390px.
- Chrome can omit native leave events when a redraw replaces the SVG hit target.
  A once-per-chart outside-pointer check dismisses the floating detail. Acceptance
  waits through a poll before leaving, preserving the bottom selection.
- A new malicious-label check initially expected the full string in a bounded
  ranking. It now verifies the literal first 80 characters, the full exact-table
  label, and no HTML execution. The failed run is retained privately.

## Preserved State And Limits

Local refs remain unchanged:

- `main`: `cd68b072ddf3475203d42661d9cdca3a93212100`
- `v0.1.0-dev` tag object: `2bf245cf6b8a7e68f36c1573f844bdcce9944ebe`
- `v0.1.0-dev.1` tag object: `ad8b006710c89231091a42d63e04f952c12fb209`
- `v0.1.0-dev.1` target: `c8d5bd78b7c7de798078acfd156805f98aac93a4`

Preserved local executable SHA-256 values:

- `dist/dev-2/MagpieFilter.exe`: `4db96d472338365d1adb51da103c061198bfcb39c2a40b5d26d3cb701fd90157`
- `dist/dev-3/MagpieFilter.exe`: `eb493cdd7004221ff25895a88e17aa1dca3474b5effd416cefa9e120b5575935`

Package version remains `0.1.0-dev.1`. No backend metric, API, dependency, policy,
authentication or CSP change; no push, tag, Release mutation or binary rebuild.
No real-provider requests or user-owned process actions. Existing published and
local EXEs therefore do not contain these source-only chart improvements yet.

Local logs, source/ref/executable hash assertions and screenshots are retained in
`.superpowers/sdd/2026-10-29-charts/` and `.verification/task-4-browser/`; private
evidence is intentionally excluded from the distributable source manifest.
Other browser engines, real mobile hardware and manual screen-reader behavior
were not tested. Unix native packaging was not repeated in this phase.
