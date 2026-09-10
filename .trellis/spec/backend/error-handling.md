# Error Handling

## Principle

A failing Capability or tool call must degrade into a **structured error the LLM can read and react to** — never a crash, never a silent swallow.

## TS (Agent Core)

- Tool `execute()` catches everything and returns a structured result:
  ```ts
  { ok: false, code: "PERMISSION_DENIED" | "TIMEOUT" | "SHELL_UNAVAILABLE" | ..., message: string }
  ```
  The LLM sees the code + message and can retry, ask the user, or give up gracefully.
- Error codes are a closed union in `@taki/shared` (zod enum) — shared with Rust. Add codes there, not inline strings.
- Governance outcomes keep policy semantics explicit: canonical tool wrappers use `GOVERNANCE_DENIED` or
  `APPROVAL_REQUIRED`; Host capability responses use the corresponding bounded broker outcome. An effective `ask` is
  not a generic permission denial and must remain distinguishable so the later canonical Approval lifecycle can resume
  it without adding a second policy lane.
- WS/JSON-RPC errors follow JSON-RPC 2.0 error objects; map protocol errors to the same code union.
- Durable Run/Attempt/Receipt evidence and streamed `chat.error` payloads use sanitized outcome summaries and stable
  error codes; never copy provider exception messages, request bodies, prompts, tool payloads, or credentials into
  persistence, logs, or transport notifications.
- Desktop ordinary requests are bounded at the `json-rpc-2.0` native timeout requester. An outer `Promise.race` is
  forbidden because it does not remove the library's pending request ID. A native timeout becomes the typed
  `RpcDeadlineExceededError`; non-timeout JSON-RPC application errors pass through unchanged for existing refusal
  handling.
- Deadline messaging must distinguish outcome class. Read-only timeout means an explicit reread is safe; mutation or
  chat-ack timeout means the remote outcome is unknown and the operation was not replayed. Retiring a whole connection
  may reject every pending request, but one request timeout must not reject concurrent requests.
- WebSocket open plus `connect` authentication share one captured total budget. If opening consumes it, no late
  handshake frame may be sent. A successful open does not reset the budget.
- Never `catch {}` (empty). Never log-and-rethrow at multiple layers — handle once at the boundary that can act.
- Config/startup validation errors are fatal-fast with a precise message (zod `.parse`, let it throw at boot).
- Streamed WS methods (ack response + event notifications): the ack MUST be sent before the first event — defer the stream pump to a **macrotask** (`setImmediate`); microtask deferral is insufficient because the response path itself crosses several `await`s. Pin the ordering with a test (see `server/methods/chat-send.ts`).
- The method registry converts uncaught handler throws into JSON-RPC `INTERNAL_ERROR` responses — a throwing handler must never become an unhandled rejection that kills the core process (regression-tested in `method-registry.test.ts`).
- App-level refusals NEVER reuse JSON-RPC envelope codes: `-32600`/`-32601`/`-32602`/`-32700` are reserved for structurally invalid traffic; every semantic refusal (auth, pairing, roles, state) rides `-32000` (`JSON_RPC_APP_ERROR`) with `data.code` from the closed `ErrorCode` union — one path for the Rust Shell to mirror, no special cases.
- Pre-auth connections are fail-closed: before a successful `connect`, ANY invalid or non-connect frame (well-formed or garbage) gets one error reply, then the socket closes. Authenticated connections are fail-tolerant: a bad frame must not kill a live session. Both behaviors are pinned by tests (`ws-server.test.ts`).
- Core-owned state files follow the same asymmetry: **auth state is fatal on corruption** (`devices.json` — a tampered trust root must stop the core), while **extension/re-derivable state degrades to warn + empty** (`mcp-servers.json`, `mcp-approvals.json`, `skills-state.json` — worst case the operator reconfigures or is asked again). Pick the policy by asking "is a corrupt file a security event or an inconvenience?" and say which in the loader's header. The same question puts **privacy state in the fatal camp**: the persisted Privacy Pause row is zod-parsed at the DB boundary and a corrupt row THROWS at boot (`db/privacy-pause-repo.ts`) — degrading it to "not paused" would silently resume observing a user who asked us to stop. Likewise a privacy KILL SWITCH parses strictly (`config/ambient-screenshot-config.ts` takes only true/1/false/0 + drop/keep/N-days): an unrecognized value is fatal, never a default in either direction, because a typo that quietly means ON is fail-open and one that quietly means OFF is a lie.
- Canonical Approval (Slice 4) is fail-closed on every non-affirmative path: timeout, disconnect, absent operator
  channel, invalid response, or thrown decision handler must not authorize execution. Before that lifecycle is active,
  an effective governance `ask` returns structured `APPROVAL_REQUIRED` without execution; do not revive the retired
  Shell-local prompt or a temporary decision writer.

## Rust (Shell)

- Library-ish modules (`gate/`, `capabilities_impl/`, `services/`): `thiserror` enums per module.
- Command/adapter layer: `anyhow::Result` acceptable; convert to the shared error-code union at the WS/IPC boundary (serde-serializable error struct from `models.rs`).
- No `.unwrap()` / `.expect()` outside tests and truly-impossible invariants (document the invariant in the `expect()` message).
- Host governance `deny` and `ask` are **not Rust exceptions internally** — they are normal non-executing outcomes:
  audit where applicable, attach bounded evidence, then return denial or `APPROVAL_REQUIRED` to Core.

