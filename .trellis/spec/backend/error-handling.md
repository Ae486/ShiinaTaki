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
- Never `catch {}` (empty). Never log-and-rethrow at multiple layers — handle once at the boundary that can act.
- Config/startup validation errors are fatal-fast with a precise message (zod `.parse`, let it throw at boot).

## Rust (Shell)

- Library-ish modules (`gate/`, `capabilities_impl/`, `services/`): `thiserror` enums per module.
- Command/adapter layer: `anyhow::Result` acceptable; convert to the shared error-code union at the WS/IPC boundary (serde-serializable error struct from `models.rs`).
- No `.unwrap()` / `.expect()` outside tests and truly-impossible invariants (document the invariant in the `expect()` message).
- Permission Gate denials are **not errors internally** — they are normal outcomes: audited, then returned as `PERMISSION_DENIED` to the core.

## What must never happen

- Panic across the FFI/IPC boundary.
- An error path that skips the audit log for a gated action.
- Retrying a side-effecting action without an idempotency check.
