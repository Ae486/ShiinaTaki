# D77/B6 Actual-Data Owner Acceptance

Status: executed; **NOT PASSED overall**. Complete original-field preservation, provider-only reconstruction,
response-loss recovery, exact policy guards and two-Bank pre-retirement recovery passed. Configured retrieval
quality, automatic-recall usefulness, guarded-reflection latency and complete curator execution did not pass.
The task remains `in_progress`; original-data activation, owner subjective acceptance and B7 are still open.

Authorization is recorded in [the execution boundary](d77-owner-acceptance-execution-2026-09-11.md).
Private evidence is under `.trellis/.runtime/d77-acceptance/9e41c8d27fa0/`; memory contents and credentials
belong there and must not be committed.

| Actual-data / configured-model gate | Result |
| --- | --- |
| All original Sources, memories, policy, provenance, metadata and Blocks | PASS; 722 / 722 original Source/memory records and two Blocks |
| Empty SQLite reconstruction with a real interruption and reopen | PASS; all 1,944 heads/projections and 1,942 artifacts match the complete baseline |
| Original Character / Global exact-text recall | FAIL; final combined ranks 167 / 158 after retrieval ranks 1 / 1 |
| New native retain, lost ACK, offline Pending and reopen | PASS; one real extracted memory, no native redispatch |
| Original pin, frozen Run, lost application ACK, stale CAS and hidden recall | PASS; restrictive current policy remains authoritative |
| Guarded real-model reflection | FAIL; 120-second operation deadline, no completed answer |
| Narrow real policy curator | PARTIAL / FAIL; three assessments committed, four work items pending at 60 seconds |
| Default automatic recall | No returned text after about 1.51 seconds; bounded non-blocking behavior passes, usefulness does not |
| Actual primary Chat | PASS for execution/commit; four Timeline rows and a nonempty real answer, about 34 seconds |
| Offline pre-retirement coverage and later recovery | PASS; two Banks, unchanged Source/metadata, no repeated gate or native dispatch |
| Final Core / types / lint | PASS; 2,957 tests in 368 files, all five workspace typechecks, root lint |
| Original storage / retained target / owned shutdown | PASS; original DB/WAL/SHM and all 1,556 old PG files unchanged, all owned services stopped |

## Input and isolation

The effective Core bootstrap resolves `C:/Users/55473/.takiagent/taki.db`. A read-only connection and SQLite
online backup captured committed data. All 74 tables exactly matched the frozen input of successful D78
run `654131f0175a`. Original main/WAL/SHM hashes remained unchanged.

The corresponding stopped PostgreSQL cluster was cold-copied after checking its ownership, absence of
`postmaster.pid`, and `pg_controldata` clean-shutdown state. All 1,556 copied files matched byte-for-byte;
the manifest digest is `f180044962f963db27e69d9aad52eab99e04dc2b076a9cab61a5daa5d2f9da3e`.
The new PG instance has independent name/data-directory ownership. Only the previous test's free loopback
HTTP port and encrypted credential were restored to preserve its actual B3 fingerprint. The old target
remains stopped and unchanged. The copied SQLite database contains the matching genuine D78 evidence.

The restored endpoint passed actual B3 validation and template verification. Both D78 certificates were
re-fetched and verified against the complete evidence. Production B4 readiness and promotion passed in
the copy at `2026-09-11T16:30:51.239Z`. Migrations 041–047 applied only to that copy. The original
application's Authority remained Canonical Local.

## Cold-read failure and correction

Consumer `bootstrap-full-1` failed with `HINDSIGHT_TIMEOUT` at `2026-09-11T16:33:05.471Z`, during Character
body-closure download. It had published no D77 checkpoint, native write or application commit. The failure
stack runs through `loadHindsightApplicationBody`, `loadBodies` and `captureHindsightApplicationBaseline`.
All five owned service groups stopped; Job cleanup was unforced with zero remaining members. The original
failed consumer log, failure record and terminal supervisor files are retained.

The Bank operation had a longer captured deadline, but `context.request()` returned the configured HTTP
cap. Passing that value once to nested readers incorrectly created a second, shorter deadline for the
complete set of pages and bodies. Individually timely responses could therefore never finish a large
snapshot. Serial immutable-body requests also consumed the finite operation budget unnecessarily.

