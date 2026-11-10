# Research: Bounded historical Avatar observation pilot

- Query: Challenge the approved observation candidate's role, placement, scope, SDK seam and cheapest useful paired comparison before experimental coding.
- Scope: internal advisory with installed upstream source verification; no production edits or model calls
- Date: 2026-11-04
- Task: `.trellis/tasks/11-02-context-attribution-token-efficiency`

## Findings

### Recommendation

Proceed with an **experiment-only, pure-Avatar-group projection**. Transform selected historical groups, never the live SDK turn. Use one `role: "user"` message explicitly labeled **Core-supplied historical tool evidence, not a new user request**, with the existing deterministic untrusted-data fence. Put it after the entire original atomic call/result group. Preserve the original assistant text before it, remove only the selected native Avatar calls and their exact matching results, and remove an assistant/tool message only when that removal leaves it empty.

Pure group means every call in the assistant call group is a proved built-in `avatar_set_expression` or `avatar_play_motion`, every call has exactly one matching contiguous result, and no unresolved call or unsupported part crosses the proposed insertion boundary. Initially leave mixed Avatar/informational groups unchanged and count skipped calls/groups. This provides a useful comparison without expanding the algorithm to mixed-group reassembly. If mixed coverage is required later, the same safe placement is after **all** original contiguous results, never between remaining native calls and their results.

The `user` role is an API transport choice for supplied evidence, as already used for native tool images; it is not a claim that the user uttered the record. Explicit labeling is essential. A `system` message would give historical data unnecessary instruction authority; an invented `tool` response would require a fabricated call; unmarked assistant prose would impersonate generated speech. Role changes may nevertheless affect model conditioning, so behavioral benefit remains a measured question. This pilot cannot isolate that role effect from the changed representation.

### Concrete observation contents

For each transformed pair, retain `toolCallId`, exact `toolName`, `argumentsStatus: "unavailable_by_storage_policy"`, the **entire tagged output passed into the projection**, and known source/origin facts. Group records in their original call/result order; never replace the output with an inferred success flag or a summary. In particular, keep applied, normal not-rendered, rejected, superseded, unknown, validation errors, codes and reasons distinct. Never infer a missing historical `name` or substitute the current costume's vocabulary.

Serialize the record as JSON inside `fenceUntrusted({ source: "core-historical-avatar", content: ... })`. The surrounding fixed label explains that it is historical evidence with unavailable inputs. No separate global system instruction or fictitious recovery endpoint is needed.

Important exactness detail: the existing fence neutralizes literal `</untrusted-observation>` by inserting a zero-width character. A reason containing that literal would otherwise change after JSON parsing. Before fencing, encode literal `<` characters in the serialized JSON as `\u003c` (valid JSON escape); then decoding the payload still reproduces the original tagged output exactly and the existing fence cannot be terminated by payload text. Test this adversarial string alongside ordinary outcomes. Do not redact, truncate or normalize the exact outcome in the candidate; keep private bodies local in ignored fixtures and publish only aggregate checks.

### Preconditions and conservative boundaries

- Pass an explicitly historical input slice produced from the frozen store projection plus association/provenance facts. Inspecting `input: {}` alone cannot distinguish storage exclusion from an actual live empty-input call. Do not expose the transformer as a generic callback over all SDK step messages.
- Require exact IDs **and names**, unique calls/results, complete result coverage, proper ordering and contiguous tool rows. Unsupported, orphaned, duplicate, reversed, name-mismatched or interrupted groups stay unchanged and are counted. A serializer passing its looser checks does not override project pairing rules.
- Exact reserved names are necessary but not sufficient historical ownership proof. Current `core-tool-governance-adapter.ts:39-40` binds those names to `core.avatar.expression` and `core.avatar.motion`; it does not independently prove every legacy snapshot call had that ownership. For this experiment, use known call-to-Run/Effect bindings from the already inspected snapshot or a documented collector fixture asserting their trusted origin. If historical ownership remains unknown, skip it rather than infer ownership from a prefix or promote unknown to built-in.
- Native images and their provenance sidecars remain intact. A group interrupted by a native image `user` message is not a simple contiguous pure group and should initially be skipped. No image recapture or action execution occurs.
- Preserve original assistant text/source header objects where possible. Rebuilding them with object spread can lose non-serialized WeakMap metadata. Preserve available call-origin and result-origin independently; absent origin remains unknown.
- The current spec demands native identity/result fidelity and `{}` minimization. Owner approval covers an experimental alternative, not silently changing that production contract. Production adoption still needs its reviewed exception and complete verification.

