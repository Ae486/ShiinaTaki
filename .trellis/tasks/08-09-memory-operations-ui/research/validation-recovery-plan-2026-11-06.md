# Memory validation and recovery boundary correction

## Objective and authorization

On 2026-11-06 the owner resumed planning, implementation and verification after reviewing the integration's
overlapping validation and weak practical recovery. Keep the existing task and data model. Replace the incorrect
control boundaries rather than retaining every existing guard and adding more artifact caches.

The deliverable is usable existing-instance Local/Hindsight memory, including recovery after an interrupted
operation. The initial increment used generated persisted fixtures and controlled models. The later 2026-11-06
continuation additionally authorizes bounded real-model verification using `H:/TakiAgent-worktrees/t4/.env.local`
and read-only real-conversation sampling into isolated test data. All task work remains in `H:/TakiAgent`.
No original database mutation, commit/push/archive or unrelated deployment is authorized. Use actual
Core/Native/PG/WS/Home, one heavy runner, and G: temporary data.

## Evidence and baseline

- Main checkout: `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`, with inherited uncommitted work preserved.
- Latest replay: `G:/taki-post-reentry-KJ9FvO/replay-result.json`; admission 19,266ms, Run 172,019ms,
  partial empty recall, Core forced to exit. Native recall was never reached. Original 1,690 source files unchanged.
- Full connection validation occupied 93.4% of samples. Request guards repeated the same full check; complete
  historical candidate/capture reconstruction remained on ordinary read, sync and command paths.
- A post-writer lease guard can mask an already returned pending/refused result. The saved trace proves lease loss,
  but does not distinguish expiry from release/replacement at that exact moment.
- Git `fe0e5f6` added full authority reconstruction to every connection guard on 2026-10-18. The repeated request
  and lease structure existed in `588e13e`. This is provenance evidence, not a completed first-bad-commit bisect.

## Contracts to preserve

- One selected authority; exact epoch/provider/lineage, Bank/Character identity and generation; no implicit fallback
  to another authority. Old runtime references remain retired.
- Current configuration/secret/template access, cancellation, exact lease/fence, expected revision and checkpoint
  remain checked at their actual operation/publication boundaries.
- Every consumed body/head/artifact retains its existing identity, hash, version, policy and scope validation.
- COMMIT, construction/binding and verified recovery use full historical proofs. Existing receipt/document bytes,
  schemas, migrations, idempotency identities and supported data fields are preserved.
- Unknown remote outcomes remain unknown until the original receipt resolves them. No blind replay/new request ID,
  expired-token revival, empty-result success, enlarged deadline, or discarded background work.

## A. Separate current authority from historical proof

- Introduce a clearly named current selection identity reader/assertion, distinct from
  `readMemoryAuthoritySelection`'s complete proof reconstruction. Reuse the existing marker/epoch/receipt identities.
- Bind a Hindsight runtime only after complete validation. Ordinary guards reread current identity and retain
  connection/template/data checks; they do not reconstruct historical captures or cache a permission verdict.
- Remove the runtime-only publication artifact verifier when it is no longer needed. Retain independent full-proof
  readers and any still-required status/transition observation implementation until their callers are migrated.
- Review B2, B4, repeated transition and private template-execution constructors explicitly.
- Historical-only corruption is detected at full-validation boundaries rather than on every unrelated read.
  Corruption in current consumed data remains an immediate failure. Known invalid selected authority stays unavailable.

Acceptance: actual completed-REENTRY ordinary guards have no candidate/history reconstruction; current marker,
epoch, lineage, configuration, template, Bank and consumed-data changes still refuse as specified. New construction,
binding, publication and recovery still reject bad full proof. No persistent/global cache or schema migration.

## B. Give each execution boundary one responsibility

- The existing foreground owner manages cancellation and exact lease assertion/renewal; its sole request caller
  already validates current authority in the publication guard. Remove that duplicate connection check.
- Command `assertActive` uses its existing guarded Bank-scope read once, then its original checkpoint/namespace and
  command-identity checks. Preserve the work fence and final write-transaction checks.
