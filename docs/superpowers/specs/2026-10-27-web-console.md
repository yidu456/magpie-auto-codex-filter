# Magpie Local Web Console

## Approved direction

The user approved building the previously discussed EXE/browser console on the
literal `dev` branch, first writing a plan, then implementing and committing each
completed step. No push, release, real-client takeover or paid model calls are
authorized by this development task. Work in the supplied standalone checkout;
leave `main` and the existing running service alone.

## Product contract

- Windows, Node.js 24.12 or newer; no production npm dependencies.
- One Windows EXE with an embedded Chinese browser UI; no Electron/WebView.
- Codex + Magpie only. Config path, loopback upstream and filter port are editable.
- Open the console on double-click. Repeated launches reopen the existing instance.
- Use a separate console runtime, never the legacy `.runtime` directory.
- First generated configuration defaults core OFF; later launches honor the saved enabled preference (approved portable-config amendment).
- First enable attaches matching Codex endpoints after the proxy is listening.
- Disable means byte-preserving HTTP/SSE passthrough, not shutdown or config restore.
- Closing the browser leaves the service running. Explicit disconnect/exit restores
  exact owned addresses and requires no active proxy requests. Restoration failure
  keeps the proxy and control server alive and reports an actionable error.
- While attached, endpoint changes are refused; disconnect first. Do not auto-kill
  or claim unknown processes. Never import another installation's runtime files.

## Runtime policy

Policies are immutable snapshots captured before the first asynchronous request
operation; each snapshot has a revision. Settings affect new requests only,
including when an older request is waiting to retry. Gateway/service identity is
independent from policy; legacy CLI modes keep their defaults.

Three cleaning policies: `always`, `conditional`, `never`. Always uses the exact
existing safe CCS cleanup. Conditional uses existing explicit HTTP400/SSE error
recognizers, once per request. Never preserves history but retains selected
recovery protections. Core OFF skips JSON manipulation, retry, and SSE buffering.

Independent checkboxes (default ON, preserving current behavior):

| Key | Scope | Existing budget |
| --- | --- | --- |
| azureResource | Exact different-Azure-resource error; conditional cleanup/retry | resource 5 |
| encryptedContent | Exact invalid_encrypted_content; conditional cleanup/retry only | resource 5 |
| rateLimit | Temporary throttling, never quota/billing/auth | rateLimit 20 |
| transport | Network errors and idle timeout | transport 10 |
| streamIncomplete | Incomplete/disconnected SSE and detail-free response.failed | transport 10 |
| alb400 | Precisely matched ALB HTML400, raw or known wrapper | transport 10 |
| unavailable | Explicit no_available_channel | availability 10 |
| bufferResponse | Hold successful Responses SSE until terminal completion | n/a |
| heartbeat | Empty progress keepalives while awaiting a buffered response | n/a |

Unchecked recovery handlers return the original HTTP error / a terminal SSE error
without cleanup or replay. Shared budgets remain max 20 extra attempts and 30 min,
honor Retry-After, and stop on cancellation. With buffering OFF, stream bytes
immediately and never replay after forwarding begins; late SSE error recovery and
cleanup are unavailable and UI explains this dependency. HTTP pre-stream errors
can still use selected recovery handlers. `heartbeat` is effective only with
buffering ON. Authentication, request limits, local-origin validation, recovery
ownership, cancellation and tool-pair integrity are mandatory, not checkboxes.

## Control/security architecture

Reuse `makeProxy` and Magpie `ConfigRouter`. Add a small controller, a separate
loopback HTTP management server, static UI and a launcher. The model proxy keeps
its existing browser rejection. Management enforces exact Host/Origin, rejects
cross-site fetches, authenticates all APIs with a persistent configuration token, limits
JSON bodies, whitelists settings and serializes mutations. The token is passed in
the initial URL fragment and moved to sessionStorage, never returned in status or
logs. No permissive CORS, remote scripts, remote fonts, model keys or request bodies.

Settings persist atomically before publication; invalid settings or failed writes
do not change the live policy. Revisions prevent stale tabs overwriting changes.
Controller returns filtered status, bounded metadata-only event history, active
request count and policy revision. Config attach state is distinct from core ON.
Recovery journal is saved before rewriting any address and used after a crash.

## UI direction

Compact Magpie-like control surface rather than a landing page: navigation rail,
connection strip, prominent core switch, three segmented policy choices, grouped
checkbox rows and request event list. Cool porcelain background (#f3f6fa), ink
(#192d42), teal (#087f83), blue (#315fc3), amber (#9b650b). Chinese text uses local
Microsoft YaHei UI, data uses Cascadia Mono. No external font/network dependency.
Responsive single-column mobile view, real labeled controls, visible focus,
reduced-motion support, error/status live region and dirty-form protection.

## Distribution and evidence

Bundle CommonJS with build-only esbuild, inject Node SEA using build-only postject.
Ship the EXE without bundling Magpie or Codex. External settings/log/recovery files
are expected. Windows GUI-subsystem launch must not leave a console window. Build
artifacts include SHA256 and Node licensing. Unsigned EXEs may prompt SmartScreen.
Tests use isolated fixtures/mock upstreams. Verify CLI compatibility, each checkbox,
in-flight snapshots, passthrough bytes, safe streaming, management auth, restoration,
real browser UI, packaged startup/reopen/exit, and clean Git state at each commit.
