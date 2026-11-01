# Non-delegation model-facing tool result audit

Date: 2026-11-01. Scope: source audit and optimization proposal only. No production implementation, service launch, external model/provider call, private QQ data read, dependency installation, commit, push, reset, Trellis task mutation, or archival was performed.

## Decision

The reported context pollution is real in several first-party projections, but it is not a field-name problem. The largest verified excess is where provider/runtime authority envelopes are serialized unchanged for the model: canonical Memory recall/retain/reflect, extension discovery/describe/call, Host context, and some Co-Watching/media/status read models. In contrast, opaque selectors, CAS revisions, paging cursors, cancellation/unknown-outcome states, source evidence, and exact QQ references are functional and must remain.

Recommended implementation after owner approval:

1. Add or refine **capability-owned `toModelOutput` projections** for first-party tools while preserving raw execute results, durable state and operator RPC shapes.
2. Keep direct third-party MCP tools on the SDK's standard MCP `content` / `structuredContent` path. Optimize a known server at that server or through an explicit identity-bound adapter, never through generic suffix stripping or recursive key deletion.
3. Preserve all meaningful `empty` / `partial` / `truncated` / `cancelled` / `outcome_unknown` / `conflict` distinctions and every exact no-loss paging coordinate.
4. Do not introduce arbitrary text truncation, a model summarizer, or a generic result middleware. Where an output can be large, use an existing source-owned page contract or design one explicitly.

This document distinguishes verified source facts, proposals, and unverified runtime behavior. Line references point to the current dirty worktree, not the stale semantic index.

## Actual runtime-to-model boundary

- Production composition registers normal capability/Skill tools, schedule, initiative and the two mature integration bundles at `packages/core/src/main.ts:475-526`. Per-Run Host/MCP/Skill capture is assembled by `packages/core/src/extensions/extension-run-context.ts:35-64`.
- `packages/core/src/agents/agent-attempt.ts:84-112` supplies the full governed tool lookup to `ToolLoopAgent` and selects visible definitions per step. `:137-162` records projected response messages and separately retains raw `event.toolResults`; therefore a model-only projection need not mutate runtime truth.
- Installed AI SDK `7.0.148` invokes `tool.toModelOutput({toolCallId,input,output})` on normal results and otherwise JSON-serializes the raw result: `node_modules/.pnpm/ai@7.0.148_zod@4.4.3/node_modules/ai/src/prompt/create-tool-model-output.ts:4-29`. SDK error modes bypass `toModelOutput` and return tagged error text/JSON at `:17-21`.
- The governed wrapper replaces only `execute` via property descriptors, preserving descriptions, schemas and `toModelOutput`: `packages/core/src/governance/governed-tool.ts:93-104`. It also returns explicit cancellation before dispatch and settles raw results separately at `:113-128,197-244,278-288`.
- Installed `@ai-sdk/mcp@2.0.81` direct tools retain the raw MCP call result but convert model output from standard `content`; absent `content`, they fall back to JSON: `node_modules/.pnpm/@ai-sdk+mcp@2.0.81_zod@4.4.3/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:213-243,1305-1349`. Its live `tools()` implementation follows `tools/list` cursors at `:1217-1234`; this transport aggregation does **not** remove the product's separate 128-entry model-facing extension-directory limit.
- Source sidecars can wrap a projected JSON result as `{sourceContext,result}` without changing its underlying outcome: `packages/core/src/agents/source-context.ts:40-62`. Any byte comparison must inspect the actual next provider request, not only `execute()`.

## Coverage and findings

