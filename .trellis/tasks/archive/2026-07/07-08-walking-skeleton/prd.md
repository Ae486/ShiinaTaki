# PRD — Walking skeleton: Core + OpenAI-compatible chat streamed over WS to a CLI

**GitHub issue**: #3 (`Ae486/ShiinaTaki`, milestone M1 — Agent Core skeleton). Parent: #1 (PRD). Blocked by: #2 (scaffold, DONE).
**Trellis task**: `07-08-walking-skeleton`

## 1. Goal

First tracer bullet through the whole agent stack, end to end and streaming:

```
CLI (apps/cli) --WS/JSON-RPC 2.0--> Agent Core (packages/core) --AI SDK v7--> OpenAI-compatible API
     ^                                                                              |
     +---------------- streamed assistant tokens (notifications) <-----------------+
```

No tools, no persistence, no pairing — just a headless Core process that boots, validates every inbound frame against `@taki/shared` zod schemas, holds a streaming multi-turn conversation via the AI SDK agent abstraction, and a thin CLI that renders tokens live.

## 2. Scope

**In**: WS JSON-RPC server (localhost) · protocol schemas in `@taki/shared` · provider config from env / git-ignored `.env.local` · AI SDK v7 streaming chat (agent class per research, no tools) · in-memory multi-turn history per `characterId` · structured error frames · thin CLI client (`apps/cli`, depends ONLY on `@taki/shared` + transport libs, never on `@taki/core` internals) · tests per §7.

