# Co-Watching invitation and failure recovery — 2026-10-16

Status: the new-video native analysis, targeted correction, Taki preparation, timed desktop transport delivery,
material Q&A, Stop awareness and completed-analysis reuse passed real validation on 2026-10-17.
The owner authorized development, real models and browser operation in the isolated T4
checkout, without creating/binding a Trellis task or publishing Git changes. This record supersedes the stale runtime
details in `.runtime/co-watching-invitation-20261016/handoff.md`; the prior successful existing-analysis production
validation remains a separate record.

## Implemented behavior

- Ordinary chat can explicitly invite the sole current video through `manage_co_watching(start)`. Core reuses an
  exact completed analysis or retains a native request UUID before using the already selected governed MCP tools.
  Same-document source renewal may be resolved before acceptance; accepted work never silently follows another video.
- BiliNote owns acquisition and generation. Core uses existing Run/Effect owners, releases the Character lane between
  bounded status polls and does not invoke a model to poll. Uncertain submission reconciles the original request;
  definitive absence permits the same key only within the original still-current acceptance/generation.
- An explicit `reanalyze` requires a confirmed failed same-video native task and retains the old request reference.
  Connection restoration, ordinary start, unknown outcomes and Stop do not automatically repeat whole-video analysis.
- Ordinary Taki conversation receives ephemeral task status and exact analysis/current-plan file references. Private
  preparation is not appended to relationship history. A primary reservation cooperatively yields only owned redoable
  preparation; pending semantic edits survive normal lane release.
- Extension pairing is remembered in extension-origin IndexedDB. Tab selection remains session-only. Disconnect
  retains pairing; Forget removes it. Configuration is serialized and transport reconnect backs off. No token is
  returned to options or stored in content-script-accessible storage.

## Actual new-video attempts

Selected video: `BV1BTP5euE75`, CID `28581954126`, page 1, acquired duration 309.8 seconds (player reports 310).

| Attempt | Native identity | Observed outcome |
| --- | --- | --- |
| Initial invitation, user row 95 | No native request | Source renewal raced the captured invitation; fixed and regression-tested |
| Invitation, user row 101 | Request `b4281a4a-9a4b-40e1-9b62-800c5e77e172`, job `c887a9e3-dd61-440c-aa69-70482c976e4d` | Download/transcription/visual input and model response completed; native temporal validation rejected the output |
| Post-Core-restart reconciliation, user row 107 | Same original request/job | Confirmed original failure without resubmitting analysis |
| Explicit reanalysis, user row 115 | Request `dc09d51c-c622-4c61-9abf-f1e050c155f8`, job `e7e6752f-530e-418d-8a4a-393dcf07b790` | Initial response and one generic structural regeneration both returned HTTP 200; both failed temporal citation validation |
| Targeted-repair reanalysis, user row 137 | Request `96ed6f75-9afe-4b93-a678-56c4defe46a7`, job `0e4517ad-4891-4945-aedc-939fdbe2609f` | Initial complete response failed temporal validation; the single targeted correction passed and published a verified result |

All three bound jobs belong to native service `8c6a923c-dae2-478d-a740-b3e74f0bbf7f`.
The second acceptance was `5bad70af-bafe-4dd9-b82a-83a0c7024788`, analysis reference
`9c877419-250b-4fe4-adae-7f0a686e1ec5`. It produced no Taki preparation or desktop publication.

The owner mentioned changing VPN during testing. That can cause independent network failures; it does not explain
the observed local validation exceptions after complete HTTP 200 responses. There is no evidence of a subtitle-index
shift. In both new responses one moment ended at approximately 136.7, while its cited subtitle set ended at index 47
(134.3). Original subtitle 48 spans 134.3–136.70000000000002, but the model did not cite it. Neither rejected moment
cited a frame. Video duration was not exceeded. Numerical observations establish incomplete temporal citation, not
that the prose or semantic ending is false. The full rejected responses from those attempts were not retained;
the original request payload was also not archived, so no direct payload-level claim about subtitle 48 is made.