The correction preserves the owning request callback across snapshot, event, descriptor and body-part
reads. Every request retains its configured cap, current lease/Authority checks, cancellation and the
original absolute operation deadline. Standalone callers retain their original complete-read deadline.
Independent body reads use batches of at most eight, deduplicate exact descriptors, cancel siblings on
failure and drain every started read before returning. Complete hash/closure validation and atomic
checkpoint publication remain required.

Verification before the second actual run:

- The minimized integration regression reproduced the same early timeout in initial, event and reset paths.
  The initial test setup used an unsupported sub-250 ms setting and was corrected before claiming reproduction.
- The bounded-concurrency case separately failed under serial reads within the same finite operation budget.
- Final focused gate: 47 tests in four files passed, including multipart data, individual and total timeouts,
  cancellation, lost lease, first-error preservation and sibling drain. A temporary assertion checked Vitest's
  assertion-return object instead of its completion; correcting that test did not change production behavior.
- Core typecheck and scoped ESLint passed. Internal Core changes require no native wire or SDK regeneration.

The second run used the same complete copied dataset and genuine saved activation. It completed the first
full snapshot and persisted 942 application commits before its actual 20-minute Bank deadline. The deadline
was honored and every owned service stopped without forced termination. It did not complete acceptance.

### Bounded recovery and binding cost

The next repair stores individually verified immutable bodies in the existing 042 evidence table under the
current lease, Authority, Bank, namespace and predecessor-checkpoint guard. This cache publishes no partial
head, artifact, consumer projection or checkpoint. A later bounded attempt can reuse valid bytes after
revalidation, including across SQLite reopen. Normal consumer reads still require a complete checkpoint.

Binding queries now filter the requested native kind and exact Source document/binding kind before body
decoding. The one-command binding step loads one candidate instead of decoding 99 unused candidates and
rescanning unrelated Source bodies. Native APIs, SDK contracts and migration history are unchanged.

The focused final gate for these repairs passed 79 tests in six files, including real SQLite close/reopen,
unpublished-cache isolation, guarded namespace/lease/cursor access and selective Source/kind reads. Core
typecheck and scoped lint passed. The final complete Core gate also passed, as recorded below.

### Complete actual-field preservation

At `2026-09-11T18:00:17Z`, `bootstrap-full-3` compared all 722 original Source records and 722 original
memories, including metadata, original bodies, provenance, policy and associations. All comparisons passed:

| Evidence | Count |
| --- | ---: |
| Banks | 2 |
| Original Sources / memories / metadata records | 722 / 722 / 722 |
| Original Core Blocks | 2 |
| Retrieved / mood-gated / pinned policies | 565 / 84 / 73 |
| Invalidated original memories | 21 |
| Complete native heads / consumer projections | 1,944 / 1,944 |
| Complete application artifacts | 1,942 |

The native set includes 494 additional observations from the earlier genuine D78 maintenance. The third
run reused the second run's committed progress and completed in about 733 seconds; this is not a measurement
of a fresh optimized initial bind. `bootstrap-original-comparison.json` contains the complete evidence hashes.

The subsequent empty-database harness initially omitted genuine activation receipts and correctly hit
`MEMORY_INTEGRITY_ERROR`. The harness now restores the actual Authority/routing receipts and their required
foreign-key closure; it does not fabricate activation or restore source, replica, outbox or capture data.

### Provider-only reconstruction and interruption

`models-full-1` restored only that genuine Authority/routing identity into an empty SQLite database. After
the first eight HTTP bodies were durably cached, the harness interrupted the read, proved that no checkpoint
or projection had been published, closed SQLite, reopened it and resumed the real provider download.

Reconstruction completed in about 230 seconds, with zero repeat downloads of those eight cached bodies.
All 1,944 heads/projections, 1,942 artifacts and two Blocks matched the original complete evidence hashes.
Canonical source/memory tables and the old B2/D78 capture tables remained empty; foreign-key checks passed.
`cold-reconstruction-proof.json` is the genuine receipt. It is reused during model diagnosis only after both
Banks synchronize and all current complete-evidence hashes still match that receipt.

### Configured retrieval investigation

The unchanged real models are DeepSeek V4 Flash, local `BAAI/bge-small-en-v1.5` embeddings and local
`cross-encoder/ms-marco-MiniLM-L-6-v2` reranking. A valid retrieved Character memory failed an exact-text
recall under the normal low budget. Its text is unique in that Bank, and the Taki policy admits it.
The native response contained 30 candidates without that ID; Taki returned 24 eligible candidates. Thus
Taki filtering did not cause this target's absence. The diagnostic request took approximately 11.7 seconds.

