# Delegation model-facing tool result audit

Date: 2026-11-01. Scope: source audit and optimization proposal only. No production implementation, service launch, external model call, private database read, dependency installation, commit, push, reset, task binding, or archival was performed.

## Decision

The child-tool example is partly valid: worker lists and inbox detail/refusal results expose broad read-model summaries and duplicate exact targets/waits. It is incorrect to assume that successful delegate/message/stop calls expose their entire stored acknowledgements: those tools already have an explicit `toModelOutput` projection. Several IDs and one class of digest are executable inputs for later tool calls. Keep them; remove unrelated copies at the existing projection owners.

Recommended first change, after owner approval: extend the existing control/evidence projections to cover scoped refusals, worker lists, and inbox details/actions; retain exact child targets, event addressing, content, source context, outcome classes, and paging. Keep raw repositories, raw intrinsic self-history, and collector acknowledgements intact. Do not introduce a generic result framework, recursively delete fields by name, shorten opaque cursors, or move redundant fields into another prompt block.

This document distinguishes **verified source facts**, **proposals**, and **unverified runtime behavior**. Line references point to the current dirty worktree, not the stale semantic index.

## Workspace and SDK boundary evidence

- `Get-Location` returned `H:\TakiAgent-worktrees\t4`; `git branch --show-current` returned `task/t4-skills-mcp-productization`. The worktree already had extensive tracked and untracked changes; none was reverted. This report is the only owned edit.
- The installed/locked AI SDK is `7.0.148`: `pnpm-lock.yaml:142-144`; `packages/core/node_modules/ai` resolves to the worktree's pnpm package. Reading installed source is not a runtime test.
- Installed `ai/src/prompt/create-tool-model-output.ts:17-29` returns tagged errors on SDK error paths, otherwise invokes `tool.toModelOutput({toolCallId,input,output})` when present; its fallback returns `{type:'json',value:JSON.parse(JSON.stringify(output))}` for an object. `ai/src/generate-text/stream-text.ts:2258-2273` passes each raw tool output into that conversion. Paths here are relative to `packages/core/node_modules/`.
- SDK `errorMode:'text'|'json'` branches run **before** the custom projection. Normal toModelOutput cannot shorten schema-validation/execute tool-error feedback. Preserve that distinction; any SDK-error presentation change is outside this proposal.
- `packages/core/src/governance/governed-tool.ts:93-104` replaces only `execute` via property descriptors; the original `toModelOutput` survives. Thus a model-only projection can be changed without mutating the trusted raw execution result.
- `packages/core/src/agents/agent-attempt.ts:84-112` passes the assembled tools to `ToolLoopAgent` and prepares subsequent requests. `:147-158` separately retains response messages and raw `event.toolResults`; `:109-112` can render material references/source sidecars into the next request. `packages/core/src/agents/worker-sdk-segment.ts:41-43` explicitly measures retained raw results as well as projected messages. Reducing model context does not prove an equal reduction in runtime retained memory.

## Source, role, and result coverage

All listed tools are informational or intrinsic private collectors; none grants public speech, child lifetime authority, or Memory mutation.