## Current repair scope

The owner approved a targeted native repair, not a partial-success wire-protocol redesign:

1. Preserve a bounded private rejected response and typed moment/endpoint/cited-support diagnostic.
2. Use at most one correction in the same native phase request, carrying original inputs, actual rejected content
   and specific feedback. Reuse acquisition/transcription/frames; do not let Python alter timestamps or citations.
3. Preserve exact payload/response receipt hashes, provider-parameter variants, checkpoint recovery and source bounds.
   Rejected attempts must not become accepted merge parents. Refusal/truncation/transport/integrity failures are not
   structural-repair triggers; repeated invalid content remains failed.

The previous fixed generic regeneration was implemented and tested but failed to resolve the real sample. The
specific-feedback mechanism above now replaces it. Its offline recovery checks passed before the next paid attempt.

An independent Core compatibility fix accepts native v1's existing `end_seconds: null` without changing it. Such
moments remain available as conversation material. Only explicitly bounded moments can anchor automatic publication;
when none exist, Core keeps an empty plan without spending a preparation model call. This does not accept a native
result that failed validation and does not infer a time window for unknown ends.

## Verification and evidence

- Current Core co-watching/queue/operator suite: 55 passed, one opt-in real-model test skipped; Core typecheck and
  scoped ESLint passed after nullable-end changes. Regressions cover original-key reconciliation, failed-only retry,
  generation loss, source renewal, yielding, private context, preserved nulls and refusal of unbounded publication.
- Earlier independent prepared-publication/authorization/governance group: 44 passed. Shared related contracts:
  28 passed. Desktop controller/WS: 7 passed; Desktop typecheck and production Vite build passed (existing chunk-size
  warning remains). Extension lifecycle: 13 passed and typecheck/build passed before documentation-only follow-up.
- Targeted native correction: 68 passed (structured 27, targeted 13, response-format 10, temporal 14, prompt 4).
  This includes durable reservation before dispatch, bounded private records, historical v2 migration and v3 recovery.
- Real extension browser exit/relaunch, blank token field, explicit video reselection and renewed Core reception
  passed; see `browser-before-restart.json` and `browser-after-restart.json`.
- Native observations live only in `.runtime/co-watching-invitation-20261016/`: timestamped chat/poll files,
  `native-model-usage.jsonl`, `native-temporal-observations.jsonl` and isolated process logs. Older R7 evidence is not
  overwritten. Ordinary real Home approvals used the selected native tools and current-connection scope.

Known native usage: the previous **85,122 tokens** plus **47,855 tokens** (21,730 + 26,125) for the successful
targeted-repair run = **132,977 tokens** across five HTTP 200 model responses.
Three provider-parameter negotiation responses returned HTTP 400 without usage; their cost is unknown, not zero.
Core foreground/model use is separate and is not included in this native subtotal. The validation profile's memory
ingestion commit tables are empty, so they cannot establish exact foreground-to-Timeline cost attribution; unrelated
owner conversations must not be included by a broad time-range sum.

## Reboot continuation — 2026-10-17

Core, Vite, Tauri Shell, WebView CDP, the isolated Edge profile and the native service were restored using the existing
data and pairing. Native service identity and the selected four MCP tools remained unchanged. The extension token
input stayed empty while remembered pairing and explicit video reselection restored observations. Startup evidence:
`.runtime/co-watching-invitation-20261016/reboot-20261017-193403/process.json`.

An independent operator-socket test helper lost its own approval owner on exit, closing acceptance
`d0e9c74e-8a62-4b72-8a5d-0ba2c31f6643` as `preparation_failed`. This was a harness mistake, not a native analysis
failure. Subsequent testing used the actual Home connection and its displayed approvals. Two foreground attempts
initially declined reconciliation because the tool description did not distinguish retained failed requests from
new analysis clearly enough. One also tried an unnecessary `exec`, which timed out. The description and closed-task
context now state that Core owns native request IDs and that only explicit `reanalyze` replaces a failed request.
Runtime submission/reanalysis guards were not changed.

