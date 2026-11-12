# Research: Independent challenge of missing-input tool replay

- Query: Is historical empty-input tool replay real and misleading, and what is the smallest safe next pilot for Avatar failures and unnecessary request cost?
- Scope: internal, with installed upstream source verification; no production implementation or paid model calls
- Date: 2026-11-04
- Workspace: `H:/TakiAgent-worktrees/t4`; parent reported current commit `d1c7067`

## Findings

### Independent conclusion

Historical tool arguments are deliberately discarded and every retained historical call is reconstructed as `input: {}`. For tools requiring `name`, an originally successful call therefore becomes a native historical example of an invalid input paired with a successful outcome. That is a real loss of input semantics, not evidence that the original live call used an empty object. The storage privacy policy is meaningful; its current model-facing placeholder conflates **unavailable** with **known empty**.

This supports reviewing a narrow replay representation change. It does not establish that long context or this representation caused the recent expression error pattern. The mechanism predates the native-image changes. The parent's cohort evidence describes exposure and correlation, not a controlled causal result, and the absence of a comparable motion trend weakens a generic long-context explanation. Frequency of generated calls, repeated attempts, endpoint behavior and actual outgoing vocabulary/schema remain confounders. No new cohort calculations are repeated here.

The preferred next candidate is a projection-only pilot for complete historical Avatar pairs whose arguments are unavailable: present a clearly labeled historical observation containing the exact observed outcome and explicit argument unavailability. Do not revive all raw argument persistence, infer an old name from a successful result, or implement general result retrieval to solve this small presentation-family issue.

### Files found and code evidence

| File | Role and decisive evidence |
| --- | --- |
| `packages/core/src/agents/turn-mapping.ts` | Durable/model conversion: lines 48-54 retain only call ID/name/origin; lines 106-108 retain tool results; line 122 supplies `input: {}` on every replayed call. |
| `packages/core/src/db/timeline-repo.ts` | Independent repository privacy enforcement: lines 184-199 reconstruct call identity without input and preserve result data. A mapper-only argument change would still be discarded by the actual DB boundary. |
| `packages/shared/src/timeline-schema.ts` | Lines 42-49 accept an optional legacy `input`, but acceptance by the Shared schema is not proof that it survives repository sanitization or reaches replay. |
| `packages/core/src/agents/conversation-store.ts` | Lines 148-153 derive history/request projection from the selected entries through `nativeReplayMessages`; lines 176-178 explicitly document empty replay inputs. |
| `packages/core/src/agents/native-image-replay.ts` | Lines 29-37 transform tool image outputs before calling `toModelMessage`; lines 46-64 add image evidence after the original message. The image migration did not restore or erase Avatar arguments at this seam. |
| `packages/core/src/agents/agent-attempt.ts` | Line 75 chooses the ordinary primary store projection, while selected initiative and private worker paths use distinct projections. Lines 93-109 wrap the model with native dispatch measurement; lines 155-158 project the selected SDK step messages. |
| `packages/core/src/agents/native-image-attempt.ts` | Lines 28-42 preserve ordinary messages while projecting images; lines 45-63 apply retirement/hydration immediately before dispatch. No Avatar input repair occurs here. |
| `packages/core/src/agents/turn-mapping.test.ts` | Lines 31-48 assert names-only persistence; lines 119-138 explicitly assert empty placeholder replay even for legacy rows containing input; lines 156-170 assert secret exclusion. These are existing intentional contract tests, not evidence of live model quality. |
| `packages/core/src/avatar/set-expression-tool.ts` | Lines 19-24 require an expression `name`; lines 27-35 publish that actual name and return the outcome. A replayed successful outcome does not identify its old name. |
| `packages/core/src/avatar/play-motion-tool.ts` | Lines 24-32 require motion `name` and allow optional `priority`/`loop`; a partial name projection must not claim the original complete motion arguments are recovered. |
| `packages/core/src/avatar/vocab-name-schema.ts` | Lines 8-20 use the current dynamic enum or a non-empty string fallback when vocabulary is unknown. Asset names are not automatically a universal privacy-safe closed vocabulary. Historical names must not become authority for the current costume's tool schema. |
| `packages/core/src/avatar/presentation-stop.ts` | Lines 15-30 give one correction opportunity for SDK-invalid presentation calls; valid outcome rejection does not reopen the loop. Replay reform is separate from repair/stop behavior. |
| `packages/core/src/agents/context-reduction.ts` | Lines 71-111 reduce eligible old tool-result/summary projections while preserving recent non-tool messages; lines 122-138 render compaction input as names and bounded structured outcome facts, not native empty-input tool calls. |
| `packages/core/src/agents/replay-folds.ts` | Lines 64-69 rank snapshots/results/oversized arguments; lines 99-104 inspect stored arguments, normally already absent under current persistence; lines 122-130 replace result bodies with a fold trace. Folding cannot recreate discarded arguments. |
| `packages/core/src/agents/compaction-coordinator.ts` | Line 171 dispatches `renderSafeTranscript(captured.span)` to summary generation. The summary route does not replay the same malformed native call examples. |