| Model surface / role | Exact input and actual returned/model object | Current owner and evidence | Finding |
| --- | --- | --- | --- |
| `delegate_subagent` / foreground parent creation or reuse | `label`, nullable `subagentId`, `direction`, explicit fresh/snapshot context, completion policy, narrowed tool selection, MaterialRefs. `execute` returns rich control result; SDK receives text JSON containing worker/state/acceptedInputId/cancellationRequested/pendingRequest/exact target. | `subagent-delegate-tool.ts:17-45`; `subagent-tool-schema.ts:10-18`; `subagent-control-output.ts:8-16`. Core generates operation key from Run and SDK toolCallId at `:34`. | Already projected; canonical input, context digests, sender and receipts are not ordinary model output. Retain reusable conversation identity. |
| `send_subagent_message` / parent ordinary guidance, exact answer, explicit continuation | Message target permits omitted work/version/Run for ordinary messages. Answer/continue parses full `SubagentTargetSchema`; `replyToEventId` identifies exact request. Same control projection on success; unparsed refusal fallback serializes broad scoped `current` plus `currentTarget`. | `subagent-message-tool.ts:14-34`; `subagent-tool-schema.ts:20-28`; `subagent-schema.ts:26-28`; `subagent-tools.ts:30-45`; control output `:9-10`. | Do not replace exact answers/continuations with “current child” guesses. Refusal result needs compact scoped projection. |
| `stop_subagent` / parent pause | Exact `{subagentId,workInputId,expectedRunId,expectedControlVersion}`; same success projection and broad refusal fallback. | `subagent-stop-tool.ts:12-20`; `subagent-schema.ts:26-28`. | Versions and explicit null Run are necessary control facts, not waste. |
| `inspect_subagent` workers / parent navigation | Both IDs null; `cursor` becomes list `afterId`; limit bounded to 100. Returns `service.list` directly, so SDK JSON contains full Summary entries, including progress/tokenUsage. | `subagent-inspect-tool.ts:16-31`; `subagent-tool-schema.ts:37-42`; `subagent-queries.ts:64-68`; `subagent-api-schema.ts:20-30`. | A UI-style summary really does cross the model boundary here. No global projection removes it first. |
| `inspect_subagent` completion / parent result reading | `completionId` selects a retained result. Returned `{status,completionId,body,offset,complete,nextCursor}` has stringified projected child+parent evidence and actual deliveryState. SDK fallback preserves that object. | inspect `:24-28`; `subagent-evidence-output.ts:11-15,33-46`; `subagent-queries.ts:55-61`. | Existing projection already omits receipts, child/parent digests and publication IDs. Keep failed/cancelled/unknown/no-output distinctions and deliveryState. |
| `inspect_subagent` messages/inputs/results/materials / parent history | Child-bound paged history, using `projectRecord: subagentHistoryEvidence`; returned records contain JSON body strings. Inputs omit requestDigest/operationKey/consumed/replyAcceptance; messages omit modelEffectId/modelInputDigest; materials remain raw. | inspect `:35-38`; evidence output `:17-24`; `subagent-self-history-tool.ts:38-83,100-119`. | Parent history is already partially projected. Nested native tool outcomes and raw material payloads must not be blindly redacted. |
| `inspect_subagent` events / parent explicit record_only questions/reports | Scoped captured-frontier cursor; returns records with immutable paged body JSON, current state/eligibility/suppression and fresh exact target. | `subagent-event-inspection.ts:12-57`; evidence output `:27-30`; queries `:39-52`. | No inbox delivery or handling is caused by inspection. IDs repeat in page envelope, body and target; some repetition preserves standalone evidence. Change body projection only with cursor compatibility. |
| `read_agent_inbox` / foreground or idle delivered consumer | Exact delivered eventId, text offset/limit, optional event/action detail. SDK JSON contains eventId/kind/state/target/full current summary/event-work pendingRequest/text/nextOffset/absent/sourceContext. | `subagent-inbox-tools.ts:16-32`; `subagent-inbox-schema.ts:44-46`; `subagent-inbox-context.ts:54-64`. | Verified broad summary and duplicate pendingRequest. Event-specific request and child's current request can differ, so deduplicate only identical requests. |
| `handle_agent_event` / foreground or idle exact disposition, answer, check-in continue | `eventId`, model-chosen stable `operationKey`, discriminated action. Answer/continue includes full target and replyToEventId; speech note is proposal, not receipt. Returns direct stored/apply result; successful child action includes inputId. Refusal contains scoped current/target/pendingRequest. | inbox tools `:35-48`; inbox schema `:32-43`; inbox context `:66-80`; `subagent-inbox-repo.ts:54-76`. | Keep operationKey for unknown-outcome reconciliation and conflict detection. Direct action result should reuse existing action-evidence projection; no raw action rewrite. |
| `interact_parent` / child nonblocking message or blocking input wait | Only `{kind:'message'|'needs_input',text}`. Returns `{ok:true,proposed:true,accepted:false}` or structured stale/conflict result. Acceptance waits for matching completed SDK result. | `subagent-interact-tool.ts:32-59`; inbox schema `:13-15`. | Already small and truthful; do not simplify proposal into “sent” or “accepted.” Wait ends work execution; no polling tool is needed. |
| `complete_subagent` / child final collector | `{text,materials:MaterialRef[]}`. Returns the same proposed/not-yet-accepted triple, or actionable material/stale/conflict error. Commit verifies actual tagged result before recording proposal. | `subagent-result-tool.ts:27-60,65-81`; tool schema `:30-32`. | Keep collector raw acknowledgement shape: `hasCollectorResult` consumes its `proposed`/`accepted` fields and JSON outcome tag. No new hash-heavy output here. |
| `read_self_history` / child intrinsic recovery | Only own category/cursor/limit; no sibling selector. Returns full retained history JSON body pages unless a caller explicitly supplies projectRecord. Actual inputs, raw native tool results and canonical result group remain recoverable. | self history `:21-35,38-83,100-119`; `subagent-context-schema.ts:19-28`. | Raw recovery is intentional capability. Parent `inspect` projection must not silently change this intrinsic exact-history contract. |
| Dynamic inbox injection / foreground and idle model instructions | Frozen claim render: eventId, worker UUID, label, workInputId, kind, up to four abbreviated sources, UTF-8 preview, detailRequired; repeated as instructions during the claim's subsequent requests. | inbox repo `:79-113,151-178`; inbox context `:30-35`; agent attempt `:63-66,98-112`. | Work ID is insufficient for mutation without target version/Run; users still need read/inspect. Remove only redundant work ID from teaser, keep child ID for inspection/reuse and exact event ID for read/handle. Do not copy complete current summary into injection. |