After an idle-only Core restart (PID 22388, `core-20261017-114916-process.json`), the same ordinary user request
invoked `manage_co_watching(start)`. Acceptance `2a2d1beb-49a1-4552-8751-f6fba7b674c9` confirmed the original
`dc09d51c-c622-4c61-9abf-f1e050c155f8` request as `analysis_failed`, with no new native submission.
The relevant control/context/native tests passed 17/17; Core typecheck and scoped ESLint passed.

Actual foreground test sends now capture the real Home `chat.send` acknowledgement. Run attribution verifies both
that run ID and its trigger request ID; older rows without a witness remain explicitly unattributed. Accepted-work
roots and publication children are matched through their exact source/user-entry lineage, not broad timestamps.
The final attribution record (`execution-evidence-195929.json`) reports **729,104 Core tokens** across the nine
identified foreground test turns and their accepted preparation work. Four older foreground turns remain unassigned
and excluded. All model Effects in the attributed set have reported totals; the delivery child has no model Effect.
This Core subtotal is separate from BiliNote's native tokens and is not a monetary-price calculation.

The separate Live2D repair is closed out in `.runtime/live2d-mask-20261017/closeout.md`: 26 focused tests, all
1,205 Desktop tests, typecheck/lint and production Vite build passed. Reboot and Pet-only reload observations show
316 mask bindings and 810 mask draws with no invalid target or mismatch. Scope remains the observed Cubism 2
costume and short observation windows; this does not imply all-costume or long-duration owner acceptance.

## Successful real path and remaining scope

- The targeted correction changed unsupported `m6` from [148.9,161.3] to [147.1,159.9] and supplied matching evidence
  references. Python did not alter the content, times or references. The independent Astra audit rebuilt source,
  request and response hashes, checked private reservation/accepted records and recovery readers, and validated both
  public-result and native-envelope codecs against the completed SQLite row. The result has ten moments, 138
  transcript inputs, 52 frames and six image grids; all ends are non-null in this real sample. See
  `.runtime/co-watching-invitation-20261016/native-targeted-repair-audit-20261017.md`.
- Acceptance `12d20cfe-f4d7-4c8f-ae17-dd0a1f52036a` prepared five candidates. Actual player controls crossed an
  eligible interval, producing Timeline row 143 and delivery child `dd2ba384-2bb9-4907-82c2-17125538e480` with
  `delivery_state=sent` and zero model Effects. `playback-1792237990726.json` records the before/after observations;
  its Pet screenshot shows the repaired character. Transport acceptance does not establish owner exposure or approval.
- User row 144 prompted an actual `read_file` and grounded material Q&A (row 147). User row 148 invoked Stop;
  the next status question (row 154) correctly reported that the task had ended. Private preparation was not inserted
  into the primary conversation; the published reaction was.
- Reanalysis row 137 omitted its requested 30-minute parameter while verbally claiming 30 minutes; the actual
  acceptance had the 120-minute default. The tool now describes each parameter explicitly and returns the accepted
  `lifetimeMinutes` in both structured output and its acknowledgement. Skill revision 7 repeats that contract and
  retained-request semantics. After stopping and an idle-only Core restart, row 158 reused the same completed
  analysis and accepted exactly 30 minutes (`10bb22e0-657e-4d46-ade2-e8cb942c6abe`), preparing three candidates with
  no new native submission. Row 164 stopped that verification session. This proves the corrected observed call,
  not a universal guarantee that every future model follows every user parameter.
