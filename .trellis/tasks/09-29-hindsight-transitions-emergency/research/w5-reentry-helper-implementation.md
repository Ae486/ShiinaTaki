# W5 reentry helper implementation

## Outcome and scope

Task-owned reentry harness repair is delivered for independent checking. Final focused
verification passes: 10 Node tests, 5 Python tests, and 13 quality/source-preservation
checks. No real SQLite/PG pair, HTTP service, credentials or model was opened by this
worker. There is no new W5 real acceptance or authority change in this delivery.

The parent owns the stopped real pair. Its accepted RETURN operation is
`ce841c61-d207-4f51-b1fd-51cd42ed9d9e`, transition
`df47f32c-48a8-47bc-9792-2e24e8642084`, receipt
`e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469`,
Local epoch `afb2053e-8bcd-4322-8573-0a447d560bb8`, submitted count 301.
These are parent-provided anchors; this worker did not re-open the real data to audit them.
The driver verifies the exact completed operation, typed receipt, independently verified
candidate/publication, common baseline and Bank/generation/lineage before Local mutations.

No production Core/Native source, dependency, credential, lease, heartbeat, timeout or
poll interval changed. The combined gate's 39 production entries still match its immutable
manifest. The root ESLint configuration already excludes `.trellis/**`; no lint exclusion
or size threshold was added here. Cohesive task functions remain together under the
owner's responsibility-based size policy. No Git/lifecycle/manual-acceptance action occurred.

## Changed and retained files

| Path under `research/` | Responsibility |
| --- | --- |
| `w5-reused-driver.mjs` | Exact completed RETURN anchor, persisted Local plan, request recovery, truthful staged result, stronger real final assertions. |
| `w5-reused-native.py` | Explicit cumulative cap; guard installed before engine initialization; stable-Bank forecast; task gate; verified staged shutdown. |
| `w5-journey-checkpoint.mjs` | Versioned hash-checked atomic current checkpoint, immutable prior checkpoints and byte-identical legacy result retention. |
| `w5-reentry-journey.mjs` | Existing Core producer/receipt joins, exact Local reconciliation, submitted request lookup, refreshed lease wait, baseline identity assertions. |
| `w5_reentry_gate.py` | Native pre-execution admission, sanitized exact-plan review, per-Bank bounded reservations and durable staged-pause audit. |
| `w5-reentry-plan.py` | Successor exact Bank AND transition plan inspection, separate missing-plan forecast, current cumulative count. |
| `w5-reentry-journey.test.mjs` | Fresh synthetic SQLite and actual Core producer restart/sequence tests. |
| `w5-reentry-gate-test.py` | Actual Native prepare/verify control flow with synthetic storage, budget/latch and supervisor startup gate tests. |

`w5-remaining-plan.py` is intentionally retained byte-for-byte as historical evidence.
It is unsuitable for new reentry; use `w5-reentry-plan.py`. No old manifest/result/log was
regenerated. Original helper preimages and hashes are in
`w5-reentry-helper-preimages-20261004/manifest.json` (all 3 digests rechecked).
New immutable delivery inventory: `w5-reentry-helper-source-manifest.json`.

## Persistence and recovery

The supervisor preserves normal attempts as before. The first checkpoint migration also
retains the original `driver-result.json` bytes under `journey-checkpoint-history/`.
`journey-checkpoint.json` is a version 1 envelope with sequence, exact UTF-8 payload JSON
and SHA256. Each write flushes a same-directory unique temporary file and atomically
replaces the current name; every complete checkpoint is retained by sequence/hash.
The driver reads the checkpoint before opening SQLite; the supervisor validates an
existing envelope before starting its owned services. Truncated, hash-mismatched or
unsupported data fails closed. Retained history is for verified operator recovery, not
an automatic fallback to a possibly stale effect plan.

The full Local policy and Block requests are saved before either mutation. Policy replay
uses `w5-real-policy-change` with its original scope/revision/patch and the actual canonical
receipt/snapshot. Current durable policy is read back and compared to that receipt.
Block replay accepts only its original revision/content hash or the exact intended next
revision/content hash; another edit conflicts. No bumped revision retry or duplicate suffix.
Both durable effects are read back before `localChanges` is recorded. Restarts compare the
saved mutation plan to the original independently verified RETURN candidate.

