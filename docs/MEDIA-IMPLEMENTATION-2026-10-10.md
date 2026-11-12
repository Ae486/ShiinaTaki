# Media integration implementation and Harness change record — 2026-10-10

Updated: 2026-10-15. Status: first support primitives, native correctness and trusted prepared-publication composition
implemented and offline-verified; native structured/provenance generation has completed independent source review,
two reproduced corrections and the updated offline gate. Native B3 admission/result ownership and Q&A compatibility
have passed independent source/evidence review and the complete isolated checks.
The full Co-Watching path and real Heartbeat/Agent behavior are not accepted.

The owner subsequently authorized continued implementation and real-data/model testing.
The [2026-10-13 live-validation record](MEDIA-LIVE-VALIDATION-2026-10-13.md) owns these
campaigns and independent B4 bridge work. The independent bridge's HTTP and actual SDK gates passed.
The owner superseded the original four-request cap; functional R1-R4 reached 12 physical requests, with R4 rejected
only at a one-adjacent-float transcript boundary. The native numeric correction passed 68 offline tests and temporal
replay. R5 then failed before temporal validation because the upstream's delayed HTTP 200 contained no usable
completion; retained-state MCP/read/restart and shutdown checks passed. Current live outcomes belong to the live-validation record. Full
Co-Watching and human content-quality acceptance remain open.

The subsequent approved test-infrastructure continuation passed 19 total-deadline/probe checks and 29 R6-controller
checks. The real ordinal-16 probe ended automatically at 90.015 seconds without a usable completion; R6's prerequisite
gate correctly refused before creating a native job or database. No production Agent/Harness, native or bridge
source change was introduced by that continuation. The live-validation record owns the exact scope and evidence.

The owner's 2026-10-12 continuation additionally requires generic Agent/Harness capabilities rather than a
Co-Watching-specific framework. The subsequent boundary review found and removed the C2 business-policy coupling;
the framework follow-up below distinguishes that correction from the earlier passing C2 source snapshot.

## Authority and baseline

After the [contract review](MEDIA-CONTRACT-REVIEW-2026-10-10.md), the owner authorized continued implementation unless
a problem or material decision requires attention. The no-Trellis-task choice persists. No commit/push, real database
operation or deployment is authorized by this implementation record.

The owner additionally required every Harness/Agent-logic change to be recorded because the current Heartbeat
implementation has not undergone real testing and must not be treated as stable or reliable. This document is the
canonical change record for this batch. Source tests and scripted SDK providers do not substitute for that acceptance.

Taki remains in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. BiliNote changes use the existing
isolated worktree `.worktrees/bilinote-media`, branch `fix/taki-video-grid-progress`, based on `90940fde4d224d0f69ad99674f4af0a1ea52d3c4`.
`H:/BiliNote` is unchanged. The native worktree already contained partial-grid and summarization-ID corrections plus
their tests; those four baseline entries are preserved and not attributed as new implementation.

Baseline hashes and actual check outputs are retained under `.runtime/media-implementation-20261010/`.

## Harness and Agent execution changes

| ID / owning files | Before -> after | Impact and current evidence |
| --- | --- | --- |
| H01 — [run-delivery-repo.ts](../packages/core/src/db/run-delivery-repo.ts) | Final publication checked terminal Run state but could accept an old staged Attempt. It now also checks the canonical active Attempt, Character and delivery class within the publication transaction. | Shared by Scheduled/Class A and initiative/Class B delivery. Fault-injected stale/mismatched records are refused before Timeline/charge. Real Heartbeat late-result behavior remains untested. |
| H02 — [delivery-coordinator.ts](../packages/core/src/delivery/delivery-coordinator.ts) | Only Character-wide retirement was public. New `retireRun(runId)` durably retires one uncommitted delivery, including terminal held text; late callbacks read canonical state. | Trusted caller must establish ownership. Active presentation receives exact cancellation/abort while its real Effect settlement remains authoritative. Sent/unknown/committed output is preserved. Unit tests cover other-task/foreground isolation. |
| H03 — [run-service.ts](../packages/core/src/harness/run-service.ts), [run-work-binding.ts](../packages/core/src/harness/run-work-binding.ts) | Added bounded `holdWork`/`resumeWork` using a retained accepted-source binding and affirmative captured authority. Reserved-provider admission validates those bindings; duplicate admission after context loss cannot reconstruct them automatically. | Adds an internal capability, not an exposed model tool or acceptance UI. Caller owns Character-lane acquisition/release. Tests use a trusted fixture binding; production accepted-source construction is not yet wired. |
| H04 — [run-repo.ts](../packages/core/src/db/run-repo.ts), [run-work-transition.ts](../packages/core/src/db/run-work-transition.ts) | Added same-ledger quiescent waiting/resume with exact Run version/Attempt/state, immutable purpose, deadline, no unfinished Effects and no delivery row. | No migration/table/candidate store. State and required event commit atomically. A stale or cancelled root cannot resume, and event-write failure rolls back the transition. |
| H05 — [recovery-coordinator.ts](../packages/core/src/harness/recovery-coordinator.ts) | An accepted ongoing purpose could be treated as completed from its last completed Effect, or as a malformed Heartbeat. Accepted-root recognition now precedes Heartbeat-specific recovery; quiescent work waits for authority and unfinished work requires explicit reconciliation. | No automatic replay/reconcile through newly configured adapters without the accepted binding. Cancellation/expired-control handling retains precedence. This is source/test evidence, not full process-restart/Continue acceptance. |
| H06 — [run-work-schema.ts](../packages/shared/src/run-work-schema.ts), [run-event-schema.ts](../packages/shared/src/run-event-schema.ts), Shared exports | Added bounded internal transition/result schemas and strict `run-event.v3` held/resumed facts; mixed event reader accepts v1/v2/v3. | Original v1/v2 schemas remain their historical decoders. New facts contain no prompt, candidate body, source reference or invented model/Effect event. |
| H07 — [trajectory projection](../packages/core/src/observability/observability-event-projection.ts), [Inspector](../packages/core/src/observability/observability-inspector.ts) | Added explicit Chinese lifecycle projection for v3 wait/resume facts. | Retains event/sequence correlation internally, no fake model/tool activity; private purpose references remain absent from Inspector. Real Monitor interaction remains untested for this path. |
| H08 — [run-service-stub.ts](../packages/core/src/testing/run-service-stub.ts) | Test-only RunService shape includes new methods that refuse with `binding_lost`. | Prevents transport fixtures from pretending they implement accepted-work authority or real SQLite waiting. |

