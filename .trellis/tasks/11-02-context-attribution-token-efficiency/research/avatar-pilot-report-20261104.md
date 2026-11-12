# Research: Faithful Avatar history pilot and bounded upstream diagnostic

> Freeze artifact location (2026-11-10): generated JSON observations are retained under
> `G:/taki-t4-freeze-20261110/local-artifacts/.trellis/tasks/11-02-context-attribution-token-efficiency/research/`
> and in `working-state-before-freeze.zip`. They are intentionally excluded from Git;
> experiment source and this conclusion remain committed.

- Query: Does an explicit historical observation representation preserve useful Avatar behavior and improve malformed-call recovery at early/late real conversation boundaries?
- Scope: mixed — frozen real conversation history, current controlled tool/profile reconstruction, deterministic SDK checks, a root-run bounded real-model comparison, and local private reply review.
- Date: 2026-11-04

## Findings

### Decision: DEFER production adoption of this observation representation

The candidate passes the tested pairing, output, privacy and serialization checks, but this pilot does not demonstrate a useful behavioral improvement. All four observation-arm trials make no tool call. Baseline trials produce two valid corrected expression proposals and four invalid expression proposals, plus two unavailable-tool proposals. Zero errors with zero Avatar use is not a successful error-rate reduction or proof that expressive behavior is preserved.

Both real latest user inputs concern studying, and neither explicitly asks for an Avatar expression, motion or reminder. Avatar use is optional in these conversations. All eight replies address the immediate conversational topic; that supports useful ordinary conversation, not successful presentation-tool repair. There is also a specific calendar-arithmetic defect in one observation reply. The experiment cannot justify adopting a more expensive representation merely because it suppresses tool proposals.

The candidate increases **actual first-request input** by 2,798 tokens early and 13,061 tokens late, in both repeats. Observation's lower aggregate cost comes with fewer calls and less expressive action; the work is not equivalent successful work. Do not present the conditional cost difference as validated savings.

The one subsequent late-baseline upstream diagnostic makes no tool proposal. Upstream SSE collection completes, but there is no failing argument to compare. Thus original missing-argument origin remains unknown. No further calls were made to obtain a favorable or diagnostic result.

### Files found and artifacts

| File | Purpose |
| --- | --- |
| `research/pilot-plan-20261104.md` | Owner-approved experiment boundaries, privacy constraints and 24-request ceiling |
| `research/replay-pilot-advisor-20261104.md` | Independent pre-implementation challenge; pure complete groups, explicit evidence role, exact outputs and honest coverage |
| `research/avatar-pilot-projection-20261104.mjs` | Experiment-only pure-Avatar history projection and strict native-pair assertions |
| `research/avatar-pilot-runner-20261104.mjs` | Default offline streaming runner; root-only explicit live mode and one bounded upstream diagnostic |
| `research/avatar-pilot-check-20261104.mjs` | Deterministic output/pair/source/image/current-turn/early-stop/cache/SSE-shape checks |
| `research/avatar-pilot-deterministic-20261104.json` | 13 passing deterministic fixture checks; zero model calls/actions |
| `research/avatar-pilot-dryrun-20261104.json` | Eight offline streaming fetch-stub trials, actual wire/attribution/schema checks and selected-history sizes |
| `research/avatar-pilot-upstream-dryrun-20261104.json` | Single diagnostic-mode offline path, zero external calls |
| `research/avatar-pilot-live-20261104.json` | Immutable original paired comparison: eight trials, 12 physical requests |
| `research/avatar-pilot-upstream-20261104.json` | Separate one-trial/one-request upstream diagnostic; original comparison untouched |
| `target/avatar-pilot-20261104/` | Ignored local private request/reply fixtures for root execution and authorized bounded local review; no credentials/authorization headers or raw SSE stored |
| `target/context-analysis-20261104/conversation-115757.db` | Read-only source snapshot, SHA256 `f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93` |

Only `avatar-pilot*` research artifacts were written by this researcher. The root executed the paid requests and wrote private target fixtures. No production replay edit, Git operation, service restart, live DB write, Host action or additional external call was performed by this researcher. The active task is the session-confirmed `11-02-context-attribution-token-efficiency`; the stale global task pointer was not changed.

### Reconstruction ledger and applicable limits