Every new operation preview/request is persisted before submission. Recovery searches the
exact original/recovery producer request and matching `memory_operations` row, requires
uniqueness, and compares the full request/producer identity. Unknown operations with an
actual attempt use the normal new explicit recovery request for the same transition.
Every prior request/operation remains retained. Lease waits re-read the current attempt
after each unchanged one-second wait; a renewal/replacement cannot be hidden by a cached lease.

**Narrow unsupported restart state:** admission committed but process stopped before first
claim. The operation can be recovered by exact identity and truthfully becomes unknown,
but production recovery requires an existing transition attempt. The helper fails closed
with the production stale refusal; it cannot manufacture an attempt, reopen an immutable
operation or start a replacement transition. A dedicated synthetic test reproduces this
state (one original intent, zero attempts/acquisitions). The parent explicitly accepted
documenting this boundary rather than expanding this repair into production.
An unadmitted saved request whose preview has expired likewise refuses through ordinary
preview validation; there is no silent request rewrite. File loss/corruption requires
reviewed retained evidence, not a fresh journey.

## Native staged maintenance and budget

The task-only wrapper covers `TransitionMaintenanceService._execute_attempt` for the
owned engine. Actual `_prepare_transition` executes unchanged first. The wrapper reads
steps by exact Bank/verification, records real candidate/required-set/policy/request/delta
hashes, actual attempt/fence, remaining finite requirement counts and safe estimate metadata.
It never writes a certificate, completes a step or returns synthetic success. Unapproved
execution raises the existing `operation_refused` error; the unchanged Native handler
records `incomplete` and drains its heartbeat. Core retains `outcome_unknown` and its
original transition/preparations/fences. The gate is also installed before engine
initialization; model requests outside an explicitly allowed maintenance context refuse.
Initial no-approval staging disables model network admission as an additional boundary.

The first staged run allows no Bank and no new model requests. Core keeps its ordinary
sequence: delta(A), verify(A), evidence(A), delta(B), verify(B). Thus the first pause has
only A's actual post-delta plan, while `run-plan.json` has stable-Bank, clearly labeled
pre-delta forecasts. After A-only approval, recovery completes A and pauses on B's actual
plan. The next recovery reuses A's real completed proof and steps.

An approval JSON has `version: 1`, exact new `transitionId`, `returnReceiptId`, an integer
`cumulativeCap` matching `--submission-cap`, and a `banks` array. Each allowed entry must
contain exact `bankId`, `transitionId`, `providerLineage`, `bankGeneration`, `candidateHash`,
`requiredSetHash`, `policyHash`, `requestHash`, `deltaResultHash`, plus a finite positive
integer `maxSubmissions`. Missing Bank means deny; mismatched identity is an unexpected
failure, not an approved pause. No timestamp, old plan or ordinal grants permission.

The unchanged `w5-model-budget.py` preserves cumulative `model-submissions.json` and the
first-402 latch. Reentry refuses missing or regressed (<301) original accounting. After new
submissions, missing per-Bank history also refuses. `reentry-bank-submissions.json` records
conservative per-plan reservations before the existing global counter/network dispatch;
a crash in that small interval may consume a reservation without a global submission.
This prevents free retries and is not represented as a billing ledger. Parent-approved
allowances remain cumulative for the same exact plan across restarts. Tokens/cost and
retry/reflect headroom are not invented; base estimates are explicitly not upper bounds.

Expected staged driver exit is 2. After normal owned shutdown, the supervisor re-reads the
exact Native row and requires `incomplete`, matching attempt/fence/candidate/requirements,
the matching Core checkpoint's unknown operation, and zero additional submissions after
the pause snapshot. It reports `stagedPause.outcome = "staged_pause"` and supervisor exit 0.
That exit means successful staging only: `completed` remains false and Core remains unknown.
An unrelated failure, cleanup failure or mismatched pause fails the supervisor.

## Parent CLI sequence after independent review

Run only on the exclusively owned stopped pair using existing custody. These commands
were **not** executed by this worker; only their `--help` parsing was checked.

```powershell
# Stage A: existing ceiling is retained, but the omitted approval denies ALL new models.
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reused-native.py run --stage reentry --submission-cap 329
```

Read `run-result.json`, its `stagedPause.reviewFile`, the corresponding
`reentry-plan-<attempt>-<id>.json`, and `run-plan.json` (B forecast). Re-audit actual stopped
Core/Native identities and count 301 before treating the zero-model staging gate as passed.
Review the complete finite A plan, B forecast and headroom before setting a new finite cap.

