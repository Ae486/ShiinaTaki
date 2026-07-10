# Research: ai@7.0.17 native tool approval + the WS operator-ask leg + decision memory

- **Query**: does v7 ship human-in-the-loop tool approval (ADR 0003 claims yes); how to wire core->CLI ask/await over our WS; where to persist once/session/always/deny decisions
- **Scope**: installed .d.ts + empirical probe (transcript below is real output; probe scripts under `research/tmp/`, deleted) + our server/cli sources
- **Date**: 2026-07-10

Evidence roots:

- `AI_DTS` = `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts`
- `PU_DTS` = `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.5_zod@4.4.3/node_modules/@ai-sdk/provider-utils/dist/index.d.ts`
- `RPC_DTS` = `node_modules/.pnpm/json-rpc-2.0@1.7.1/node_modules/json-rpc-2.0/dist/`

## Verdicts (short)

1. **YES — native, and better than expected**: `toolApproval` on `ToolLoopAgentSettings` (`AI_DTS:5094`) accepts an **async function per tool (or one generic fn for all tools)** returning `'approved' | {type:'denied', reason} | 'user-approval' | ...`. PROBED: an async fn that awaits (our WS round-trip) and returns `'approved'`/`'denied'` keeps the WHOLE flow inside ONE `agent.stream()` call — no stop, no resubmission. This is the recommended mechanism; the old `Tool.needsApproval` is **deprecated** (`PU_DTS:1590-1592`).
2. WS leg: `json-rpc-2.0` CAN do server-initiated requests (`JSONRPCServerAndClient`, `RPC_DTS/server-and-client.d.ts:7-24`), but BOTH of our zod envelope schemas exclude them — smaller diff is **notify + response method**: core sends an `approval.request` notification, CLI answers with a normal `approval.respond` request; correlation via a pending map keyed by `approvalId`.
3. Timeout: **deny-by-timeout** (fail-closed), reason `"approval timed out"` — the model sees it and continues gracefully (probed).
4. Decision memory: JSON file `<dataDir>/mcp-approvals.json` in the paired-device-store pattern — smaller diff than a db table; same class of core-owned security state as `devices.json`.

## 1. Native approval — exact API + probed flow

Types (`AI_DTS:3067-3146`): `ToolApprovalConfiguration = GenericToolApprovalFunction | { [toolName]?: ToolApprovalStatus | SingleToolApprovalFunction }`; status = `'not-applicable' | 'approved' | 'denied' | 'user-approval'` or object form with `reason`. Both function forms may return a **Promise** (`MaybePromiseLike`, `AI_DTS:3096-3127`). The generic form receives `{ toolCall, tools, messages }` — ideal for one MCP-wide policy fn keyed on `toolCall.toolName`. Present on `streamText`/`generateText` (`AI_DTS:3566, 4880`) and `ToolLoopAgent` settings (`AI_DTS:5094`); also passable via `prepareCall` (`AI_DTS:5205-5207`).

Probe (ToolLoopAgent + MockLanguageModelV4, approval fn awaits 50 ms to simulate the WS round-trip):

```
--- A: async 'approved'
parts: start start-step tool-call tool-approval-request(isAutomatic=true) tool-approval-response
       tool-result finish-step start-step text-start text-delta text-end finish-step finish
log:   approval-fn called -> EXECUTED          llm calls: 2   (ONE stream() call, loop auto-continued)

--- B: async {type:'denied', reason:'operator denied it'}
parts: ... tool-call tool-approval-request(isAutomatic=true) tool-approval-response finish-step start-step text-delta ...
log:   approval-fn called (tool NEVER executed)    llm calls: 2
2nd-call last msg: {"role":"tool","content":[{"type":"tool-result","toolCallId":"call-1","toolName":"danger",
  "output":{"type":"execution-denied","reason":"operator denied it"}}]}

--- C: 'user-approval'
parts: start start-step tool-call tool-approval-request(isAutomatic=undefined) finish-step finish
llm calls: 1   (loop STOPPED; resume requires resubmitting messages with a tool-approval-response part)
```

Readings:

- **Use A/B**: the async-fn path is the native seam AND behaves like the wrapper pattern (inline await), with the SDK handling what-the-model-sees on deny (`execution-denied` + reason — no hand-rolled denial message needed).
- **Avoid C** (`'user-approval'`): that is the UI-resubmission flow (stop turn, persist `responseMessages` incl. `tool-approval-request` part, re-call with a `ToolApprovalResponse` in a tool message, `PU_DTS:1244-1344`). Our conversation-store persists text only — resubmission would force us to hold/persist tool messages. Wrong fit.
- Wrapper pattern (intercept in our own `execute`) is strictly worse now: same await capability, but we would hand-write the denial result the model sees and lose the stream's approval parts. Rejected.
- **Pump safety**: the new `tool-approval-request/-response` parts flow through `result.stream`; our chat pump (`packages/core/src/agents/chat-agent.ts:50-57`) ignores everything but `text-delta`/`error` — still correct. M3 can surface those parts additively.
- M3 reuse: the Permission Gate replaces the decision fn's body (WS-ask -> Rust gate call); the `toolApproval` seam and stream parts stay identical.