Abbreviated filenames in this table are under `packages/core/src/agents/`, `packages/core/src/harness/`, or `packages/core/src/db/` as named; schema files are under `packages/shared/src/`. Full evidence paths appear below where ownership matters.

## Identifier and field disposition

The classification is contextual, not a global allow/drop list.

| Field(s) | Disposition | Why / downstream consuming tool |
| --- | --- | --- |
| `target.subagentId` | **Keep** | Reusable private conversation identity: delegate with existing subagentId, inspect child, ordinary guidance, exact stop/continue/answer. Labels are nonunique and mutable descriptions. |
| `target.workInputId` | **Keep** | Explicit work must not retarget to newer work. `send_subagent_message`, `stop_subagent`, `handle_agent_event` exact action schemas consume it. |
| `target.expectedRunId`, including explicit `null`; `expectedControlVersion` | **Keep** | CAS/current execution checks on stop/continue/exact answer. Null means displayed idle; omission has compatibility semantics. Never guess a Run, increment version, or shorten to a label. |
| Event `eventId`, request `replyToEventId` | **Keep** | `read_agent_inbox`, `handle_agent_event`, exact question answer/check-in continuation. Reading record_only events through inspect does not authorize handle_agent_event without delivered membership. |
| `completionId`, nonnull `latestCompletionId` | **Keep** | Select exact result using inspect; completionId currently equals child execution Run identity. Removing apparent Run IDs indiscriminately breaks this navigation. |
| `nextCursor`, `nextOffset`, record `id`, `offset`, `complete`, `hasMore`, `status` | **Keep** | Full reconstruction, immutable captured frontier and wrong-scope/error detection. Opaque cursor coordinates are passed unchanged; they are not paragraphs of optional metadata. |
| `operationKey` in handle input and recovered accepted action | **Keep** | Repository compares operation key plus action digest and returns original result on identical repeat (`subagent-inbox-repo.ts:58-64`). Unknown outcome must not produce a new side effect. Ordinary delegate/message keys remain Core-generated and internal. |
| `MaterialRef.kind='input'`: `inputId`, `key` | **Keep when available for selected material** | Delegate/message/complete/parent decision use these to select an actual input material (`context-source-schema.ts:35-40`; tool materials `:150-156`). |
| `MaterialRef.kind='tool_result'`: `runId`, `attemptId`, `stepNumber`, `toolCallId`, `key` | **Keep** | Tool material sink validates exact completed witness, not tool name or an invented short ID; downstream selected materials and complete_subagent consume them (`subagent-tool-materials.ts:100-115,158-175`). |
| `MaterialRef.kind='retained_result'`: `childRunId`, `resultDigest`, `materialIndex` | **Keep in explicit reference / raw recovery** | `resultDigest` is a real stale-evidence fence: compared to canonical childDigest at tool materials `:160-165`. Not interchangeable with an internal requestDigest. |
| Canonical `childDigest` in default parent inspect | **Already internal; keep current omission** | Parent evidence projection intentionally excludes it. Parents can select the exact completed inspect tool result via supplied tool_result MaterialRefs. Intrinsic raw results preserve canonical digest for retained_result recovery. Do not re-add hashes everywhere or delete them from actual reference objects. |
| `acceptedInputId` in control success | **Conditional** | Delegate work inputId duplicates target.workInputId. For a message with selected materials, accepted inputId can be used with retained material keys; preserve it or supply explicit input MaterialRefs when materials exist. With no selected materials it has no consuming model input identified in this audit; expose `accepted:true` instead. |
| handle result `inputId` | **Internal by default** | Current inbox answer/continue sends `materials:[]` (`subagent-inbox-context.ts:72-75`); no downstream exact-action schema consumes its accepted answer input ID. Canonical acceptance/replay keeps it. `subagentActionEvidence` already removes it in recovered action detail. |
| Wait `answerInputId` | **Conditional; omit null and ordinary default** | Wait state preserves answered/open truth; answerInputId is useful for raw exact input recovery, not direct answering. Keep where recovery requires it; do not claim the answer was absent because ID is omitted. |
| Wait reason/state/`checkIn.requiredActor` and full factual checkIn sidecar | **Keep** | Distinguish question answer from check-in continuation and user-only continuation. Full checkIn supplies the reason/evidence for human or parent approval; do not remove counters needed to assess the pause. |
| `current.state`, `stopOrigin`, worker label, actual outcome/outputKind/currentness | **Keep** | Models must distinguish idle from completion, user stop from parent stop, question from check-in, partial/none from complete and failure from successful empty. These are behavioral facts. |
| Current pending request duplicated beside event-specific pending request | **Conditional** | Expose one copy when same event/work/reason; retain both under clear existing owners when different works/events. A historical event target and active work cannot be merged. |
| `activeWorkInputId`, `latestWorkInputId`, `activeRunId`, `controlVersion` duplicated beside target | **Conditional** | Remove equal copies, but preserve differing active/latest work selectors so reuse/concurrent work cannot silently select a different job. Exact target retains Run/version. |
| `characterId` in scoped successful list/current summary; createdByRunId, initialContextDigest, nextInputSeq | **Internal by default** | Trusted bindings already fix Character and scope; not a model-selected authority. Preserve canonical storage/API. CreatedAt can be conditionally useful chronology in explicit history, not every control ack. |
| `progress`, `tokenUsage` ordinary current/list summaries | **Conditional** | No subsequent control schema consumes them. Keep checkIn evidence for actual pauses; omit general usage/progress by default only if explicit diagnostics remains available. Never replace unknown totals with zero or falsely mark incomplete usage complete. |
| Canonical request/action/body/projection/model-input digests, receipts, consumerId/modelEffectId/invocationId/producerAttemptId/producerKey | **Internal by default** | Atomicity, exact intent membership, replay, audit, recovery, CAS and generations remain runtime-owned. Existing projections already omit most. ConsumerId belongs operator recovery, not model action input; intrinsic raw evidence remains exact. |
| `sourceContext` and `sourceContext.generatedBy` | **Keep in first implementation** | Generated provenance differs from source speaker attribution. Preserve label/reference/speaker/time and generation origin; do not turn worker text into a user quote or drop unknown-source semantics. Further source projection would need its own contract and proof. |
| `agent-event:<eventId>#<bodyDigest>` source reference | **Keep as one evidence reference** | `subagent-inbox-context.ts:33-34` supplies immutable attribution for accepted public text. Digest here binds evidence identity, although model action input only needs eventId. Do not delete the fragment globally; do not separately append bodyDigest to every event teaser. |
| `artifact.reference` and `artifact.revision` | **Keep when present** | Artifact source/revision evidence is result content. No current tool dereference was found; lack of a consumer is not permission to erase requested deliverable references. |

