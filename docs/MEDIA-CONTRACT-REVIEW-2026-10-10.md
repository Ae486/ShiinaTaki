# Media capability contracts and targeted validation — 2026-10-10

Status: targeted validation completed; implementation contracts below are proposals for the first production slice.
Production Co-Watching, formal browser/Host attachment, and full restart recovery are not accepted.

This report preserves the validation-only snapshot. Subsequent authorized A/B1/C1 implementation and the 2026-10-11
B2/C2 continuation are tracked in the [implementation and Harness change record](MEDIA-IMPLEMENTATION-2026-10-10.md).
Its newer source/check results supersede unimplemented-status statements here without rewriting the original probes.

## Scope and continuity

The owner agreed to organize V3 execution/publication validation and concrete native-result, browser-observation and
Host-data contracts, continuing without a Trellis task. Two Astra workers investigated V3 and native service behavior;
the parent investigated Host locality and consolidated the findings. A rate-limited worker was explicitly resumed.

This review follows [M49/M59 and the settled product decisions](MEDIA-INTEGRATION.md), the
[technical proposal](MEDIA-AGENT-INTEGRATION-PLAN.md), and the
[first native/browser experiment](MEDIA-VALIDATION-2026-10-09.md). M01-M59, especially M51, remain unchanged.
No new quota grill, permanent recommendation score, parallel task ledger or dedicated Co-Watching runtime is selected.

All new probes are under `.runtime/media-validation-20261010/`. They use existing source, private fixtures and the
previously supplied video's saved results. No new BiliNote/DeepSeek video analysis, credential transfer, browser action,
service deployment, production database access or production source edit occurred. Probe provider calls are local SDK
mocks; they are not external model calls or evidence of output quality.

## What the probes established

| Probe | Result | Evidence boundary |
| --- | --- | --- |
| V3 execution/publication | 16 cases passed; scoped TypeScript and ESLint checks passed | Real RunService, ChatAgent/SDK execution, SQLite evidence and delivery owners; controlled snapshot/provider/transport/currentness ports. Several passing cases deliberately reproduce missing guarantees. |
| Native service | 5 tests passed, including 12 original/counterfactual grid cases | Original Python AST definitions with heavy boundaries stubbed locally. Proposed fixes were applied in memory only; upstream files stayed unchanged. |
| Proposed native schemas | 9 contract tests passed | Proposed schema/examples validated against structural and cross-field constraints. Original transcript/Markdown retained; unknown metadata stays null. This is not an implemented native endpoint. |
| Skill/Workspace/browser | 4 cases passed; scoped ESLint passed | Real Core Skill/file owners and 248 historical browser samples. No live Shell or formal browser attachment was exercised. |

Existing 52-test evidence from October 9 remains a separate baseline, not an additional suite rerun in this pass.
The detailed local artifacts are linked in the reproducibility section below.

### Existing execution strengths

The V3 probe prepares two texts, releases the Character lane, runs a foreground ChatAgent turn, then separately admits
two publications through existing delivery owners. The two publication Runs each commit one immutable decision and
one Timeline entry. Retrying the first admission/publication does not create another utterance. The mock provider sees
one preparation call and one foreground call; publication creates zero model Effects.

Other existing guarantees were exercised: same-decision reuse; conflicting decision refusal; cancellation before
commit; no automatic resend after an unknown transport result; Class B budget enforcement; same-Attempt executable
presentation hold/resume; selected-tool intersection/expiry; and admitted Effect budgets.

Class A publication succeeds without consuming or waiting on the Class B utterance gap/allowance. This proves the
existing accounting branch needed by M51, not a production acceptance-to-Class-A authorization path: the probe itself
selected Class A and supplied source-currentness functions.

### Execution gaps that must be closed