| Capability | Present model-facing result and actual owner | Excess versus functional metadata | Proposed ownership seam |
| --- | --- | --- | --- |
| Current time | Raw `{ok,iso,local,timezone,epochMs,capturedAt}`; `capturedAt === iso` by construction (`packages/core/src/time/current-time-tool.ts:19-36`). Replay folding detects `capturedAt` as the state-snapshot class marker (`packages/core/src/agents/replay-folds.ts:64-78,143-149`). | `iso` and `capturedAt` duplicate one instant, but `capturedAt` is not disposable because replay reduction consumes it. | Add tool-local `toModelOutput` that keeps `capturedAt`, `local`, `timezone`, `epochMs` and omits duplicate `iso`; keep raw result unchanged. Low priority because the object is already small. |
| Workspace files | `read_file` returns relative path, complete/capped content, returned bytes and `truncated`, plus a source material; `write_file` returns relative path and bytes (`packages/core/src/workspace/read-file-tool.ts:29-65`; `write-file-tool.ts:22-52`). | No verified harmful IDs/hashes. `path` is provenance and a future selector; `truncated` distinguishes a partial read. | **Keep as-is.** Do not shorten content further or remove the source sidecar. Description should say how to obtain the rest only if a real ranged-read tool is added; there is none today. |
| Device/Shell capabilities | Clipboard read `{text,capturedAt}`; process list `{processes,count,capturedAt}`; shell open `{opened}`; exec `{stdout,stderr,exitCode,timedOut,truncated,...}`; screenshot `{path,width,height,bytes,capturedAt,description?}` (`packages/core/src/capabilities/*-tool.ts`, specifically clipboard `:24-36`, process `:24-35`, shell-open `:23-34`, exec `:24-35`, screenshot `:55-77`). | No authority IDs escape the route/broker. `capturedAt`, paths, exit status, timeouts and truncation are meaningful. `count` and byte sizes are modest redundancy but useful diagnostics. | **Keep current results.** `exec` is explicitly exempted by tool-design. If real process-list size becomes a measured problem, add source-owned filtering/paging rather than generic truncation. |
| Canonical Memory recall | Hindsight/local recall is deliberately converted to fenced text, but currently serializes the complete provider envelope and canonical records (`packages/core/src/memory/canonical-tools/canonical-memory-tools.ts:46-63,81-149`). Envelope includes `requestId`, provider/epoch/capability identity (`packages/shared/src/memory-provider-envelope-schema.ts:10-40`); each hit can include Bank/epoch IDs, full policy/provenance, scores and timestamps (`memory-provider-operation-schema.ts:70-71,124-140`). | Provider request/epoch identity, capability bitmap and Bank IDs are execution metadata. `memoryId` and `revision` are functional mutation inputs. The model still needs semantic policy origin/visibility/disclosure, provenance actor/origin/source reference, nonempty entities/source-memory lineage/observation scopes, and meaningful occurrence/capture/update times. A generic untrusted fence preserves bytes, not those semantics after projection. `partial`, `branchFailures`, `truncated`, vector state and pending/confirmed distinctions are also content truth. | Replace `fencedRecallOutput`'s complete-envelope projection with an explicit semantic recall view in `canonical-memory-tools.ts`; keep the raw validated envelope for settlement/materials. Project each hit with content, callable selectors, compact policy/provenance/source/temporal facts and all nonempty evidence collections; preserve every branch failure disposition and truncation flag. Do not rely on raw internal retention as a substitute for model-visible attribution. |
| Canonical Memory retain/reflect/mutations | Hindsight retain and reflect currently send complete validated outputs; mutation view is partly reduced but spreads the outer provider envelope and includes pending `operationId`, Bank and target identity (`canonical-memory-tools.ts:55-64,152-173`). | Retain/reflect can expose request/provider/epoch/capabilities, native document/source revisions, usage/trace and evidence IDs with no model consumer. Mutation `memoryId`/revision/state is functional; pending/applied/unchanged/superseded/not-found and retry/next-action truth are mandatory. No model tool currently consumes provider requestId, Bank ID or pending operationId. | Add operation-specific model views at the existing loop in `canonical-memory-tools.ts:56-64`: retain receipt with actual zero/pending/completed and useful created memory selectors; reflect with content, structured content and factual evidence summary; mutation with outcome, phase, target `memoryId`, expected/new revision and actionable error. Preserve raw envelopes and no-loss provider recovery. |
| Skill load/resource | `load_skill` returns `{ok,content,contentRevision,files}`; resource read returns `{ok,content,contentRevision}` (`packages/core/src/skills/skills-loader.ts:12-23`; tools at `load-skill-tool.ts:11-31`, `read-skill-resource-tool.ts:11-22`). Disclosure activation consumes the raw successful load's `contentRevision` (`packages/core/src/agents/tool-disclosure.ts:60-77`). | Full instructions and listed resource paths are useful. The revision hash is a captured-currentness fact but need not be shown to the model when raw `toolResults` still drive disclosure. Resource revision has no model input consumer. | Add projections on Skill tools: success `load_skill -> {ok,content,files}` and resource read -> `{ok,content}`; keep failures unchanged. Verify disclosure still reads raw toolResults, not projected messages. |
| Extension discover/describe | Discover returns `runId` plus descriptors containing generated extension/model keys, Host IDs and connection/catalog generations; describe repeats run/descriptor and optionally returns the exact direct `toolName` (`packages/core/src/extensions/extension-registry.ts:73-81,114-116`; schema `packages/shared/src/extension-discovery-schema.ts:21-43,99-114`). | `extensionId` is the next-call selector; kind/display/summary/availability and `toolName` steer use. `runId`, `modelKey`, connection/catalog generations and usually owner Host ID are sealed snapshot/currentness metadata, not arguments. Owner Host may be useful only when the task explicitly selects a Host. | Add `toModelOutput` in `extension-tools.ts`: compact descriptor view; retain `truncated`; keep `extensionId` and direct `toolName`. Optionally expose owner Host only for multi-Host disambiguation. Raw results must stay unchanged because disclosure verifies raw identity/toolName at `tool-disclosure.ts:79-85`. |
| Extension call | Raw success is `{ok:true,owner,output}`; failures carry owner plus closed code/state (`extension-registry.ts:82-109,241-272`; shared schema `extension-discovery-schema.ts:133-152`). A successful indirect MCP call can therefore show a nested owner identity and nested MCP `content` object rather than the direct tool's normal content projection. | Owner generation identity is needed internally for captured binding/disclosure but is usually model-noise. The nested output itself, `cancelled` and `outcome_unknown` are essential. A generic unwrap cannot correctly project every third-party MCP content type. | Capture an optional candidate-owned model projector beside the sealed call closure. `extension_call.toModelOutput` should use it for known Skill/MCP/capability candidates; otherwise return a conservative `{ok,output}` without deleting unknown fields. Keep raw owner identity for currentness and direct disclosure. |
| Direct third-party MCP | SDK tool returns the server's complete `CallToolResult`; model receives standard `content` conversion. `structuredContent` remains raw/typed when an output schema is configured, while compatible content mirrors stay protocol-owned (`mcp-client.ts:1305-1406`). | Schema is server-specific and may contain necessary selectors, resources, images or evidence. This audit cannot classify all installed or future MCP fields. | **Keep the generic boundary as-is.** Optimize only a known server/tool at its source or through an explicit canonical-identity adapter. Never recursively remove `id`, `hash`, `revision`, `_meta`, or suffix-matching keys. |
| Host capability metadata | Every turn's instructions contain primary Host plus each Host's ID, label, duplicated availability/readiness, last-seen time, connection/catalog generations and complete bounded capability/workspace/Skill/MCP identifiers (`packages/core/src/hosts/host-context.ts:12-29,31-85`). | `primaryHostId` and target Host IDs are functional route selectors. Capability/workspace/Skill/MCP identities and truncation describe reachable work. Connection/catalog generations are sealed controls; `available` duplicates readiness. `lastSeenAt` is useful only when unavailable/staleness matters. | Create a separate model projection in `renderHostContext`: keep Host selectors, readable labels, readiness, advertised semantic resources and truncation; omit generations and duplicate boolean. Keep the full frozen snapshot for registry/currentness. |
| Co-Watching catalog/read | List already returns only `analysisId,title,media` (`manage-co-watching-tool.ts:65-66`; shared read model `co-watching-schema.ts:59-61`). `read_analysis` currently embeds the complete registered analysis including server/native service/request/job/SHA identity beside bounded content and paging (`read-analysis.ts:43-55,63-70`; schema `co-watching-analysis-read-schema.ts:21-30`; full identity `co-watching-schema.ts:16-20`). | List shape is already good. In read output, `analysisId`, title/media, content, view, offset/total/nextOffset/truncated are functional. Native service/request/job/hash/revision prove verification internally but are not subsequent user-tool inputs. | **Keep list as-is.** Add `manage_co_watching` model projection for read success that uses the minimal catalog analysis view while retaining all paging/content fields. Raw result keeps native verification identity. |
| Co-Watching control and URL analysis | Start returns sessionId/expiry; revise/stop small acknowledgements. URL/status/cancel returns full `MediaAnalysisJob` containing requestId, characterId, URL, status, runId, analysisId, title, reason and expiry (`manage-co-watching-tool.ts:74-116`; `packages/shared/src/media-analysis-schema.ts:18-29`). | `requestId` is the current cancel selector, `analysisId` selects later catalog read, status/reason/expiry/URL/title are useful. `runId` is execution identity; characterId repeats bound scope. | Add an action-aware projection in the tool: omit bound Character and internal Run; keep requestId only while it is a usable current selector, plus analysisId and all state/reason/expiry truth. Do not turn accepted into completed. |
| Media recommendations | Prepare/status/cancel returns batch with `batchId`, bound Character and up to three full jobs (`manage-media-recommendations-tool.ts:42-60`; `media-analysis-schema.ts:31-47`). | `batchId` and job `requestId` are required status/cancel selectors. Per-job URL/status/reason/expiry/analysisId are useful. Per-job runId and repeated characterId are not. | Project at `manage-media-recommendations-tool.ts`: compact batch and jobs while retaining exact batch/job selectors and all partial completion/failure/cancellation distinctions. |
| Initiative follow-up | Result is already small: status/state/purpose/window/reported time/disposition; refusal is actionable (`packages/core/src/initiative/plan-follow-up-tool.ts:27-40`). | No verified pollution. No internal Run/Attempt/tool-call IDs are returned. | **Keep as-is.** |
| Interaction patterns | List/read/history return domain views and paging; mutations return current pattern. `patternId`, version, candidate/effective `revisionId`, `nextAfter` and `nextBefore` feed later calls/CAS (`packages/core/src/initiative/manage-pattern-tool.ts:70-103`; schemas `packages/shared/src/interaction-pattern-schema.ts:100-120`, `interaction-pattern-protocol.ts:25-50,74-79`). | Bound `characterId`, origin internals and repeated full definitions can be verbose, but IDs/revisions/cursors are functional. Accepted/created timestamps are factual history. | Keep selectors/CAS/cursors. A compact list projection may omit bound Character and full revision bodies while read/history retain detail. Do not change immutable paging serialization without compatibility tests. |
| Scheduler | `action=list` returns complete tasks, and create/update/pause/resume/delete each return one complete task (`packages/core/src/scheduler/schedule-task-tool.ts:54-75`; schema `packages/shared/src/scheduled-task-schema.ts:26-39`). There is no model-readable detail/history action. | `taskId` and revision are mandatory CAS inputs; schedule/timezone/control input/state/nextRun are user-visible truth. `characterId` repeats the tool's bound scope. `lastRunId` and created/updated times remain accessible through the actual complete list result. Under the sole regular writer, create writes `enabled=true,state=active`, state changes set `enabled` iff state is active, update preserves both, and terminal advance writes `enabled=false,state=completed` (`packages/core/src/db/scheduled-task-repo.ts:24-39`), so `enabled` duplicates mutation receipt state. Conflict `currentRevision` is functional. | Keep `action=list` complete. Add a scheduler-local compact projection **only for mutation receipts**; preserve `taskId`, revision and conflict `currentRevision`. Omit bound Character and invariant-derived `enabled` from those receipts, while list remains the real route to timestamps/lastRunId/full canonical records. |
| External QQ MCP | The server returns JSON text in standard MCP `content`, errors as `isError:true` plus retryable/details (`H:/QQMessageMonitor/src/mcp/register-tools.ts:27-35,64-131`). Status includes lifecycle/health/issues plus `summary.schemaHash` (`status-service.ts:131-196`). Feed returns conversation/reference/count/summary state and advances feed progress; reads preserve refs, local read progress and no-loss cursors (`feed-service.ts:92-209`; `conversation-reader.ts:368-451,454-558,606-693`). | QQ numbers, `qqc_/qqsu_/qqsf_/qqm_` refs, `nextCursor`, hasMore, evidence availability, recall/content availability, gaps and local progress are functional. `schemaHash` is internal and has no read input consumer. Local feed/read progress is not QQ-client read state. | Keep semantic read/feed outputs and exact refs. Remove `schemaHash` from the **model/server result projection**, not the summary owner. Improve descriptions as below. Do not require status -> feed -> read; choose by user intent. |