| Request component | What is reconstructed | Gap / interpretation |
| --- | --- | --- |
| Historical conversation | Exact frozen Timeline slice through user boundary 4239 or 4594, selected using current production Replay projection and latest fixed calibration | Historical calibration/transient admission decisions were not captured; this is not the exact old wire request |
| Rolling summary | Exact revision 6, through seq 4182, unchanged since Nov 1 | Only these post-summary boundaries are in scope |
| Original latest user | Exact retained 26-character user input at each boundary, unchanged between its paired arms | The two early/late tasks differ; no causal length isolation |
| Time | Current production formatting using the original Run's timestamp and Asia/Shanghai | Original perceived screen/volatile tail and automatic recall are absent |
| Base/persona | Current canonical base prompt, current shipped assistant/persona cards, current Avatar guidance | Configured/cached historical user-edited cards may differ |
| Memory | Source manifest proves Local provider/capability identity | It does not retain selected front/pinned/recall memory text or membership. These unknown sections are omitted equally from both arms; later memories are not substituted into earlier history |
| Blocks/revisions | Snapshot has block revision 3 updated after the early boundary and 298 unit revision snapshots | These do not reconstruct historical block contents or complete assembly selection |
| Tool schemas | Same two current Avatar factory templates and fixed persisted enum fixtures in both arms; automatic tool choice | Full historical tool definitions are unavailable. Avatar-only competition is explicitly controlled and unrepresentative of the complete runtime |
| Expression vocabulary | Same 30-name set from new retained validation errors, including seq 4688 | Current emitted schema uses the same fixture in every arm |
| Motion vocabulary | Latest parsable retained motion enum: 397 names at seq 1915 | Historical fixture is not proved to match the current live costume. No motion reliability or current motion-name correctness conclusion follows |
| Original Avatar input | Deliberately absent from canonical storage | Never guessed from prose, current vocabulary or validation example |

Historical `run_snapshots.manifest_json` has `replayDecision.status = not_captured`, empty `sourceRefs`, provider/capability metadata and extension identities, but no raw schema bytes, selected front-memory text or actual full dispatch. The current memory capture owner is `canonical-local-runtime.ts:97`; its `captureCanonicalMemoryAssembly` closure freezes selected rows/blocks/persona for the live Run, but the inspected manifest does not persist that text.

The first-request actual inputs are consequently about 34.6K/78.1K for the unchanged early/late arms, rather than historical 50.1K/99.1K requests. This is a controlled mechanism probe with real retained history and real user inputs, not a replay of all conditions that caused the original failures.

### Candidate and deterministic boundary

The candidate uses the existing `replayUnits` grouping (`context-window.ts:58`) and existing `nativeReplayMessages` hydration. Only explicitly historical rows are passed to it. Eligible groups require exact reserved built-in Avatar names, complete unique ID/name pairing, one starting assistant call group, and contiguous matching tool-result rows. Mixed, interrupted, unmatched, ambiguous, known-input and unexpected image groups stay unchanged and are counted.

The collector uses the inspected Taki snapshot's matched call/Run/model-Effect evidence and existing reserved-name registration/collision contract. Missing old supplier metadata remains unknown; it is not silently promoted to known origin. This is a documented controlled-domain assumption, not a new historical authority mechanism.

The original assistant speech remains before one `role:user` record explicitly labeled Core-supplied historical tool evidence, not a new user request. The inserted record replaces only eligible historical native Avatar calls and their matching results. It keeps call ID/name, call/result sequence, full tagged output, necessary source facts and any differing result order. Arguments-unavailable status appears once. It does not guess a historical name, collapse errors/no-ops to success, or create a fake native tool result.

JSON encodes literal `<` as `\u003c` before the existing `fenceUntrusted` wrapper (`untrusted-fence.ts:24`), so decoding retains exact output strings even when an output contains a closing-fence literal. The observation's text spans remain `tool_interactions` with call/result supplier sidecars; missing original supplier stays unknown. Wrapper framing is Core-owned. Descriptor construction uses the existing `context-attribution.ts` and actual final native dispatch composition, not old removed-interaction descriptors.

| Boundary | Historical Avatar calls | Transformed pure calls/groups | Mixed Avatar calls left native | Local history estimate: unchanged → observation |
| --- | ---: | ---: | ---: | ---: |
| Early 4239 | 15 | 14 / 14 | 1 | 22,333 → 24,464 (+2,131 units) |
| Late 4594 | 96 | 81 / 81 | 15 | 61,909 → 74,274 (+12,365 units) |