### C2 implementation and reviewed offline evidence — 2026-10-11

The following changes are implemented in the resumed worktree and have passed proportional offline checks and parent
source review. The [C2 closeout report](../.runtime/media-implementation-20261011/prepared/report.md) records the exact
24-file snapshot, baseline patch and check provenance. These changes do not add
an authenticated acceptance/browser producer, model tool, public RPC, startup wiring or explicit Continue UI.

| ID / owning files | Before -> after | Impact and remaining validation |
| --- | --- | --- |
| H09 — [run-service.ts](../packages/core/src/harness/run-service.ts), [run-work-binding.ts](../packages/core/src/harness/run-work-binding.ts), [run-prepared-publication.ts](../packages/core/src/harness/run-prepared-publication.ts), [run-readers.ts](../packages/core/src/db/run-readers.ts), [run-repo.ts](../packages/core/src/db/run-repo.ts) | Trusted Core admission can attach an accepted-source binding to the ordinary captured root. Separate prepared children derive identity, original snapshot and exact content from that retained root without another capture/model Effect. Source callbacks now require exactly `true`. | Reuses the Run ledger and original authority. M51 maps only the trusted accepted-Co-Watching policy to Class A. Restart cannot reconstruct the source through ordinary admission. Offline authority/identity/retry regressions passed; real acceptance remains open. |
| H10 — [prepared-publication-source.ts](../packages/core/src/delivery/prepared-publication-source.ts), [prepared-publication.ts](../packages/core/src/delivery/prepared-publication.ts), [Shared schemas](../packages/shared/src/prepared-publication-schema.ts) | Added an inert trusted composition accepting only a candidate reference and expected revision from its helper. It captures exact approved text, closes publication before returning an edit ticket, reopens only a confirmed revision and retires its own pending children on Stop. | Source views remain the external producer's responsibility. Retained bindings/cancellation handles are not a second persistent ledger. Existing TurnQueue and one-held-output-per-Character rules apply. Offline tests cover two outputs, foreground work, edits, Stop, terminal held text and unknown transport; Host CAS and real playback remain unimplemented. |
| H11 — [delivery-coordinator.ts](../packages/core/src/delivery/delivery-coordinator.ts), [run-delivery-repo.ts](../packages/core/src/db/run-delivery-repo.ts) | Delivery passes synchronous source/gate/content currentness into the canonical SQLite publication transaction; only an explicit boolean `true` passes. Existing Attempt/Character/class checks remain. | This also changes the final recheck for existing Scheduled/Class A and initiative/Class B paths. No asynchronous producer work belongs in the transaction. Stale/throwing/non-boolean callbacks and rollback regressions passed; real Heartbeat late callbacks and actual transport are still untested. |

H03's initial fixture-only limitation is narrowed by H09's internal admission port, not closed by a real user acceptance
flow. H08's test stub also mirrors the new admission methods without pretending to implement accepted-source authority.
Parent review found production non-null assertions and stale spec/index descriptions. The closeout captures and
narrows one publication binding, verifies that binding identity remains current, and explicitly refuses a missing child
deadline. The affected 19-case suite, Core typecheck and source-file lint passed after that cleanup; specs and indexes
now describe the implemented internal entry. No new behavioral defect was identified in the reviewed C2 scope.

Supporting executable specs: [accepted-work lifecycle](../.trellis/spec/backend/accepted-work-lifecycle.md) and the
updated [initiative delivery contract](../.trellis/spec/backend/initiative-runtime.md). Source directory indexes and the
Shared export entry were synchronized with these changes.

### Generic framework boundary correction — 2026-10-12

The [architecture review](../.runtime/media-implementation-20261012/framework-review/review.md) identified a real reuse
barrier: the generic source schema and Harness admitted only `accepted_co_watching`, so another trusted accepted task
would have had to claim a media policy. Passing the C2 lifecycle tests did not establish the desired generic boundary.
This follow-up removes that dependency rather than renaming the policy or broadening proactive admission.

