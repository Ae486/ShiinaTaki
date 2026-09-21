# Stage 2a Design: Durable Local Onboarding

Date: 2026-09-20. Status: reviewed and ready for implementation. Requirements: [prd.md](prd.md).
Grounding: [producer seams](research/stage2a-seams.md), [Home seams](research/stage2a-home.md),
[independent contract review](research/contract-review-2026-09-20.md), and the Stage 1 operation contract.

## 1. Selected design and scope

Extend the existing Core operation owner with `local.onboard.prepare` and `local.onboard.activate`. A focused
Local onboarding service coordinates the B2 producer and real runtime binding; it owns no timers or second ledger
of operation outcomes. Preparation and activation stay separate so source exceptions can be reviewed. Preparation
also supports explicit same-run resume and safe replacement of a stale preactivation candidate.

This slice includes necessary B2 correctness fixes, candidate isolation, exact primary-source custody and truthful
binding recovery. It does not implement Hindsight activation, generic provider switching, remote administration or
vector infrastructure. Existing Stage 1 setup/replica behavior is preserved. Original user data is not a test fixture.

## 2. Public contracts

Shared owns new `memory-local-onboarding-schema.ts` and additions to `memory-operation-schema.ts`.

### Durable commands through `memory.operations.submit`

- `{ kind: "local.onboard.prepare", source: { mode: "new", previewId, replaceRunId?: string } }` accepts exact preview
  bytes. `replaceRunId` is required to replace a discovered preactivation candidate and is checked against current state.
- `{ kind: "local.onboard.prepare", source: { mode: "resume", runId } }` resumes a preserved non-superseded run.
- `{ kind: "local.onboard.prepare", source: { mode: "retry", operationId } }` resolves an interrupted command whose
  reserved run was not published. Core obtains the reserved run/preview from that prior command, not the client.
- `{ kind: "local.onboard.activate", runId }` either freshly verifies/commits the prepared run or repairs the exact
  already-committed run's binding. It never commits the authority twice.

All use family `local-onboarding`. Core mints operation/run/transaction identities. `admit` is synchronous, cheap and
side-effect free; no filesystem snapshot or source conversion happens there. Persist the producer reference before
execution, defer claim to a macrotask, then CAS the still-admitted row to running. The Local execution interface uses
`tryClaim(): boolean`; a false result immediately exits without producer side effects. Do not reuse the current void
`running()` callback as claim proof. Pre-claim cancellation wins that CAS.

The local producer arm holds exact `runId`, accepted preview/snapshot identity when known, reserved activation
transaction identity when relevant, and bounded checkpoint progress. Progress is persisted independently of terminal
`result`; preserve the existing non-terminal-result-null invariant. Local results distinguish source-blocked preparation,
ready preparation, committed activation and committed-but-unavailable binding. Extend closed local error codes rather
than casting migration errors into replica errors. Extend settlement/observation to support `outcome_unknown` with
explicit reason and producer evidence; unknown commitment must not be collapsed into failed.

### Operator read/short-command group

Use `memory.onboarding.preview`, `memory.onboarding.status`, `memory.onboarding.exceptions`,
`memory.onboarding.exclude` and `memory.onboarding.subscribe` / `memory.onboarding.changed`.

- `preview({})` reads the effective Core workspace cooperatively and returns the B2 report identity/counts; it creates
  no run or authority. `status({})` discovers the selected/latest relevant run even if created by an older raw B2 RPC.
- Status returns selected authority, actual binding readiness/reason, exact run/progress/receipt summary, relevant
  operation and server-derived available actions. Missing/unknown state is explicit. No source bodies or arbitrary paths.
- `exceptions({runId,cursor?,limit?})` returns bounded source-relative diagnostics, using the existing limit of 100.
- `exclude({runId,sourceId,reason})` is a synchronous transaction under the same family/lease guard. Actor is supplied
  from authenticated MethodContext. Exact duplicate receipts are idempotent; changed audit identity conflicts. Exclude
  only unresolved sources without committed import effects; invalidate readiness and require re-verification.
- `subscribe({})` returns `{status:"ok"}` and is idempotent per physical authenticated connection. `changed` carries
  `{reason:"producer"|"exclusion"|"candidate"|"binding"}` as a strict invalidation signal, with no memory body or
  inferred success. Publish after durable producer
  checkpoints, exclusions, candidate changes and binding availability changes. Reuse the server's connection-scoped
  subscriber pattern; all methods are operator-only. This channel also updates another client's short-command view.

Use strict schemas, existing bounded IDs/timestamps and Shared exports. Reads have interactive deadline classification.
Production legacy stage/resume/activate/exclude and the old write-bearing verify RPC uniformly refuse with
`MEMORY_OPERATION_REQUIRED`; this intentional compatibility change directs callers to the durable API. Preserve only
dryRun/status/exceptions reads, constrained to the Core workspace and known run. Readiness writes are private to the
admitted producer. Keep synchronous internal test helpers only if they share invariants.