## Existing scoping, projections, and sanitization

1. Character/child scope is checked by `subagent-queries.ts:39-41,55-58` and self history `:49-57`. Wrong-Character refusals expose no summary (`subagent-tools.ts:32-39`). Inbox reads require actual delivered intent and exact consumer membership (`subagent-inbox-context.ts:55-58`); handle requires actual invocation/Effect membership (`subagent-inbox-repo.ts:131-142`). These checks stay before model projection.
2. Existing model-only owners: `subagent-control-output.ts`; `subagent-evidence-output.ts`; `subagentActionEvidence` at `packages/core/src/db/subagent-action-evidence.ts:6-10`. The latter omits inputId, receipts, action/consumer/Effect/invocation IDs and request/action/body digests only at the top level. It is already reused for action detail; direct action ack currently bypasses it.
3. Evidence body paging caps **body text**, not entire result envelope: 3,000 UTF-16 code units for history/event/completion pages, with surrogate-pair boundary protection (`subagent-self-history-tool.ts:64-83`; event inspection `:32-55`; evidence output `:43-46`). Inbox read accepts up to 16,000 characters per page (`subagent-inbox-schema.ts:44-45`), similarly protects pairs, and explicitly returns absent/nextOffset. These are not byte caps and not token counts.
4. Dynamic inbox preview is capped in **UTF-8 bytes**, 1,500 per event, at most eight events and 16,384 rendered bytes (`subagent-inbox-repo.ts:92-110,166-178`). Sources are abbreviated to four entries, 100-character labels and 200-character references. These are teaser source previews; exact read still returns full sourceContext. Source preview truncation has no independent truncation flag; do not treat a shortened reference as full immutable evidence.
5. `packages/core/src/agents/source-context.ts:27-55` renders source facts using `fenceUntrusted` without inferring attribution from arbitrary text. `untrusted-fence.ts:19-24` neutralizes injected closing tags. Parent-selected summary is fenced (`subagent-delegate-tool.ts:37-39`). No universal delegation-result sanitizer strips every native nested field; claiming one exists would be false.
6. `context-reduction.ts:129,175,203-206,249-270` sanitizes/reduces material for compaction/replay. It is not an argument for corrupting exact raw recovery results. `private-task-context.ts:198-205` reattaches exact tool MaterialRefs; `:208-210` protects bounded read_self_history outcomes from ordinary large-result reduction. Preserve complete native error/cancellation tags.