| ID / owning files | Before -> after | Impact and verification boundary |
| --- | --- | --- |
| H15 — [authorization handle](../packages/core/src/harness/prepared-publication-authorization.ts), [work binding](../packages/core/src/harness/run-work-binding.ts), [child admission](../packages/core/src/harness/run-prepared-publication.ts), [generic source](../packages/core/src/delivery/prepared-publication-source.ts), [publication](../packages/core/src/delivery/prepared-publication.ts), [Shared scope](../packages/shared/src/prepared-publication-schema.ts) | Replaced the embedded business-policy literal with a separately registered process-owned authorization handle, explicit Class A classification and exact source/acceptance/Character/expiry scope. Generic admission consumes that current authorization; staging uses the admitted Run class. | No grant can arise from source JSON, a copied handle or helper-selected class. Revocation, mismatch and non-boolean authority refuse through final commitment. The WeakMap retains only immutable scope/callback identity, with no Run/candidate/replay state. Existing queue, ledger, recovery, quota and transport owners remain in place. |
| H16 — [Co-Watching adapter](../packages/core/src/co-watching/publication-source.ts), [business schema](../packages/shared/src/co-watching-publication-schema.ts) | Moved the existing M51 classification out of generic Shared/Harness/Delivery into one inert business adapter. Other trusted Class A producers can use generic publication without a media label. | The adapter still needs a real trusted accepted-source producer; its schema cannot prove consent. Invitations cannot use it. No public grant tool/RPC, startup wiring, new Class B path, actual browser producer or broader automatic permission/exemption was added. |

The generic integration fixture now represents an explicitly requested non-media report, with real local Run/SQLite/
Character-lane owners and a synthetic trusted Class A authorization. It produces two independent outputs around a
foreground SDK turn without another publication model Effect. Separate business-adapter tests preserve M51 and refuse
invitation/invalid/forged classification data. Negative tests cover absent/copied/JSON grants, scope mismatch, callback
receiver/replacement, and authorization loss before child admission, while held, during edits and at final commitment.

The [independent follow-up](../.runtime/media-implementation-20261012/framework-review/follow-up.md) found the coupling
resolved and no additional confirmed source defect in the bounded patch. This is a source/offline finding, not proof
that an untested real Heartbeat or media integration is safe. Original C2 results remain historical; the new gate and
delta are retained under `.runtime/media-implementation-20261012/framework-decoupling/`.

The [framework correction report](../.runtime/media-implementation-20261012/framework-decoupling/report.md) records
workspace typecheck/root lint exit 0, Shared 642/642 and Core 3,799 passed/one existing archive-fixture skip. The final
Core run includes all 39 affected composition/authorization cases. Three initial concurrent-run failures passed with
unchanged source in isolation and in the bounded full run; no timeout or assertion was relaxed. The existing Scheduled
teardown warning remains recorded and unresolved. These checks permit continued implementation within this boundary,
but do not close real Heartbeat acceptance.

This is an internal composition API change: trusted callers of `createPreparedPublicationSource` must now provide
the separate authorization handle. All current production/test callers were updated. No persisted Run/Attempt/event
decoder, public wire/RPC contract, database migration, dependency or deployment setting changes with this correction.

This batch does not establish a more capable autonomous judgment: the fixed initiative read-tool registry,
`heartbeat_respond` outcomes, model selection, initiative wake/quiet/quota policy and ordinary ChatAgent prompt assembly
are not widened here. H01/H02 and H05/H06 still touch shared infrastructure used by Heartbeat, so they must be included
in its real acceptance campaign rather than labelled harmless from unit results alone.

### Quiescent root representation and migration boundary

The first primitive has one immutable accepted purpose: persisted provider `core.accepted-work`, its original source
reference, internal delivery class and existing Run state/phase. Provider/source strings identify it; a trusted
`acceptedWork.isCurrent()` binding plus `authorityCurrent()` supplies live validity. They do not arise from a marker.
`reasonRef` cannot replace the captured purpose. Missing context after restart yields `RUN_WORK_CONTINUE_REQUIRED` on
ordinary admission reuse; D85 explicit reconstruction is still a separate integration obligation.

The source audit found that main's migration versions 49–57 and T4's 49–55 have different meanings. This pass neither
renumbers nor applies either lineage, and introduces no migration. It does not resolve or claim a verified eventual
merge/deployment of those histories. Recheck lineage before any later native/Taki schema addition or branch merge.

### Review findings and regression closure

- **A stale Attempt:** reproduced before the fix and refused after it; active Attempt/Character/class are checked at
  canonical commitment. The before-fix isolated V3 results remain historical, not rewritten into a passing result.
- **C Heartbeat-origin recovery:** a valid accepted root whose initiator was Heartbeat entered old missing-decision
  repair. New regression failed before the correction; accepted-root routing now takes precedence.
- **C unfinished Effect recovery:** a configured adapter could replay/reconcile retired accepted work and infer whole
  root completion. New regression failed before the correction; such work now waits for explicit reconciliation.
- **Retained purpose drift:** resume compares retained source identity with the immutable admitted source and refuses
  replacement even if the source callback otherwise returns true.
- **Cross-Host revision ordering:** the reviewed close-Core-gate -> Host CAS -> confirmed-new-revision -> reopen rule
  is still a contract for the future adapter. File writes alone do not implement it.

## Native BiliNote changes

### B1 compatibility and publication baseline

The [native implementation report](../.runtime/media-implementation-20261010/native/report.md) is the detailed file-level
evidence; the implementation lives in the isolated upstream worktree.

- Canonical task identity now flows through download, transcription and summarization while preserving existing
  Markdown checkpoint keys. The prior grid/summarization corrections are retained.
- Generation reaches SAVING; the route atomically saves the complete JSON result before publishing SUCCESS and its
  actual completion timestamp. Failed replacement preserves the prior complete file. Nonfinite JSON is refused.
- Cached audio no longer bypasses requested video/frame work. Each job uses its own frame/grid directories; different
  jobs were tested concurrently using native grouping/cleanup with local extraction/composition stubs.