- Process pending/refused writer outcomes before running guards needed only to continue successful work.
  Preserve the original result; successful continuation must still refuse stale/cancelled/foreign ownership.
- Use existing scheduler catch-up and command receipt recovery. Do not add a second scheduler or recovery engine.

Acceptance: slow/pending/refused writes retain their actual error and durable identity; old leases never publish or
renew after expiry/replacement; a fresh attempt resumes the original command and applies once. Existing whole-command
and per-request deadlines retain their meanings. A successful response followed by cancellation cannot publish late.

## C. Keep diagnosis reachable when memory is unavailable

- Separate discovering current control records and explaining a failure from proving that memory data can be served.
- Full-proof or constructor failure must not manufacture a Local/Legacy fallback or a healthy runtime.
- Reuse the existing unavailable binding/status and recovery surfaces where possible. Extend a protocol only for a
  concrete missing diagnostic state; show unknown identity as unknown, never infer a provider from corrupt fields.
- Distinguish intact-evidence interrupted binding (same receipt/epoch recovery), rebuildable replica state, unknown
  remote write outcome, and damaged authority/history requiring a verified backup. Do not promise generic online repair.

Acceptance: damaged memory proof leaves the control/diagnostic path accessible, identifies the failed boundary and
supported recovery route, and prevents unsafe data operations. Intact-evidence bind interruption recovers the same
epoch and ordinary retain/recall succeeds. Restore validation cannot require the damaged source to become healthy first.

## D. Verify the usable path and remove superseded complexity

1. Focused regression failures before each correction; tests assert the intended result/error and successful recovery.
   Corruption fixtures use wrapper transactions, preserve SQL shape constraints, and never count setup failures as proof.
2. Independent source review, relevant Core/Shared/Desktop tests as affected, typecheck, lint and source/spec consistency.
3. Fresh copy of `G:/taki-first-use-9LeODa`: exact copper-compass recall once, correct authority, nonpartial result,
   responsive Run status and normal Core/Native shutdown; original source hashes unchanged.
4. Complete the existing connected journey through backup, healthy return/reentry, offline emergency takeover,
   restart/Local recall and isolated paired restore. Keep original deadlines and error assertions.
5. Fault/recovery cases: provider interruption, lost ACK plus new lease/restart, committed-but-unbound target,
   cursor reset versus actual rollback, and unavailable diagnostic state. Require eventual ordinary use and no duplicates.

The need to finish an entire Bank catch-up before each Native recall remains a separate question. Reuse exact
candidate hydration if a proven remaining blocker requires that change; do not silently remove policy preparation or
restore an old short business timeout. The owner explicitly accepted ordinary recall waiting for completion/cancellation.

Remove obsolete runtime-only machinery and stale contracts as their responsibility is replaced; preserve unrelated
changes. Existing passing counts are scoped evidence, not a fresh full-suite pass or manual acceptance. Original-data
activation, real-model quality, Tauri owner observations and D94-D96 managed deployment remain separately tracked.

## Execution state

- [x] Reconfirm workspace, active session task, preserved baseline and latest authorization.
- [x] Record the corrected responsibility/recovery plan and preserved contracts.
- [x] Independently challenge exact current-authority and diagnostic boundary APIs.
- [x] Implement A and B; run focused checks and independent source review (integrated typecheck follows C).
- [x] Implement C and Local current identity, verify concrete owner/diagnostic/recovery gaps and independently review the integrated boundaries.
- [x] Pass fresh-copy diagnostic boot and normal recall replay.
- [x] Pass the complete connected journey with actual services and controlled models.
- [x] Record actual results, remaining limitations and removed superseded machinery.
- [ ] Complete the newly requested bounded real-model and real-conversation verification.

A evidence: `G:/taki-current-authority-checks/`, four files / 23 passing cases, affected ESLint and whitespace check.
B evidence: `G:/taki-execution-boundary-checks/`, corrected red five failures, green six files / 67 cases,
Core typecheck and affected ESLint. Counts overlap prior suites and must not be added as a unique total.
Independent A/B source review found no defect; it explicitly requires C before accepting live known-invalid behavior.
Current diagnostic and ordinary recall replays pass; journey 16's backup failure and journey 17's completed
recovery are recorded below. Neither is a real-model quality acceptance result.