### Actual semantics and reachability

1. The live SDK response can contain the real arguments. `toEntryInput` excludes them, and `TimelineRepo.sanitizeParts` also excludes them on write/read. Their absence is therefore a durable policy, not a one-off image serializer bug.
2. Ordinary primary requests consume `store.project(...).messages`; native image replay calls the old mapper. The installed compatible serializer emits `arguments: JSON.stringify(part.input)`, so mapper `{}` becomes literal historical HTTP arguments `'{}'`.
3. A native historical call is prompt evidence, not an execution request by itself. The diagnosed risk is misleading conditioning and missing historical detail, not automatic re-execution of old Avatar side effects.
4. History preserves matching IDs/names/results. Schema-invalid *new* generated calls are a different path: the SDK parses/validates them and emits the existing error/repair feedback. `Value: {}` in an error does not prove the provider emitted literal `'{}'`; the installed SDK also validates blank input as `{}`.
5. A successful Avatar result says the renderer applied something, or nothing was rendered, depending on the actual outcome. It cannot recover an omitted expression name. Preserve `applied`, `not_rendered`, `rejected`, `superseded`, `unknown`, error codes and actual reasons independently.
6. Summary generation already expresses tool records as facts without invented input. It can still lose an old requested name, because that name was not retained, but this is a different failure mode from native empty-input examples. No existing summary text was inspected for semantic contamination in this advisory pass.

### Preexisting behavior

The parent independently ran read-only Git inspection and reported that pre-November-2 commit `9326955` already contains both names-only `assistantEntry` persistence and `toModelMessage(... input: {})`. This advisory did not run Git, consistent with researcher restrictions. Current contract/tests also confirm intentional minimization. Original introduction date was not independently established and is unnecessary to reject a claim that the November native-image change introduced this mapper behavior.

### Alternatives and tradeoffs

| Candidate | Benefit | Cost, boundary and limitation | Decision |
| --- | --- | --- | --- |
| Keep native `{}` plus a global explanatory instruction | Small code footprint and preserves pair format | Still serializes known-empty native examples; every request pays extra explanation tokens; semantic effectiveness unmeasured | Useful control arm if a later experiment needs it; not assumed sufficient |
| Retain selected validated Avatar arguments prospectively | New valid examples can preserve exact names; complete selected motion fields could retain intent | Requires family-owned allowlist, mapper + repository + replay/spec changes; trusted identity rather than name-prefix trust; unknown-vocabulary names need privacy review; old names are unavailable; stale costumes remain historical only; changes durable content policy | Consider only if exact historical presentation intent is a demonstrated need; not the smallest first pilot |
| Convert only complete missing-input historical Avatar pairs to explicit observations | Truthfully separates unavailable input from empty input; supports old rows without DB rewrite; avoids teaching invalid successful native examples; small outcome family | Changes native roles/representation and request prefix; result/call pairing, attribution, order, source labels and mixed-call steps need verification; compactness and model-quality benefit must be measured | Preferred bounded candidate for review and offline validation |
| Drop historical Avatar calls/results entirely | Shortest request | Removes evidence that a presentation action occurred and its outcome; risks repeating the old tool-record-loss class of hallucination | Reject |
| Re-enable raw input for all tools or backfill guesses | Broad apparent fidelity | Commands, URLs, secrets and private bodies may be retained; current DB privacy contract violated; old raw inputs remain unavailable; no demonstrated need for broad change | Reject |

For the observation candidate, use a model-visible **Core-supplied historical record**, not unmarked current assistant speech or a fresh user instruction. For example, the semantic contents should be: `Historical avatar_set_expression record; arguments unavailable by storage policy; observed result: <the original small tagged output>`. The precise role/fence implementation is a reviewed design choice; this advisory does not claim a tested role arrangement. Keep text immediately associated with its original result position and preserve source/origin. Do not serialize an executable-looking call with fabricated `name`, or claim that this observation is an exact argument transcript.

### Smallest next pilot and acceptance

**Stage 1: offline projection experiment, no production behavior change.** Use sanitized representative stored pairs, the real ConversationStore/native request construction and installed SDK fetch stub. Compare unchanged replay and a narrow observation projection. Include applied/not-rendered success, schema error, renderer rejection, unknown/superseded outcome, text-plus-presentation call, parallel expression/motion, mixed Avatar/informational calls, split result rows, summary boundary and retained image evidence. Transform only complete historical pairs with proved trusted Avatar ownership. Any unsupported/malformed association remains unchanged or follows existing window validation; never silently remove an informational result.