- New `/api/media/v1/jobs/{task_id}` and `/result` reads provide explicit availability and a safe complete-result
  SHA-256/byte-length reference. The legacy envelope remains supported; unknown provenance stays unknown.
- The new projection is `legacy_markdown`. It does not produce Viewing Moments, exact acquisition identity or native
  request-idempotency proof. Unsupported `media_v1` generation and non-null `client_request_id` are refused rather than
  accepted as working features. Structured generation, exact source/part cache binding and request reservation remain
  required before the complete media contract can feed timed delivery.

No new dependency or environment variable is needed for this native slice. There is no native database migration,
service deployment or paid model call. Real HTTP/model/browser acceptance is outstanding.

### B2 exact acquisition, input evidence and structured generation

The [B2 implementation report](../.runtime/media-implementation-20261011/native-structured/report.md) supersedes B1's
generation limitations for this opt-in slice. The existing submission pipeline now accepts `output_format="media_v1"`
for native Bilibili acquisition and preserves the legacy Markdown response. Non-null `client_request_id`, native
request reservation and durable service-instance identity remain unsupported; missing identities stay null.

The source/part resolver validates BVID, page and CID against native platform metadata and extractor observations.
Audio/video caches are part-qualified and check acquisition sidecars and file hashes. Transcript provenance records
native ASR, platform subtitles, browser-prefetched input or unknown; old unbound caches cannot acquire an exact new
part merely by reuse. Frame manifests retain sampled timestamps and image payload hashes without exposing local paths.

The opt-in structured result is requested in the existing analysis/merge calls, with no additional model pass to parse
Markdown. Native validation checks finite ordered times, referenced evidence and actual supplied inputs before the
complete result can become available. The versioned read endpoints verify embedded job/source/transcript/Markdown
consistency and return the complete validated bytes, hash, length and ETag. These are content and acquisition facts;
they do not establish accepted-work authority or authorize timed publication.

| ID / owning files | Before -> after | Impact and remaining validation |
| --- | --- | --- |
| H12 — [universal_gpt.py](../.worktrees/bilinote-media/backend/app/gpt/universal_gpt.py), [media_generation.py](../.worktrees/bilinote-media/backend/app/gpt/media_generation.py), [request_chunker.py](../.worktrees/bilinote-media/backend/app/gpt/request_chunker.py) | Native generation retains receipts for usable accepted SDK requests, exact transcript ranges, actually supplied images and merge parentage. Version 2 checkpoints preserve that lineage across partial and mid-merge resume; old checkpoint input remains unknown. | Changes native model execution/evidence, including the ordinary Markdown path. Failed requests and omitted images cannot become positive receipts. The hash describes the assembled SDK payload, not observed wire bytes or model understanding. Offline fallback, retry, split and mixed-version resume cases passed; real provider behavior is unverified. |
| H13 — [prompt_builder.py](../.worktrees/bilinote-media/backend/app/gpt/prompt_builder.py), [media_generation.py](../.worktrees/bilinote-media/backend/app/gpt/media_generation.py), [note_result_v1.py](../.worktrees/bilinote-media/backend/app/models/note_result_v1.py), [media_provenance.py](../.worktrees/bilinote-media/backend/app/models/media_provenance.py) | Opt-in `media_v1` uses the existing summarize/merge response for structured content plus Markdown. Invalid JSON, time/evidence references or unsupported structured-provider responses fail explicitly. | Changes the native model response contract without adding a second Agent or Markdown-recovery call. Structured moments remain optional analysis content. Offline schema/provider-refusal cases passed; actual `deepseek-flash` compatibility and output quality remain untested for this patch. |
| H14 — [native note service](../.worktrees/bilinote-media/backend/app/services/note.py), [note_media.py](../.worktrees/bilinote-media/backend/app/services/note_media.py), [result projection](../.worktrees/bilinote-media/backend/app/services/note_result_projection.py), [native routes](../.worktrees/bilinote-media/backend/app/routers/note.py) | The existing job pipeline forwards structured mode, preserves selected-part/input provenance and publishes the validated complete result before SUCCESS. Legacy reads retain their original content and unknown provenance. | Changes the result/failure contract consumed by the future media tools. No Core Harness file changes in B2, native request-idempotency guarantee, live browser binding or bridge admission are implied. Offline registered-route/result round trips passed; real HTTP/acquisition and later authenticated service integration remain open. |

On 2026-10-12 the parent matched all 28 native file hashes/lengths and the complete patch hash against the saved
manifest (24 files differ from the B2 baseline; four B1 files are unchanged). The patch includes retained pre-B1/B1
changes and is not an incremental patch containing only the recovered worker's edits. C2's separate 24-file manifest
also matched. This refresh verifies source continuity; it does not represent another execution of the recorded tests.
The [independent B2 review](../.runtime/media-implementation-20261012/review/b2-review.md) then found two defects, both
corrected and independently rechecked. Its final approval covers this native source/offline scope only.

### B2 review corrections — 2026-10-12

| Finding / affected behavior | Correction | Verification |
| --- | --- | --- |
| B2-R1 / H14: A different-part browser transcript rejected by URL-aware reads could re-enter through the ASR fallback, whose cache read omitted the URL. | Browser cache reuse now requires an explicit matching current URL. The URL and browser-reuse policy cross every fallback read. Structured mode reacquires native evidence even for a same-URL browser cache; compatible same-URL Markdown reuse remains available. | Two new permanent tests failed before the fix (four failing subcases) and passed afterward. The original independent reproduction now invokes ASR once and returns the current part's native transcript, rather than the wrong cached part. |
| B2-R2 / H13: `min_length=1` accepted whitespace-only structured Markdown, moment identity and moment content. A prepended source link could then conceal the empty note. | Native structured validators reject strings with no non-whitespace content without modifying valid strings. The produced structured read model also rejects blank Markdown; legacy reads preserve their historical representation. | Expanded invalid-output cases, a new valid-whitespace/receipt test and corrupted-artifact read coverage passed. Independent probes reject each blank field after one synthetic request and preserve valid content bytes/response hashes. |