| Finding | Source / observed behavior | Required treatment |
| --- | --- | --- |
| Parent linkage is evidence only | `RunProvenance` supports `parentRunId/sourceRef`; an absent parent can be named. Cancelling an existing parent leaves an admitted child able to publish. | A trusted adapter validates the source and exact accepted root; stop retires only the owned pending children and bindings. A string parent reference is not consent or a cancellation policy. |
| No generic quiescent root wait | `RunService.holdDelivery` requires an existing executable delivery decision. An internal root with no such row cannot enter that wait. | Add bounded wait/resume semantics to existing Run owners for accepted ongoing work; do not stage a fake utterance/presentation just to keep a task alive. |
| Held text can belong to a terminal Run | Text-only hold settles its Run as completed. Later `requestCancel` returns false; retiring the retained binding prevents resume, leaving it current permits publication. | Stop must retire pending prepared publications/source bindings, including those whose preparation/delivery Run is already terminal. Do not reopen terminal Runs or call Character-wide retirement for a single task. |
| Final publication omits active Attempt equality | Under injected stage -> retry -> settle replacement ordering, the old staged decision can commit. `run-delivery-repo.ts:123-124` checks terminal state but not `active_attempt_id`. | Recheck active Attempt, immutable decision/source revision and current scope at canonical commit. This ordering was constructed against the low-level owner; it is not a reproduced failure of today's normal Scheduled/Initiative adapter. |
| Silent scheduled work lacks an explicit routing contract | A nonempty settled result calls the Scheduled adapter's delivery port even when its prompt asks for silence; an empty result does not. | Select execution/result routing through trusted configuration, independent of model wording. A silent preparation run must not become an unsolicited Class A invitation. |
| Selected initiative remains read-only | The fixed registered-read intersection and response outcomes remain unchanged. | Choose a bounded action scope or linked work only where needed. The first explicitly requested Co-Watching slice need not remove this boundary. |

Concrete owners: [RunService](../packages/core/src/harness/run-service.ts),
[Run repository](../packages/core/src/db/run-repo.ts),
[delivery transition](../packages/core/src/db/run-delivery-transition.ts),
[delivery repository](../packages/core/src/db/run-delivery-repo.ts),
[DeliveryCoordinator](../packages/core/src/delivery/delivery-coordinator.ts), and
[Scheduled adapter](../packages/core/src/scheduler/scheduled-run-adapter.ts).

## Proposed execution and prepared-publication contract

Use one nonterminal internal root Run for the accepted ongoing work, with independently admitted publication children.
This is a composition of the existing Run ledger, not another session store or task engine. The root is admitted by a
trusted adapter from the actual user request/acceptance and retains the relevant source identity. Completing a model
Effect or native analysis does not, by itself, finish the accepted activity.

| Operation | Required contract | Existing owner / addition |
| --- | --- | --- |
| Admit accepted work | Validate the actual primary request or invitation-acceptance source, exact media/part and captured permissions. Persist source linkage. A model-provided class or arbitrary `sourceRef` cannot authorize it. | Existing admission/snapshot/Run evidence; add the narrowly typed accepted-work source validation. |
| Wait between work | Retain a nonterminal root with an explicit durable wait reason, release the Character lane, and create no model Effect merely for waiting. Resume revalidates original scope, current permissions and input source. | Proposed generic bounded wait/resume on RunService/RunRepo. Existing `holdDelivery` is not sufficient. |
| Prepare/revise contents | Complete bounded Agent work; commit candidate changes through one expected-revision writer. Media/content policy remains Skill/task data. | Existing Agent/Skill plus the Host data contract below. |
| Request prepared publication | Resolve a candidate ID and revision to exact text under the live root and source. The helper supplies intent/reference; Core derives admission, class and provenance. | Proposed narrow internal prepared-result entry; no generic caller-selected `class_a` API. |
| Commit publication | Atomically validate current delivery Attempt, exact immutable text/revision, live accepted scope and source lease, cancellation, expiry and applicable policy before the existing Timeline commit. No network/file await inside SQLite transactions. | Existing DeliveryCoordinator/RunDeliveryRepo with a trusted final guard and current producer bindings. |
| Retry / replace | Exact same publication uses the same identity. An uncommitted obsolete candidate is retired; changed text uses a new valid publication identity. Sent/unknown outputs are not automatic replay requests. | Existing immutable delivery records and idempotency, with source-specific retirement. |
| Stop | Retire the accepted root/source and all its pending publication bindings before releasing more output; cancel owned active work through existing controls. Already committed output is not claimed retractable. | Existing Run cancellation plus scoped child/binding retirement, including held terminal text. |
| Recover | Preserve the wait reason, source and unfinished state; require explicit Continue with fresh bindings under M36/D85. Never infer activity completion only from the last completed model Effect. | Existing RecoveryCoordinator/D85 extension; V5 remains untested. |