## Proposal at current ownership boundaries

### First approval scope: no input schema changes, no raw result rewrites

- Extend `subagentControlModelOutput` to project known scoped refusals as well as successful controls. Preserve `{ok:false,code,message,nextAction}`, compact `current`, and one exact `currentTarget`; keep foreign/unknown error results unchanged unless a known structured type can be projected safely. On success add an explicit accepted fact when an input exists; emit acceptedInputId conditionally for selected-material addressing. Emit cancellationRequested when true; absence in the new projection means no cancellation request, and must be stated in its description. Preserve nonnull pendingRequest.
- Add `toModelOutput` at the existing `inspect_subagent` declaration for **unpaged worker-list summaries only**. Reuse a small explicit worker-summary projection: label/state/stopOrigin, one exact target, relevant pendingRequest, nonnull completionId, and differing active/latest work selectors. Preserve entries/nextCursor. Do not recursively transform stringified body fragments or raw `materials`.
- Add `toModelOutput` for `read_agent_inbox` and handle refusals/results. Compact current summary; preserve event-work target and event pendingRequest; include child-current pendingRequest separately if different. Reuse `subagentActionEvidence` on direct successful handle output, preserving eventId/disposition/ok/publication. `publication:'not_published'` is significant, not decorative metadata. Do not modify the retained action result or idempotence comparison.
- General progress/usage diagnostics must remain available explicitly before removing them from default workers/current model projections. Reuse existing selectors first: both IDs null with `category:null` can request the compact default; `category:'workers'` can explicitly request the current detailed Summary list. Both values already exist in the input schema, so no new flag/tool is necessary. This selector/output behavior and description change requires owner approval; the examples show the intended compact default, not an implemented behavior. Do not silently make model-readable diagnostics inaccessible merely because Desktop still has them.
- Remove redundant workInputId from future dynamic **teasers** because read supplies the exact target. Keep eventId, worker UUID, label, kind, bounded preview, sources and detailRequired. Keep the source reference sidecar at its existing owner; do not add a new hash or current-summary block to replace the removed field.
- Shorten repeated tool prose only after preserving the operational distinctions: create/reuse vs acknowledgement, ordinary message vs exact question answer vs continue, copy target unchanged/null Run, user Stop/user-only check-in, proposal vs acceptance/publication, pagination and opaque-cursor reuse, record_only inspection. Use description cross-references only when that sibling is actually available. `inspect_subagent.afterSeq` is accepted but never used by its implementation; mark deprecated/remove only as a separate input compatibility change, not a “result optimization.”

### Optional later scope: evidence body projection changes

`subagentEventEvidence` currently repeats event/child/work identities that appear outside body pages. Removing redundant identifiers from the **immutable body projection** can save more, but requires cursor versioning/preserved rendering because cursors address offsets in that serialized body. A `toModelOutput` hook sees partial JSON strings, so it must not parse/strip those fragments independently. Keep the initial proposal to outer summaries/teasers; do not manufacture empty body text or claim partial JSON parses as full evidence. Retain self-contained accepted evidence and source attribution unless a new explicit envelope contract preserves them.

## Representative actual-before / proposed-after examples and size measurement

These use synthetic ASCII values with **source-derived current fields**. They are not observations from a private DB or external model. Measurements are exact `JSON.stringify(value).length` on the compact objects shown, computed in an in-memory JavaScript script on 2026-11-01. Because every example character is ASCII, those counts also equal UTF-8 bytes for the measured serialized value. Savings are illustrative estimates for those scenarios, not aggregate traffic measurements. No tokenizer was used and no token savings are claimed.

For control example A, the current SDK output is `{type:'text',value:JSON.stringify(before)}`: the measured value below is the already projected inner text. For inbox/list examples B/C the SDK fallback yields `{type:'json',value:before}`. D is an instruction teaser, not a tool result. Native `toolCallId`/toolName envelopes, JSON string escaping at provider transport, source fences, and later material-reference wrappers are deliberately excluded from this value-level measurement; actual next-request overhead can be higher.

| Scenario | Current chars / UTF-8 bytes | Proposed chars / UTF-8 bytes | Saved |
| --- | ---: | ---: | ---: |
| A. Projected delegate ack, no selected materials | 320 | 237 | 83 |
| B. read_agent_inbox, same open question in current and event work | 1,605 | 779 | 826 |
| C. workers page, one paused worker | 907 | 443 | 464 |
| D. dynamic one-event teaser, fixed header excluded | 307 | 254 | 53 |

### A. Existing projected control acknowledgement

Before (not the rich repository result):