### Smallest viable test seam

Use one local experimental function under the task's permitted research/ignored target area:

`selected historical ModelMessage[] + snapshot association proof -> projected historical messages + transformed/skipped counts`

Apply it after selection/hydration to keep the exact same selected rows/images between arms, before constructing the common current request. Then reuse the existing native projection and installed AI SDK compatible serializer with a fetch stub to inspect the actual wire messages. Do not modify ConversationStore, `toModelMessage`, summary policy, window selection, the production prepareStep callback or live DB for this pilot. This seam estimates a representation change over fixed history; it does not prove how a future production integration would change window admission.

Minimum deterministic cases are meaningful assertions, not prose snapshots:

1. Pure single and parallel Avatar groups, split contiguous result rows, and assistant text-plus-call: exact outcomes/identities retained, no removed speech, transformed pairs absent from native tool fields.
2. Every important success/error/unknown outcome plus a closing-fence string: decode the observation and compare each full tagged output to the input.
3. Mixed informational groups and interrupted/incomplete/duplicate/name-mismatched groups: unchanged and explicitly counted as skipped; no silent partial conversion.
4. Current-turn calls, known-input records, non-Avatar tools and retained image messages: unchanged. Historical-only input ownership is enforced by the harness, not guessed from empty input.
5. Wire validity: no empty assistant/tool rows, no outstanding call before the inserted user record, no stranded native tool result, all remaining native pairs contiguous and unchanged. Assert these independently; installed SDK does not validate every duplicate/orphan/name mismatch.
6. Immutable originals and metadata: original messages/durable snapshot unchanged; native media sidecars retained; provider-bound size/attribution recaptured after transformation.
7. No execution: model responses are captured and validated; history and newly proposed actions never reach execution closures. A deterministic stub should fail the harness if any action executor is called.

### Attribution and size

The observation remains `tool_interactions` content even though transported as user text. `request-composition.ts:92-97` otherwise defaults an ordinary user text to `conversation` with built-in origin, which would misclassify it. Reuse `retainContextText`/`contextText` and `describeMessages` for the new observation's spans. Core wrapper/framing may use built-in attribution; the records must retain known original supplier or unknown, including distinct call/result origins if necessary. Rebuild final descriptors from the transformed messages; do not reuse removed native-interaction descriptors to manufacture text provenance.

Measure the entire actual wire request using the existing estimator/provider usage. One repeated fence and exact JSON output may cost **more** than a short native Avatar pair. That is acceptable as an experimental result; do not assume this is a token-saving mechanism. No component token estimate becomes provider-exact, and missing usage remains unknown. The historical-prefix change also affects cache reuse; include initial cache disruption and subsequent costs where observed.

### Cheapest meaningful paired model comparison

Start with **8 initial requests**, not the entire 24-request budget: two fixed real history boundaries (early/late) × two replay arms (unchanged/observation) × two repetitions of one expression-focused task. Alternate arm order between repetitions to avoid giving one arm systematically warmer cache. Select a boundary with enough covered pure Avatar pairs in each history; otherwise report that the pilot lacks exposure rather than stretch coverage.

Hold endpoint/model/settings, active tool schemas and current vocabulary, persona/instructions and final task text identical within every pair. Ask for one specifically named current expression alongside a short checkable substantive answer. Both arm prompts receive the same current request and both Avatar schemas if that matches the chosen harness. Do not force success by dropping failed/no-call responses from the denominator. A forced-tool variant may cheaply isolate argument validity, but is synthetic and does not replace the main automatic-tool comparison.

No tool executes. Capture tool proposals, parse with the same schema, score required-name presence, valid current enum and intended-name correctness, and assess the small substantive response against a predetermined expected answer. Track missing call separately from invalid args. For an invalid proposal, allow at most one paired correction request containing the real SDK-compatible validation feedback and matching call identity; cap output at 1,024 for every physical request. Corrected validity and whether the model responds after error are separate outcomes.