Integrated source review found and resolved incomplete Local current-identity checks, early checkpoint/template
observation losing the published template identity, error-code-dependent proof withdrawal, and invalid committed
targets that were not yet bound. The full-proof owner now handles failures by validation scope and preserves the
original error. A further queue regression proved that authority drift during capability resolution could still
enqueue work; the shared Local/Hindsight queue now checks immediately before that durable side effect.

All obsolete cross-read observation machinery was removed: the observed-selection reader, publication read verifier,
observation store and observation-context mode. Pure byte/freezing/projection helpers remain in
`transition-evidence-artifacts.ts`; independent synchronous proof contexts and their integrity/lifetime tests remain.
The former observation tests were converted to complete independent publication validation, keeping corruption,
current joins, legal Local edits and custody evolution coverage.

Current check evidence: C `G:/taki-authority-recovery-checks/c-owner-review-regression.log` (5 files / 51 passing);
Local `G:/taki-local-authority-checks/green-2.log` (2 files / 28 passing), with earlier ingestion/write-fence/binding
checks passing in `green.log`; shared queue/current status `queue-status-green.log` (3 files / 26 passing).
Counts overlap and are not additive. Queue red is `queue-red.log`, Local red is `red.log`; initial Local transition
test failures were expired fixture snapshots and were corrected by using the existing W3 fixture clock.
Core integrated typecheck and affected 81-file ESLint passed under `G:/taki-authority-integrated-checks/`.
The final Shared/UI tests and copied-instance/recovery journeys are separate gates; their completed results
are recorded below rather than inferred from the Core checks.

Real copy acceptance now passes: `G:/taki-post-reentry-BDMtS8/diagnostic-result.json` preserves diagnosis and rejects
chat with exact `MEMORY_AUTHORITY_INVALID`, zero model calls; `G:/taki-post-reentry-s6SfCS/replay-result.json`
returns the exact retained copper-compass fact once, `partial:false`, correct Hindsight epoch, normal shutdown.
Normal admission is 8,773ms and complete request 64,246ms; first recall is still slow. Native recall was actually
reached (four HTTP 200 recall requests). Both runs retain all 1,690 original fixture hashes and clear owned resources.
Final Core test helpers (16 cases), Shared schema (4) and Desktop state/cards (32) pass in the integrated check folder.
Journey 16 log: `G:/taki-hindsight-first-use-20261104-checks/connected-journey-16.log`.

Journey 16 reached and passed step 13; step 14 refused backup quiescence after 30 seconds while an admitted writer
was still active. No Core copy/native backup was attempted for that failed request. All services stopped normally;
steps 15-17 were not run in that attempt. The combined detached-autoMemory/write-fence/public-backup regression passes
(21 service cases), including no failed artifact and successful retry after the original owner settles. The real
`--with-backup` probe records admitted owner stacks at quiescence and retries only after observing actual drain;
original production budgets and failure outcomes are unchanged.

Journey 17 subsequently passed every scenario (17 numbered steps plus settings, 6b and pending) in
`first-use-runtime/results/2026-11-05T18-51-25.420Z/result.json`. It completed healthy Local return/re-entry,
post-re-entry recall, a new verified pair, offline emergency takeover, Local restart/recall and isolated paired
restore. The restore compared all 61 Native tables and performed authenticated pre-writer Core verification;
it did not start restored Core writers or activate an owner database. All three Core lifetimes and Native
stopped without force; PG was stopped/removed and no owned processes or listeners remained.

On continuation, all 204 extant Taki changed-source hashes and 97 Native hashes matched current files. Three
Taki paths were correctly absent with recorded `sha256: null`, matching the removed observation machinery.
The existing model fixture made 40 requests; this is controlled-model service/recovery evidence. The 64-second
copied-instance recall and substantial transition durations remain visible performance limits. Real-model
connectivity and subsequent conversation validation are separate evidence in the usable-delivery report.
