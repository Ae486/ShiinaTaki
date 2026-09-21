# Stage 2a Implementation Context Index

Date: 2026-09-20. This compact index is the injected research context. The complete
[producer research](stage2a-seams.md) exceeds the injection byte limit and must be opened by section when needed.
Read [design.md](../design.md) and [implement.md](../implement.md) in full; their selected contracts supersede tentative
alternatives and old observed behavior in the research. [Independent review](contract-review-2026-09-20.md) supplies
the source-backed corrections. [Home research](stage2a-home.md) is separate.

## Known producer defects to fix

- `legacy-migration-runner.ts` originally registered one source at a time. A crash could omit unvisited manifest entries
  and make verify falsely pass. Publish complete run inventory atomically and verify exact source/canonical closure.
- Source import and ledger completion originally committed separately. Enclose one source's effects/evidence together;
  retain deterministic existing import identities. Unsupported source exclusion is explicit and auditable.
- Verify rewrote completed runs ready; failed-run resume could not acquire its lease. Preserve terminal history and
  define explicit recoverable claims. Refresh time/lease per chunk and release in finally.
- Preparation used the active candidate epoch repeatedly and published Blocks globally. Isolate fresh replacement
  candidates, stage Blocks by run/source and publish selected plans atomically with activation. Preserve old artifacts;
  reject superseded run mutation and historical unowned Block conflicts. No cleanup of original files/history.

## Durable operation contract

- Reuse Stage 1's owner. Two local kinds: prepare (new/resume/retry absent producer), activate (fresh activation or
  exact committed recovery). Single family local-onboarding; Core-minted identities; no snapshot work in admission.
- Persist producer identity before effects. Yield to a macrotask, win an explicit boolean claim CAS or do no work.
  Cancel-before-claim only; running cancel refuses. Cooperation makes reads/events responsive without false cancel.
- Progress is persisted producer evidence, separate from terminal result. Add Local error/result/unknown arms rather
  than abusing replica codes. A read-only boot observation precedes generic foreign unknown reconciliation; no replay.
- Old production mutation RPCs uniformly refuse MEMORY_OPERATION_REQUIRED; retained old reads are workspace constrained.
  New operator preview/status/exceptions/exclude take no arbitrary filesystem root or actor override.
- Exact receipt joins run/snapshot/epoch/transaction. A failed response is not rollback proof. Known committed repair
  never repeats activation. An interrupted pre-run command can explicitly retry its Core-reserved producer identity.

## Source and binding correctness

- Primary Chat persistence gets a Core-generated trusted group/member boundary. Timeline append and exact member
  registration commit together; complete-group witness finalization and silent retraction are atomic. Do not feed
  existing witness API one row at a time with changing committedThroughSeq.
- New Legacy groups are tracked before first candidate creation. Candidate creation adopts open groups; replacement
  moves both open and finalized-unconsumed group assignment, exact unconsumed witnesses and preserved eligibility.
- Empty dead/terminal groups close without witness; unassigned Legacy terminal groups close header only. Retained
  user-only terminal failures finalize; retry keeps group open. Late append requires open state in the transaction.
- Explicit recovery proves old boot dead or producer terminal before finalizing exact saved prefix; no model/Run replay
  and no role/range provenance inference. Healthy binding and ready run still expose source reconciliation.
- Active trusted groups may coexist with ready runtime, but retirement checks exact unresolved members at its target,
  including baseline-before and assistant-only cases. Corrupt evidence remains an actionable integrity failure.
- One published binding controls engine/capture/write/maintenance/flush. Draft Local construction starts no worker;
  publish only after components succeed; dispose failed draft. Preserve unavailable facade/failing flush on boot or
  rebind failure. Recover same epoch without old Legacy revival; healthy construction/start is a no-op.
- New-capture gate releases on proven Legacy pre-commit rollback or full Local readiness. Unavailable is a refusal,
  never indefinite wait. Shutdown settles producer work before closing its runtime/DB dependencies.

## Proof, not proxies

Use real temporary SQLite/files and registered methods through actual B2/runtime, with model-boundary substitutes.
Cover complete manifest, source atomicity, supersession, Block provenance, trusted-group append/finalize/retract/crash,
pre/post-commit failures, every binding accessor, unknown/restart and real Local retain/recall/maintenance. UI tests
cover both subscriptions, generation/visibility guards and no write replay. Shared/Core/Desktop gates plus isolated
real Core boot are required; no original data, live model/provider or manual acceptance is implied.