Required proof: no fake historical native empty-input Avatar examples in the selected arm; all actual outcomes and assistant speech retained; no dangling tool rows or invalid neighboring native pairs; no changed current-turn call/result messages; zero execution/capture retries; byte-identical durable Timeline; correct request-pressure estimate and category/origin attribution for the actual dispatched representation; explicit unavailable old name rather than fabricated recovery.

**Stage 2: after review of the new production scope/design where applicable.** The owner's existing authorization for real data and matching bounded paid model calls remains valid; no call was needed or permitted by this advisory dispatch. Observe comparable natural-use scenarios or run a bounded model-quality experiment using unchanged versus observation replay, keeping model/endpoint/settings/active schema/vocabulary and user goal controlled. Treat context length and number of unavailable-input examples as separate exposures; a simple shorter-history comparison changes both and cannot isolate the mechanism. Record first-call validity, repairs/attempts, actual user outcome, subsequent context/summary/recovery requests, latency, input/cache/output usage and applicable prices. Do not promise cost savings from an offline serializer check.

Changing a historical prefix can lose cache reuse initially. Measure that loss over the affected subsequent request horizon; fewer local estimated tokens or a larger cache ratio alone is insufficient. Avatar result preservation needs no new generic retrieval framework. If a later large-result folding pilot omits exact data, existing originals must remain model-accessible without re-executing the side effect; UI scrollback or a developer's DB access is not model-accessible recovery.

**Root fix versus causal experiment:** replacing fabricated empty input with explicit unavailability addresses a verified representation problem. Whether the selected representation should be adopted, and whether it lowers expression errors or total cost, are still experiment questions. Do not label replay reform as the proven root cause of the recent error increase or bundle it with retry/summary-policy changes.

### External references and versions

- Installed `ai` **7.0.148**, confirmed in `packages/core/node_modules/ai/package.json` and `packages/core/package.json:17`.
- Installed/locked `@ai-sdk/openai-compatible` **3.0.75**, `packages/core/package.json:15`.
- `packages/core/node_modules/@ai-sdk/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts:266`: native historical input becomes `arguments: JSON.stringify(part.input)`.
- `packages/core/node_modules/ai/src/prompt/convert-to-language-model-prompt.ts:300-305`: passes historical call `part.input` into the model prompt.
- `packages/core/node_modules/ai/src/generate-text/parse-tool-call.ts:249-262`: validates newly generated input; blank argument strings are normalized to `{}` before validation.
- Official conceptual reference: [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), already linked from project Tool Design. This pass verified installed source rather than fetching latest docs; no live provider behavior or model conditioning was tested by the advisor.

### Related specs

- `.trellis/spec/backend/agent-runtime.md:19-34`: complete turn fidelity, deliberate raw-input exclusion, native pair validity and atomic selection. An observation projection needs an explicit reviewed exception/change, not an unnoticed mapper tweak.
- `.trellis/spec/backend/compaction-harness.md:70-72` and `84-102`: bounded private diagnostics, projection-only reductions, result identity, safe summary facts and source evidence.
- `.trellis/spec/backend/native-image-input.md:21-35`: actual repository retention, native tool/image association, full-request pricing and explicit unavailable evidence without recapture.
- `.trellis/spec/backend/operation-presentation.md:72-75`: repository raw-input exclusion and presentation metadata must not change canonical replay/source digest.
- `.trellis/spec/backend/tool-design.md`: distinct expression/motion vocabularies, outcome semantics, source-owned schemas and no blind side-effect retry.
- Parent `prd.md` and `design.md:97-126`: preserved quality/original records/recoverability; no broad history rewrite hidden inside native-image migration; assess total cost over cache/summary/recovery horizon.

## Caveats / Not Found

- The raw `.trellis/.current-task` is stale (`09-03-avatar-presentation-lab`). The parent explicitly dispatched `11-02-context-attribution-token-efficiency`; its `task.json` is `in_progress`. Only the assigned research file was written; no task state was changed.
- Current commit and pre-Nov2 Git evidence are parent-supplied, not independently executed by this researcher. No original-introduction claim is made.
- No live raw provider response was captured here. Recorded validation text cannot distinguish a provider's blank arguments from a literal `{}`; original live valid inputs cannot be recovered from the durable names-only timeline.
- No new metric cohorts, effect-size estimates, live model/paid calls, service restart, database rewrite, implementation, tests or Git operations were performed by the advisor. Static/upstream source inspection proves wiring/serialization, not improved model behavior.
- Whether changing native roles to a labeled observation improves quality remains unverified. Mixed-call groups, source/attribution continuity and adjacent tool-pair validity must be validated before adoption.
- Exact historical Avatar intent is already unavailable. Neither a summary nor a new recovery tool can reconstruct it from an omitted input without additional trustworthy evidence. Preserve that limitation visibly.
- Memory was used only to locate prior D69 and measurement/privacy cautions; current files and installed SDK source were re-read. Historical summary/token figures were not reused as current evidence.