The [reviewed native report](../.runtime/media-implementation-20261012/native-structured/report.md) records the six-file
correction, preserved pre-review source, 63-test/31-syntax gate, full upstream patch and incremental review diff.
Both before-fix reproduction files and all October 11 evidence remain unchanged. These corrections touch four native
Python production files and two tests; no Core Harness, TypeScript, Rust, database schema, dependency or deployment
configuration changes were made in this review follow-up.

### B3 native admission, ownership and Q&A — 2026-10-13

The [native admission checkpoint](../.runtime/media-implementation-20261012/native-admission/progress.md) and
[Q&A report](../.runtime/media-implementation-20261012/native-chat/report.md) describe this slice. It implements the
[reviewed native design](../.runtime/media-implementation-20261012/native-next/design-review.md) inside BiliNote.
No Taki Agent/Harness/Shared code changes, new model tools, publication exemption or second job ledger are required.
All 26 files in the framework-decoupling snapshot matched before this documentation update; its production code
retains the earlier independent review and passing offline gates.

| ID / owning files | Before -> after | Impact and remaining validation |
| --- | --- | --- |
| H17 — [admission model](../.worktrees/bilinote-media/backend/app/models/native_admission.py), [native schema](../.worktrees/bilinote-media/backend/app/db/native_admission_schema.py), [DAO](../.worktrees/bilinote-media/backend/app/db/native_task_admission_dao.py), [native owner](../.worktrees/bilinote-media/backend/app/services/native_task_admission.py), [note routes](../.worktrees/bilinote-media/backend/app/routers/note.py) | Existing `video_tasks` rows now retain the service/request identity, normalized-input digest, one-time execution claim, terminal disposition and two artifact digests. Repeated identical keys reuse the original job before readiness checks; conflicting inputs refuse. Prior-boot unfinished rows become interrupted/unknown and are never automatically replayed. | Changes the native contract consumed by future tools. The service UUID describes origin, not authentication, readiness or permission. SQLite migration is explicit and additive; no retained database has been migrated. |
| H18 — [storage owner](../.worktrees/bilinote-media/backend/app/services/native_storage_owner.py), [ASGI owner](../.worktrees/bilinote-media/backend/app/services/native_owner_middleware.py), [startup](../.worktrees/bilinote-media/backend/main.py), [app factory](../.worktrees/bilinote-media/backend/app/__init__.py), native generator/checkpoint wiring | Startup obtains DB/output ownership before legacy initialization and route-import side effects. Bound jobs use private result/cache/frame/checkpoint directories. Close seals new work, drains admitted request/generation/file/DB/status/index operations, then shuts down the existing pool and releases locks. | Affects ordinary native startup and legacy writers as well as keyed jobs. Existing local OS-lock dependency is reused. Shared downloader part caches remain shared. Old unmanaged binaries and remote databases are outside the local exclusion guarantee. |
| H19 — [vector store](../.worktrees/bilinote-media/backend/app/services/vector_store.py), [chat tools](../.worktrees/bilinote-media/backend/app/services/chat_tools.py), [chat context](../.worktrees/bilinote-media/backend/app/services/chat_service.py), [chat routes](../.worktrees/bilinote-media/backend/app/routers/chat.py) | Q&A resolves the verified full native envelope, binds collections to its identity and digests, serializes same-key collection operations across managers, and retains the original owner throughout manual indexing. Untimed text remains usable; missing endpoints/duration never become invented zeroes. | Invalid/missing bound results fail before stale context or provider use. Index progress is not job authority. Legacy unbound collections remain supported. Chroma/model boundaries are synthetic in the current tests; actual service/model acceptance is open. |

Keyed submission uses the existing `/api/generate_note` endpoint with paired `client_request_id` and
`expected_service_instance_id`. `/api/media/v1/instance` reports native origin, and
`/api/media/v1/requests/{client_request_id}` recovers the original reservation without submitting work. The versioned
job/result endpoints verify completed reservation identity and private content. Root-path shadow files, orphan bound
artifacts, missing inventory and DB/schema failures cannot substitute for a confirmed bound result.

The public SHA-256 continues to cover the safe v1 projection. A separate `bilinote.note-envelope.v1` digest and byte
length bind the entire raw JSON envelope, including metadata consumed by Q&A. Its encoding is deterministic UTF-8
JSON with sorted keys and compact separators, rejecting NaN. It is not a hash of the pretty-printed file's raw bytes.
Both checks are required on bound reads; the index key incorporates both digests.

The [independent B3 review](../.runtime/media-implementation-20261012/native-admission-review/full-review.md) closed
the two Q&A findings and two test-evidence corrections, with no new confirmed production defect in the declared
cooperating local-SQLite topology. All 55 native source/test hashes match. Both cumulative and B3-incremental patches
passed checks and actual application in reconstructed disposable baselines, with matching normalized content.
The four recorded gates total 110 passing test executions. These are implementation/review results, not live acceptance.