```json
{"worker":"Source researcher","state":"queued","acceptedInputId":"22222222-2222-4222-8222-222222222222","cancellationRequested":false,"pendingRequest":null,"target":{"subagentId":"11111111-1111-4111-8111-111111111111","workInputId":"22222222-2222-4222-8222-222222222222","expectedRunId":null,"expectedControlVersion":0}}
```

After proposal, specifically no selected materials, no pending request, no cancellation request:

```json
{"ok":true,"worker":"Source researcher","state":"queued","accepted":true,"target":{"subagentId":"11111111-1111-4111-8111-111111111111","workInputId":"22222222-2222-4222-8222-222222222222","expectedRunId":null,"expectedControlVersion":0}}
```

If accepted message input has materials, preserve its acceptedInputId/material references. If cancellation was requested or a wait exists, keep those facts. This example does not establish completed work.

### B. Delivered question read

Before:

```json
{"ok":true,"eventId":"event-question-1","kind":"needs_input","state":"delivered","target":{"subagentId":"11111111-1111-4111-8111-111111111111","workInputId":"22222222-2222-4222-8222-222222222222","expectedRunId":null,"expectedControlVersion":4},"current":{"subagentId":"11111111-1111-4111-8111-111111111111","characterId":"taki","label":"Source researcher","createdAt":"2026-11-01T02:00:00Z","activeRunId":null,"activeWorkInputId":null,"controlVersion":4,"stopOrigin":null,"state":"needs_input","pendingRequest":{"eventId":"event-question-1","workInputId":"22222222-2222-4222-8222-222222222222","state":"open","answerInputId":null,"reason":"question","checkIn":null},"progress":{"workInputId":"22222222-2222-4222-8222-222222222222","tracking":"work_start","completedSteps":3,"intervalStartSteps":0,"intervalSteps":10,"parentApprovalLimit":2,"consecutiveParentApprovals":0},"tokenUsage":{"modelEffects":3,"inflightEffects":0,"missingUsageEffects":0,"inputTokens":900,"outputTokens":300,"totalTokens":1200,"knownTotalTokens":1200,"complete":true},"latestWorkInputId":"22222222-2222-4222-8222-222222222222","latestCompletionId":null},"pendingRequest":{"eventId":"event-question-1","workInputId":"22222222-2222-4222-8222-222222222222","state":"open","answerInputId":null,"reason":"question","checkIn":null},"text":"Which baseline should I use?","nextOffset":null,"absent":false,"sourceContext":{"generatedBy":{"runId":"child-run-1","attemptId":"child-attempt-1","subagentId":"11111111-1111-4111-8111-111111111111"},"materials":[{"label":"Workspace file","reference":"notes.txt","speaker":"Document author"}]}}
```

After proposal:

```json
{"ok":true,"eventId":"event-question-1","kind":"needs_input","state":"delivered","target":{"subagentId":"11111111-1111-4111-8111-111111111111","workInputId":"22222222-2222-4222-8222-222222222222","expectedRunId":null,"expectedControlVersion":4},"current":{"worker":"Source researcher","state":"needs_input","stopOrigin":null},"pendingRequest":{"eventId":"event-question-1","workInputId":"22222222-2222-4222-8222-222222222222","state":"open","reason":"question","checkIn":null},"text":"Which baseline should I use?","nextOffset":null,"absent":false,"sourceContext":{"generatedBy":{"runId":"child-run-1","attemptId":"child-attempt-1","subagentId":"11111111-1111-4111-8111-111111111111"},"materials":[{"label":"Workspace file","reference":"notes.txt","speaker":"Document author"}]}}
```

Exact question text, source attribution and action addressing are unchanged. `absent:false` still distinguishes present empty text from absent data. A check-in example must keep its full factual checkIn object. A different current-work request must remain separately visible.

### C. Worker list

Before:

```json
{"entries":[{"subagentId":"11111111-1111-4111-8111-111111111111","characterId":"taki","label":"Source researcher","createdAt":"2026-11-01T02:00:00Z","activeRunId":null,"activeWorkInputId":null,"controlVersion":4,"stopOrigin":null,"state":"needs_input","pendingRequest":{"eventId":"event-question-1","workInputId":"22222222-2222-4222-8222-222222222222","state":"open","answerInputId":null,"reason":"question","checkIn":null},"progress":{"workInputId":"22222222-2222-4222-8222-222222222222","tracking":"work_start","completedSteps":3,"intervalStartSteps":0,"intervalSteps":10,"parentApprovalLimit":2,"consecutiveParentApprovals":0},"tokenUsage":{"modelEffects":3,"inflightEffects":0,"missingUsageEffects":0,"inputTokens":900,"outputTokens":300,"totalTokens":1200,"knownTotalTokens":1200,"complete":true},"latestWorkInputId":"22222222-2222-4222-8222-222222222222","latestCompletionId":null}],"nextCursor":null}
```