All other selected rows, current user input, native informational pairs and image/source sidecars remain intact in the tested boundary. The transformation does not change production selection/window admission; its increased size could affect a later production pressure boundary, which this fixed-selection pilot does not validate.

The 13 deterministic checks cover exact success/normal/error/unknown output roundtrip, assistant speech, parallel/split results and order, distinct sources/origins, mixed/incomplete/interrupted/duplicate/name-mismatch/known-input exclusions, image preservation, current-turn refusal, ordinary assistant string validity, explicit-zero versus unknown cache normalization, first failure/censoring halting all later trials, AB/BA order, and bounded upstream literal/blank/named JSON shape collection. Wire serialization passes structure, not endpoint/model semantics.

### Real comparison settings and complete trial outcomes

The root verified the existing effective config: direct `https://api.deepseek.com/`, requested `deepseek-v4-flash`, env-sourced credentials loaded in-process using existing config/provider helpers. Responses report `deepseek-flash`; alias spelling is not proof of identical weights across dates.

Eight initial trials were predeclared: two boundaries × two arms × two repeats, with AB then BA arm order. They used exact original latest user text, unchanged settings/schemas/vocabulary, streaming, no forced tool choice, `maxRetries:0`, at most 1,024 output tokens per physical request, a 60-second fetch abort deadline, and the existing `presentationTailStop` plus three-step maximum. Three steps allow spoken content after a valid/corrected call. The live fetch guard enforces 24 physical requests and a conservative 131K input-estimate bound; the normalized output/usage comes from the provider finish metadata. No synthetic named-control calls were run.

Every generated tool uses a deterministic stub; valid Avatar proposals return a synthetic applied outcome without sending a command. Unavailable tools never execute. A valid proposal therefore proves argument acceptance, not Pet rendering or actual user acceptance.

| Boundary / repeat | Arm | Requests | Observed result |
| --- | --- | ---: | --- |
| Early / 1 | Unchanged | 1 | No tool call; topical reply |
| Early / 1 | Observation | 1 | No tool call; topical reply with an added calendar-arithmetic defect |
| Late / 1 | Unchanged | 3 | Two unavailable `read_file` proposals, then empty expression input, then valid `serious01` correction; topical reply |
| Late / 1 | Observation | 1 | No tool call; topical planning reply and an unscheduled reminder offer |
| Early / 2 | Observation | 1 | No tool call; topical clarifying reply |
| Early / 2 | Unchanged | 2 | Empty expression input, then valid `thinking01` correction; topical clarifying reply |
| Late / 2 | Observation | 1 | No tool call; topical planning reply |
| Late / 2 | Unchanged | 2 | Empty expression input repeated; topical reply also promises an unsupported future reminder |

There are six unchanged-arm expression proposals: four invalid empty-object proposals and two valid corrected proposals. All three expression-bearing trials have an invalid first expression proposal. Two repair successfully; one repeats the invalid input. Observation has zero expression/motion proposals across all four trials. No arm has a valid initial expression proposal in this sample. No output is length-censored; no network error occurs.

The late unchanged trial also reaches three SDK steps. The stored `endedByStepLimit` field is inferred from step count plus final `tool-calls` finish, not a proven winning stop condition: with prior speech and a final valid presentation-only step, `presentationTailStop` can also stop at that point. It should not be interpreted as independent proof that a substantive final answer was lost.

The unavailable `read_file` proposals are a limitation of this controlled Avatar-only profile: the historical real conversation contains other tools, while these definitions are not provided to the new model. They are not evidence that the production application's file tool is unavailable or that the Avatar representation fixes file execution. Their failed proposals and followup requests remain in the cost/outcome population.

### Authorized local reply and intent assessment

Only the two original latest inputs, their generated replies and bounded immediately relevant conversation context were read. Private bodies were not copied into this report.