## Fields that should remain unchanged

- `exec` stdout/stderr, exit code, timeout and `truncated`; `read_file` content/path/bytes/`truncated`; screenshot source path/dimensions/capture time and fenced description.
- `capturedAt` on state snapshots because replay folding consumes it; omission would change history pressure behavior.
- Memory `memoryId` + revision where update/invalidate/restore can consume them; semantic policy origin/visibility/disclosure; provenance actor/origin/source reference; nonempty entities/source-memory IDs/observation scopes; meaningful temporal evidence; recall `partial`, `branchFailures`, retryability/next action, `truncated`, pending/confirmed and vector availability.
- Skill body and resource file list; extension `extensionId`; `extension_describe.toolName` when it activates a direct captured tool.
- Host IDs and capability/workspace identifiers that actually select a Host-bound operation; never replace them with display labels.
- Co-Watching `analysisId`, media identity, sessionId while controlling an active session, read `offset`/`nextOffset`/`totalChars`/`truncated`; media recommendation `batchId` and job request IDs.
- Pattern `patternId`, expected version, accepted/candidate revision IDs, `nextAfter`/`nextBefore`; Scheduled Task `taskId`, revision and conflict `currentRevision`.
- QQ hard identity (`conversationType` + QQ number), local references, sender UIN, cursors, `hasMore`, source/evidence availability, recall/gap state, and explicit local-progress acknowledgements.
- All `cancelled`, stale-generation, deadline, retryable, conflict and `outcome_unknown` results. An unknown side-effect outcome must never be simplified to failure, empty, success or safe retry.