After compact-default proposal (explicit diagnostics access is a prerequisite):

```json
{"entries":[{"worker":"Source researcher","state":"needs_input","stopOrigin":null,"target":{"subagentId":"11111111-1111-4111-8111-111111111111","workInputId":"22222222-2222-4222-8222-222222222222","expectedRunId":null,"expectedControlVersion":4},"pendingRequest":{"eventId":"event-question-1","workInputId":"22222222-2222-4222-8222-222222222222","state":"open","reason":"question","checkIn":null},"latestCompletionId":null}],"nextCursor":null}
```

Here active/latest work do not differ from the selected target. Different work selectors must be conditionally retained. Nonnull latestCompletionId is retained for result inspection; a conversation with no work cannot claim a full valid target.

### D. Dynamic inbox teaser

Before (`subagent-inbox-repo.ts:166-170`):

```json
{"eventId":"event-question-1","worker":"11111111-1111-4111-8111-111111111111","label":"Source researcher","workInputId":"22222222-2222-4222-8222-222222222222","kind":"needs_input","sources":[{"label":"Workspace file","reference":"notes.txt"}],"preview":"Which baseline should I use?","detailRequired":false}
```

After:

```json
{"eventId":"event-question-1","worker":"11111111-1111-4111-8111-111111111111","label":"Source researcher","kind":"needs_input","sources":[{"label":"Workspace file","reference":"notes.txt"}],"preview":"Which baseline should I use?","detailRequired":false}
```

The fixed behavioral header is not counted or proposed for removal. Its job is to distinguish worker evidence from user utterances, handling from public delivery, and interrupted output from accepted completion. The read tool still supplies work/version/Run together. No fields are relocated into a second injection block.

## Dynamic injection and material-reference amplification

- The same claim instructions are returned during subsequent prepareStep calls (`agent-attempt.ts:101-112`). Reading an event does not replace or acknowledge that immutable claim. Hence B's full text can coexist with D's preview; removing B's duplicates saves result context but does not remove D. Preserving a small routing teaser is intentional.
- The claim stores immutable instructions plus a projectionDigest (`subagent-inbox-repo.ts:103-110,151-157`). Delivery evidence records the original projectionDigest at actual model intent (`:116-128`). New rendering should affect future claims, not rewrite historical claims/digests or replay delivered events.
- Source attribution for later public text uses a separate event reference (`subagent-inbox-context.ts:33-34`; `agent-attempt.ts:148-150`). That metadata is retained for truth/audit; do not treat it as proof that every field was sent to the provider in the same request.
- `subagent-tool-materials.ts:85-101` captures raw complete results and produces tool_result references, including a default key `result` when provenance is unknown. `:53-65,124-131` renders those references into the next request. Even a small acknowledgement can therefore gain a reference object; this cost is actionable context for delegate/message/result selection, not automatically removable metadata.
- `subagent-tool-materials.ts:61` and `source-context.ts:40-55` may add source headers alongside references. Both use WeakMap associations to render from originals and avoid cumulative nested wrapping; audit the actual next provider prompt before claiming duplicated source wrappers. The measurements above exclude these wrappers explicitly. Removing a source field from a direct tool object must not discard producer-owned sidecars or leave the same unwanted data in a newly added header.
- Do not globally disable MaterialRefs for acknowledgements without a separate proof that selecting that completed tool result is unsupported/unneeded; current sink deliberately retains raw output as selectable material. The first proposal changes result values only.

## Compatibility and meaningful verification plan

No runtime tests were executed in this audit. Existing tests were read for requirements, not reported as passing.