To create the exact A approval after that review, use the actual snapshot values;
`$reviewedCap` and `$reviewedBankA` below must already be explicitly chosen integers.

```powershell
$review = Get-Content -Raw -LiteralPath '<owned-root>/<actual-A-review-file>.json' | ConvertFrom-Json
$bank = @{ maxSubmissions = $reviewedBankA }
foreach ($field in @('bankId','transitionId','providerLineage','bankGeneration','candidateHash','requiredSetHash','policyHash','requestHash','deltaResultHash')) {
    $bank[$field] = $review.$field
}
$approval = @{ version = 1; transitionId = $review.transitionId; returnReceiptId = $review.returnReceiptId; cumulativeCap = $reviewedCap; banks = @($bank) }
$approval | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM -LiteralPath '<new-reviewed-A-approval>.json'
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reused-native.py run --stage reentry --submission-cap $reviewedCap --maintenance-approval '<new-reviewed-A-approval>.json'
```

This should finish A and stop at B. Review B's new actual snapshot, retain A's original
allowance/history, and create a separately named approval with exact B added. Invoke the
same reentry command again using the reviewed cumulative cap and new approval path.
Do not delete checkpoints, reset counts/latches, reuse old RETURN planning totals or
shorten leases to accelerate this sequence.

For stopped-pair read-only Native plan inspection (starts PG only, never the engine):

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-plan.py --transition-id '<new-reentry-transition-id>' --submission-cap $reviewedCap --forecast '<owned-root>/run-plan.json'
```

Final assertions preserve every original document mapping/native/application identity
and body hash, 722 Sources/two scopes, exact original Bank/generation/lineage/baseline,
zero document/memory-unit delta rows, validated delta receipts, actual changed policy
version/importance, intended Block revision/content hash, and original invalidated unit
identities/state and unchanged raw content. Legitimate maintenance-derived observations,
models and graph changes are permitted. Actual native proof/closure remains production-owned.

## Verification and evidence

All checks ran sequentially; Node test concurrency is 1 and no Vitest workers were started.
The existing complete 166-test/type/lint gate was not repeated.

| Command/check | Final result | Evidence |
| --- | --- | --- |
| `node --test --test-concurrency=1 .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-journey.test.mjs` | 10/10 pass; 6.88 s | `w5-reentry-helper-node-final.log` |
| `H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-gate-test.py` | 5/5 pass; 11.74 s | `w5-reentry-helper-native-final.log` |
| `node --check` on all 4 delivery MJS files; `ast.parse` on all 4 Python files | pass | `w5-reentry-helper-quality-final.json` |
| Ruff check and format --check on the 3 new Python files; Ruff `--select F,E9` on existing supervisor | pass | quality JSON has exact command arrays/output |
| Both supervisor and successor inspector `--help` | pass | quality JSON |
| UTF-8/no-BOM/trailing-space audit, all 8 scripts | pass | quality JSON |
| Immutable 3 preimage hashes and 39 combined-gate production source hashes | unchanged | quality JSON |

Initial Node run had 7/8 pass: the existing fixture's fixed-date snapshot had expired
under wall time. The test now uses its existing 2026-10-01 synthetic Date clock; production
TTLs remain unchanged. Initial Python test had 3/4 pass due to a too-broad sanitizer test
token matching the synthetic operation ID; the assertion now checks the actual private
tag marker. The first startup test passed but an imported LiteLLM metadata lookup tried
to use the substituted socket and fell back locally; final tests explicitly use its local
cost map, with no metadata request or model dispatch. New-file unused imports/formatting
were corrected before final checks. Final logs above contain no failed test.

Python tests exercise real Native `_prepare_transition`/`verify_transition` control flow
over an existing synthetic incomplete run with storage/lease adapters substituted. They
cover refusal before execution, durable incomplete update, same-transition continuation,
completed first-Bank fast path, B denial, exact plan selection, cumulative/per-Bank budget,
first-402 response identity and persistent latch, and guard-before-initialize/default
network-deny. They do **not** certify real PG full-candidate enumeration or real model
execution. Node tests exercise real SQLite/Core producers with synthetic Native transport;
neither suite is a substitute for the parent's staged real acceptance.

Independent checking remains required before any real startup. W5 real reentry, W6-W8,
manual/original-environment acceptance and overall closure remain incomplete.