## Description and prerequisite gaps

1. `extension_discover` says results are bounded but does not explain `truncated`. The description should state that truncation means the immutable Run directory omitted entries under its fixed budget; there is no cursor or eager fallback in that Run. `extension_describe` already correctly says exact describe reveals a direct tool on the next step (`extension-tools.ts:16-29`).
2. Memory tool descriptions explain purpose but not all normal non-success result semantics. Add concise guidance: partial recall remains usable with named branch failures; truncated means the returned set is incomplete; pending mutation is not applied completion; conflict/superseded requires fresh recall rather than blind retry.
3. Co-Watching and media recommendation descriptions are already mature about accepted-versus-complete, reuse, cancellation and upstream uncertainty (`manage-co-watching-tool.ts:27-40`; `manage-media-recommendations-tool.ts:34-40`). Preserve them; only align projected result field names with those instructions.
4. Scheduler's one-sentence description does not explain CAS conflict or that list should precede update/pause/resume/delete when the exact task/revision is unknown (`schedule-task-tool.ts:54-58`). Add this result interpretation; do not require list before create.
5. QQ tools should remain independent by intent. Update the external owner descriptions without rewriting the summary prompt:
   - `qq_monitor_status`: diagnostic only, not a prerequisite for feed/read.
   - `qq_feed_pull`: use for “what changed?”; it advances **local feed progress**, never local read progress or QQ-client read state.
   - `qq_read_conversation`: direct read when the conversation/reference is known. For `operation=read`, only `scope=unread` advances local read progress; `recent` and `after_cursor` do not. `operation=mark_read` explicitly advances local read progress. Neither operation changes QQ client's read state.
   Current wording at `register-tools.ts:99-105` incorrectly lets “Only scope=unread advances read progress” read as if it also covers `mark_read`; the implementation proves explicit mark-read advancement at `conversation-reader.ts:667-693`.
