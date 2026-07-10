# Research: Rust WS client + serde protocol mirror (tokio-tungstenite 0.29)

- **Query**: tokio-tungstenite 0.29 client to core; serde mirror of the zod JSON-RPC + connect + approval protocol; golden-fixture cross-check strategy; core→node capability request frames
- **Scope**: mixed (installed crate sources + installed zod schemas + probe compiled clean)
- **Date**: 2026-07-10

## Verdicts (first)

1. **`tokio_tungstenite::connect_async("ws://127.0.0.1:8974")` + `SinkExt::send`/`StreamExt::next` is the whole client.** Probe compiled clean (`cargo check` EXIT 0). Default features `["connect","handshake"]` are enough for a plaintext ws:// client — NO TLS feature needed for v1 localhost. `Message::text(...)` sends a text frame; match `Message::Text(Utf8Bytes)` on receive, `.as_str()` → serde. Answer Ping with Pong.
2. **serde mirror shape**: JSON-RPC client frames (response-success / response-error / notification) mirror as an **`#[serde(untagged)]` enum** — the wire carries no discriminant, and the TS side already uses a zod `union` (`json-rpc-schema.ts:57`). Deserialization tries variants in order; put the most specific first. Connect params use `#[serde(rename = "...")]` camelCase + `#[serde(rename_all = "lowercase")]` on the `Role` enum.
3. **Golden-fixture cross-check is the anti-drift mechanism** and it is cheap: check the SAME `.json` files into a shared fixtures dir, assert `Zod.parse` in vitest AND `serde_json::from_str::<T>` (+ round-trip re-serialize) in `cargo test`. If either side changes a field, one test goes red. This is the ONLY guard against the two-language protocol drifting (invariant 3). See fixtures strategy below.
4. **Core→node capability request = server-initiated notify + node-initiated respond**, an EXACT structural mirror of the #8 approval broker (`approval.request` notification + `approval.respond` request, correlated by id). Propose `capability.request` (core→node notification) + `capability.respond` (node→core request), correlation via a `requestId`. **The core-side method + broker do not exist yet — this is net-new work; frame shapes below are a PROPOSAL for leader sign-off (D4).**
5. **Reconnect/backoff**: wrap connect+run in a loop with exponential backoff (e.g. 500ms→cap 30s, reset on successful auth). tokio-tungstenite surfaces disconnect as `stream.next()` yielding `None` or an `Err`. No built-in reconnect — hand-rolled loop.

## Findings

### tokio-tungstenite 0.29 client API (installed-source verified)

`tokio-tungstenite-0.29.0/src/lib.rs`:
- `:58` `pub use connect::{connect_async, connect_async_with_config}`
- `:13` `pub use tungstenite;` (re-exports the sync crate — get `Message` via `tokio_tungstenite::tungstenite::Message`)
- `:64` `pub use stream::MaybeTlsStream;`

`connect_async<R: IntoClientRequest + Unpin>(request) -> Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response)>` (`connect.rs:31`). A `&str` URL implements `IntoClientRequest`.

`tungstenite-0.29.0/src/protocol/message.rs`:
- `:157` `pub enum Message { Text(Utf8Bytes), Binary(Bytes), Ping(Bytes), Pong(Bytes), Close(Option<CloseFrame>), Frame(_) }`
- `:178` `pub fn text<S: Into<Utf8Bytes>>(string: S) -> Message`
- `:186` `pub fn binary<B: Into<Bytes>>(bin) -> Message`
- `:248` `pub fn into_text(self) -> Result<Utf8Bytes>`; `Utf8Bytes` derefs to `&str` (use `.as_str()`).
- `:275` `impl From<String> for Message` (→ Text).

Splitting for concurrent read/write: `use futures_util::StreamExt; let (write, read) = stream.split();` then `write: SplitSink` (has `SinkExt::send`), `read: SplitStream` (has `StreamExt::next`). `futures-util` is already a probe dep and resolves in the locked tree.

**Message size limits (installed defaults, `tungstenite-0.29.0/src/protocol/mod.rs`)**:
```
WebSocketConfig::default() = {
  read_buffer_size: 128 KiB, write_buffer_size: 128 KiB,
  max_write_buffer_size: usize::MAX,
  max_message_size: Some(64 MiB),   // <-- inbound cap
  max_frame_size:   Some(16 MiB),
}
```
The TS `ws` server default `maxPayload` is **100 MiB** (`ws@8.21.0/lib/websocket-server.js:74`). So a screenshot base64 (a 1080p PNG is ~1-3 MB → ~1.5-4 MB base64, well under both caps) rides a normal text frame with NO config change. Only 4K multi-monitor PNGs approach tens of MB — still under 64 MiB. **Verdict: default frame sizes are fine for screenshot-over-JSON-RPC; do not raise limits in v1.**

