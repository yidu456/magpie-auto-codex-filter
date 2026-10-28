# Magpie dev-2 V11 Adaptation Design

## Status and Goal

The user approved this compatibility design and explicitly requested the literal branch `dev-2`. Baseline: standalone `2649f98`, upstream reference `837f793`; all 123 baseline tests pass. On 2026-10-28 the user also required theme-matched charts and separate pages for request records and usage instructions. During Task 4 the user further required the home page to contain only charts and the core filter switch, with all other settings on a separate settings page.

Adapt upstream recovery, protected streaming, and observability to the existing Magpie console. Do not replace the standalone implementation with the CC Switch implementation.

## Chosen Approach

Implement small, independently tested changes in the current checkout on `dev-2`. Reuse the current proxy, immutable policy snapshots, controller, authenticated state endpoint, and browser UI. Adapt the upstream metrics concepts into a separate local recorder. Keep legacy CLI lifecycle and configuration routing unchanged.

Replacing the proxy wholesale is rejected because it would remove Magpie context delegation, invalid-encrypted-content recovery, policy switches, and console lifecycle guarantees. Building a second dashboard server is rejected because the existing authenticated console already provides the necessary boundary.

## Compatibility Contract

- Keep `dev` at its current commit. Do not push, merge, stop user processes, or alter real Codex/Magpie configuration during development.
- Build the new executable only at `dist/dev-2/MagpieFilter.exe`; preserve both existing executable locations and their adjacent configuration/runtime files.
- Existing version-1 portable configuration must load without user editing. Reading it must not rewrite it. Existing atomic saves, external-edit conflicts, web-token rotation, startup preference, and recovery ownership remain intact.
- Compatibility is old-config-to-new-program, not new-config-to-old-program: the old strict validator will not understand new policy fields. Keep the old executable and its original adjacent config as the rollback pair; never point both versions at one writable config/runtime.
- Retain cleanup modes `always`, `conditional`, and `never`, the core bypass, existing handler preferences, and per-request policy snapshots.
- Conditional/never mode continues preserving `store`, reasoning, IDs, include, and context references on its initial request. Keep Magpie compaction delegation. Only an actual conditional cleanup applies the existing safe stripping rules; do not force the CC Switch lazy-mode restrictions onto Magpie.
- Preserve Azure and `invalid_encrypted_content` cleanup, one cleanup per request, tool `call_id` pairs, cancellation, and request-size validation.
- Retain existing default behavior: newly generated config has core OFF and full response buffering. Existing unbuffered config stays direct streaming until the user selects protected streaming.
- Runtime remains dependency-free on Node.js 24.12+ or the embedded runtime. Reuse existing browser assets; no CDN, telemetry, or third-party chart dependency.

## 1. Bounded Recovery Extension

Restore HTTP-wrapped explicit disconnection recovery and add recognized relay/server errors: `cc_switch_forward_failed`, `bad_response`, and `server_error`. Add fallback recovery for otherwise unclassified JSON-object HTTP 5xx errors, not arbitrary HTML/text responses.

HTTP relay/disconnection/5xx recovery uses the existing `transport` switch and ten-retry transport allowance. Explicit SSE relay/server errors also use `transport`; detail-free failures and incomplete streams continue using `streamIncomplete`. Update UI descriptions to state these boundaries.

Classification order is authoritative: first exclude HTTP 401/403 and explicit authentication, permission, billing, balance, quota, invalid-parameter, and invalid-encrypted-history business failures; then classify specific supported errors; only then consider generic JSON 5xx fallback. Do not turn an excluded history error into a gateway retry. Existing valid HTTP-400 conditional history cleanup remains a separate path.

Disabling a specific recovery path must not cause fallback into a different enabled category. Generic gateway recovery must not consume resource or availability budgets. Existing per-category limits, aggregate 20-extra-attempt limit, 30-minute deadline, Retry-After minimums, and cancellation remain enforced.

## 2. Three Response Delivery Modes

Preserve `policy.bufferResponse` and add optional boolean `policy.protectStreamStart`, default `false`. This avoids renaming or reinterpreting saved booleans. Normalize and validate the new field with the rest of the immutable policy.

The UI replaces the buffering checkbox with a three-choice delivery selector:

| UI mode | bufferResponse | protectStreamStart | Behavior |
| --- | --- | --- | --- |
| Full buffering | true | false | Existing whole-round protection; default unchanged |
| Protected streaming | false | true | Inspect before first content delta; then stream without replay |
| Direct streaming | false | false | Existing immediate forwarding; no in-band error interception |

If both booleans are true in hand-edited configuration, full buffering takes precedence; retain the preference without interpreting it as an invalid configuration. UI saves the unambiguous pairs shown above.

Protected streaming buffers at most the existing 64 MiB limit before delivery. It parses complete SSE frames across UTF-8 and network boundaries, retries enabled early errors, then flushes the prelude and streams once the first content delta is observed. Completion without deltas is delivered once. JSON primitives, unknown event names, and text resembling terminal events must not crash or spoof completion.

After any real content delivery, never retry, clean history, or replay client tools. Continue bounded passive inspection only for completion, errors, and usage. Late failures remain failures even when HTTP status is 200. Cancellation/deadline ends the connection without replay. Honor downstream backpressure; neither the prelude nor passive parser may retain the complete post-delivery response.