6. QQ summary ownership stays in `H:/QQMessageMonitor/src/summary/prompt-builder.ts:28-69`. Its message IDs are source evidence for findings, not disposable tool-result IDs. No summary-prompt rewrite is proposed here.

## Cancellation, retry, empty and paging rules

- SDK/tool errors: `toModelOutput` does not run on AI SDK `tool-error` conversion. Keep actionable thrown/validation messages at the actual error owner; projections cover structured normal results only.
- Core governance cancellation returns `{ok:false,code:'CANCELLED'}` before dispatch (`governed-tool.ts:113-118,197-207`). Do not project it to a generic failure.
- Forced MCP generation close after dispatch returns `OUTCOME_UNKNOWN`; stale pre-dispatch generation returns `MCP_STALE_GENERATION` (`packages/core/src/mcp/mcp-turn-tools.ts:22-25,71-103`). Unknown side effects require inspection, never automatic replay.
- Extension call normalization preserves `cancelled` versus `outcome_unknown` (`extension-registry.ts:241-268`). Any compact view must keep `state`.
- Co-Watching analysis read has distinct not-found/unavailable/cancelled/reference-changed/invalid-offset/identity-mismatch failures (`read-analysis.ts:79-89`). Keep all; identity mismatch is not permission to reanalyze.
- No-loss paging coordinates are opaque and exact: Co-Watching `nextOffset`; patterns `nextAfter`/`nextBefore`; QQ `nextCursor`/message refs; feed `hasMore`. Never shorten, hash again, infer or concatenate pages from different selection/view identities.
- An empty successful list/read is not a failed read. QQ `hasUpdates:false`, Memory `returned:0`, Co-Watching empty catalog and scheduler/pattern empty list must remain distinguishable from unavailable/partial/truncated.

## Concrete projection seams

The smallest coherent implementation is not one middleware. It is a set of explicit projectors owned by the capability that knows which identifiers are callable:

- `canonical-memory-tools.ts`: operation-specific Memory semantic views, then existing untrusted fencing.
- `load-skill-tool.ts` / `read-skill-resource-tool.ts`: omit revision only from model view; raw result remains activation/currentness truth.
- `extension-tools.ts` plus captured `ExtensionCandidate`: compact directory views and optional identity-bound output projector for indirect call.
- `host-context.ts`: full frozen internal snapshot plus a separate rendered model view.
- `manage-co-watching-tool.ts` / `manage-media-recommendations-tool.ts`: action-aware views; reader/runtime results remain complete internally.
- `manage-pattern-tool.ts` / `schedule-task-tool.ts`: compact list/default receipts without losing selectors/CAS/paging.
- `H:/QQMessageMonitor`: server-owned result projection/description adjustment for its three known tools. Continue returning standard MCP `content`; if `structuredContent` is added, preserve a useful backwards-compatible content mirror and validate both consumers.