### serde mirror of the protocol (probe-compiled)

The probe (`research/tmp/src/main.rs`) compiled these clean against installed serde 1.0.228:

**Envelope** (mirror of `json-rpc-schema.ts`): untagged enum for the 3 inbound-client frames.
```rust
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum ClientFrame {
    Success { jsonrpc: String, id: JsonRpcId, result: serde_json::Value },
    Error   { jsonrpc: String, id: Option<JsonRpcId>, error: JsonRpcErrorObject },
    Notification { jsonrpc: String, method: String, #[serde(default)] params: serde_json::Value },
}
#[serde(untagged)] enum JsonRpcId { Str(String), Num(i64) }   // mirrors z.union([string, number])
```
- `JsonRpcErrorObject { code: i64, message: String, data: Option<Value> }` with `#[serde(skip_serializing_if="Option::is_none")]` on data.
- Note: TS uses `z.strictObject` for requests/notifications (rejects unknown keys). serde is lenient by default; add `#[serde(deny_unknown_fields)]` where the zod side is strict, to keep parity (esp. request vs notification discrimination — the TS side deliberately uses strictObject so a notification carrying `id` is NOT accepted as a notification, `json-rpc-schema.ts:13-14`).

**Connect handshake** (mirror of `connect-schema.ts`):
```rust
#[serde(rename_all = "lowercase")] enum Role { Operator, Node }
struct ConnectParams {
  #[serde(rename="deviceId")] device_id: String,   // z.uuid()
  #[serde(rename="deviceName")] device_name: String,
  role: Role,
  capabilities: Vec<String>,                        // default []
  #[serde(skip_serializing_if="Option::is_none")] token: Option<String>,
  #[serde(rename="pairingCode", skip_serializing_if="Option::is_none")] pairing_code: Option<String>,
}
```
- `ConnectResult { status: "ok", token: Option<String> }` — `status` is a literal; mirror as `#[serde(rename_all=...)]` or a unit-variant/const string. The token appears exactly once (post-pairing).
- **Refinement not expressible in serde**: zod's `.refine` "operators must not declare capabilities" (`connect-schema.ts:23`) is a validation rule. The Rust node is always `role:"node"` WITH capabilities, so it never hits that branch — no mirror needed on the client, but the fixture set should include the invalid case to prove the CORE rejects it.

**Handshake flow the Rust node drives** (from `connect.ts`):
1. First connect: send `connect` with `deviceId/deviceName/role:"node"/capabilities:["screenshot"]`, NO token/pairingCode → core responds app-error `-32000` with `error.data.code="PAIRING_REQUIRED"` and logs a pairing code to the operator console.
2. Node re-sends `connect` WITH `pairingCode` → core responds `{status:"ok", token:"..."}`. **Node MUST persist that token** (keyring, see gate-audit-keyring.md) for tokenless-free reconnect.
3. Subsequent connects: `connect` WITH `token` (no pairingCode) → `{status:"ok"}`. Wrong token/role → app-error `AUTH_FAILED` and the core CLOSES the socket (`connect.ts:55` `ctx.close()`).

**App-error envelope** (mirror of `app-error.ts` + `error-code-schema.ts`): a JSON-RPC error response with `error.code = -32000` (`JSON_RPC_APP_ERROR`) and `error.data = { code: ErrorCode }` where `ErrorCode ∈ {PROVIDER_ERROR, INTERNAL_ERROR, PAIRING_REQUIRED, AUTH_FAILED, NOT_AUTHENTICATED, ALREADY_CONNECTED, FORBIDDEN}`. Mirror `ErrorCode` as a serde enum with `#[serde(rename_all="SCREAMING_SNAKE_CASE")]` (or explicit renames) so the node can branch on `PAIRING_REQUIRED` vs `AUTH_FAILED`.

Standard envelope codes (`json-rpc-schema.ts:64`): PARSE_ERROR -32700, INVALID_REQUEST -32600, METHOD_NOT_FOUND -32601, INVALID_PARAMS -32602, INTERNAL_ERROR -32603, APP_ERROR -32000.

### Golden-fixture cross-check strategy (the anti-drift contract)

**Problem**: protocol defined once in zod (`packages/shared`), mirrored by hand in serde. Nothing mechanically links them (invariant 3 says "defined once… mirrored in Rust via serde" but there is no codegen).