Both actual targets were present at rank 1 in their fact type's semantic and keyword retrieval. The native
trace then locates the loss precisely:

| Bank | Fused rank | Raw cross-encoder rank | Final combined rank | Scores above 0.99 |
| --- | ---: | ---: | ---: | ---: |
| Character | 2 | 166 | 167 | 280 / 282 |
| Global | 1 | 49 | 158 | 203 / 227 |

Both low and high retrieval budgets omitted the targets at the same 5,000-token output limit. This is
current reranking/scoring quality, not absent original records, missing index hits or a Taki policy rejection.
Natural-language queries returned 25 eligible hits per Bank, but hit count alone does not establish relevance.
Character exact/natural calls took about 12.0/10.7 seconds; Global took 8.9/9.2 seconds.

The full low-budget trace was 671,786 bytes for Character and 572,836 bytes for Global. The first diagnostic
correctly exceeded the normal 512 KiB runtime response limit. A task-only bounded 8 MiB trace reader captured
the private diagnostic; production response limits and the consumer's `trace: false` request remain unchanged.

The failed quality checks remain failed while unrelated scenarios continue; no successful overall receipt
is emitted merely because independent storage or model calls succeed. Continued cases reuse the completed
original baseline proof explicitly as historical input; they do not claim later acceptance mutations still
have the original full-state hashes.

### Native response loss

A single real model extraction retained an isolated synthetic checklist nickname through the production
write path. The native successful response was lost and the test endpoint then became unavailable. The
caller received durable Pending, and degraded recall showed one separate unconfirmed source overlay.
After SQLite reopen and ordinary recovery, the same request completed with one actual native memory,
without a second native dispatch. Original Source text and nested/null metadata matched exactly. A further
process continuation replayed that completed request and returned byte-equivalent result data without I/O
redispatch. Evidence: `native-response-loss-result.json` and the acceptance event stream.

The first manual visibility scenario kept `policy_basis: neutral` while changing the policy and was correctly
refused with `binding_invalid`. The task script now declares the real owner edit as curated with no invented
model assessment. Frozen-Run pin checks use a real, non-truncatable Character promise under the unchanged
normal pin budget; ordinary truncatable Global pins do not bypass existing budget policy.

### Policy, reflection and curator outcomes

The corrected policy case passed at `2026-09-11T19:06:34Z`. Removing one original non-truncatable pin affected
the next Run while the already captured Run retained its old prompt. The pin was then restored in the copy.
A real hidden-policy commit lost its response, survived reopen and completed from its original receipt without
redispatch. A competing stale request was refused; subsequent current recall excluded the hidden test memory.

The real guarded-reflection request then reached its 120-second operation deadline and returned the public
retryable availability error. No final answer was received, so this attempt cannot prove a completed model
answer excludes hidden content. The successful policy/read guards above and earlier deterministic model-input
tests remain separate evidence. The timed-out attempt and actual native model usage are retained.

The unmodified 60-second curator deadline was also reached. The real model completed and published three
assessments/policy edits, with zero Block writes and four pending work items; user-owned Blocks stayed unchanged.
The pass recorded two Utility calls and two steps. One Utility call lacks complete returned usage. This is
real partial progress, not a successful complete two-Bank maintenance pass. No timeout was raised to make it pass.

### Actual Chat and pre-retirement recovery

The default automatic-recall hook returned no text in 1,511.7 ms under its 1,500 ms limit. The actual Chat agent
still produced a 626-character answer and committed four real Timeline rows in about 34 seconds. Its ordinary
memory tools and Primary-commit witness were wired; the empty automatic branch did not fabricate a recalled fact.
This proves execution and non-blocking failure behavior, not acceptable retrieval quality or whole-admission latency.

With native transport offline before dispatch, the real Write Gate selected both Banks and produced two durable
outbox receipts in 3.32 seconds. After SQLite reopen, native writes progressed, but concurrent native maintenance
caused one genuine `native_version_conflict` during exact binding. The refusal was correct; the first task loop
had treated every non-Pending error as terminal. The saved original operation and refusal were preserved.