The current recovery scanner can settle a Run from its final completed Effect. Consequently, leaving the root merely
`running` while releasing the lane would conceal an incomplete recovery contract. The waiting-state evidence and its
recovery classification must accompany the root lifecycle addition, even before full Continue acceptance is exercised.

Proposed internal signatures are `holdWork({ runId, attemptId, expectedRunVersion, reasonRef })` and
`resumeWork({ runId, attemptId, expectedRunVersion })`. They are not model-callable tools or existing methods:

- Hold compares the current Run/Attempt/version in one transaction, requires `running`, an unexpired captured scope
  and no unfinished Effect, persists its bounded wait reason, and changes the Run to `waiting`. Only after the durable
  transition does the caller release its lane. It retains the executable context without inventing a delivery row.
- Resume first acquires the existing Character lane under primary precedence, then rechecks the same waiting
  Run/Attempt/version, retained context/authority and source/deadline before the transactional transition to `running`.
  Refusal releases the newly acquired lane and never revives a terminal Run, replaces an Attempt or captures new
  authority silently. Wrong version, expired/retired source and unfinished work are distinct bounded refusals.
- Process-backed work with an unfinished Effect is outside this quiescent primitive. Its existing Effect lifecycle
  must settle or supply a separately reviewed wait contract; force-cancelling it to meet the precondition is invalid.

Prepared publication remains independent of further model inference. Source/plan invalidations update a trusted bounded
Core binding; the final commit checks it synchronously along with durable Run facts. A mutable file flag such as
`delivered: true` or `accepted: true` is never publication or consent authority.

## Native result and status contract

The previous `video-result.json` is a sanitized validation artifact with `task_id`, `state`, audio/transcript data and
Markdown. Its experiment timing fields are not native API fields. It has no validated typed Viewing Moment contract.

### Additional native findings

| Finding | Offline evidence | Proposed compatible correction |
| --- | --- | --- |
| Final partial grid dropped | 50 frames produce 5 grids covering 45; removing the skip in memory yields 6 grids covering 50. Tests cover 0, 1, 8, 9, 10 and 50 frames. | Preserve the existing padded grid compositor and include the final partial group with its real source-frame manifest. |
| Status identity split | `_markdown` filename stem becomes the status job ID, leaving canonical TRANSCRIBING while the suffix reports SUMMARIZING. | Pass canonical task ID separately from the existing checkpoint key; retain checkpoint compatibility. |
| Success precedes saved result | Original completion order allows SUCCESS while the result file does not exist. | Publish a complete result atomically before reporting success/readiness. |
| Ambiguous state/error projection | Unknown job and success-with-missing-result both return PENDING; FAILED loses the job ID; corrupt status JSON escapes the route function. | Distinguish actual queued work, not-found, unavailable result and failure; retain request/job identity and bounded typed errors. |
| Cached audio can bypass requested visual work | An offline audio-cache hit with visual understanding requested reaches the model stub with zero image inputs. | Make cache reuse respect required analysis inputs; record frames actually supplied to accepted model requests and omissions, not only requested flags. This does not prove model understanding. |
| Shared frame/grid paths under concurrency | Source exposes a concurrent executor with default three workers and shared image paths. | This is a source-confirmed risk, not a reproduced concurrent corruption. Validate or isolate native per-job paths before overlapping analysis. |