## What must never happen

- Panic across the FFI/IPC boundary.
- An error path that skips the audit log for a gated action.
- Retrying a side-effecting action without an idempotency check.

## Scenario: Hindsight HTTP deadlines and bounded responses

### 1. Scope / Trigger

Applies when changing `hindsight-client.ts`, its default network delegate, or a Hindsight endpoint consumer. A finite
application timeout does not override an HTTP library's separate header/body timers. The actual D78 investigation
reproduced early Undici phase timeouts while the longer application signal was still active.

### 2. Signatures

- `createHindsightClient({ endpoint, resolveApiKey, transport? }): HindsightClient` retains the injected transport seam.
- `HindsightCallContext` carries `timeoutMs: number` and optional `signal: AbortSignal`.
- `hindsightHttpTransport(input, init, { maxBytes?, responseStatuses? })` is the default HTTP/HTTPS delegate.
- `HindsightTransportResponse` contains `status`, optional `Headers`, and decoded `body: string`.

### 3. Contracts

- The timeout is a positive safe integer no greater than `2_147_483_647` milliseconds. Reject unsupported values before
  dispatch rather than letting Node clamp an overflowing timer to one millisecond. Public connection defaults are
  independent of a task's explicit long-running validation budget.
- Capture one total deadline before transport dispatch. Its signal covers connection, headers, body and decompression;
  neither receiving headers nor another body chunk resets the budget. The default delegate has no shorter implicit
  phase timer, global dispatcher mutation, redirect following or automatic retry.
- Retain the first abort cause. A later caller cancellation cannot relabel an earlier deadline, and vice versa.
  Observe the composed signal immediately, including for injected transports that do not subscribe themselves;
  Node's unobserved `AbortSignal.any` may resolve its reason lazily. Dispose the listener and timer in `finally`.
- Preserve endpoint policy, current API-key resolution and HTTPS certificate validation. Reject unsupported request
  shapes before dispatch; do not allow embedded URL credentials, alternate transport schemes or transfer/upgrade
  headers to introduce an unreviewed path.
- Count decoded UTF-8 bytes while streaming, including after gzip/deflate/Brotli decompression. The ordinary response
  limit remains 512 KiB; only the explicit D78 methods receive their separate 16 MiB limit. Exceeding a limit destroys
  the owned stream/request and refuses the response. Never truncate JSON into an accepted result.
- HEAD and bodyless statuses do not decode an absent representation merely because a content-encoding header exists.
- Parse only an endpoint's declared refusal envelopes before generic HTTP classification. An unrelated 403 body is
  authentication failure; a matching typed operational refusal retains its endpoint meaning. Unknown error text,
  caller abort reasons and private response contents never become public diagnostic messages.
- Timeout/disconnect does not prove that a mutation was absent or rolled back. Recovery reads the existing durable
  operation/verification identity; transport never automatically dispatches that mutation again.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Slow headers/body within the captured budget | Complete normally without a hidden phase deadline. |
| Total deadline expires across phases or while decoding | `HINDSIGHT_TIMEOUT`; stop the owned request. |
| Caller cancellation wins, including delayed settlement | `HINDSIGHT_CANCELLED`; do not acknowledge a mutation. |
| Both abort sources have fired before transport settles | Preserve the first cause, independent of source-array order. |
| Oversized body, bad JSON or invalid declared payload | `HINDSIGHT_RESPONSE_INVALID`; no partial accepted evidence. |
| Matching declared native 403/413/503 refusal | Validate and retain the typed refusal. |
| Undeclared 401/403, redirect, connection/TLS failure | Existing sanitized classification; no credential forwarding, TLS bypass or retry. |
| Committed mutation followed by a lost response | Unknown until the original durable identity is read; no second dispatch. |

### 5. Good / Base / Bad Cases

- Good: a split multibyte response exactly at the byte limit is decoded intact; a larger response is stopped.
- Base: a healthy default-client call and a deliberately injected transport keep the same cancellation/error contract.
- Bad: increase an outer timeout while leaving an independent HTTP timer active, or replay a POST after its response is lost.

### 6. Tests Required

Use owned real loopback HTTP/TLS servers for the default delegate: delayed headers/body at different timings, total
budget across phases, both cancellation orders, gzip/deflate/Brotli, empty bodies, exact/over-limit UTF-8, refusal
envelopes, redirects, connection reset and certificate rejection. Verify one request per mutation and status-read
recovery after acknowledgement loss. Keep late-settlement tests for an injected transport that ignores abort.

Changing the default delegate requires updating tests that stub `globalThis.fetch` to reach the actual supported seam.
Preserve their byte-limit, early-stop and error-envelope assertions; do not let a disconnected mock create false coverage.
Run the Core suite and the owned native HTTP-to-SQLite cutover fixture before actual-data acceptance.

### 7. Wrong vs Correct

```ts
// Wrong: this alone does not override a fetch implementation's internal phase timers.
await fetch(url, { signal: AbortSignal.timeout(longBudget) });

// Correct: the production client owns the complete transport/deadline/error contract.
const client = createHindsightClient({ endpoint, resolveApiKey });
await client.health({ timeoutMs: 10_000, signal: callerSignal });
```
