# W4 implementation delivery

Status: complete W4 implementation delivered for independent checking. This is not a W5 release or product/manual
acceptance. Task: `09-29-hindsight-transitions-emergency`; implementer: `/root/w4_implement`.

## Source identity and scope

- Taki workspace: `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native dependency: `H:/hindsight`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; no W4 native edits.
- Additive SQLite migration054 is exclusive to W4. It follows the unchanged applied001-053 history.
- Explicit session assignment remains authoritative; the empty legacy `.current-task` was not replaced.
- `w4-source-ownership.json` enumerates89 changed source/spec/index/test files with before/after SHA-256 and baseline
  provenance:20 checked pre-W4 files,35 HEAD files and34 new files. The task report/audit/context files are additional
  delivery documents, not production source. Regenerate with `python .../research/w4-source-audit.py`.
  Final manifest SHA-256: `c11e7015dd8992c0689941f98b0f75a06754d5adbf5dd1547924673c7d7a6f28`.
- All349 native paths in the immutable pre-W4 inventory match. The244-path Taki/349-path native input inventory retains
  SHA-256 `1cd5cf124305fb12e3323b3039a1dfe8440abd9f58516a634ef0f4c8c7d1ac75`.
- Original `w3-source-ownership.json` remains unchanged, SHA-256
  `998edcd67c06757f9f400ce4d17a02dcc63f7456f3607e2f992be3f674ee5851`.
- No commit/push/reset/rebase, dependency installation, task finish/archive, T4 work, original-data mutation or real
  corpus conversion occurred. No new agent was spawned. Existing earlier-wave changes remain on disk.

## Delivered production behavior

### Atomic authority and representation publication

`db/memory-transition-publication-{proof,repo,reader}.ts` independently joins W1 admission/attempt/proof, W3 complete
candidate/baseline/native closure, final setup/configuration, exact primary custody and every queued obligation.

`publishMemoryTransition` owns one synchronous outer SQLite transaction: reserve/close/select epochs, install actual
Local canonical rows and Blocks or the complete Hindsight native/application pair, assign primary custody, record the
unchanged W1 receipt and new publication, then select the explicit transition marker. Local staging participates in
the outer transaction and is independently read back before COMMIT. No temporary candidate is externally selected.

Migration054 adds `transition_receipt_id`; a transition has neither a B2 verified snapshot nor a fabricated B2/B4
activation transaction. It recognizes the exact preceding marker schema and preserves all original columns, values,
B2/B4 receipts and migration timestamps. Unknown attached schema refuses atomically. The new publication, effect,
Local refusal and native-outcome tables reject UPDATE, DELETE and INSERT OR REPLACE collisions.

The public marker read in `legacy-activation-repo.ts` reconstructs the complete publication/candidate/native/custody
join before runtime selection. Historical first Local/first Hindsight checks remain separate. Corrupt marker, epoch,
candidate or publication refuses boot before either provider constructor executes. The low-level Local repository
runtime remains usable by its existing isolated tests; production boot always enters through the verified selector.

The retained Hindsight snapshot installer reconstructs original W2 pages and bodies itself. It does not trust a caller
bundle merely because its manifest matches. Only that retained certificate path can outlive snapshot transport TTL;
ordinary snapshot seeding still rejects expired native baselines and writes neither checkpoint on refusal.

### Primary custody and pending Sources

`db/memory-transition-custody.ts` transfers exact groups/members/witnesses in both directions. Late actual primary
append/finalize after COMMIT but before a usable target binding remains assigned to the selected target. Target
ingestion and subsequent reopens preserve these identities; source publication refuses unfinished ingestion work.

Real Timeline compaction cascades away primary witness rows. The reader therefore verifies a completed producer
ingestion span's exact source JSON/hash, Character, seq/entry ID/digest and epoch ancestry. It validates all finalized
groups before filtering consumed members. Missing/foreign witnesses or members cannot disappear into an empty
inventory; ordinary appended/finalized/retracted members can extend or remove the appropriate saved subset.

`memory-transition-source-disposition.ts` joins actual awaiting Source bytes to source-command/Pending/parent journals.
The parent's native-operation field is the original Pending `intent.operationId`, not its remote UUID. Shared
`transitionPendingRefusal` accepts only terminal non-dispatch or factual tracked cancellation with zero committed
parts/completed inputs and no result. Partial or ambiguous outcomes remain unknown, with original source ownership.

### Runtime ownership, readiness and recovery

`composeMemoryRuntime(...).transitions` is installed in the existing production composition used by Core startup.
No second scheduler, Utility Slot, Compaction authority or operation ledger was introduced.

Local/Hindsight bindings now retire an epoch separately from whole-Core stop. Source publication is withdrawn before
a fresh target construction. Constructors, install or start failures leave the committed target selected/unavailable;
same-epoch repair constructs a new draft without another authority receipt. Old Run/Effect/writer references retain
their original authority and remain permanently retired. Failed and replaced drafts retain tracked asynchronous
disposal, so shutdown joins them even when no current binding remains.

The shared fence counts each admitted nested child independently. An inherited continuation cannot enter after its
original owner has completed. Hindsight capture owns its whole multi-Bank lifetime: draining after its first Bank
cannot prematurely release the second Bank. Source drain covers raw/provider writes, observed writes, retention,
ingestion, flush/tidy, foreground capture/read/sync, manual/background scheduling and application/source/policy work.
The existing B4 privileged ingestion drain still works while quiesced but not retired. W4 drain failure never opens a
microtask gap in the source fence. Open read tools preserve their own immutable lifetime and result envelope, including
post-stop cancellation before a closed SQLite handle; they do not receive a generic write-fence DTO.

Both provider subsystem constructors refuse an unresolved source transition. Positive all-Bank abort proof and a
source-aborted W1 resolution permit fresh same-epoch source reconstruction. New scopes use exact unused-scope
quarantine/baseline-held evidence; existing reentry scopes restore the retired baseline. Native activation is separately
required for every target Hindsight Bank before binding or queued dispatch. Return-Local can remain usable while its
native retirement is pending/fenced, but the operation's final release still requires every positive native outcome.

### Durable queued callers and target outcomes

Actual canonical tools/coordinator calls attach original caller/Run/Attempt/Effect provenance and enter the typed
provider queue adapter. The adapter commits normalized commands before the distinct `MEMORY_TRANSITION_QUEUED` ACK.
Queue-full is the retryable `MEMORY_TRANSITION_QUEUE_FULL`; cutoff is nonretryable `MEMORY_TRANSITION_CUTOFF`.
Cancelled calls and unsupported Local retain strategy/updateMode or named-document semantics refuse before insertion.

`transition-intent-executor.ts` maps original scope/logical ID/CAS revision into the final candidate, compares the actual
current target revision and reserves a stable request before dispatch. Ordered revision conflicts do not overwrite
earlier results. Unavailable targets do not reserve execution. Target requests use fresh contexts; original Runs and
Effects remain provenance only. `transitions.queue()` and repository reads expose the same durable outcome to later
observers without retaining the initiating UI.

Recovery reads actual Local or Hindsight parent receipts first. An effect committed before a thrown/lost reply is
settled once. Unknown observations preserve the target request ID and invoke only existing target Pending/parent
recovery before another receipt lookup; they never authorize another raw provider call or new identity. Unknown work
blocks following sequence entries. A positive abort explicitly cancels undispatched queued callers.

Actual Hindsight completed parent results distinguish full retain/policy completion from pending state. `superseded`
becomes `MEMORY_REVISION_MISMATCH`, never completed mutation. Even a terminal error parent requires the original
Pending no-effect proof; one committed part in a cancelled result remains unknown.

Local no-effect evidence is narrower: the actual Local response must match provider, target epoch and reserved request;
no canonical receipt may exist; only audited synchronous Local preflight/CAS/rollback refusal codes qualify. Persisted
evidence contains a domain, execution hash, command hash and closed code, never raw responses. Transport exceptions,
generic internal/integrity errors and remote cancellation without zero-effect proof remain unknown. Actual provider
receipts always take precedence. Reopen/second observer and subsequent sequence execution are tested.

## W5 integration contract

| Seam | Required use |
| --- | --- |
| Final configuration | `configRevision` and `inventoryRevision` both mean actual `hindsight_connection_state.revision`; `configFingerprint` is its configured fingerprint. |
| Exact inventory | `canonicalPayloadHash(db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all())`; include every raw column, operation JSON and timestamp. Capture after verified setup, before admission. |
| Logical coverage | Every Character from Timeline, assigned primary groups, current canonical Banks and Character Blocks must have an admitted candidate scope. A late unknown Character invalidates publication independently of setup revision. |
| Source drain | Call `.transitions.quiesce({lease, now, timeoutMs})` on the live source. W1 owns admission open/close, cutoff and phase updates; quiesce does not manufacture those rows. |
| Final proof | W3 produces a complete final candidate. `.transitions.proof({lease, now, candidateId, assertConfiguration})`; persist with W1 `recordTransitionProof`, then move the actual attempt to `proven`. |
| COMMIT | `.transitions.publish(sameInput)` returns the exact receipt; immediately reread the current attempt/lease projection because receipt recording updates it. Lost replies query the same receipt. |
| Native finalization | Execute the existing W2 authenticated resolve outside SQLite, using that exact Core receipt/final native proof. Persist each actual response with `.nativeOutcome({lease, now, status})`. |
| Target binding | `.bind(transitionId)` verifies COMMIT and retires the source. Hindsight requires every activation outcome first. Constructor/start failure is binding-only recovery; repeat bind against the same receipt. |
| Queue | `.executeIntents(currentLease)` uses fresh target provider state; `.queue(transitionId)` returns original intent/outcome. Reconcile unknown through original target journals, never replay the source Run. |
| Final release | `.nativeRelease({lease, now})` verifies all admitted Banks. Feed it, actual binding readiness and queue truth into the existing W1 operation resolution; do not infer overall completion from Core COMMIT. |
| Pre-COMMIT abort | Resolve every native scope positively, persist outcomes, call `.abort({lease, now})` after cutoff, then `.resumeSource(operationId)`. The latter revalidates the source-aborted resolution/release and constructs a fresh source. |
| Shutdown | The existing runtime stop aborts transitions and joins producer, failed-draft and active executor settlement before DB close. |

New unused target scopes must have actual verified setup rows before the inventory is captured, even though admission's
old native ID/generation are NULL. W3 candidate `origin=new`, exact target Bank and unused-scope proof determine the
new native generation. A fabricated old native identity or a missing setup row is not a shortcut.

W5 still owns the complete healthy operator action, progress/cancel orchestration and real copied-corpus journey.
W6 owns emergency uncertainty; W7 owns Home. No partially implemented operator action is advertised by W4.

## Changed file groups

The complete per-file list and digests are in `w4-source-ownership.json`; major groups are:

- Shared publication/custody/disposition schema, distinct queue error policy and named package exports.
- Core migration054 and fresh/upgrade/reopen lineage tests; publication/proof/reader/representation repositories.
- Custody, native outcome/abort, exact pending refusal, Local target refusal and factual effect repositories/tests.
- Local raw/engine writers, scope creation, provider/Run provenance, selector/composition and both runtime bindings.
- Hindsight foreground/provider/Bank/scheduler work ownership, retired consumers, runtime readiness and shutdown.
- Typed transition provider/mapping/executor/runtime and real four-receipt, source-reboot and unused-scope fixtures/tests.
- Touched directory indexes, migration guidance and separate `memory-transition-publication.md`; both active context
  manifests now include it. Splitting the spec avoids the32KiB injection limit; validation has33 implement/34 check rows.

## Verification record

All Vitest commands used `--maxWorkers=2`; no overlapping Vitest groups exceeded that total. Native response envelopes
were deterministic test data except existing production producer logic executed inside Core. No external native/LLM
call, corpus transfer or manual acceptance was performed by W4.

| Command / session | Actual result |
| --- | --- |
| `pnpm --filter @taki/shared test -- --maxWorkers=2` /79321 | Exit0;64 files555 tests PASS. |
| `pnpm -r typecheck` /42497 then99077 | Both exit0 for Shared/Core/Desktop/CLI/E2E. |
| `pnpm --filter @taki/core typecheck` /97985 then34484 | Both exit0;34484 includes the final expiry regression and delivery source. |
| Broad Core group below /66949 | Exit1;74 files,457 PASS/2 FAIL. Both failures were repaired and rerun as described below; never reported as a clean aggregate. |
| Scoped runtime/publication/replica group /49647 | Exit1;7 files,75 PASS/4 FAIL. Both prior broad failures passed; four new tests incorrectly asserted the low-level Local repository factory was a boot selector. Corrected to the actual selector and prove zero constructor calls. |
| Final migrations + publication + native outcomes + queued executor /57519 | Exit0;36 files171 tests PASS, including corrected corruption joins and all054 INSERT OR REPLACE guards. |
| Final application replica + Hindsight runtime composition /96210 | Exit0;2 files55 tests PASS, including ordinary expired native baseline refusal and post-stop closed-DB safety. |
| Queue/actual native target effects/Pending source disposition /99955 | Exit0;3 files11 tests PASS, including original-ID unknown recovery, no-effect/partial cancellation and completed/superseded distinction. |
| Source runtime recovery + publication +041 migration /24519 | Exit0;3 files23 tests PASS. |
| New unused native scope /79044 | Exit0;1 file2 tests PASS, both real Core publish/readiness and abort release. |
| Actual Hindsight lifetime drain /40038 | Exit0;1 file2 tests PASS after complete capture ownership repair. |
| Root `pnpm lint` /21802 then8685 | Exit1; exactly5 cohesive line-count-only exceptions listed below, no other diagnostics. |
| `git diff --check` | Exit0. Git reports existing CRLF normalization notices in prior coordination documents; no diff errors. |
| `python .trellis/scripts/task.py validate .trellis/tasks/09-29-hindsight-transitions-emergency` | Exit0;33 implement/34 check entries, no missing paths or truncation warnings. |
| `python .../research/w4-source-audit.py` | Exit0;89 W4 paths,349 native paths unchanged, valid UTF-8/no BOM, production headers and touched indexes valid. |

Broad66949 command:

```powershell
$tests = @(
  'src/memory/transitions', 'src/db/migrations',
  'src/db/memory-transition-abort.test.ts', 'src/db/memory-transition-custody.test.ts',
  'src/db/memory-transition-effect-repo.test.ts', 'src/db/memory-transition-native-outcome.test.ts',
  'src/db/memory-transition-publication.test.ts', 'src/db/memory-transition-source-disposition.test.ts',
  'src/db/memory-transition-repo.test.ts', 'src/db/memory-transition-queue-repo.test.ts',
  'src/db/primary-memory-custody-repo.test.ts', 'src/db/hindsight-activation-custody.test.ts',
  'src/db/hindsight-application-replica-repo.test.ts', 'src/memory/runtime-selector.test.ts',
  'src/memory/runtime-composition.test.ts', 'src/memory/runtime-activation-failure.test.ts',
  'src/memory/local-runtime-binding.test.ts', 'src/memory/hindsight-runtime-binding.test.ts',
  'src/memory/hindsight-runtime-composition.test.ts', 'src/memory/canonical-local-write-fence.test.ts',
  'src/memory/canonical-local-runtime.test.ts', 'src/memory/memory-coordinator.test.ts',
  'src/memory/local-memory-provider.test.ts', 'src/memory/hindsight-activation',
  'src/memory/hindsight/hindsight-runtime-lifetime.test.ts', 'src/memory/hindsight/hindsight-runtime-bank-service.test.ts',
  'src/memory/hindsight/hindsight-replica-scheduler.test.ts', 'src/memory/hindsight/hindsight-writer-fence.test.ts',
  'src/memory/hindsight/hindsight-memory-writes.test.ts', 'src/memory/hindsight/hindsight-application-bundle.test.ts'
)
pnpm --filter @taki/core exec vitest run @tests --maxWorkers=2 --reporter=dot
```

Vitest selected74 existing files. Some explicit filter strings (for example `canonical-local-runtime.test.ts` and
`hindsight-application-bundle.test.ts`) name no standalone file; they did not create extra tests. Actual Local runtime
behavior is exercised by composition/transition tests; ordinary bundle publication is exercised by the replica tests.

Final57519 command:

```powershell
pnpm --filter @taki/core exec vitest run src/db/memory-transition-publication.test.ts src/db/memory-transition-native-outcome.test.ts src/memory/transitions/transition-intent-executor.test.ts src/db/migrations --maxWorkers=2 --reporter=dot
```

Final96210 command:

```powershell
pnpm --filter @taki/core exec vitest run src/db/hindsight-application-replica-repo.test.ts src/memory/hindsight-runtime-composition.test.ts --maxWorkers=2 --reporter=dot
```

### Repaired findings and raw failures

Earlier commands and exact raw failures remain in `w4-checkpoint.md`. Material corrections were:

- Real Timeline compaction removed witnesses through CASCADE; custody now joins completed producer spans.
- Started multi-Bank foreground capture released per-Bank ownership too early; complete capture now holds one owner.
- Reentry attempted the ordinary snapshot TTL path; retained installation now separately reconstructs immutable W2
  closure while the ordinary expiration refusal remains tested.
- Source reconstruction was possible while unresolved; both subsystem constructors now refuse until positive abort.
- Full Core regression found an outer generic write-fence DTO masking a stopped read consumer's contract. Open reads
  now reach their original lifetime guard, which refuses before closed SQLite access.
- The Source-candidate query now revalidates the selected body through W3 closure. Its old assertion demanded exactly
  one read of that body. The test now asserts the set of bodies is exactly the selected Source, preserving the real
  no-unrelated-body contract; no Source-query production behavior changed in W4.
- Queue capacity lost its typed retry policy; known Local refusal was incorrectly left unknown; native superseded
  parent was incorrectly completed. Distinct closed evidence now handles each without weakening unknown semantics.
- Added migration tail expectations initially failed only on expected54/new NULL marker shape; repaired.
- Temporary fixture UUID, stale lease, type-only mock, synthetic page identity and five-second test timeout errors
  were fixed. The four-transition started integration has a30-second bound and completes in ordinary test time.

Raw lint exceptions, allowed by the owner's cohesive-line-count amendment:

| Function | Actual / limit |
| --- | --- |
| `createHindsightRuntimeBinding` |55/50 |
| `composeMemoryRuntime` |51/50 |
| `selectMemoryRuntime` |55/50 |
| `createMemoryTransitionRuntime` |51/50 |
| Previous W3 `projectTransitionLocalBank` |51/50 |

No lint suppression was added. Parameter-count and unused-parameter errors from the initial lint were fixed; final
raw lint remains exit1 and must not be represented as green.

## Remaining acceptance boundaries

No known implementation gate is intentionally deferred from W4. Independent checker review is still required.
Tests use production Core constructors, started schedulers, actual SQLite COMMIT/reopen, real primary/Pending/parent
and application producers, but native transition responses are synthetic. This does not replace actual W5 native
maintenance/resolve or copied-corpus roundtrip evidence. No owner/manual criterion, original-environment replacement,
full headless Core process acceptance, emergency takeover or Home UI has been marked passed.

The intentional line-count exceptions and later-wave acceptance above are the remaining reported limitations.