## 3. B2 producer correctness and candidate storage

Allocate one additive migration after live version 048 (verify registry again before editing); never edit 021/048.
Minimum durable additions: run/candidate metadata including supersession and workspace binding; run/source-scoped
Block plans; trusted primary group/member tables described below. Existing operation JSON columns hold local arms.

Publish snapshot bytes/manifest atomically before the DB run. Validate reusable snapshot files rather than trusting
an existing directory. The run and COMPLETE manifest inventory are inserted together before conversion. Resume
validates manifest bytes and fills/rejects historical incomplete inventories deterministically. Each source's canonical
import, result rows and success disposition commit in one transaction. Failure evidence is saved after rollback.

Use cooperative traversal/copy and source iteration; no await inside SQLite transactions. Renew leases using a live
clock and release in finally. A returned status with blockers is not successful readiness. The selected source/Bank
import identities and zero-result receipts remain deterministic and idempotent.

Verification proves manifest membership, raw snapshot hashes, exact source/result identities and the conversion's
canonical record/policy/receipt/Block-plan closure. It detects missing AND extra candidate effects. It must not merely
count whatever source rows survived. Completed historical runs remain completed; reading their receipt never rewrites
them to ready or compares legitimately changed active memory to a stale preparation image.

### Changed source / replacement candidate

Keep original files, old snapshots/runs/epochs and receipts. An explicit fresh preview plus replacement command creates
an isolated candidate; never append a new snapshot's effects into the prior candidate epoch.

One synchronous transaction verifies Legacy authority/current candidate, marks the old run superseded using durable
relationship metadata (existing status `failed` is sufficient), closes the old candidate epoch, creates/publishes the
new epoch/run/full inventory, moves the canonical internal active-epoch pointer and transfers unconsumed exact custody
and eligibility. The user-visible authority marker stays Legacy. Reject every mutation against a superseded run.
Use the existing allowed epoch reason/status vocabulary; do not mislabel this as a completed user authority switch.

Stage Blocks by run/source/scope. Activation publishes only the selected run's plans, with current revision/content
checks, in the marker/receipt transaction. Preserve independent Blocks; establish provenance for old raw-run imports
before adopting/replacing their projection. Historical unowned conflict gives an explicit integrity/repair refusal,
not automatic overwrite or deletion. Whole-candidate closure does not authorize clearing the shared Block table.

## 4. Exact primary-source custody

The independent review rejected composition-only callback buffering: Chat persistence precedes the callback, and
the existing witness repository requires one stable complete-group `committedThroughSeq`. Preserve that contract.

Introduce a small Core-owned primary persistence/custody module, wired through the trusted primary Chat path, with
group header plus exact members. Header fields include Core-generated group/producer identity, Character, optional
Harness Run association, creator boot, assigned candidate/Local epoch, lifecycle and finalized boundary. Members
store exact Timeline seq/id/content digest. Arbitrary Timeline writes and role labels cannot enroll a primary group.

- Establish a group before the first primary append. Every append and member registration share the SAME synchronous
  SQLite transaction; notifications occur only after commit. Group creation is active for new-version Legacy primary
  work too, so the first candidate can adopt an already appended in-flight user. Do not retroactively infer history.
- Candidate publication initializes/preserves per-Character eligibility and atomically assigns currently open trusted
  groups and exact members, including members below the baseline. New groups attach to the current prepared/committed
  Local epoch before their first append. Finalized pre-boundary Legacy groups are not retrospectively ingested.
- Append/member registration checks that the group is still open in the same transaction. Finalize a group once:
  validate its exact saved membership, fix max(seq), write the existing whole-group primary
  witnesses and finalized header together. The existing complete-group callback remains an idempotent notification;
  never register rowwise witnesses with different throughSeq and then replay them as a whole group.
- A terminal/dead zero-member group closes as `closed-empty`, with no max(seq) or witness write. A finalized Legacy
  group with no assigned epoch closes its header only, without calling the Local witness repository. Keep its exact
  members for the normal retention/evidence lifetime; finalized pre-boundary groups are not newly assigned later.
- Silent cancellation retracts the user/member/group atomically. Existing context-overflow retry reuses the same group
  without finalization. Terminal failure finalizes any retained exact user/partial reply, including user-only failures.
- A crash leaves durable open custody. Explicit prepare resume or binding recovery may finalize the exact committed
  prefix as interrupted only after proving the producer dead (different boot) or settled/terminal (Core-owned producer
  state or actual Harness status). An active producer returns RUNNING/waits. No model call or Run replay is involved.
  Membership corruption blocks recovery and cannot be hidden by resetting eligibility.
- Candidate replacement relocates assigned open AND finalized-but-unconsumed groups and their unconsumed
  witnesses/eligibility atomically. Preserve original assignment for audit and use current assignment for idempotent
  callbacks. If an old
  span/receipt proves consumption that cannot be safely moved, refuse replacement rather than duplicate ingestion.