Do not attach a projector by model-facing sanitized tool key alone. The extension/MCP seam must bind it to the same captured canonical owner/subject/revision as the call closure so a collision or replacement cannot select another projector.

## Synthetic source-derived examples and exact size measurements

These are synthetic ASCII examples using current source fields; they are not private runtime data or external-model observations. Counts are exact compact JSON character counts and UTF-8 byte counts measured in-memory on 2026-11-01. Because all shown characters are ASCII, characters equal UTF-8 bytes. Counts exclude SDK `toolCallId`/toolName envelopes, provider transport escaping, untrusted/source fences and material-reference wrappers. No tokenizer or token-saving claim is used.

| Example | Actual-before chars / UTF-8 bytes | Proposed-after chars / UTF-8 bytes | Difference |
| --- | ---: | ---: | ---: |
| Memory recall, one evidence-rich hit | 2,049 / 2,049 | 1,010 / 1,010 | 1,039 |
| Extension discovery, one entry | 551 / 551 | 233 / 233 | 318 |
| Co-Watching analysis page | 685 / 685 | 401 / 401 | 284 |
| Scheduled Task mutation receipt | 447 / 447 | 282 / 282 | 165 |

### A. Memory recall

Actual-before shape. This exact object passed `HindsightMemoryRecallEnvelopeV1Schema.parse`; notably the current capability contract requires `contractVersion`, `conditionalMutation`, `idempotentWrites`, `sparseRetrieval` and `derivedMemoryRead` in addition to the earlier booleans (`packages/shared/src/memory-provider-domain-schema.ts:121-125`):

```json
{"ok":true,"requestId":"8e0c4fcb-8d85-4b9d-b240-6ce89d98a162","providerId":"hindsight","authorityEpochId":"epoch-2026-11-01","capabilities":{"providerId":"hindsight","contractVersion":1,"retain":true,"recall":true,"reflect":true,"edit":true,"invalidate":true,"restore":true,"conditionalMutation":true,"idempotentWrites":true,"sparseRetrieval":true,"vectorRetrieval":"ready","derivedMemoryRead":true},"data":{"hits":[{"record":{"unit":{"authorityEpochId":"epoch-2026-11-01","bankId":"character:taki","memoryId":"mem-42","documentId":"doc-17","chunkId":null,"text":"The user prefers concise technical reports while reviewing Project Alpha.","context":"Observed during a project review.","factType":"observation","state":"valid","revision":3,"tags":["taki-layer:activity"],"metadata":{},"entities":["project:alpha"],"sourceMemoryIds":["mem-source-7"],"observationScopes":[["device:desktop","window:editor"]],"eventDate":"2026-10-20T08:00:00.000Z","occurredStart":"2026-10-20T07:45:00.000Z","occurredEnd":"2026-10-20T08:00:00.000Z","mentionedAt":"2026-10-20T08:00:00.000Z","createdAt":"2026-10-20T08:00:00.000Z","updatedAt":"2026-10-31T09:30:00.000Z","editedAt":"2026-10-31T09:30:00.000Z","consolidatedAt":null,"consolidationFailedAt":null,"invalidationReason":null,"invalidatedAt":null,"proofCount":2},"policy":{"authorityEpochId":"epoch-2026-11-01","bankId":"character:taki","memoryId":"mem-42","layerId":"activity","importance":5,"visibility":"retrieved","disclosure":"When Project Alpha review style matters","origin":"observed","emotionalWeight":null,"retention":{"kind":"rolling-window","days":30},"policyVersion":1,"updatedAt":"2026-10-31T09:30:00.000Z"},"provenance":{"actor":"system","origin":"machine-observed","characterId":"taki","timelineFromSeq":null,"timelineToSeq":null,"capturedAt":"2026-10-20T08:00:00.000Z","sanitized":true,"sourceRef":"activity:sample-88"}},"scores":[{"source":"hybrid","value":0.91,"higherIsBetter":true}],"confirmed":true}],"returned":1,"truncated":false,"vectorState":"ready","partial":false,"branchFailures":[]}}
```

Proposed-after model view:

```json
{"ok":true,"hits":[{"scope":"character","memoryId":"mem-42","revision":3,"text":"The user prefers concise technical reports while reviewing Project Alpha.","context":"Observed during a project review.","factType":"observation","state":"valid","policy":{"layer":"activity","origin":"observed","visibility":"retrieved","disclosure":"When Project Alpha review style matters","importance":5,"retention":{"kind":"rolling-window","days":30}},"provenance":{"actor":"system","origin":"machine-observed","sourceRef":"activity:sample-88","capturedAt":"2026-10-20T08:00:00.000Z"},"entities":["project:alpha"],"sourceMemoryIds":["mem-source-7"],"observationScopes":[["device:desktop","window:editor"]],"time":{"eventDate":"2026-10-20T08:00:00.000Z","occurredStart":"2026-10-20T07:45:00.000Z","occurredEnd":"2026-10-20T08:00:00.000Z","mentionedAt":"2026-10-20T08:00:00.000Z","updatedAt":"2026-10-31T09:30:00.000Z"},"confirmed":true}],"returned":1,"truncated":false,"vectorState":"ready","partial":false,"branchFailures":[]}
```

The proposal adds semantic scope at the projection owner; it does not infer it from an opaque Bank string in middleware. It also deliberately retains semantic policy/provenance, nonempty lineage/entity/scope evidence and meaningful time facts. Raw-result retention and a generic fence do not make omitted model fields recoverable. Pending overlays, source material and failures need their own explicit arms.

### B. Extension discovery

Before:

```json
{"runId":"f5db3175-6977-46cc-979d-e2bd9448b1cc","entries":[{"identity":{"extensionId":"ext:22ceca061ac64f3814942c8c4f825568d83f79ee","kind":"mcp-tool","ownerHostId":"32be09ac-f25d-4e3b-8dbf-82fd1eecc6ad","subjectId":"server-a:qq_read_conversation","subjectRevision":"config-7:tool-3","connectionGeneration":12,"catalogGeneration":9},"displayName":"QQ conversation reader","summary":"Read monitored QQ conversations and local summaries.","callMode":"mcp-tool","modelKey":"ext_mcp_12ab34cd56ef_98ab76cd54ef3210abcd","available":true}],"truncated":false}
```

After:

```json
{"entries":[{"extensionId":"ext:22ceca061ac64f3814942c8c4f825568d83f79ee","kind":"mcp-tool","displayName":"QQ conversation reader","summary":"Read monitored QQ conversations and local summaries.","available":true}],"truncated":false}
```

`extensionId` remains exact for describe/call. A multi-Host task may conditionally retain ownerHostId; generations remain internal.

### C. Co-Watching analysis page

Before:

```json
{"ok":true,"status":"analysis_read","analysis":{"analysisId":"62ac8416-2bb8-4890-9b7a-0aef21acbe1a","revision":4,"title":"Example video","media":{"kind":"bilibili","bvid":"BV1xx411c7mD","cid":"123456","page":1},"serverId":"bili-analysis","native":{"serviceInstanceId":"a20eb7d8-e57b-453a-856a-8dfb9fc6aa4d","requestId":"e511a9fc-7d50-4ed5-b9a1-4824dcfd1a21","jobId":"739593cc-aec7-43a2-8882-047309bb654c","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},"view":"analysis","content":"<untrusted-observation source=\"registered-video-analysis\">Useful analysis content.</untrusted-observation>","offset":0,"totalChars":24,"nextOffset":null,"truncated":false}
```

After:

```json
{"ok":true,"status":"analysis_read","analysis":{"analysisId":"62ac8416-2bb8-4890-9b7a-0aef21acbe1a","title":"Example video","media":{"kind":"bilibili","bvid":"BV1xx411c7mD","cid":"123456","page":1}},"view":"analysis","content":"<untrusted-observation source=\"registered-video-analysis\">Useful analysis content.</untrusted-observation>","offset":0,"totalChars":24,"nextOffset":null,"truncated":false}
```

All verification fields remain in the raw result; paging and media identity remain model-visible.

### D. Scheduled Task receipt

Before:

```json
{"ok":true,"task":{"taskId":"task-2f27","characterId":"taki","name":"Weekly review","controlInput":"Review open project risks","pattern":{"kind":"cron","expression":"0 9 * * 1"},"timezone":{"kind":"fixed","timezone":"Asia/Shanghai"},"enabled":true,"state":"active","revision":5,"nextRunAt":"2026-11-02T01:00:00.000Z","lastRunId":"6a0af020-9cd3-4acf-b123-4ed4abec2680","createdAt":"2026-10-01T02:00:00.000Z","updatedAt":"2026-10-28T08:00:00.000Z"}}
```

After proposed mutation-only model view:

```json
{"ok":true,"task":{"taskId":"task-2f27","name":"Weekly review","controlInput":"Review open project risks","pattern":{"kind":"cron","expression":"0 9 * * 1"},"timezone":{"kind":"fixed","timezone":"Asia/Shanghai"},"state":"active","revision":5,"nextRunAt":"2026-11-02T01:00:00.000Z"}}
```