**Proposed mechanism** (leader to approve location — D5):
1. A shared fixtures directory of `.json` files, one per protocol message shape, with valid AND invalid instances (e.g. `connect-request.node-pairing.json`, `connect-result.ok-token.json`, `app-error.pairing-required.json`, `capability-request.screenshot.json`, `client-frame.notification.json`).
2. **TS side** (vitest): a test loads each fixture and asserts the matching zod schema `.parse` succeeds (valid) / throws (invalid). Some already exist implicitly — e.g. `connect-schema.test.ts`, `json-rpc-schema.test.ts` — but they build objects inline, not from shared files.
3. **Rust side** (`cargo test`): the same files are read (`include_str!` or a path relative to `CARGO_MANIFEST_DIR`) and asserted with `serde_json::from_str::<T>()` (valid parses, invalid errors) + a **round-trip**: `from_str` → `to_value` → compare to the parsed `serde_json::Value` (catches rename/casing drift).
4. Fixture location candidates: (a) `packages/shared/fixtures/protocol/` read by both (Rust reads via a relative `../../../packages/shared/...` path from src-tauri — brittle on the monorepo), or (b) a copied/symlinked set under `apps/desktop/src-tauri/tests/fixtures/` kept in sync by a check script, or (c) a `.trellis`-scripted generator. **D5: leader chooses the canonical fixture home + sync mechanism.**

### Core→node capability request frames (PROPOSAL — mirror of #8 broker)

The #8 approval broker (`packages/core/src/approval/approval-broker.ts`) is the reuse template: a pending-map keyed by a generated id, a notify to push the ask, a respond method to settle it, a 60s fail-closed timeout, and `denyAll` on disconnect. The SAME shape applies to core asking a NODE to run a capability — except here the flow is core→node (capability execution) rather than core→operator (approval).

Existing server-initiated pattern in code: `chat-send.ts` pushes `chat.delta`/`.complete`/`.error` notifications via `ctx.notify` after acking; `approval.request` is pushed via `ctx.notify` and answered by the operator-role `approval.respond` method (`approval-respond.ts`). **Nodes currently have NO server-initiated method** — the capability channel is net-new.

**Proposed frames** (for D4 sign-off):
```jsonc
// core -> node : JSON-RPC NOTIFICATION (no id; correlate by requestId)
{ "jsonrpc":"2.0", "method":"capability.request",
  "params": { "requestId":"<uuid>", "capability":"screenshot", "input": { /* per-cap args */ } } }

// node -> core : JSON-RPC REQUEST (node-role method)
{ "jsonrpc":"2.0", "id":"<n>", "method":"capability.respond",
  "params": { "requestId":"<uuid>", "ok":true,
              "output": { "mediaType":"image/png", "dataBase64":"..." } } }
// failure form: { "requestId":"...", "ok":false, "error": { "code":"...", "message":"..." } }
```
Design notes for the leader:
- **Correlation** via `requestId` (mirror of `approvalId`), NOT the JSON-RPC `id` — because the request is a notification (no id) and the response is a separate request with its OWN id. This is exactly how #8 decouples the two.
- **Role gating**: `capability.respond` must be a `node`-role method (mirror of how `approval.respond` is operator-role, `method-registry.ts:91` role gate). A `capability.request` notification is only sent to sockets in the tracked connection set whose declared `capabilities` include the requested one (`connection-registry.ts` `list()` + the authenticated `capabilities` field — the comment at `:3` literally says "the tracked set M3's capability router will consume").
- **Node inbound routing**: the Rust node's read loop matches on `frame.method`; a `capability.request` notification dispatches to a Rust handler keyed by `params.capability` (a small handler registry mirroring the TS method-registry's pluggable seam, invariant 7). The handler runs the gate → executes → sends `capability.respond`.
- **Fail-closed timeout**: reuse the 60s deny (broker `DEFAULT_TIMEOUT_MS`) on the CORE side if the node never responds; the NODE side likewise bounds capability execution with its own timeout.

## Caveats / Not found

- The core-side `capability.request`/`capability.respond` method + a core→node broker **do not exist in the codebase yet** — only the operator-facing approval broker (#8) exists as the template. Frame shapes above are a proposal.
- `IntoClientRequest` for adding headers (e.g. an `Authorization` token at the WS layer) exists but our protocol carries auth in the `connect` params, not headers — so no custom request builder needed for v1.
- Whether the node should send WS-level Ping keepalives (vs relying on the core) is unspecified; tokio-tungstenite does not auto-ping. Minor — flag if reconnect proves flaky.

## Leader decisions needed

- **D4 (capability frame shapes)**: approve `capability.request` (notification) / `capability.respond` (node-role request) + `requestId` correlation, OR specify an alternative. This gates BOTH the new core method and the Rust handler.
- **D5 (golden-fixture home + sync)**: where do the shared `.json` fixtures live and how are they kept in sync between vitest and cargo test? (shared dir read by both / copied-with-check-script / generated).
- **D6 (token persistence)**: confirm the node persists its pairing-issued token via keyring (see gate-audit-keyring.md) so reconnect is tokenless-free — vs re-pairing each launch.
