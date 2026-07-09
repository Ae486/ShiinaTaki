# PRD — Device identity, pairing handshake, operator/node roles

**GitHub issue**: #4 (`Ae486/ShiinaTaki`, milestone M1). Parent: #1. Blocked by: #3 (DONE, commits `fcbbf6c..5ee2a7c`).
**Trellis task**: `07-09-device-pairing`

## 1. Goal

The security + topology foundation of the WS protocol (ADR 0004): every client presents a device identity and a role on connect; unknown devices go through a pairing approval and receive a token; paired devices reconnect with the token. Roles (`operator` = converses/configures, `node` = provides capabilities) are enforced at dispatch. Nothing assumes localhost — the v1.5 VPS topology and the future phone node ride on this unchanged.

## 2. Scope

**In**: `connect` handshake (the ONLY pre-auth method) · pairing-code bootstrap flow · token issue/verify (hash at rest) · file-backed paired-device registry (survives core restart) · per-connection auth state + connection registry · role-gated method dispatch (`chat.send` = operator-only) · CLI upgraded to authenticate (identity file, pairing-code prompt, token reuse) · tests per §7.

**Out**: approval via settings UI / operator-role `device.*` management methods (M5 #23 grant management) · capability invocation core→node (M3 — but the connection registry this slice builds is its seam) · transport security TLS/WSS (deployment concern, v1.5; ADR 0004) · secrets in Windows Credential Manager (later hardening slice — the CLI token file + core device store are data files, not provider keys) · revocation UX (delete the store file = manual revoke for now) · SQLite migration of the device store (#5 owns db/; this store stays file-based JSON — device registry is config-like security state, files-as-truth is fine).

## 3. Protocol additions (`@taki/shared`)

| File | Contents |
| --- | --- |
| `connect-schema.ts` (new) | `RoleSchema = z.enum(["operator", "node"])` · `ConnectParamsSchema { deviceId: z.uuid(), deviceName: z.string().min(1), role: RoleSchema, capabilities: z.array(z.string()).default([]), token?: z.string(), pairingCode?: z.string() }` with `.refine`: operators must declare empty `capabilities` · `ConnectResultSchema { status: z.literal("ok"), token: z.string().optional() }` (token present exactly when pairing just completed) · `CONNECT_METHOD = "connect"` |
| `error-code-schema.ts` (extend enum) | `PAIRING_REQUIRED`, `AUTH_FAILED`, `NOT_AUTHENTICATED`, `FORBIDDEN` |
| `index.ts` | extend named re-exports |

App-level failures ride JSON-RPC error responses: `error.code = JSON_RPC_ERROR_CODES.INTERNAL_ERROR`? No — use a dedicated app range: `error.code = -32000` (server-defined) with `error.data = { code: <ErrorCode>, ... }`. Add `JSON_RPC_APP_ERROR = -32000` to `json-rpc-schema.ts`. The `ErrorCode` in `data` is the machine-readable contract (closed union, error-handling spec).

**Handshake flow** (transport-agnostic — no IP/host anywhere in the protocol; identity is `deviceId`):

```
1. socket opens → connection state = awaiting-connect
2. ANY frame other than a `connect` request while awaiting → error response
   {data:{code:"NOT_AUTHENTICATED"}} AND socket closed (fail-closed)          [AC 1]
3. connect{deviceId, role, token}   → token valid for deviceId AND stored role == presented role
                                      → authenticated; result {status:"ok"}    [AC 2 reconnect]
4. connect{deviceId, ...} unknown/no token → error {data:{code:"PAIRING_REQUIRED"}};
   core emits a 6-digit pairing code via onPairingCode sink (main.ts wires it to console/log);
   pending entry {deviceId → code} expires in 5 min, max 3 attempts            [AC 2 pairing]
5. connect{deviceId, pairingCode} matching pending → paired: token generated, sha256 hash
   persisted, plaintext token returned ONCE in result; authenticated           [AC 2 token]
6. connect while already authenticated → error INVALID_REQUEST-style app error (no re-handshake)
7. token wrong / role mismatch vs paired record → error {data:{code:"AUTH_FAILED"}} + close
```

**Role enforcement** (AC 3): `MethodDefinition` gains `roles: Role[]`. Dispatch resolves the connection's authenticated role; method not permitting it → error `{data:{code:"FORBIDDEN"}}`. `chat.send` declares `roles: ["operator"]`. The connection registry records `role` + declared `capabilities` per connection — the seam M3's capability router will consume (nodes are providers, operators never are).

## 4. Storage & security design (decided; implement exactly)

- **Paired-device store**: JSON file `<dataDir>/devices.json`, `dataDir` from `TAKI_DATA_DIR` env, default `path.join(os.homedir(), ".takiagent")` (OS-neutral). Shape: `{ devices: [{ deviceId, deviceName, role, tokenHash, pairedAt }] }`. Atomic write (write temp file, `fs.renameSync`). **Sanctioned `node:fs` site**: this is core-owned security state under the app data root, same class as the future `db/` SQLite file — NOT an agent-reachable path (invariant 1 governs agent-initiated actions; nothing in the tool surface can touch this module).
- **Tokens**: `crypto.randomBytes(32).toString("base64url")`; at rest ONLY `sha256` hash (base64); verification hashes the presented token and compares with `crypto.timingSafeEqual`. Plaintext token appears exactly once: in the pairing `connect` result. Tokens never logged (logging-guidelines).
- **Pairing codes**: 6 numeric digits via `crypto.randomInt(0, 1_000_000)` zero-padded; single pending per deviceId; 5-min expiry (injectable `now()` clock for tests); max 3 failed attempts then pending invalidated (re-connect restarts pairing). The code is DELIBERATELY surfaced on the core console (`onPairingCode` sink → pino info in main wiring): the operator console is the trust anchor for first pairing (OpenClaw gateway pattern; works identically on a VPS via journald). This is the one sanctioned "secret-ish value in a log" — it is short-lived, single-purpose, and its whole job is to be read by the human at the console. Role is LOCKED at pairing; a paired device presenting a different role fails (`AUTH_FAILED`) — prevents privilege swap with a stolen token.

## 5. File map

```
packages/shared/src/
  connect-schema.ts (+ .test.ts)          # handshake schemas + CONNECT_METHOD
  error-code-schema.ts                    # +4 codes (edit)
  json-rpc-schema.ts                      # +JSON_RPC_APP_ERROR (edit)
packages/core/src/
  devices/paired-device-store.ts (+test)  # JSON persistence, atomic write (sanctioned fs site)
  devices/device-registry.ts (+test)      # pair/verify/expiry/attempts; store + clock injected
  server/connection-registry.ts (+test)   # per-socket auth state: awaiting|authenticated{deviceId,role,capabilities}
  server/methods/connect.ts               # the pre-auth method; deps: deviceRegistry, connectionRegistry, onPairingCode
  server/method-registry.ts               # +roles on MethodDefinition; FORBIDDEN dispatch check (edit)
  server/ws-server.ts                     # pre-auth gate: only connect before authenticated; close on violation (edit)
  server/methods/chat-send.ts             # +roles: ["operator"] (edit, one line)
  config/server-config.ts                 # +dataDir (TAKI_DATA_DIR) (edit)
  main.ts                                 # wire registries + onPairingCode → logger (edit)
apps/cli/src/
  device-identity.ts (+test)              # ~/.takiagent/cli-device.json: {deviceId, token?}; create-on-first-run
  chat-client.ts                          # connect handshake before use; pairing flow surfaces PAIRING_REQUIRED (edit)
  main.ts                                 # on PAIRING_REQUIRED: readline-prompt the code, retry connect, persist token (edit)
```

Every new/edited production file: INPUT/OUTPUT/POS header; every touched dir: update `index.md` (devices/ gets a new one). Directory note: `devices/` is a new core domain dir — pluggable-module rule (registry + own files), record it in `packages/core/src/index.md`.

## 6. Key flows (pseudocode)

```
ws-server connection state (owned by connection-registry):
  on frame:
    if !conn.authenticated and !(frame is request with method === CONNECT_METHOD):
      reply appError(NOT_AUTHENTICATED); socket.close()
    else dispatch normally (connect handler mutates conn state via connection-registry)

connect handler(params: ConnectParams, ctx):
  if ctx.connection.authenticated → appError(INVALID_REQUEST app-level "already connected")
  paired = deviceRegistry.find(params.deviceId)
  if params.token:
    if paired && paired.role === params.role && deviceRegistry.verifyToken(deviceId, token):
      connectionRegistry.authenticate(ctx.connection, {deviceId, role, capabilities})
      return {status:"ok"}
    → appError(AUTH_FAILED) + close
  if params.pairingCode:
    token = deviceRegistry.completePairing(deviceId, pairingCode, {deviceName, role})   # throws PairingError → AUTH_FAILED-ish mapping, attempts--
    connectionRegistry.authenticate(...)
    return {status:"ok", token}
  # no credentials:
  code = deviceRegistry.beginPairing(deviceId)
  onPairingCode({deviceId, deviceName, code})          # main wires → logger.info
  → appError(PAIRING_REQUIRED)

method dispatch (registry):
  ...zod params ok...
  if !def.roles.includes(ctx.connection.role) → appError(FORBIDDEN)
  ...run handler...

cli main:
  identity = loadOrCreateIdentity(file)                 # deviceId minted on first run
  res = client.connect({identity, token: identity.token})
  if PAIRING_REQUIRED: code = prompt("pairing code (shown in core console): ")
    res = client.connect({identity, pairingCode: code}); saveToken(res.token)
  ... REPL as in #3 ...
```

## 7. TDD plan (strict red-green-refactor; zero network; fake clock for expiry)

| Cycle | Red | Green |
| --- | --- | --- |
| **A — shared** | T1 connect-schema tables: role enum, uuid check, operator-with-capabilities rejected, token/code optionality, round-trips; error-code additions | schemas |
| **B — devices** | T2 store: save/load round-trip, missing file → empty, corrupted file → fatal-fast readable error. T3 registry: beginPairing code format + single pending; completePairing issues token whose sha256 matches stored hash (never plaintext at rest); wrong code ×3 → pending invalidated; expiry via fake clock; verifyToken happy/miss; role-mismatch rejected; NEW registry instance over same store file verifies same token (restart survival) | devices/ modules |
| **C — server integration** (real socket, ephemeral port) | T4 pre-auth `chat.send` → NOT_AUTHENTICATED error frame AND socket closed. T5 unknown connect → PAIRING_REQUIRED + code captured via injected onPairingCode sink. T6 connect with code → `{status:"ok", token}`; NEW socket reconnect with token → ok; then chat works (mock model). T7 wrong token → AUTH_FAILED + closed. T8 node-role device pairs, calls `chat.send` → FORBIDDEN (and connect result carried no error). T9 double connect on same socket → app error | ws-server gate + connect method + registry roles |
| **D — CLI** | T10 identity file created on first run (tmp dir), deviceId stable across loads; token persisted after pairing. T11 chat-client: scripted server demanding pairing → client surfaces PAIRING_REQUIRED, second connect with code succeeds, token exposed to caller | cli modules |
| **E — glue** | (no unit tests) main.ts wiring both sides | manual smoke §9 |

## 8. Constraints

All of #3's §9 constraints carry over (invariants, size caps, headers/index.md, why-only comments, pino no-secrets, closed error union). Additions: `devices/paired-device-store.ts` and `apps/cli/src/device-identity.ts` are the ONLY new fs sites (rationale §4 — check agent: verify no other module imports node:fs); tokens/hashes never logged (the pairing CODE via the sink is the documented exception); `timingSafeEqual` for token compare; no new npm dependencies (Node builtins only — `node:crypto`, `node:fs`, `node:path`, `node:os`; typecheck against installed @types/node is the API verification for builtins).

## 9. Verification (definition of done)

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test      # green, new tests included
# manual (leader): rm -rf %USERPROFILE%\.takiagent test-state as needed, or TAKI_DATA_DIR=tmp
pnpm core:dev                                        # boot
pnpm cli:dev                                         # 1st run: pairing required → code on core console → enter → chat streams
pnpm cli:dev                                         # 2nd run: token reused, chat direct, no pairing
# tamper cli token file → AUTH_FAILED surfaced, re-pair path works
```

AC mapping: AC1←T4/T9 · AC2←T5/T6/T7 + manual · AC3←T8 + registry roles · AC4←schema review (no host/IP fields) + §3 note · AC5←T10/T11 + manual · AC6←T4-T8.