The exact selector/CAS revision remains. `action=list` stays complete and is the actual model-readable route to `createdAt`, `updatedAt`, `lastRunId`, `enabled` and every canonical task field; no nonexistent detail/history tool is assumed. Omitting `enabled` only from mutation receipts relies on the regular writer invariant described above, while state remains explicit.

## Verification required after authorized implementation

No tests were run in this audit. The following are future checks, not passed claims.

| Check | Required evidence |
| --- | --- |
| Installed-SDK next-request capture | Execute result remains raw; `event.toolResults` still drives disclosure/materials/outcome; the following provider request contains only the explicit model projection plus required source wrappers. Assert actual mock-provider prompt bodies. |
| Governed wrapper preservation | Core, Skill and MCP wrapped tools retain `toModelOutput`; denied/cancelled/stale/unknown results remain classified correctly. Cover property descriptors and indirect extension calls. |
| Memory matrix | Recall: zero, success, partial one-branch failure, all-branch failure, pending overlay, truncation, vector building/degraded, authority mismatch. Mutations: applied/unchanged/superseded/not-found/pending/conflict/cancelled/outcome-unknown. Verify memoryId/revision still supports the next mutation and no provider lineage is needed by model calls. |
| Skill disclosure | A successful captured load activates only the expected bundle on the next step despite revision omission from model view; failed/stale/mismatched load activates nothing. Resource content remains available and fenced as required. |
| Extension discovery/disclosure | Exact current describe still reveals only the captured direct tool; compact discover preserves extensionId/truncated. Overflow remains undiscoverable in that Run; no false pagination claim. Multi-Host conditional owner display cannot change routing. |
| MCP protocol compatibility | Known direct MCP tools preserve text/image/resource content and `isError`; structuredContent/outputSchema validation still works; indirect extension projection cannot replace or reinterpret an unknown third-party schema. Capture QQ direct and extension_call paths separately. |
| Host routing | Compact prompt retains exact primary/target Host selection, workspace/capability identity and unavailable/truncated truth. Connection/catalog generations remain internal and stale generation fails closed. |
| Co-Watching/media | List -> read and every page reconstructs the exact verified content; wrong analysis/view/offset refuses. Accepted/start/status/cancel/revise/stop keep their different meanings. Recommendation batch/item selectors and mixed completed/failed/cancelled jobs survive compaction. |
| Initiative/pattern/scheduler | Follow-up unchanged. Pattern list/read/history/mutation preserve exact CAS and cursors. Scheduler conflict exposes currentRevision; create/list/update/pause/resume/delete keep user-visible definitions and state. |
| QQ direct intent and progress | Status, feed and direct read work independently. Feed advances only local feed progress; unread/mark_read advance local read progress as specified; recent/after_cursor do not; nothing claims QQ-client read. Repeated calls with `hasMore`/`nextCursor` recover every item without duplication/loss. Empty, summary-failed, capture-gap, recalled, expired-source and storage errors remain distinct. |
| Size report | Compare complete serialized next-provider requests for identical synthetic scenes, including instructions, tool schemas, source fences and material refs. Report exact chars/UTF-8 bytes; use provider token usage only if genuinely observed. |

Run proportional Core/Shared/QQ tests, typechecks and lint only after implementation is authorized. Real provider/model behavior, packaged UI and live external MCP acceptance require separate authority and evidence.

## Verified findings, limits and actual edit

**Verified:** model projection is a separate seam from raw execution; governance preserves it; Memory and extension envelopes currently expose substantial internal lineage; Host prompt contains sealed generations; Co-Watching list is already minimal while read embeds native verification identity; scheduler/pattern IDs and revisions are functional; QQ refs/cursors/UINs and local-progress semantics are functional; standard MCP direct output is third-party-owned.

**Proposal:** explicit capability-owned projections, conditional diagnostics, description corrections, and no generic cleaner. Outputs identified as already good remain unchanged.

**Limits:** no private/runtime QQ results were inspected; no inventory of all installed or future MCP server result schemas is claimed; live call frequency, aggregate context savings, model reliability, provider serialization/caching and UI behavior are unverified. The worktree is heavily dirty and line numbers can drift. Synthetic examples measure only the compact values shown.

Actual edit: created only `docs/research/TOOL-RESULT-AUDIT-CAPABILITIES-2026-11-01.md`. Checks performed: worktree/branch/status reads; specified Trellis specs; current production/tool/schema call paths; installed AI SDK/MCP source; external QQ source and summary-owner boundary; exact consumer searches; in-memory compact JSON character/UTF-8 measurement. No production files changed and no test-passing claim is made.