- Early intent: the user studies daily but feels inefficient. A useful reply identifies whether the problem is concentration/fragmentation or slow comprehension and asks a concrete clarifying question. Both arms generally do this. No specific presentation or action is requested. The corrected `thinking01` is a plausible optional reaction, not a uniquely required intended name. One observation reply incorrectly describes a 48-day interval as eight complete weeks; this added arithmetic claim is a real reply-quality issue, not a schema failure.
- Late intent: the user proposes about 40 more minutes of study while reserving time for washing and vocabulary revision. Immediately prior turns reiterate an agreed stopping time; they do not establish a new successful reminder operation. Responses appropriately acknowledge the plan and compute a stopping time from the supplied clock. Avatar is optional. The unchanged first repeat explicitly admits this profile cannot create the reminder; the unchanged second repeat promises a future reminder without supporting tool execution. Observation's first repeat asks whether a reminder is wanted but does not schedule one; its second keeps responsibility with the user's clock.
- These replies are useful conversation at a narrow level, but factual/behavioral fidelity is not universally established. The report does not grade all historical claims, endorse unsupported reminder promises, or convert optional no-tool replies into presentation success. The two valid corrected names are plausible for these replies; no exact intended-name target existed in the original user inputs.

### Provider-normalized usage, input growth and conditional cost

The runner reuses `normalizeAuxiliaryUsage` on the **adapter finish usage with raw provider counters** (`auxiliary-usage-normalization.ts:9`). It stores only nullable normalized counters and known-cache coverage, excluding raw metadata. SDK step totals remain separate. Every one of the 12 paired-comparison requests has known input, cached/uncached input and output; reasoning is included in output and is not added again.

| Arm | Trials / physical requests | Input | Cached | Uncached | Output (reasoning subset) | Aggregate trial latency | Conditional off-peak CNY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Unchanged | 4 / 8 | 497,957 | 391,424 | 106,533 | 2,138 (1,604) | 27.145 s | 0.12291348 |
| Observation | 4 / 4 | 257,212 | 173,312 | 83,900 | 884 (517) | 12.005 s | 0.09090224 |
| Paired comparison total | 8 / 12 | 755,169 | 564,736 | 190,433 | 3,022 (2,121) | 39.150 s | 0.21381572 |

First-request input is reproducible in both repeats:

| Boundary | Unchanged | Observation | Actual increase |
| --- | ---: | ---: | ---: |
| Early | 34,647 | 37,445 | +2,798 (8.08%) |
| Late | 78,100 | 91,161 | +13,061 (16.72%) |

Prices use the root-verified November 4 direct Flash off-peak tariff: CNY 1 uncached input, 0.02 cached input and 4 output per million, from the [official Chinese pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) cited in `cohort-analysis-20261104.md:51`. The experiments ran outside the documented Beijing peak periods. These remain conditional tariff calculations, not invoices or a net savings claim. Changed historical prefixes and trial order also affect cache reuse; AB/BA order does not fully control cache/provider state.

### Adapter evidence and single upstream followup

The original comparison middleware observes compatible-adapter `tool-call` parts **before SDK validation**, not raw upstream SSE. Four invalid Avatar arguments at this boundary are nonblank, two-byte parsed objects without `name`: literal `{}` after the adapter. Valid repairs have the expected named object shape. This confirms the failure exists before local Zod validation, but cannot alone exclude compatible-adapter or earlier transport loss.

The root authorized one separate late unchanged diagnostic, retaining the original 12-call file and private fixtures. It uses the same original task/profile and three-request ceiling; completed comparison plus diagnostic could not exceed 15. Its fetch wrapper clones the bounded SSE response, incrementally groups argument deltas by tool index, and returns only byte/blank/JSON/name-presence facts. It never retains raw SSE, reasoning or argument strings in the diagnostic result, and awaits capture completion before reporting. Prefixes keep all previous fixtures intact.

Actual diagnostic outcome: **one request, no tool call**. Upstream capture completes with 22,544 bytes, zero parse errors and zero tool-call records; adapter tool-call records are also empty. There is no failing tool argument to compare, so the upstream origin of the earlier `{}` proposals remains unidentified. It does not prove server-side generation or disprove adapter loss. No second diagnostic or extra control was run.

| Scope | Requests | Input | Cached | Uncached | Output (reasoning subset) | Conditional off-peak CNY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Separate upstream diagnostic | 1 | 78,100 | 77,952 | 148 | 70 (0) | 0.00198704 |
| All authorized pilot calls | **13** | **833,269** | **642,688** | **190,581** | **3,092 (2,121)** | **0.21580276** |

Both executions preserve the source snapshot hash. The original comparison remains separate from the diagnostic; the latter is not a third observation/baseline repeat in the treatment statistics.