An unmigrated SQLite database retains the historical five-column ORM/legacy API and refuses keyed capability with
503. Non-SQLite legacy remains available with output locking only; keyed capability refuses and no remote-DB
exclusivity is claimed. Migration must use `backend/scripts/migrate_native_admission.py` with explicit absolute
`--database` and `--output-dir` paths; creating an empty store additionally needs `--create-empty`. Stop all old writers
and preserve the database/output baseline before any real deployment. Rolling back a deployed migration requires
that matched baseline; an old binary does not honor the new locks or binding guards. None of these real operations
has been performed or authorized by this report.

## Verification ledger

| Check | Recorded result | What it does not establish |
| --- | --- | --- |
| A scoped regressions | 35/35 passed; scoped ESLint and strict TypeScript passed | Actual user Stop, real presentation transport or full Heartbeat reliability |
| B native checks | 22/22 passed; 12 Python syntax checks; saved 246-segment result passed schema/projection checks | HTTP/provider/acquisition/deployment quality or same-job concurrent resubmission safety |
| B2 before independent review | Saved 60/60 tests and 31 syntax checks passed: 48 native tests plus 12 legacy compatibility tests; retained 246-segment result still passed projection/schema checks; zero forbidden live-boundary attempts | Historical pre-review snapshot; it did not catch B2-R1/R2 |
| B2 reviewed corrections | 63/63 tests and 31 syntax checks passed; 246-segment compatibility retained; zero forbidden boundary attempts. Independent targeted rechecks closed both findings. All 28 final file hashes and the full patch matched, with six files changed from pre-review | Synthetic provider/acquisition/process boundaries and direct registered-route calls do not establish actual HTTP, yt-dlp, FFmpeg, model quality, full Co-Watching or Heartbeat acceptance |
| B3 native admission | 30/30 tests and 49 syntax checks passed using disposable SQLite, actual local process-lock/crash fixtures and socket-free ASGI lifetimes. Explicit migration CLI, old ORM, legacy post-generation save/drain and startup ordering are covered; exact hashes/no drift and zero forbidden boundary attempts | Actual deployed HTTP/ASGI shutdown, Linux locks, remote DB exclusion or retained-store migration |
| B3 Q&A consumers | 13/13 tests and 5 syntax checks passed, with exact source hashes/no drift. Real threads exercise collection contention; closed-owner callbacks refuse; unknown timing/duration stays unknown | The resolver, Chroma and providers in this subset are substitutes |
| B3 native-to-Q&A integration | 4/4 tests and 16 syntax checks passed with real disposable DB/DAO/owner/resolver, full-envelope tampering and manual-index shutdown checks; exact hashes/no drift and zero forbidden boundaries | Chroma persistence, actual model output, real HTTP, browser/playback or Heartbeat acceptance |
| B3 compatibility refresh | Existing B2 63-test/31-syntax gate passed separately under `native-admission-b2/`; prior B2 reports were preserved | Historical B2 evidence is not reused as proof of untested B3 behavior |
| C focused checks | Shared/event/Harness/recovery/observability set: 35 tests passed; final retained-purpose regression adds one focused case, 10/10 work tests passed | Production accepted-source construction, new model tools or complete D85 Continue |
| Workspace typecheck | CLI, Desktop, E2E, Core and Shared passed before the final retained-purpose guard; the last Core check's completion was not observed before interruption | Runtime/browser behavior; current C2 changes need their own check |
| Broader Shared/Core tests | Shared: 68 files, 639 passed. Core: 455 files, 3,753 passed and one skipped. The final retained-purpose guard also passed all 10 focused work tests | Real model/provider or manual acceptance; subsequent C2/B2 changes are outside this snapshot |
| Root ESLint | Passed after excluding isolated runtime/upstream worktrees and pre-existing user-data backups | No source rule was relaxed; backup/browser-generated code is not project source |
| C2 before closeout cleanup | 9 files, 99/99 passed; full workspace typecheck passed; final root lint, Core typecheck and Node imports have recovered exit-0 command completions | The 99-case snapshot precedes the final binding/deadline type-narrowing cleanup; no live source/Host/browser acceptance |
| C2 final changed source | 19/19 prepared-publication cases, Core typecheck and scoped lint passed; 24-file UTF-8/hash manifest and baseline patch verified | Does not rerun the earlier broad suites or establish real Heartbeat behavior |

ESLint now excludes `.runtime/**`, `.worktrees/**` and `.backup-*/**` as non-project inputs. A raw root run had scanned a
pre-existing backup's operator helper and WebView filter script, producing 22 unrelated errors. The backup was not
edited. Production source rules remain enabled; isolated/upstream checks use their own recorded commands.

The 99-case C2 run also emitted `database is not open` from Scheduled asynchronous work after fixture teardown.
The preserved pre-C2 source overlay reproduced the same stack with both Scheduled tests passing. This establishes
preexistence relative to C2, not clean teardown or real Scheduler/Heartbeat reliability. The warning remains open and
its baseline/output evidence is retained in the C2 report.

The native HTTP test expansion encountered the offline harness audit: Windows asyncio attempted a local socketpair,
which was blocked, and an optional HTTP library attempted an import-time IPv6 probe. Those failed attempts were kept
in the native validation logs. The final pure endpoint/OpenAPI/function suite reported no forbidden boundary attempts;
it is not labelled a successful real HTTP test.

### 2026-10-11 interruption recovery

