# D1 retained slices and deferred execution

## Current owner direction (2026-10-28)

Plan update only. Follow the [parent execution plan](../08-09-memory-operations-ui/implement.md).
D95 defers new D1/C4/D2 development until a concrete upgrade need or the dedicated lifecycle increment
after first-use stabilization. D1 no longer runs ahead of or blocks existing-instance acceptance.

Preserve D1-A/B source, migration 060 and all evidence. The completed
[combined review](../10-14-hindsight-managed-deployment/research/combined-d1b-api-artifact-review-01a180b6.md)
reports no blocking D1-B source/integration finding; actual D1-C/D and full upgrades remain unproved.
Do not delete this work, alter recorded migrations or mark product criteria complete.

The following slices retain design/reference value for resumption. Their former parallel-dispatch and
C2b-before-all-S6 instructions are superseded by the parent plan. Reassess actual dependencies and the
smallest preservation-correct implementation when the trigger is reached; do not start another
candidate scheduler, duplicate backup owner or new evidence framework. This update starts no work.

## Historical preparation and slice contracts

Current phase: execution, 2026-10-24. The owner requested development entry after accepted preparation and authorized bounded deletion of verified regenerable project build output when needed. D1-A is the first admitted source slice, parallel with C2b's image-inventory prerequisite; subsequent slices retain the gates below. Read [prd.md](prd.md), [design.md](design.md) and the complete [source study](research/source-readiness-2026-10-24.md); the latter exceeds the 32 KiB injection cap.

## Preparation gate

- [x] Restore current task, worktree and cross-repository state; preserve uncommitted Native work.
- [x] Record the owner's C2b / parallel D1 / machine-first Stage 6 direction and create only the approved D1 planning child.
- [x] Inspect current backup, immutable reader, full inventory, template observation, operation and Host seams; identify stale dependencies and concrete gaps.
- [x] Select the supported identity, strict restore, no-inference inspection and original-outcome ownership approach in `design.md`.
- [x] Complete independent review of the consolidated D1/C2b/S6 artifacts and resolve verified blocking findings.
- [x] Validate curated context manifests, document links, task hierarchy and the preparation-only diff.

The last two checks are preparation deliverables. Passing them does not pass product acceptance or automatically call `task.py start`. Before production dispatch, report the concrete reviewed scope and follow the owner's current authorization plus the existing task activation gate.

Preparation result: the [final independent review](../08-09-memory-operations-ui/research/preparation-advisor-2026-10-24.md)
is PASS for planning only, with no blocking correction. D1 context validates 12 entries in each manifest;
C2b validates 35 in each. The oversized study is routed through `research/README.md` for a mandatory full
direct read, so it is not silently truncated by injection. UTF-8/JSON, local links and parent-child identity
checks pass. No production/runtime acceptance criterion is checked by these results. D1 was subsequently
activated under the owner's development-entry direction; see the current phase above.

## Four implementation slices

### D1-A: complete archive and immutable-reader contract

May proceed in parallel with C2b's inventory/minimal producer after implementation admission.

- Add separately versioned candidate-specific Shared contracts and a cohesive Core module under `packages/core/src/memory/hindsight-candidates/`. Suggested new boundaries are inventory admission, immutable copy verification and candidate proof; these are proposed modules, not existing APIs.
- Reuse `openReadonlyDatabase`, copied-scope/body readers, original-version restore validation and the v2 template consumer. Add full table/column/entry/body/Pending/template checks without changing global pair cursor semantics.
- Implement explicit absent/unreadable/unsupported/tampered distinctions and candidate endpoint/physical identity requirements in the verifier interface. Offline work must return unverified when fresh selected-template service evidence is unavailable.
- Verify pure/file/SQLite cases with nonempty representatives; omit each required family, drop a column, alter a digest, use a live-WAL or wrong-version input, and attempt a source/foreign endpoint. Prove no ordinary Core construction, migrations or copied writer side effects.

Exit: independently reviewed deterministic contracts and useful tests. No real Host/API or full D1 PASS is claimed. Central Shared exports/subpaths are integrated by the current single owner rather than edited concurrently with C2b.

- [x] D1-A deterministic source exit accepted on 2026-10-28: Shared/Core types, scoped lint,
  24 Shared tests and 39 Core tests passed; independent review found no blocking defect and
  verified all source/evidence hashes plus exact Native 61-table profile parity.
  See [source release](research/d1a-source-release-01a180b6.md) and
  [independent review](research/d1a-independent-review-01a180b6.md).
  D1-B/C/D and the original product acceptance criteria remain open.

### D1-B: durable candidate domain and original-request recovery

May be developed alongside C2b in candidate-specific files. Shared registry and schema integration is serialized.

- Add the narrow candidate repository/operation handler and explicit links to original request, Run/Attempt/Effect, source backup and physical proof references. The controlling Core is the only candidate-record writer; never migrate the copied Core.
- Extend Memory Operations through its existing admission, checkpoint, recovery and original-result lookup seams. Preserve the generic operation owner; the candidate record carries domain evidence, not another scheduler or retry queue.
- Implement fake Host boundary tests for lost reply, wrong input/identity, stale custody, outcome unknown, explicit inspect/resume and cancellation before/after possible effects. Reopening Core performs local classification only.
- Allocate the additive Core migration and integrate operation/boot/Shared registries only after C2b's current schema handoff. Do not preassign 060 or renumber recorded migrations.

Exit: actual temporary SQLite reopen and original-identity/no-replay tests, scoped types/lint and independent state/persistence review. Fake Host results remain deterministic evidence only.