## 2. The WS leg: core asks the operator CLI and awaits

Current shapes:

- Core ws-server only sends notifications (`ctx.notify`, `packages/core/src/server/method-registry.ts:24-29`) and dispatches inbound **requests**; inbound envelope = request|notification only (`packages/shared/src/json-rpc-schema.ts:30`) — a raw JSON-RPC *response* from the CLI would be dropped (post-auth tolerant path, `ws-server.ts:73-89`).
- CLI already runs a full `JSONRPCServerAndClient` with `receiveAndSend` (`apps/cli/src/chat-client.ts:118-133`), but its inbound frame schema also excludes server-initiated requests (`JsonRpcClientFrameSchema` = response|notification, `json-rpc-schema.ts:57-62`).

Option A — per-connection `JSONRPCServerAndClient` in core: real server-initiated requests. Requires: new envelope schemas on both ends, rework of ws-server dispatch (registry + rpc client coexisting), CLI schema change. Bigger diff, touches the walking-skeleton protocol layer.

Option B (RECOMMENDED, smaller diff) — hand-rolled correlation on existing primitives:

1. Shared: add `APPROVAL_METHODS` + `ApprovalRequestSchema` (`{approvalId, serverName, toolName, input}`) + `ApprovalRespondParamsSchema` (`{approvalId, approved, remember?}`). No envelope changes.
2. Core: an `ApprovalBroker` module: `ask(request, notify) -> Promise<Decision>` — stores a resolver in a `Map<approvalId, ...>`, sends the `approval.request` **notification** via the chat turn's `ctx.notify` (the asking operator is the socket that started the turn), races a timeout. New registry method `approval.respond` (operator role) resolves the map entry. Wire `ctx.onClose` to deny all pending on disconnect.
3. CLI: `rpc.addMethod(APPROVAL_METHODS.request, ...)` (notification handlers already work this way for chat.*), prompt y/n, then `rpc.request(APPROVAL_METHODS.respond, {...})`.
4. Chat-agent: `toolApproval` generic fn = decisions-store lookup, else `broker.ask(...)`; `createChatAgent` gains the broker dep and `chat-send.ts` passes a notify-capable handle into `stream()` (the one signature change; today `stream()` has no ctx access — `chat-send.ts:47-53`).

Timeout ruling: operator silent -> **deny with reason "approval timed out"** (fail-closed, consistent with the pre-auth gate philosophy in `ws-server.ts:76-80`); suggested default 60 s. Note `json-rpc-2.0` has a built-in `timeout(delay)` requester (`RPC_DTS/client.d.ts:16`) — only relevant if Option A is ever chosen; the broker's own `setTimeout` race covers Option B.

## 3. Decision memory (once / session / always / deny per server+tool)

- `once` -> don't store; `session` -> in-memory `Map` in the broker (dies with the process — matches "session" = agent-core lifetime; per-connection session would key on connection and clear in `onClose`); `always`/`never` -> persist.
- **Recommend a JSON decisions file** `<dataDir>/mcp-approvals.json` cloning the paired-device-store pattern (`packages/core/src/devices/paired-device-store.ts` — atomic temp+rename write, fatal-fast on corrupt, zod file schema): entries `{serverName, toolName, decision: 'always'|'never', decidedAt}`.
- Against a db table: db layer currently serves memory only (`packages/core/src/db/memory-repo.ts` + sqlite wrapper); approvals are security config, same nature as `devices.json`, and ADR 0006 already groups MCP config outside the db. A table adds schema/migration surface for a handful of rows. File wins on diff size and consistency; revisit if approval history/audit becomes a requirement (that would be a timeline concern anyway).

## Caveats / Not Found

- `experimental_toolApprovalSecret` (HMAC-signed approval requests, `AI_DTS:3568-3572`) matters only for the resubmission flow (C) where a client could forge approvals; irrelevant for our in-process async fn. Skip.
- Probe used a static `tool()`; MCP tools are `dynamicTool`s — the **generic** `toolApproval` function form is the natural fit there (per-name keys also work since MCP tools are name-keyed in the ToolSet). Behavior difference: none expected (same loop machinery); not separately probed.
- The approval fn receives parsed `input` and (generic form) `toolCall` — enough to render a meaningful CLI prompt. It does NOT receive an AbortSignal (`AI_DTS:3096` omits it) — the broker timeout must be self-contained.