The original A/B1/C1 evidence remains under `.runtime/media-implementation-20261010/`; its recorded 11 Harness/source
hashes matched the recovered files before new implementation. The prior broad checks are retained as completed
snapshot evidence, not repeated or promoted to acceptance of later edits. The final Core typecheck completion was
not recovered at that point. This session read the original tail and recovered later successful Core typecheck, root
lint and Node import completions at raw lines 1693, 1690 and 1686 respectively; the final C2 cleanup has its own checks.

Two Astra workers resumed the reviewed slices: B2 owns the isolated native worktree's exact media/part provenance,
actual model-input receipts and optional structured generation; C2 owns the trusted accepted-source/prepared-output
composition and exact revision/Stop/final-commit guards. Their new evidence belongs under
`.runtime/media-implementation-20261011/`. Native request reservation remains explicitly unsupported; no database
migration, new dependency, service deployment, paid model call or browser operation is included in this continuation.
The no-task choice and the requirement to record every Harness/Agent behavior change remain in force.
After repeated rate limits, the owner capped concurrent child agents at two. Resume an errored worker from saved
progress only when a slot is available; run independent review after an implementation worker releases its slot.

The [2026-10-12 recovery audit](../.runtime/media-implementation-20261012/recovery/session-audit.md) covers all readable
context in session `01a12adf-0778-70a1-97b3-89a03d3a6194` (502 records) and the two children's final handoffs. It separates
recoverable event stdout from encrypted/unavailable wording, records the original B2 review stop, and points to the
subsequent corrected 63-test gate. The original authorization and no-task choice continue to apply.

## Remaining work and real acceptance

1. Connect an authenticated acceptance/media producer to the implemented trusted prepared-publication entry and its
   exact child retirement; opaque fixture references do not establish a real playback source.
2. Connect the independent media bridge and formal Host/browser data paths; preserve the already reviewed
   revision-update ordering. Native request reservation/instance attribution has completed B3 source/offline review,
   with real migration/service acceptance still separate.
3. Exercise real Co-Watching: explicit request, at least two timed outputs, foreground dialogue/edit, Stop, seek/rewind,
   wrong part/player, disconnect and late callbacks. Then verify other entry reuse and full restart/Continue.
4. Run the real Heartbeat campaign with this Harness change record: initiative eligibility and actual model/tool bag,
   ordinary user-turn precedence, Class B accounting, Scheduled/Class A separation, source retirement, cancellation,
   restart and observed presentation/delivery. Only owner-observed evidence can close manual items.

Until those checks exist, report the implementation as partial and the Heartbeat baseline as unvalidated in real use.
The current offline work needs no owner action; a later browser/Host checklist must be concrete and batched.

The B3 implementation above supersedes the earlier design-only status of native admission. Its additive migration
has run only on newly created fixture databases. Actual endpoint deployment, authenticated bridge integration and
owner-observed acceptance remain separate steps; no Taki Agent/Harness coupling is introduced by the native slice.

## B4 independent bridge and native compatibility follow-up

The bridge is a standalone Python package at `integrations/media-bridge/`. Its five tools expose instance,
single keyed submission, lookup, status and verified result reads; complete resources retain the exact native
UTF-8 bytes, SHA-256 and service/request/job identity. It imports no Taki or native production internals, adds
no job database/queue/model loop, and starts no native service. Caller-retained request UUIDs remain authoritative
after uncertain submission; no automatic key replacement, result-driven re-analysis or restart replay is added.

| ID / owning files | Behavior and boundary | Evidence |
| --- | --- | --- |
| H20 — `integrations/media-bridge/src/media_service_bridge/` | Adds a standard external MCP adapter with operator-selected endpoint/profile, five tools, strict native wire validation, bounded reads and complete resources. Generic Run, Effect, accepted-work, publication and Heartbeat owners are unchanged. Closing the adapter does not cancel a shared native job. | HTTP: 21 checks in each of two isolated dependency environments; four disposable native SQLite/ASGI integration checks. Official Python MCP 1.26.0 interoperates with the unchanged Taki `defaultConnect` / `@ai-sdk/mcp` 2.0.10. These synthetic-producer checks do not establish real model output. |
| H21 — native `app/gpt/universal_gpt.py`, `app/gpt/media_generation.py` | After an explicit HTTP 400/422 optional-parameter rejection, native media generation may omit the rejected `response_format` hint. The model, messages, images, `media_v1` contract and strict output/evidence validation remain unchanged. Omissions are local to one summarize operation; accepted receipts hash the actual successful payload and checkpoint recovery validates the precise allowed payload variants. Existing outer transient retry policy is retained. | The original live error and separate exact-body diagnostic both returned HTTP 400 with `This response_format type is unavailable now`; neither produced usage/cost or a successful native result. Compatibility source review and live retest are tracked in the October 13 record, with exact gate/snapshot distinctions. |

The owner-approved independent SDK installation contains the same 31 locked packages and wheel hashes; `pip check`
and imports passed. The sole lock notation correction is `pyjwt[crypto]`, preserving the approved package/version/hash
closure. Existing Taki, BiliNote and OpenBili environments were not upgraded.

Taki's existing SDK closes stdio by aborting the child process. Protocol success and interpreter exit do not prove
Python `finally` cleanup. A separate stdin-EOF gate proved the bridge's own lifespan closes the HTTP transport and
exits without an orphan. No Core modification was introduced to alter that existing lifecycle behavior.

Final package hashes/patch and exact gate provenance are in
`.runtime/media-implementation-20261013/bridge-final/package-manifest.json`; all 20 package files were reconstructed
by actual patch application, and original reports remain retained. The old
native ASGI gate precedes H21 and is explicitly historical. Framework production hashes still match the previously
reviewed generic-framework snapshot. Formal Host/browser binding, real Heartbeat and complete Co-Watching remain open.