**Out (later slices — do not build, do not block)**: device identity/pairing (#4) · timeline persistence (#5) · tools/Permission Gate (M3) · MCP/skills · reconnect logic · WS auth/TLS · multi-client broadcast · persona/system prompts · Credential Manager secret storage · `ping-schema.ts` removal (desktop IPC smoke still uses it — leave untouched).

## 3. Protocol design (`@taki/shared` — single source of truth, invariant 3)

New files in `packages/shared/src/` (kebab-case, one concern per file, `XSchema` + `type X = z.infer<>`, colocated `*.test.ts`):

| File | Contents |
| --- | --- |
| `json-rpc-schema.ts` | `JsonRpcIdSchema` (string \| number), `JsonRpcRequestSchema`, `JsonRpcNotificationSchema` (no `id`), `JsonRpcSuccessResponseSchema`, `JsonRpcErrorObjectSchema` (`code:int, message:string, data?:unknown`), `JsonRpcErrorResponseSchema`, `JsonRpcInboundFrameSchema` (request \| notification union), `JSON_RPC_ERROR_CODES` const (`PARSE_ERROR:-32700, INVALID_REQUEST:-32600, METHOD_NOT_FOUND:-32601, INVALID_PARAMS:-32602, INTERNAL_ERROR:-32603`) |
| `error-code-schema.ts` | `ErrorCodeSchema = z.enum(["PROVIDER_ERROR", "INTERNAL_ERROR"])` — the closed cross-process error-code union (error-handling spec). Extend HERE only, never inline strings. |
| `chat-schema.ts` | `CHAT_METHODS` const (`send: "chat.send"`, `delta: "chat.delta"`, `complete: "chat.complete"`, `error: "chat.error"`) · `ChatSendParamsSchema { characterId: string.min(1), message: string.min(1) }` · `ChatSendResultSchema { messageId: string }` · `ChatDeltaSchema { messageId, characterId, delta: string }` · `ChatCompleteSchema { messageId, characterId }` · `ChatErrorSchema { messageId, characterId, code: ErrorCodeSchema, message: string }` |
| `ws-defaults.ts` | `DEFAULT_WS_HOST = "127.0.0.1"`, `DEFAULT_WS_PORT = 8974` (shared by core default config and CLI default URL) |
| `index.ts` | extend named re-exports (NO `export *`) |

**Conversation flow** (all frames zod-validated on receipt, both directions):

1. client → `chat.send` request `{characterId, message}`
2. core → immediate JSON-RPC success response `{messageId}` (ack; stream follows)
3. core → 0..n `chat.delta` notifications `{messageId, characterId, delta}`
4. core → exactly one terminal notification: `chat.complete {messageId, characterId}` **or** `chat.error {messageId, characterId, code, message}` (structured, human/LLM-readable — never a crash, never silent)

**Envelope-level errors** (malformed JSON → `-32700` with `id:null`; frame fails `JsonRpcInboundFrameSchema` → `-32600`; unknown method → `-32601`; params fail method schema → `-32602` with zod issues summarized in `error.data`). `characterId` appears in every chat-level frame — nothing anywhere hardcodes a single character (invariant 7); only the CLI's default flag value is `"taki"`.

## 4. Config contract (invariant 5: secrets never in committed files)

Read from `process.env` at boot; dev values come from repo-root `.env.local` (git-ignored via `.env.*`, already present) loaded by the Node run script (exact flag per `research/runtime-and-provider.md`). zod `.parse` fatal-fast at boot with a message naming the missing variable. NEVER log `apiKey`.

| Env var | Required | Default |
| --- | --- | --- |
| `TAKI_PROVIDER_BASE_URL` | yes | — |
| `TAKI_PROVIDER_API_KEY` | yes | — |
| `TAKI_PROVIDER_MODEL` | yes | — |
| `TAKI_WS_HOST` | no | `DEFAULT_WS_HOST` |
| `TAKI_WS_PORT` | no | `DEFAULT_WS_PORT` |
| `TAKI_LOG_LEVEL` | no | `info` |

## 5. File map

```
packages/core/src/
  main.ts                        # process entry, thin: config → logger → model → registry → server; SIGINT/SIGTERM graceful close
  config/provider-config.ts      # ProviderConfigSchema + loadProviderConfig(env)
  config/provider-config.test.ts
  config/server-config.ts        # ServerConfigSchema (host/port/logLevel) + loadServerConfig(env)
  config/server-config.test.ts
  logging/logger.ts              # pino root logger factory; modules use logger.child({ mod })
  server/ws-server.ts            # ONLY module owning sockets: listen, frame parse+validate, dispatch, reply/notify, close
  server/ws-server.test.ts       # integration tests (ephemeral port, real ws client, mock model)
  server/method-registry.ts      # createMethodRegistry(): register({method, paramsSchema, handler}) + dispatch(frame, ctx) — invariant 7 seam
  server/method-registry.test.ts
  server/methods/chat-send.ts    # thin handler: ack {messageId}, then pump agent stream → notifications
  agents/chat-agent.ts           # AI SDK v7 wiring (model injected — DI seam for mock-model tests); throws on provider failure
  agents/chat-agent.test.ts
  agents/conversation-store.ts   # in-memory Map<characterId, messages> (replaced by #5)
  index.ts                       # named re-exports only (public entry)
apps/cli/
  package.json                   # @taki/cli, private; deps: @taki/shared workspace:*, ws (+ envelope lib per research); scripts mirror sibling packages (typecheck/test/start)
  tsconfig.json                  # mirror packages/core pattern
  src/main.ts                    # parseArgs (--url default ws://DEFAULT_WS_HOST:DEFAULT_WS_PORT, --character default "taki") + readline REPL, stdout.write(delta) live
  src/chat-client.ts             # @taki/shared-typed client: connect, chat() resolving on complete/error; validates inbound frames with zod
  src/chat-client.test.ts        # against a scripted in-test ws server
```

Cleanup owned by this slice: delete scaffold examples `packages/core/src/hello.ts` + `hello.test.ts`, update `packages/core/src/index.ts`. Root `package.json`: add `core:dev` / `cli:dev` convenience scripts (pattern of `desktop:dev`). No CI changes (recursive scripts pick up `apps/cli` automatically).

Runtime migration required by the Node 24 native-TS dev runner (`research/runtime-and-provider.md`, empirically verified): switch relative import specifiers in `packages/shared/src` from `.js` to `.ts` (and use `.ts` extensions in all new relative imports), set `rewriteRelativeImportExtensions: true` in `tsconfig.base.json`; `packages/core` dev script is `node --watch --env-file-if-exists=../../.env.local src/main.ts`.

## 6. Key flows (pseudocode — exact API names come from `research/*.md`, never memory)

```
main.ts:
  serverCfg = loadServerConfig(process.env); providerCfg = loadProviderConfig(process.env)   # fatal-fast
  logger = createLogger(serverCfg.logLevel)
  model = <openai-compatible provider factory>(providerCfg)          # research/ai-sdk-v7-api.md
  registry = createMethodRegistry()
  registry.register(chatSendMethod(createChatAgent({ model })))
  server = await startWsServer({ host, port, registry, logger })
  on SIGINT/SIGTERM → server.close() → exit 0

ws-server, per inbound message:
  text → JSON.parse            | fail → error response PARSE_ERROR (id null)
  → JsonRpcInboundFrameSchema  | fail → INVALID_REQUEST
  request      → registry.dispatch(frame, ctx) → send success/error response   # ctx = { notify(method, params) } bound to THIS socket
  notification → none registered in v1 → debug-log and ignore

chat-send handler(params: ChatSendParams, ctx):
  messageId = crypto.randomUUID()
  void pump()                                   # deliberately un-awaited: ack returns first, same-socket ordering guarantees ack precedes deltas
  return { messageId }
  pump():
    try:
      for await delta of chatAgent.stream(params): ctx.notify(CHAT_METHODS.delta, {messageId, characterId, delta})
      ctx.notify(CHAT_METHODS.complete, {messageId, characterId})
    catch err:
      logger.warn({ mod, err: summary(err) })   # never full prompt/key
      ctx.notify(CHAT_METHODS.error, {messageId, characterId, code: "PROVIDER_ERROR", message: readable(err)})

chat-agent.stream({characterId, message}):
  history = store.history(characterId); history.append(user message)
  <AI SDK v7 streaming call with messages=history>                   # agent class per research
  yield each text delta; accumulate; on finish append assistant message to history
  (errors propagate — handled ONCE at the chat-send boundary)

cli main:
  client = await connectChatClient(url)
  readline loop: line → await client.chat({characterId, message: line}, {onDelta: stdout.write, onComplete: newline+reprompt, onError: stderr `[code] message`})
```

## 7. TDD plan — strict red-green-refactor (tdd discipline)

Rule: **no production line before its failing test exists**, except pure process-glue (`main.ts`, CLI `main.ts`) which stays thin and is covered by the manual smoke. Tests exercise public seams only (WS frames, exported functions) — never module internals. Mock model everywhere; **zero network in tests**.

| Cycle | Red (write failing tests) | Green (minimal impl) |
| --- | --- | --- |
| **A — shared schemas** | T1 `json-rpc-schema.test.ts`: table-driven valid/invalid frames (missing `jsonrpc`, bad id type, notification-with-id...). T2 `chat-schema.test.ts`: params/event round-trips (`parse(candidate)` accepts/rejects; missing `characterId` fails; unknown error code fails) | schemas + constants + index re-exports |
| **B — core config & registry** | T3 `provider-config.test.ts`: full env parses; missing var → throw naming it. T4 `server-config.test.ts`: defaults applied; bad port rejected. T5 `method-registry.test.ts`: dispatch known method → handler result; unknown → METHOD_NOT_FOUND error object; bad params → INVALID_PARAMS with zod issues in `data` | config + registry modules |
| **C — ws-server integration** (the core of the slice) | T6 malformed JSON → PARSE_ERROR response. T7 valid JSON, non-frame → INVALID_REQUEST. T8 happy path: mock model streaming 3 deltas → ack `{messageId}` then 3 `chat.delta` then `chat.complete`, in order, every frame zod-parses and carries `characterId`. T9 mock model throws → ack then structured `chat.error` (code `PROVIDER_ERROR`, readable message), and the server still answers a subsequent request (no crash). | `ws-server.ts` + `methods/chat-send.ts` wiring (ephemeral port via `port: 0`, returned actual port) |
| **D — chat-agent multi-turn** | T10 streams deltas from mock model. T11 second `stream()` call for same `characterId` sends prior user+assistant turns to the model (assert via mock's captured call args); different `characterId` starts clean | `chat-agent.ts` + `conversation-store.ts` |
| **E — CLI client** | T12 scripted server: ack+deltas+complete → `onDelta` in order, promise resolves. T13 scripted `chat.error` → `onError` with code, promise settles | `chat-client.ts` |
| **F — glue** | (no unit tests) `main.ts` both sides + scripts | manual smoke below |

Refactor step each cycle: enforce size caps (file ≤ 300 / fn ≤ 50 / params ≤ 3), extract on first sign of a second concern.

## 8. Acceptance criteria mapping (issue #3)

| AC | Verified by |
| --- | --- |
| Core boots standalone, WS server, zod-validates inbound | T6-T8 + manual smoke |
| CLI connects, sends, renders streamed tokens live | T12 + manual smoke |
| Round-trip against real OpenAI-compatible endpoint | Leader manual: DeepSeek via `.env.local` |
| Protocol types once in `@taki/shared`, JSON-RPC 2.0 envelope | T1-T2 + check-agent review (no local message shapes) |
| Failed provider call → structured readable error frame | T9, T13 |
| `characterId` end-to-end | asserted in T2, T8, T11 |
| Tests: schema round-trips + mock-model exchange | cycles A-E |

## 9. Constraints & guardrails

- **Invariant 1**: nothing in `packages/core` touches the OS on the agent's initiative — this slice needs NO `child_process`, NO `fs` (env loading is done by the Node CLI flag, not code; if research mandates programmatic env loading, it must be boot-time-only and documented).
- **Invariant 3**: zero message shapes declared outside `@taki/shared`.
- **Invariant 5**: key only via env/`.env.local`; never committed, never logged.
- **Invariant 7**: WS methods register through `method-registry` — adding a method later = new file under `server/methods/` + one registry entry.
- **Invariant 8 / OS-neutral**: no Windows-only APIs or hardcoded path separators in `core`/`shared`/`cli`.
- **Library discipline**: every AI SDK / json-rpc-2.0 / ws call follows `research/*.md` (verified against installed `.d.ts`). On any mismatch: STOP, re-verify against `node_modules`, update the research file — never guess.
- **Known traps (already verified — do not rediscover)**: v7 `ToolLoopAgent` takes `instructions` (not `system`) and REJECTS system messages inside `messages`; `agent.stream()` returns a Promise that MUST be awaited before iterating `result.textStream`; append history from `await result.responseMessages`; json-rpc-2.0 handlers must throw `JSONRPCErrorException` for coded errors (a plain `Error` maps to code 0, not -32603); mock stream parts use the `delta` field while ai-level stream parts use `.text`.
- Error handling per `.trellis/spec/backend/error-handling.md`: no empty catch; handle once at the chat-send boundary; config errors fatal-fast.
- Logging per `logging-guidelines.md`: pino, `logger.child({ mod })`, never log keys or message contents (log lengths/ids instead).
- Naming/size per CLAUDE.md; no barrel files; comments only for non-obvious constraints (why, not what).

## 10. Simplifications accepted for this slice (documented, not accidental)

- Single in-flight `chat.send` per connection (CLI awaits each turn); no queueing/cancellation.
- In-memory history per `characterId`, lost on restart — #5 replaces with SQLite timeline.
- On provider failure the user message stays in history (retry re-asks; acceptable until #5).
- No WS auth (pairing = #4); server binds `127.0.0.1` only — never `0.0.0.0`.
- CLI renders any `chat.delta` it receives (single-conversation client); `messageId` is sanity-checked, not gated on.

## 11. Verification (definition of done)

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test          # all green, new tests included
# manual smoke (leader):
pnpm core:dev                                            # boots, logs listening on 127.0.0.1:8974
pnpm cli:dev                                             # REPL; message → live streamed reply; Ctrl+C clean exit
# real-API round-trip: DeepSeek via repo-root .env.local (leader runs; AC 3)
# negative smoke: boot core with wrong TAKI_PROVIDER_API_KEY → chat yields structured chat.error, process stays alive
```
