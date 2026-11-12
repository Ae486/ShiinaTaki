# Controlled Journey Memory Tool Projection Repair

Date: 2026-11-12. Workspace: `G:/TakiAgent-integration`, branch
`integration/main-t4-20261111`. Test-harness changes only; the parent owns full-stack
reruns, resource observations, and final acceptance.

## Reproduced failure

The journey recorded under
`first-use-runtime/results/2026-11-12T09-21-17.541Z/result.json` passed steps 1-4 and
stopped at step 5, after the real Hindsight retain invocation completed. Its retained
isolated database is `G:/taki-first-use-Btl1vA/core-data/taki.db`; the parent confirmed
teardown and unchanged source before this repair began.

The harness parsed the persisted model-facing result with
`HindsightMemoryRetainEnvelopeV1Schema`. The accepted production projection in
`packages/core/src/memory/canonical-tools/memory-tool-model-output.ts` deliberately
returns `{ ok, scope, status, memories }` for retain and flattened `hits` for recall.
Internal request/provider/epoch/capability fields remain runtime evidence, not model
content. Its colocated tests explicitly assert this separation. Local and Hindsight
persisted projections both reproduce the old parser's failure.

Three hypotheses were checked in order: stale full-envelope expectation, wrong
tool-result association, and a failed real write. The first is confirmed. For the
failed Hindsight scenario, saved evidence proves:

- Run `9509623f-5388-41c8-8a8f-f151fd619525`, Attempt
  `93a4d0ea-cc1f-4c40-a5cc-c3936c2e8a5a`, exact `call_5` started/settled invocation.
- Settled Memory Effect and original request
  `760a6eb7-2e39-4589-9ed0-bda49d7a3faa` belong to that Run/Attempt.
- The Effect source/executor references agree with the primary Source and admitted Run
  snapshot: Hindsight provider, epoch `1f33f456-8a53-4eae-9e6c-bdb1a738283f`, and lineage
  `1ab42385-2a70-4b0f-9b11-9804868e69f5`.
- Exactly one independently decoded/hash-checked parent remains `pending`, with one
  original Native child in `submitted`, no parent terminal result, and its preserved
  document ID. The original parent input matches the admitted Effect input digest.

An Effect completing means the tool returned its accepted Pending response; it does not
mean Native memory processing completed. The stopped fixture proves durable acceptance,
not the later automatic-settlement gate.

## Implemented correction

The small test-only `first-use-runtime/memory-tool-evidence.mjs` reads the exact Run's
`primary_conversation_sources` membership and Timeline call/result pair, then matches
started/settled invocation IDs and their Effect. It validates the actual Source/Executor
schemas and captured Run memory, including the scenario's expected provider and epoch.
It returns the unmodified compact `modelView` separately from factual `memoryEffect`
identity. It never synthesizes a full envelope from current mutable authority state.

`native-smoke.mjs` uses this helper in `retainedChat` and `memoryChat`. Retain checks read
`status` directly. Recall checks read flattened `text`, `policy`, and `scope`, keep the
original Local observed-text fence, and require the exact expected Global fact once,
confirmed, with no partial or failed branch. `memoryChat` additionally compares the
provider-observed projection with the exact persisted result.

`retainedWrite` and `pending-write-evidence.mjs` now query through the independently
verified Effect request ID. The shared reader preserves production parent decoding and
hash checks, exact parent/child cardinality, schema checks, lineage/generation, immutable
input equality, and the original Effect input digest. The captured initial document ID
comes from the durable Native child. Existing completed-write Source/fact uniqueness,
every returned memory, document identity, restart immutability, Native evidence, and
automatic-settlement assertions remain in place.

The new helper is included in the journey's `harnessBaseline()` inventory. No production
file, migration, original receipt, model configuration, or provider behavior changed.

## Offline verification

```powershell
node .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/memory-tool-replay.mjs G:/taki-first-use-Btl1vA/core-data/taki.db
```

Node `v24.18.0`; 19 checks passed in 1.51 seconds. The replay reads only the stopped
database. Both actual retain projections pass; wrong Run, epoch, provider, request ID,
lineage, input digest, and SDK error output refuse. Restart evidence reads the same
original parent/child. Recall regression uses an actual imported record through the
production model projection and verifies Local observed fencing, exact scope/text,
partial/failed branches, duplicate facts, and unconfirmed facts.

Database SHA-256 before and after:
`b063f5e638532af26ae5e3fc5059cd618950c95b0abb883dbf98e63b8fd2ef4b`.
All four changed/new JavaScript harness files pass `node --check`; tracked diffs pass
`git diff --check`. The [structured replay receipt](memory-tool-replay-20261112.json)
records commands, checks, timing, source identity, and limits.

Code was frozen after these checks and handed back to the parent for the full rerun;
only this note and the task-owned receipt were written afterward.

## Remaining boundaries

This replay does not run Core, Hindsight, PostgreSQL, live recall, automatic Pending
settlement, or the later transition journey. Those remain the parent's full controlled
run. The original failed run and source database remain unchanged.

Two separate harnesses still contain the older full-envelope model-output assumption:
`first-use-runtime/real-model-memory.mjs` and `first-use-runtime/post-reentry-replay.mjs`.
Neither is imported or executed by this controlled journey. Repair and verify them before
their own future suites; they are not covered or accepted by this change.