The first five items have executable offline evidence. The final row remains a concurrency investigation/test obligation.
No provider cancellation or overseas acquisition claim is added by these tests.

### Proposed minimum envelope

| Part | Content / invariant |
| --- | --- |
| Version and native identity | Explicit schema version; service-instance attribution; original request and native job identity. Submission retry uses native idempotency/reconciliation, not a second bridge job database. |
| Exact media | Canonical platform/video identity and part/CID; actual media duration when known; unknown remains null. A title alone never selects the source. |
| Status and availability | Native stage/outcome, result availability and bounded error. Not-found, failed and result-unavailable do not become queued work. Status reads never submit analysis. |
| Complete result | Transcript/summary, approximately timed content and a native complete-artifact reference; the artifact SHA-256 is the stable result revision. Reads verify bytes/hash/length plus service, request, job and selected-media identity. Preserve existing Markdown consumers via opt-in/versioned output. |
| Timed content | Numeric finite times linked to actual transcript/frame evidence; optional moments carry content, not mandatory utterances. Missing reliable timing prevents timed delivery. |
| Evidence basis | Actual transcript acquisition method and whether frames were supplied, including coverage/missing-input reasons. A requested visual flag does not prove visual analysis occurred. |
| Consumption | Taki reads bounded source-attributed material and resolves the native full result when necessary; upstream owns retention. Expired/removed results stay unavailable unless re-analysis is explicitly requested under M46. |

Unverified legacy identity may support a qualified ordinary answer, but cannot silently become an exact media/part
binding for timed delivery. Unknown native instance, request identity or completion time remains explicitly unknown;
the versioned compatibility example does not manufacture those fields.

Generate the optional structured result in the existing native analysis/merge stage. Do not add a second model call just
to recover structure from Markdown, fabricate moments by matching headings, or require forced partial streaming.
The bridge remains a native-client projection and uses the existing MCP identity/governance path.

The concrete native proposal uses optional `output_format="media_v1"` and `client_request_id` on submission, with
versioned status/result reads. A native request reservation binds a UUID request key and normalized request digest to
one job before queueing; a changed payload under the same key conflicts. Extend the existing native task inventory,
not a Taki/bridge database. Legacy tasks retain unknown request/completion metadata rather than deriving timestamps
from file mtime. Exact proposed schemas and legacy-compatible examples are linked below; none are captured v1 server
responses. Native multi-chunk analysis can still perform its existing merge calls: avoiding an extra Markdown parsing
pass does not promise one model call for every video.

## Host data and browser observation contracts

### Host-owned helper and working data

The actual Skill/package/resource and Core Workspace operations passed. Core writes are confined to their configured
root and refuse absolute paths; they do not deliver bytes to another Host. The Shell currently advertises no Workspace
inventory, resolves its own exec cwd, and the existing exec tool accepts only a command. A same-machine disk coincidence
does not prove the split topology.

Use the existing Host route and Workspace descriptor for a narrowly scoped file/resource capability when needed:

- Resolve the admitted Host, current catalog, Workspace ID and confined relative path; no implicit Host replacement.
- Stage the exact immutable Skill resource by owner/revision/path, then verify destination content before exec.
- Validate complete bounded task-data snapshots and require the expected revision/hash at a single atomic writer.
  The probe's sequential revisions 1 -> 2 -> 1 all succeeded with ordinary `write_file`; it is scratch IO, not CAS.
- Return content revision and completeness. Truncated reads are not usable partial task JSON.
- Retain Run/Attempt, permission, connection and operation identity through normal Host control. Task contents cannot
  authorize execution, report delivery, change source binding or reopen stopped work.

**Cross-Host edit ordering is part of the contract.** Host file CAS alone cannot protect a Core binding that still points
at the old revision. Apply this bounded sequence through the existing owners:

