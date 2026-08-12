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
- WS/JSON-RPC errors follow JSON-RPC 2.0 error objects; map protocol errors to the same code union.
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
- Approval-style gates (operator/permission asks) are fail-closed on EVERY non-affirmative path: timeout, disconnect, absent ask channel, thrown decision fn — all must resolve to deny, and the deny default must be pinned by a test that fails if flipped (`approval-gate.test.ts`, `approval-broker.test.ts`).

## Rust (Shell)

- Library-ish modules (`gate/`, `capabilities_impl/`, `services/`): `thiserror` enums per module.
- Command/adapter layer: `anyhow::Result` acceptable; convert to the shared error-code union at the WS/IPC boundary (serde-serializable error struct from `models.rs`).
- No `.unwrap()` / `.expect()` outside tests and truly-impossible invariants (document the invariant in the `expect()` message).
- Permission Gate denials are **not errors internally** — they are normal outcomes: audited, then returned as `PERMISSION_DENIED` to the core.

## What must never happen

- Panic across the FFI/IPC boundary.
- An error path that skips the audit log for a gated action.
- Retrying a side-effecting action without an idempotency check.