### Recommendation and next candidate boundary

DEFER the current observation representation. Retain the structural lesson: history should not misrepresent known argument omission as a successfully executed empty argument. This pilot does not show that a user-role observation fence is the right production remedy, and its exact-output wrapper materially increases context size. Do not adopt it, claim causal proof, or spend the unused request budget to seek a favorable result.

The next candidate is a **narrow future-call Avatar argument projection**, preserving only validated public `name` and reviewed finite/boolean motion controls where applicable. It must belong to the Avatar family and existing canonical writer/replay contract; generic raw arguments, secrets, Host commands and other tools remain subject to the existing privacy boundary. Persisted future arguments would provide genuine successful examples with less wrapping, while original outputs and recorded history stay truthful. This is a recommendation only, not implemented or behaviorally validated here.

For old rows whose arguments were not stored, never invent names or backfill from the current costume, assistant speech or the first enum example. A separate reviewed historical strategy may still be required. Any eventual implementation needs its own contract review, bounded correctness tests and evidence-selected validation; this report does not authorize a silent production replay change.

### Reproduction, source patterns, and checks

From `H:/TakiAgent-worktrees/t4`, Node 24.18.0:

```powershell
node .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-check-20261104.mjs
node .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-runner-20261104.mjs --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-dryrun-20261104.json
node .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-runner-20261104.mjs --single-late-baseline --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-upstream-dryrun-20261104.json
```

The root used the following authorized live commands once each. They are recorded for reproducibility, **not a recommendation to rerun**; the task's paid pilot is finished.

```powershell
node --env-file=.env.local .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-runner-20261104.mjs --live --fixtures-dir target/avatar-pilot-20261104 --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-live-20261104.json
node --env-file=.env.local .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-runner-20261104.mjs --live --single-late-baseline --fixtures-dir target/avatar-pilot-20261104 --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-pilot-upstream-20261104.json
```

Relevant production patterns are `turn-mapping.ts:118` (omitted-input replay), `conversation-store.ts:152` (one selected Replay source), `context-window.ts:58` (balanced atomic groups), `native-image-replay.ts:29` (hydrated image/source preservation), `untrusted-fence.ts:24` (supplied-material wrapper), `context-attribution.ts:10` / `request-composition.ts:23` (construction-owned spans and final recapture), `presentation-stop.ts:26` (bounded repair/words policy), and `auxiliary-usage-normalization.ts:9` (nullable raw-aware usage).

Related specs are `.trellis/spec/backend/agent-runtime.md`, `native-image-input.md`, `tool-design.md`, `tool-disclosure.md`, `logging-guidelines.md`, `request-attribution.md` and the independent advisor's contract references. No spec was modified. Installed upstream source is AI SDK 7.0.148, OpenAI-compatible 3.0.75 and provider-utils 5.0.65; current source/serialization, explicit streamed calls, real model behavior and local qualitative review are separately identified throughout this report.

## Caveats / Not Found

- This is a current reconstructed Avatar-only profile, not the exact historical full request or full capability competition. Missing memory/volatile material and the historical 397-name motion fixture are material applicability limits.
- All observation replies avoid tool use, and Avatar was optional in these tasks. No valid observation-arm call tests required-name recovery; no-call cannot be treated as success. Four trials per arm cannot establish stable trigger-rate, error-rate, quality or cost effects.
- Role, wording, size, historical-example shape and cache prefix change together. Early/late contexts and goals differ. Neither length causation nor a specific representation mechanism is isolated.
- Unavailable `read_file` proposals are artificial to the reduced tool profile, not proved production defects. Costs include them honestly without extrapolating their removal to the application.
- Reply review is bounded and qualitative; it identifies a specific calendar-arithmetic error and unsupported reminder behavior without grading every historical fact. No owner manual Pet/UI acceptance occurred.
- The three-step stop flag does not identify a unique winning stop condition when the existing presentation policy also applies.
- Adapter literal `{}` is confirmed in the first comparison. The no-tool upstream followup cannot locate its original emission/loss boundary. Old conversation records still lack raw provider arguments.
- All model-proposed actions were stubbed. Accepted arguments are not actual rendering or Host execution. Thirteen authorized real requests were run by the root; this researcher made none, and no more calls or production changes follow from this report.