1. Core validates the live root and expected revision, closes the affected candidate publication gates, and issues a
   scoped edit identity. Unknown edit impact closes all timed output for that root, while ordinary conversation stays available.
2. Only after that closure is acknowledged does the Host writer perform the confined expected-revision update.
3. A confirmed Host result returns the exact new revision/hash under the same operation/source generation. Core
   revalidates root, edit identity and source, replaces the approved candidate binding, then reopens eligible output.
4. Conflict, failure, ambiguous outcome, Stop, retired source or late superseded confirmation leaves the affected
   output closed. Reconcile the original operation/snapshot before considering another edit; never blindly replay it.

No SQLite transaction spans Host IO. Source invalidation and publication commitment serialize through Core's existing
owner. A late Host file write may leave task bytes on disk after Stop, but cannot reopen the retired execution scope.
This ordering was added after peer review; it is a proposed integration guarantee, not behavior exercised by the
Core-only stale-write probe.

Reuse [ADR 0007](adr/0007-capability-data-locality-split-machine.md) and
[Host operation lifecycle](../.trellis/spec/backend/host-operation-lifecycle.md).
Protocol definitions belong in Shared and their Rust mirrors when implemented. A same-machine first probe can validate
shared placement explicitly; real Host execution and cross-machine placement remain distinct acceptance checks.

### Selected playback source

| Layer | Contract |
| --- | --- |
| Authenticated attachment | Core/Host retains selected Host and connection/catalog generations, browser attachment, exact media/part and revocable source epoch. Source payloads cannot assert authentication. |
| Extension background | Derive tab/frame/document identity from browser sender metadata, then bind the selected player instance. Element replacement creates a new player identity. |
| Observation | Increasing sequence; finite-or-null position/duration/rate; play/pause/seeking/buffering/end; visibility/PiP; observed time. |
| Receiver | Record reception and freshness independently; reject duplicate/reversed/outdated/wrong-source frames. Disconnect invalidates dependent output. Reconnect supplies fresh evidence. |
| Task consumer | Use current media time plus candidate revision and accepted work scope. No model call or Timeline entry per tick. |

The 248 saved samples have two documents and no duplicate/reversed sequences or sequence gaps in arrival order. They
lack Host/connection/source epoch/tab/player/CID fields. That narrows the formal adapter work; it does not pass it.

Count eligible viewing using continuous elapsed observations. Pause, buffering, seeking, absent or stale intervals add
zero; seek distance never counts as viewing time. Timed delivery separately uses media position/rate. Do not infer
remaining duration when unknown. Freshness constants require measurement through the formal transport; the original
1-second local sample interval is not a remote latency guarantee.

## First production slices and acceptance

These are the concrete next implementation units, not newly created Trellis tasks or blanket authorization to alter
unrelated runtime behavior. Existing product choices remain settled; review should focus on these contracts and their
observable behavior.

| Order | Slice / scope | Exit evidence |
| --- | --- | --- |
| A | Harden final publication Attempt equality and source-scoped retirement using existing delivery owners. | Fault-order regression refuses stale Attempt; one task's Stop leaves another task/foreground conversation intact. |
| B, independent of A | Native partial-grid/status/cache/readiness corrections plus opt-in structured result, in an isolated upstream worktree. | Original/corrected fixtures, backward-compatible Markdown/status consumers, native result schema and one result-availability contract. |
| C | Nonterminal accepted root wait/resume and trusted prepared publication; minimal recovery classification and explicit silent result routing where preparation uses Schedule. | Replace probe-injected acceptance/currentness with real owners; two outputs, foreground turn, revision, Stop, retry and M51 all work through public integration seams. No model Effect per publication. |
| D | Minimal formal Host data and selected browser attachment paths. | Actual designated Shell reads/runs the intended helper; exact source, navigation/part changes and disconnect retirement proven. |
| E | First explicitly requested Co-Watching Skill composition. | Reuse native result, prepare at least two candidates, publish against real playback, revise pending content from conversation, then Stop. |
| Follow-on | Exercise Schedule/contextual/detected/recommendation entry reuse, OpenBili native UI/feedback, intended VPS topology and full Continue. | V1-V6 completed within their actual scopes; no quota re-grill or duplicated runtime. |