A separate bounded continuation consumed those same saved spans and current native state. Both Bank requests
completed, their original Source text and typed metadata matched, the saved span did not change, and replaying
`prepareRetirement` performed zero writes and zero Utility calls. The continuation made 25 HTTP requests, zero
native writes and zero application commits. It neither regenerated Chat nor reran the Write Gate. The genuine
completion receipt is `retirement-recovery-result.json`; the original race remains in the failed-run evidence.

## Final automated gate and preservation

The nine production source files used for the successful original-data comparison are unchanged through the
final recovery. This acceptance added 16 meaningful regression cases; the complete current Core suite passed
**2,957 tests in 368 files**, with no failed or skipped tests. All five workspace typechecks and root lint passed.
The task's strict standalone TypeScript check, both Python helpers' Ruff/format checks, and tracked whitespace
checks passed. Shared/CLI/Desktop and native/SDK implementations were not changed by these acceptance repairs;
their earlier results remain in the [engineering report](d77-runtime-validation-2026-09-11.md).

Final commands, from `H:/TakiAgent`:

```powershell
pnpm --filter @taki/core exec vitest run --maxWorkers=2 --reporter=json --outputFile=H:/TakiAgent/.trellis/.runtime/d77-acceptance/9e41c8d27fa0/core-final.json
pnpm -r typecheck
pnpm lint
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --allowImportingTsExtensions --skipLibCheck --strict .trellis/tasks/08-09-memory-runtime-integration/research/validation/d77-owner-acceptance.ts
```

`final-copy-integrity.json` records a passing SQLite integrity check, zero foreign-key violations and zero remaining
required Bank/Source/Memory bindings. `final-original-preservation.json` records unchanged bytes for original
`taki.db`, WAL and SHM, and all 1,556 files of the stopped original D78 PostgreSQL target. The final supervisor
stopped consumer, HTTP, engine, background tasks and PostgreSQL; the Job exited without force, has zero members,
and its handle is closed. No listener remains on port 4658 and neither cluster has a `postmaster.pid`.

The new isolated data and private failed-attempt evidence are retained for diagnosis. There was no original-data
Authority change, staging, commit, push, reset/rebase, task archive or dependency change.

## Actual usage

`actual-model-usage-summary.json` reports 21 observed native HTTP model responses, all HTTP 200, with 176,382 input
and 18,977 output tokens. These include startup checks, actual extraction and the unfinished reflection flow.
Core reported 31,534 / 1,664 tokens for Chat, 9,937 / 2,518 known tokens for the curator and 834 / 485 for the Write
Gate. The known total is 242,331 tokens, with one curator call lacking complete usage. No bill or complete cost
is inferred from that incomplete total. Lower-level HTTP 200 does not mean the whole reflection/curator pass completed.

## Next work and acceptance boundary

1. Keep D77/B6 open and address the observed runtime quality/performance gates before original-data activation:
   Chinese retrieval suitability of the configured reranker, saturated relevance scores and recency/proof weighting;
   the mismatch between native retrieval/hydration cost and automatic recall's 1.5-second budget; full Run-admission
   cost; bounded reflection search and resumable curator throughput. Reuse the exact failed queries and private traces.
   Do not replace this work with a blanket timeout increase, a changed acceptance target or a second Local semantic engine.
2. Repeat the affected actual scenarios after the selected correction. Keep the original full-data and recovery proofs;
   rerun them only when source/protocol changes or a concrete regression concern requires it. Owner subjective response
   quality and original-environment activation remain separate decisions.
3. Then perform the required B7 grill against the already accepted documents, covering only remaining choices for
   planned Hindsight-to-Local switch-back, Local-to-Hindsight re-entry and Emergency Local Takeover. Preserve both
   providers' gap-period changes and all losslessly retained advanced evidence. B7 implementation did not begin here.

## Recovery and tool limitations

The requested `context_explorer` could not start because its model is unsupported in the configured tool service;
JetBrains semantic search also returned 404. Root continued with direct reads and exact local searches, without
resuming the older implementation agents. During one context recovery, an initial directory/file-name enumeration
mistakenly included T4 before the current checkpoint was located. No file content, edit or test from that worktree
was used as evidence. The session-bound main-worktree task was reverified and all implementation/execution stayed
in the exact D77 task and approved isolated/native scope. Future dispatch/resume must retain the existing anchor rule.