### D1-C: actual stopped candidate restore

Consumes the released C2b Host/PG ownership and installed resource contract. It does not require C3 model application.

- Add separately keyed candidates under the same protected Host registry owner/lock, preserving the selected deployment and V1 compatibility. Prove source/candidate coexistence, actual independent storage/backing/attachments and fresh owned PostgreSQL identity.
- Add strict pre-admission around Native administrative restore and the minimal transaction helper for a candidate-only restore receipt. Receipt namespace ownership and inventory classification precede use; preserve ordinary CLI behavior and existing narrow trigger handling.
- Prepare one bounded generated-data source pair and a distinct stopped target. Confirm exact original schema/build/extension/type identity and full inventory before COPY.
- Prove atomic restore, original receipt and complete row/body/queue/template equality; inject a lost restore reply and recover the original transaction/resource without another COPY. Keep candidate API/workers fenced.

Exit: independently reviewed actual PostgreSQL restore evidence, failed/refused examples and exact owned cleanup/disposition. Result is restored-unverified until D1-D completes the real v2 observer path.

### D1-D: authenticated candidate-bound verification

Consumes released C2b actual API/custody/listener/checked-stop producers plus D1's archive-compatible validation profile.

- Freeze the explicit source SQL vector dimensions, migrations-off setting, no-inference providers, original template/authentication context, immutable installed/cache identity and permitted read routes. Fail before startup on missing/mismatched facts.
- Bind every observer request/result to the actual candidate Host/container/volume/PG/startup/listener/endpoint and original request. Do not trust a caller URL or context hash alone.
- Use the real existing preflight/observer over the sealed Core copy. Seed nonempty due/processing jobs and primary-source obligations, then prove zero worker/webhook/maintenance/model actions and unchanged preserved rows across startup, observation, stop and explicit restart.
- Record baseline verification only after whole inventory, body, template and physical proof pass. Verify success/failure/crash never publishes authority, rebinds the selected runtime or replaces live Core.
- Independently review the released source and actual runtime evidence. Update executable specs and the original acceptance criteria with only established claims.

Exit: complete D1 same-version isolated-candidate acceptance. Hand off immutable identities/evidence and remaining known/unknown model facts to C4/D2. Model upgrades and Stage 6 closure remain outstanding.

## Ownership and integration schedule

| Owner | Exclusive work | Handoff / overlap rule |
| --- | --- | --- |
| Root | Task/phase, accepted contract baseline, resource identities, migration allocation, integrated acceptance and one heavy execution slot. | Validate the actual shared state before each admission; preserve unrelated work and old failed evidence. |
| C2b cohesive implementer | Versioned real API/wire/Host resources, Native process lifecycle, trusted lookup and setup capsule/template publication. | Releases concrete shared interfaces/artifact identity before D1-C/D; existing R2 plan stays authoritative. |
| D1 cohesive implementer | New candidate-specific inventory/domain/verifier and tests, then explicitly handed-off restore/Host extensions. | New files may proceed concurrently; central registries, applied migrations, Host owner and Native artifact recipe have one writer at a time. |
| Independent advisor/checker | Design challenge, then released complete source/runtime evidence at the meaningful slice gates. | No repeated review of normal unfinished source; each finding is verified against reachability and current defenses. |

Frontend changes accompany actual callable candidate status/actions only after the Shared contract handoff. Do not create a second page-owned operation store or advertise unimplemented promotion/model actions. UI finish work remains coordinated by the parent Stage 5E map.

## Meaningful verification and resource rules

The source study contains the full future scenario matrix. At minimum verify: complete same-version pair; strict omitted/malformed source or body refusal; wrong/shared/foreign target; exact version/schema/type mismatch; nonempty customized/removed template state; Pending/processing preservation with no copied execution; immutable reader no sidecars/migration; lost response and real reopen at each durable boundary; stale Host/custody refusal; and source authority unchanged throughout.

Use current package scripts for scoped types, root lint and affected Vitest suites (`--maxWorkers=2`). Add the affected strict Rust and Native isolated tests when their code changes. Preserve one heavy runner; do not invoke the root parallel recursive scripts during constrained checks. Appropriate full package/build gates run once when new cross-layer changes justify them, not after every documentation or small source increment.

Root's preparation snapshot: Node 24.18.0, pnpm 10.22.0, Python 3.12.7; H: about 2.31 GiB free, G: about 135.84 GiB; no Docker Desktop/backend process observed. These are current planning observations, not lasting runtime authority. Refresh space, process/engine/image/profile identities, fresh marker/token paths and cleanup bounds before an actual run. New heavy output uses G: staging and only the established protected C: fixture exception when necessary. Do not clean H:, alter unrelated containers/daemons or reuse consumed fixture tokens as a preparation shortcut.

No new dependency/framework, original data/key access, paid model call, commit/push/reset/rebase or finish/archive is included in this assignment. Product-state rollback is not file cleanup: before any later source publication D1 retains the selected source; after a possible candidate effect preserve and inspect the original resource. D2 separately owns post-publication recovery.

## Stage 6 and complete model-upgrade handoff

Use the parent's [S6 acceptance plan](../08-09-memory-operations-ui/research/s6-acceptance-plan-2026-10-24.md). S6 starts after accepted C2b; full C11 and the model parts of C02/C16 wait for C3/C4/D2. D89 has four owner-only items, delivered together after the machine-verifiable complete journeys. Missing implementation or an unresolved engineering case never becomes an extra manual question.