| Check after authorized implementation | What it must prove |
| --- | --- |
| Actual installed-SDK mock-provider request capture | Execute raw result is unchanged; next request has compact toModelOutput value plus required material/source wrappers. Assert on model.doStreamCalls prompt, not merely returned execute object. Governed wrapper must retain projection. |
| Control message/stop/refusal matrix | Ordinary guidance, exact question answer, permitted check-in continue, parent-stop resume, user-stop refusal, user-only check-in, stale version/Run/null Run, wrong Character and explicit older work preserve outcomes and scoped exact targets. Existing sources: `subagent-followup-contracts.test.ts:24-38`; `subagent-event-inspection.test.ts:66-77,80-110`; service/check-in tests. |
| Source/MaterialRef round trip | Input refs with material keys, exact completed tool refs including unknown provenance, and retained_result correct/wrong digest are still accepted/refused appropriately; selected text and speaker/reference/time survive. Relevant `subagent-materials.test.ts`, `subagent-tool-materials-retention.test.ts`, `source-context.test.ts`, `subagent-result-tool.test.ts`. |
| Collector completed-result witness | Proposed=true/accepted=false raw JSON result still drives one terminal reservation/commit; invalid material does not consume terminal choice; final vs needs_input conflict, stale currentness, failed SDK/recording and unknown effects are not relabeled successful. `subagent-result-tool.test.ts`; `subagent-interactive.test.ts`; governed-tool tests. |
| Inbox action unknown-result reconciliation | Same operationKey and action return retained result without a second child input/publication; conflicting action/key refuses. Preserve disposition/publication meaning, membership and actual invocation scope. `db/subagent-inbox.test.ts`; `subagent-inbox-recovery.test.ts`. |
| Bounded paging and result truth | Reconstruct multilingual/emoji long question/result/input/tool evidence exactly; cursor scope/frontier/body-offset drift refuses; failed/unavailable/invalid_cursor remain distinct from empty. Current relevant expectations: `subagent-followup-contracts.test.ts:40-54`; `subagent-event-inspection.test.ts:32-64,80-110`. |
| Mixed-work detail | Historical event work A plus current/pending B retains both distinctions and neither target is silently rewritten. Repeated identical pending request is compacted once. Keep user-only actor sidecar for check-ins. |
| List navigation/diagnostic compatibility | Multi-page workers retain nextCursor and subagent identity; reused conversation and nonnull completion can be selected; explicit detailed diagnostics preserve incomplete/missing usage and factual counters. Existing usage assertions: followup contracts `:92-101`. |
| Frozen dynamic claim/recovery | Future claims use compact teaser; existing claimed/delivered projections/digests remain unchanged; old accepted actions remain inspectable. No event replay, automatic admission or publication authority is added. `subagent-inbox-recovery.test.ts`, `subagent-inbox-yield.test.ts`, runtime inbox tests. |
| Request size comparison | Serialize actual next provider prompts with identical synthetic scenes before/after, include tools/instructions/material/source wrappers. Report UTF-8 bytes or exact chars; provider token usage only if genuinely observed. No blanket token-factor estimates. |

After implementation, run relevant Core/Shared typechecks and scoped/root lint required by `.trellis/spec/backend/shared-agent-delegation.md:144-147` and private inbox `:133-139`. Do not run or claim external-model acceptance without its separate authorization.

Compatibility effects requiring explicit treatment:

- AI-facing output key/default changes affect saved prompt fixtures, model instructions and learned usage patterns, even if internal RPC schemas do not change. Preserve accepted/refused/pending/publication distinctions and explain omission defaults.
- Preserve explicit diagnostic access through the existing `category:'workers'` selector before compact-default removal of progress/tokenUsage; keep nullable/incomplete values intact. No new input field is proposed. The new distinction between null/default and explicit workers requires updated description and actual-SDK tests.
- Keep `SubagentControlResultSchema`, stored inputs/results/events/action result_json and Desktop RPC read models unchanged. Use `toModelOutput` and explicit projections to isolate model changes.
- Existing persisted inbox instruction projections remain their immutable text/digest. New claims use the revised renderer. No database migration or rewriting historical bytes is necessary for first scope.
- Existing history/event cursor offsets depend on serialized projected bodies. Outer-summary changes need no body cursor change; any later body-render change needs versioned rendering/fallback or explicit restart with invalid_cursor. Do not concatenate pages from different renderings.
- Keep intrinsic read_self_history's exact raw recovery contract, including canonical hashes and native tool tags. Parent inspection remains the concise projection; no durable evidence is deleted.

## Verified findings, limits, and actual edits

**Verified:** successful delegate/message/stop already project; list/detail/refusal broad summaries and identical wait/target copies can consume context; internal receipt/hash projections exist; exact MaterialRefs/target/event IDs have real consuming schemas; dynamic claims and next-request reference/source rendering are separate context owners. There is no generic missing-results-equals-empty rule, and current paging/error/source contracts deliberately protect fidelity.

**Proposal:** small additions at existing toModelOutput/evidence/action owners; conditional field exposure; explicit diagnostics access; future teaser compaction; no generic framework or raw result mutation. Optional body projection changes are excluded from first scope.

**Unverified:** live traffic frequency, aggregate byte/token savings, model reliability with compact fields, external-provider serialization/caching, real UI behavior, and runtime tests. The current source includes ongoing uncommitted work; line numbers can drift. Synthetic examples measure serialized values, not complete provider requests.

Actual edit: created only `docs/research/TOOL-RESULT-AUDIT-DELEGATION-2026-11-01.md`. Checks performed: workspace/branch/status read; specified specs and current source/installed SDK reads; exact schema/caller searches; existing test-source review; in-memory compact JSON character measurement. No production files changed and no test-passing claim is made. Outstanding: independent parent review, owner explanation/approval, final compact-vs-detailed diagnostic behavior choice, implementation and the targeted verification above.