The October 14 `review-5` campaign establishes H21's real wire compatibility: shared attempt 3 received the known
format rejection, then attempt 4 omitted that field and returned HTTP 200. The native guard nevertheless rejected
an incomplete/refused response before JSON parsing; no valid analysis was published. Reported completion usage was
8,191 tokens, all classified as reasoning, against the 8,192 test cap. Budget exhaustion is the leading hypothesis,
not a proven `finish_reason`, because choice metadata was not retained. Both failed requests and the complete old
evidence remain intact. Real native HTTP through the unchanged bridge/Taki client confirmed failed-state reads,
retained identity and no replay; the successful resource path, Q&A and quality acceptance remain open.
This is the historical four-request stopping point. See the live-validation record for its superseding authorization,
later functional campaigns, exact identities and usage.

## Native numeric-boundary continuation — 2026-10-15

Restoration completed the previously unfinished transcript-boundary correction in native
`backend/app/models/media_provenance.py`, with regression coverage in `backend/tests/test_note_temporal_contract.py`.
The original proper transcript interval may support exactly one adjacent representable value outside each boundary;
evidence/output values and receipt hashes are preserved. Frame/point matching, media duration, finite/nonnegative
values, ordering and accepted reference lineage retain their existing guards. Single-float gaps and unbounded
magnitude are explicit limitations, documented in `native-numeric-contract/review.md`.

The 68-test final gate and temporal-only replay passed; the 174-file manifest and reviewed R5 snapshot match.
The 18-test campaign gate and unchanged Taki MCP client's five-tool startup/exit check also passed. This continuation
adds no Agent/Harness, bridge implementation or new dependency change. All 23 retained framework source/spec hashes
match. R5's actual functional disposition, usage and shutdown evidence are owned by the live-validation record;
offline results do not close human content quality or full Co-Watching/Heartbeat acceptance.

## Explicit playback-source connection — 2026-10-15

The owner authorized the explicit Co-Watching path first, followed by other entries, OpenBili management and full
restart/Heartbeat/cross-Host acceptance. Task creation/binding remains declined. The implementation sequence and
source contract are in [the playback integration record](MEDIA-PLAYBACK-INTEGRATION-2026-10-15.md).

| ID / owner | Behavior and boundary | Current verification |
| --- | --- | --- |
| H22 — Shared browser-playback schema, Core Perception/source methods and startup composition | Optional `browser.playback.ready/report/read/control` uses the existing authenticated Node/socket/catalog. Core owns expiring source references and generation tombstones. The default-off config and Privacy Pause retire sources and send revision-bound control. No model tick, Timeline tick, acceptance or publication is produced by observation. | 15 Shared checks and 23 Core source/config checks, including disable-before-notify, catalog replacement and no old-source revival; Core typecheck and scoped lint pass. |
| H23 — Shell attachment, Home card and isolated OpenBili extension | A dedicated local credential gates one Chromium extension connection. Browser payloads omit Host identity, consent and Core credentials. Home explicitly reveals local pairing details and enables observation. Isolated Shell profile/keyring naming and explicit Core URL support the authorized test setup. The existing Node socket forwards latest observations without backlog. | Desktop 1,187 tests pass; Rust all-target clippy passes. Full native tests pass: 203 library + 7 helper tests, including actual compiled Home-only ACLs. Owner confirmed extension import and Shell pairing; real selected-player reception remains pending. |

Generic Agent/Harness, accepted-work and prepared-publication behavior is unchanged by H22/H23. The existing
Co-Watching adapter remains inert until a real accepted producer is wired. These changes do not close the explicit
request, prepared commentary, timed publication, dialogue revision, Stop or full restart/Heartbeat acceptance items.
No additional model request was made during this playback-source setup/check continuation.

The developer extension builds and its two added capture tests pass. Its complete Windows suite reports
1,385 passed / 8 failed: one test tries `execFileSync("npm")` and fails with `ENOENT`; seven static-source tests
fail on CRLF-sensitive extraction. These failures involve unchanged upstream tests/source files. They remain
recorded in `.runtime/media-implementation-20261015-playback/openbili-tests.log`; the full extension gate is not
reported as green. Chromium playback API behavior and Firefox attachment support are separate unresolved checks.

H23 compatibility follow-up: the owner's live player exposes `__getUserParams().input.bvid/cid/p` and
`mediaElement()` / `getElements().videoArea`, not `getVideoInfo()`. The optional extension now samples that exact
main element despite other visible previews, correlates its isolated UUID with a temporary non-secret DOM marker,
and verifies media/player/document identity before forwarding. Source and built-function fixtures cover the actual
reported shape and privacy withdrawal. No Core, Shell, Shared wire, Agent/Harness or acceptance/publication owner
changes are made by this repair. See the October 15 playback record and runtime `player-compatibility-fix` evidence;
successful post-fix live reception remains owner-driven and is not inferred from fixture tests.

H23 receiver follow-up: real post-reload frames exposed an additional producer/consumer mismatch. Chromium's
32-hex document token was incorrectly constrained as a UUID by Shared/Core and Rust. Both validators now retain
the raw token with exact length/alphabet checks, while the existing UUID alternative and all non-document UUID
requirements remain intact. Shared/Core negative and source-replacement tests and a real Shell loopback test use
the observed format. Temporary diagnostic logs contained only admission/field-validity metadata and were removed
before final runtime delivery. This widens only the document identifier representation; it adds no acceptance,
Agent/Harness behavior, model request or publication authority.