Count every initial/correction/failed physical request toward the **24** cap. Eight initial requests plus one correction each need at most 16. The remaining budget is optional, not a requirement: spend it only on a predeclared comparable motion control or an extra expression repeat if the first pass is informative and no clear structural/behavioral failure has occurred. Do not sample repeatedly to obtain a favorable result. Parent verifies endpoint/pricing and projected total cost before dispatch; existing bounded paid-call authorization remains valid.

Choose explicit decisions in advance: a structural mismatch rejects this candidate; consistent loss of intended action or substantive answer rejects it; small samples without a stable useful difference defer adoption. A successful tiny pilot can justify broader validation or a narrow adoption review, not a general claim of savings or causation. Report per-context transformed/skipped exposure, all validity/outcome counts, physical requests, repairs, latency, provider input/cache/output and conditional cost.

### What this comparison can establish

The frozen source is `target/context-analysis-20261104/conversation-115757.db` from the parent cohort report. Reconstructed current requests use present code/window calibration/schema; they are **not** exact historical provider prompts. Original valid argument values were omitted by storage, historical schema/endpoint settings may differ, and the original current runtime tail may be unavailable. Keep the reconstruction ledger explicit and identical between paired arms.

Early/late paired outcomes can inform whether this representation is useful under these reconstructed contexts. They cannot independently isolate context length from unavailable-example count, topic, recency, summarization or role changes. A matched-length padding control would itself be synthetic; it is unnecessary for selecting the first bounded candidate and should not consume the budget by default. No observed improvement proves the new native-image change caused the original errors.

### Files found / related specs / external references

- `research/pilot-plan-20261104.md`: owner-approved experiment, independent review, exact outcome/metadata preservation and 24-request/1,024-output caps.
- `research/cohort-analysis-20261104.md:12,105,130`: frozen source, reconstructed-wire limitations and early/late comparison requirements.
- `.trellis/spec/backend/agent-runtime.md:19-34`: durable tool evidence/privacy and strict atomic native-pair rules.
- `.trellis/spec/backend/native-image-input.md:28-35` and `agents/native-image-replay.ts:46-64`: user-role tool image evidence, exact association and explicit unavailability.
- `agents/untrusted-fence.ts:8-29`: existing deterministic supplied-material label, closing-tag neutralization and fence helper.
- `agents/context-attribution.ts:10-44` and `agents/request-composition.ts:23-44,84-114`: WeakMap sidecars, origin preservation, descriptors and ordinary user-text fallback.
- `governance/core-tool-governance-adapter.ts:39-40`: current trusted exact built-in Avatar bindings; legacy historical ownership still needs snapshot proof.
- Installed AI SDK **7.0.148**, `packages/core/node_modules/ai/src/prompt/convert-to-language-model-prompt.ts:75-104,106-146`: merges contiguous tool messages; outstanding calls before user/system messages or prompt end throw `MissingToolResultsError`; empty tool rows are removed. This is source/API evidence, not proof of target endpoint role acceptance.
- Installed compatible adapter **3.0.75**, `packages/core/node_modules/@ai-sdk/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts:210-228,256-291,296-332`: serializes user records, native calls and matching result IDs.
- Official conceptual reference: [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling). Installed sources were reviewed; no documentation fetch or external model call occurred in this advisory.

## Caveats / Not Found

- Read-only advisory only; no production edits, tests, model calls, DB writes, task state changes or Git operations. Only this assigned research artifact was written.
- The first recommendation intentionally covers pure proved-Avatar groups; mixed, interrupted and ambiguous legacy groups remain unchanged. Counts must make that limitation visible.
- The role arrangement is SDK-compatible in source, but endpoint acceptance and model semantics still need the deterministic wire probe and bounded model comparison. It may increase tokens.
- Ownership cannot be inferred from exact spelling alone; current reserved bindings do not recreate absent historical governance proof.
- Exact original arguments and exact historical full prompts remain unavailable. The candidate expresses that loss honestly and preserves known outcomes; it does not recover the omitted intent.
- No new memory lookup was performed. Prior D69/privacy cautions remain background context; the concrete recommendation is verified against current plan, current code and installed upstream sources.