Heartbeat remains independently controlled and may run during protected pre-delivery/retry waiting as well as full buffering. It stops at content delivery. Direct/core-OFF modes do not synthesize progress events. Policy changes affect only new requests.

## 3. Observability in the Existing Console

Add a recorder owned by the controller, surviving proxy disconnect/reconnect within that controller process. The proxy exposes optional structured observation events; legacy callers may omit the observer. Observation failure must not break forwarding or recovery.

Record request start/finish, delivery time, retry scheduling/execution/recovery/exhaustion, cleanup, and validated response usage. Store only bounded metadata: internal request ID, bounded model label, stage, status, duration, retry classes/codes, counts, and token numbers. Never retain request/response text, headers, credentials, reasoning content, or tool arguments/results.

Expose a `metrics` snapshot through the existing token/Host/Origin-protected `/api/state`, reusing current polling. No separate listening port, EventSource token in a URL, or new unauthenticated endpoint.

Console additions:

- Daily started/success/failed/canceled request counts and successful retry recoveries.
- Average first-delivery latency and first-delivery/total-duration distributions.
- Input/output/cached tokens from observed `response.completed.usage`; no invented values for missing usage or billing claims.
- Error categories/codes and retry scheduled/executed/recovered/exhausted/planned-wait statistics.
- Up to 180 event-bearing minute buckets, 200 recent request records, and active-request stages.
- History retained/removed and actual cleanup-request counts, distinct from retry executions.

Keep existing controls and event table. Use small dependency-free SVG charts and accessible text/table summaries within the current light blue/teal theme, typography, spacing and card treatments. Split the interface into four navigable pages: home dashboard, settings, request records, and usage instructions. The home dashboard contains only aggregate charts/KPIs and the core filter switch, with concise operational status. All other controls, including connection, cleanup mode, recovery handlers, delivery mode and web/portable configuration, belong on the settings page. The records page contains active/recent requests and diagnostic events; the instructions page contains detailed usage and recovery guidance. They must not all appear on the same page. Use local query-based navigation (`/?page=settings`, `/?page=records`, `/?page=help`) and the same shell/assets; keep login fragments separate. Direct navigation, refresh, back/forward, current-page indication and mobile navigation must work. Verify all four pages at 390px mobile and desktop layouts, keyboard access, and dynamic text escaping.

Persist same-local-day aggregates atomically to the console runtime's `metrics.json` once per minute and on orderly close. Curves/recent details remain memory-only. Preserve in-flight requests across midnight; attribute events to the day they occur. Validate persisted data; invalid/oversized snapshots must not block proxy startup. Surface persistence problems as a nonfatal diagnostics warning. Do not change config revision when metrics change.

Core bypass stays byte-transparent and does not parse response bodies to obtain tokens. Label its usage unavailable rather than falsely reporting measured zero; ordinary lifecycle counting may still occur.

## 4. Request Bytes and Logging

After existing type/size validation, conditional/never initial requests reuse the decoded original JSON bytes instead of serializing unchanged objects. Actual cleanup still serializes the transformed body and recalculates Content-Length. Core OFF continues preserving compressed bytes exactly. This is a serialization optimization, not a guarantee of lower model latency or token cost.

Replace the console's per-event synchronous append with a bounded asynchronous batch writer. Preserve the existing sanitized event schema and approximately 1 MiB/512 KiB retention behavior. Serialize append and rotation operations; drain pending writes during normal close before exit. Disk errors must neither fail model requests nor prevent endpoint restoration. Keep memory bounded if the disk is slow, and expose a nonfatal dropped-log warning if the bounded queue must discard diagnostic rows. Do not refactor legacy CLI logging in this iteration.

## 5. Verification and Delivery

Use test-first changes and a verified local commit per implementation step. Test negative classification cases as well as successful retries; disabled-handler behavior, mixed budgets, canceled backoff, compressed payloads, and policy snapshots are mandatory coverage.

Streaming tests cover early errors, first-delta latency, late failure without replay, tool pairing, completion without delta, fragmented UTF-8/SSE, misleading text, unknown events, bounded buffers, backpressure/cancel, deadlines, and usage counted once. Metrics tests cover success/failure/cancel, retry recovery semantics, missing usage, day rollover, same-day hydration, malformed persistence, and reconnects.

Run the complete suite, isolated desktop/mobile browser acceptance, and packaged EXE lifecycle tests with temporary configs and loopback mock upstreams. Test a copy of an old version-1 configuration without changing the user's real file. Verify the new EXE from a different working directory with no Node PATH, singleton reopening, config restoration, and pending web-token/port rotation.

Do not call real paid models or claim measured production speed, quality, cost, or recovery improvements. Final delivery identifies the separate executable, source commits, test results, unsigned status, and a manual transition procedure that first restores the old instance's endpoints.

## Review Check

The intended changes are limited to proxy/policy, recorder, console logging/controller/UI, their tests, packaging fixtures, and documentation. No routing replacement, dependency addition, config migration rewrite, remote deployment, or automatic switchover is included. Implementation sequencing follows after user review of this compatibility contract.