Start integration development with stored native results and deterministic fixtures, then repeat the supplied video
through actual service and Taki paths. This separates provider/media quality and latency from execution bugs.

## Gate accounting and owner participation

| Gate | Current status |
| --- | --- |
| V1 | Partial live baseline plus stronger offline native defect/contract evidence. Native patches, OpenBili and VPS readiness remain unverified. |
| V2 | Core Skill/resource/staging subset passed; actual Host execution/staging and split placement not passed. |
| V3 | Existing-owner composition tested and missing guards/lifecycle demonstrated. Accepted-work source, prepared adapter and silent preparation contract are not implemented; gate remains partial. |
| V4 | Historical real observation audit passed; formal transport, exact part/player identity and lifecycle not passed. |
| V5 | Recovery source implications recorded; full restart/explicit Continue not exercised. |
| V6 | Integrated three-entry/recommendation/feedback behavior not exercised. |

No manual action is required for this completed offline phase. Once the formal adapters and first closed loop are ready,
provide one batched Edge checklist: play/pause, seek/rewind, rate/PiP, different tab/part/navigation, conversation/edit,
Stop and disconnect/reconnect. The owner should not repeat the October 9 probe before those interfaces exist.

## Reproducibility and artifacts

Run from the T4 worktree with installed locked dependencies. The native probe uses the existing isolated Python venv;
it guards against network/provider/subprocess boundaries and verifies source hashes before/after.

```powershell
pnpm exec vitest run --config .runtime/media-validation-20261010/v3/vitest.config.ts
pnpm exec tsc -p .runtime/media-validation-20261010/v3/tsconfig.json
pnpm exec eslint .runtime/media-validation-20261010/v3/v3-execution-probe.test.ts
& '.runtime/media-validation-20261009/venv/Scripts/python.exe' -B '.runtime/media-validation-20261010/native/native_probe.py'
& '.runtime/media-validation-20261009/venv/Scripts/python.exe' -B '.runtime/media-validation-20261010/native/contract_probe.py'
node --test .runtime/media-validation-20261010/host-browser/locality.test.mjs
pnpm exec eslint .runtime/media-validation-20261010/host-browser/locality.test.mjs
```

- [V3 observations](../.runtime/media-validation-20261010/v3/observations.json) and [test output](../.runtime/media-validation-20261010/v3/test-output.txt).
- [V3 detailed report](../.runtime/media-validation-20261010/v3/report.md) and [peer review](../.runtime/media-validation-20261010/v3/review.md).
- [Native detailed report](../.runtime/media-validation-20261010/native/report.md), [function probe results](../.runtime/media-validation-20261010/native/native-probe-results.json), and [proposed-contract results](../.runtime/media-validation-20261010/native/contract-probe-results.json).
- [Native peer review](../.runtime/media-validation-20261010/native/review.md); its invocation, evidence wording and result-integrity clarifications are incorporated above.
- Proposed native [result schema](../.runtime/media-validation-20261010/native/proposed-result.schema.json) and [status schema](../.runtime/media-validation-20261010/native/proposed-status.schema.json).
- [Locality/source observations](../.runtime/media-validation-20261010/host-browser/probe-results.json).
- [Host/browser detailed contract](../.runtime/media-validation-20261010/host-browser/report.md).

These probes are ignored local validation artifacts, retained for continuation rather than installed production tools.
Permanent regression tests belong beside the affected owners when their reviewed changes are implemented. This report
records their purpose, inputs, observed limitations and commands so a later checkout can reconstruct the small fixtures.