- Normal active open groups with durable custody may coexist with a ready runtime. Flush must refuse retirement of
  their unfinalized members at/below its target, including baseline-before members and assistant-only gaps. Dead or
  settled open groups must reconcile before reporting recovery ready. Extend the existing source/flush checks;
  no second ingestion engine is added.

Keep Hindsight's existing primary callback behavior and authority ownership unchanged. The new Local custody branch
is an internal persistence seam; it is not a public tool or a provider switch. Exact source failures must remain
observable/durable rather than only logged and swallowed.

## 5. Activation, publication and recovery

Activation first reconciles eligible dead/settled primary custody, then takes the short admission fence, drains
admitted Legacy memory writes, re-proves live snapshot and full
candidate coverage, publishes selected Block plans and commits the marker/run/receipt atomically. The saved receipt
must join exactly on run, snapshot, epoch and activation transaction; mode alone is not proof. Pre-commit failure may
reopen Legacy only with positive Legacy marker evidence. Once committed, old tools/writes/maintenance remain retired.
The temporary new-capture gate releases on positively proven pre-commit Legacy rollback, or after a complete Local
binding is published. Committed-but-unavailable capture returns a structured unavailable refusal, not an indefinite wait.

Use one published runtime binding for engine, captureRun, maintenance, writeMemory and flush. Build a draft subsystem
without starting retention workers; install required components, publish the binding and then start its owned work.
On failure dispose the draft and keep an unavailable facade/failing flush. No scope.canonical side-channel may expose
a half-published engine. Separate construction from start as necessary; preserve successful ordinary boot behavior.

Same-epoch explicit recovery validates the exact committed receipt and always reconciles recoverable custody before
constructing a binding if unavailable. With a healthy same-epoch binding, only construction/start is a no-op; pending
source reconciliation still runs and status exposes that recovery action. A ready preparation also accepts explicit
prepare-resume for custody-only reconciliation without reopening/reconverting its verified migration. Recovery neither
creates an epoch nor calls activation
again. Core must boot with an observable unavailable Local binding when a valid selected Local runtime fails to
construct; compaction initializes with a failing flush and cannot crash merely by reading current().memoryFlush.
Corrupt marker/receipt state remains fail-closed; no Legacy fallback.

Expose a pure composition binding snapshot to both onboarding status and `memory.authority.status`. It checks the
selected epoch and published engine/flush/lifetime; it does not call captureRun or create Banks as a health probe.

## 6. Operation lifecycle and shutdown

Local handlers settle from exact producer evidence. Add a read-only per-kind boot observation before generic foreign
row reconciliation: proven prepared/committed outcomes can be reconstructed; incomplete/ambiguous work becomes
unknown with an explicit recovery action. No boot hook dispatches migration/model work, and setup/replica keep the
Stage 1 unknown fallback. Historical terminal command outcomes remain immutable even when later binding is repaired.

Cancellation is supported before claim only in S2a. A claimed command refuses RUNNING while cooperative IO leaves
status responsive. Stop new claims, settle/checkpoint active Local work, then retire runtime/DB; adapt shutdown order
without deadlocking the existing B5 scheduler. No frontend timer or automatic mutation replay is introduced.

## 7. Home integration

Add a focused Local onboarding card/controller/hook and a typed WS method group. Use existing Operations page
primitives. Subscribe before initial read; refetch on relevant push, reconnect, remount and visibility restoration.
Guard both client identity and generation, coalesce invalidations and serialize operator actions. No polling.

The card guides preview -> prepare -> source diagnostics/exclusion/resume -> explicit enable Local. It renders
producer counts, source-relative errors, pre-claim cancel and committed-but-unavailable binding recovery. Core-derived
actions are disabled while status is stale/disconnected or a mutation is pending. A timed-out mutation causes discovery,
not resubmission. Display accepted versus completed distinctly; technical receipt hashes belong in diagnostics.

## 8. Validation and rollback

The acceptance matrix in PRD and the two research reports is required. Use real temporary SQLite/files, real registered
operations/B2/runtime composition and deterministic substitutes only at model boundaries. Include full empty/legacy
journeys, mid-inventory/source crashes, supersession, snapshot/policy/Block corruption, same-run retry, cancellation
claim races, callback crash, silent retraction/user-only failure, candidate replacement during late finalization,
every bind publication failure, new-boot unknown recovery and actual Local scoped use/maintenance.

Changes are additive at rest. Before authority commit, preserve the Legacy runtime and immutable evidence; a code
rollback may leave additive tables. After commit, never roll back by editing markers or removing evidence. Recovery
uses the committed Local identity and a compatible build. No live-data migration, service or model operation is part
of this slice's automated verification. Record packaged/manual validation separately and never mark it passed by proxy.