- Core currently runs as PID 21172 with `core-20261017-115651` logs. Original browser/Shell profiles, credentials,
  native service and its request identities remain in place. The final source-only schema hoist preserves the exact
  tested tool definition; final focused tests (17/17), scoped lint and Core typecheck all passed.
  `final-evidence-20261017.json` independently asserts exact completed-analysis reuse, zero new native submissions
  during reuse, the 30-minute returned duration, the sent delivery and no active Runs after the final Stop.

The owner reaffirmed ordinary Agent/Skill/tool composition and requested discoverability of existing analyses. This
is explicit in `MEDIA-AGENT-INTEGRATION-PLAN.md`; the next S6 slice exposes the existing catalog through a governed
Agent read tool and Skill guidance. Current automatic reuse must not be confused with an already shipped inventory
tool. Optional invitations/recommendations, complete Core-restart Continue, natural closing and short source-recovery
policy also remain outside this completed explicit-invitation slice. Tone/spoiler quality remains owner evaluation.

## Scoped native correction — 2026-10-18

The new video `BV1Z7a36GEtd` failed in the locally added structured-media path, not in download or ASR.
Job `0c4e08df-71e7-45b8-a9e8-2a70abcb267f` produced 379 transcript segments and a schema-valid response.
Only `m4` lacked cited support for its end. The existing whole-object correction fixed `m4` but introduced
unsupported ends in three previously valid moments, so the native job correctly remained failed.

The owner authorized implementation of a bounded repair. Native-derived edit scope now lists every invalid
moment before the existing single correction. The model still returns a complete object; Markdown and valid
moments must remain unchanged, and only invalid moments' time/reference fields may change. The model may omit
an invalid moment without a grounded anchor. Complete validation and scope validation both precede acceptance.
Native code never assembles a hybrid response or edits model timestamps, citations or strings.

Private repair record v2 retains the scope and exact response bytes. Restore recomputes the scope from original
inputs and verifies the correction and payload hashes. Historical record v1 retains its original prompt and
semantics; malformed JSON/schema retains the existing general correction. Public result v1, checkpoint v3,
model budgets, Core/MCP permissions and the no-automatic-third-attempt rule are unchanged.
The native contract is [documented alongside the implementation](../.worktrees/bilinote-media/backend/docs/media-structured-repair.md).

Validation:

- The new regression first failed against the prior code, including acceptance of out-of-scope yet temporally
  valid changes. The final native note suite passed **103 tests** in 93.825 seconds, including historical/mixed
  checkpoint recovery, exact byte budgets, optional provider negotiation, projection and ordinary Markdown.
- An isolated probe reconstructed the failed job's actual transcript, 12 grids, messages, source/chunk signatures
  and original payload hash. It replayed the recorded first response and made **one new real correction request**.
  The response retained all 11 moments, unchanged Markdown and ten unchanged moments. Only `m4` changed, retaining
  [127.28, 134.88] and citing `transcript:58`, `59`, `60`. Full temporal validation and edit-scope checks passed.
  Reported usage: **39,505 tokens**; actual billed cost unknown. This is a recorded-failure/real-correction probe,
  not another full native acquisition, original-job retry or owner quality acceptance.
- BiliNote was restarted from the corrected isolated worktree after confirming no native work was active. Its
  service identity remained unchanged; all six native task states and envelope hashes exactly matched the prior
  snapshot. Existing completed-result HTTP reads passed. Core PID 2352 was not restarted.

Evidence: `.runtime/media-repair-scope-20261018/` contains the pre-edit source copies, regression logs,
`reconstruction.json`, `live-replay-result.json`, private correction records and `after-restart-native.json`.
The historical failed job remains failed, and the isolated probe is not registered as a public analysis result.
No new native video task, permission change, Trellis binding or Git lifecycle operation was performed.

For rollback, restore the recorded pre-edit source set and restart only BiliNote while idle. Preserve runtime data.
New private repair-v2 checkpoints need the updated reader; an older reader must fail closed rather than reinterpret
them or replay a model request. Existing completed public results retain their unchanged versioned format.
