# Stage 5B independent review contract

The owner delegated implementation and check scheduling on 2026-10-07. Review boundaries follow persisted
effects and recovery risk. B1, B2 and B3 are substantive milestones; a passing B1 does not accept all Stage 5B.
The leader owns this plan and acceptance. One implementer owns shared production files until formal release;
the checker may fix findings only after explicit ownership transfer. Preserve historical failed evidence.

The owner resumed implementation on 2026-10-08. `resume-review-plan-2026-10-08.md` assigns independent
Native/Shared and Core B1 check/fix scopes after both implementers' release. They form one combined B1 gate;
B2 and final B3 keep separate milestone gates. Small related helpers are checked within their milestone.

## Entry and evidence rules

- Freeze the milestone source inventory relative to the post-5A baseline, including existing dirty-file hashes.
  Read actual changed source and current tests, not only the implementer's report. Verify original W9/5A preservation.
- Check exact commands, real exits, test counts, source identities and isolated fixture teardown. A check can reuse
  unchanged passing evidence; changed behavior needs focused reruns. Do not claim a final full suite from an older tree.
- Use the current Native isolated runner, never real `.env`, user credentials, original databases or old corpus wrappers.
  At most two Vitest workers and one heavy test/generation/build process. Provider calls use fakes/fail-on-call traps.
- Prioritize externally observable correctness: actual authenticated route, real transactional database and actual
  execution claims/publication. Mock-only claims of atomicity, authentication or freshness are insufficient.

## B1: composition, authenticated transaction and derived jobs

| Dimension | Required evidence | Failure that blocks B2 |
| --- | --- | --- |
| User/base/template precedence | Immutable v1 identities; explicit equal-to-old values; suppression/reset; inherited labels -> user edit -> Taki removal -> final user reset; complete user resources after removal. | Lost user/base values, guessed ownership or silent adoption of collisions. |
| Wire and hashing | Shared/Pydantic strict bounded shapes; complete trigger; absent/null/empty arrays; Unicode and binary64 vectors; duplicate/oversized rejection; canonical generation. | Structural bounds/normalization diverge or either language hashes a partial precondition. |
| Read-only evidence | Real repeatable-read snapshot/result; absent Bank/identity and traps around initializer/ensure helpers. | Snapshot creates state or presents a mixed revision as a coherent CAS proof. |
| Authentication | Actual route Bearer/schema/Bank/action/field checks, including failing validators and cross-target same-ID use. | Tenant, namespace or resource disclosure/mutation through an unchecked path. |
| Atomic application | Inject failures after resource, logical event, child and receipt writes using actual PostgreSQL; verify all tables. | Any partial Bank commit, duplicated receipt/admission or out-of-transaction CRUD. |
| Concurrency/replay | Two overlapping effective plans share one snapshot; ordinary writer drift; receipt-first repeat after later edits/provider unavailability; independent no-op truth. | More than one effective winner, repeated writes, stale deletes or fabricated changes. |
| Refresh ownership/result | Real durable Sync and Worker claims; missing/foreign/terminal child; definition and object A-B-A/content edit; lease/owner loss; crash after result commit. | Provider execution without owned claim, stale overwrite, duplicate history or lost semantic result. |
| Definition-only/init proof | Empty content/null embedding with no provider calls; ungenerated search behavior; genuine definition-installed event; historical/pristine cases. | Fake generated success, fabricated unused provenance or weakened old receipts. |
| Existing compatibility | Old, 5A and exact lifecycle build; mandatory contracts, manifest-preview invalidation and fresh proof; transition lock/fence coverage. | Prefix admission, immutable migration/receipt rewrite or bypassed writer fence. |

B1 release includes finite label and backup proof wire contracts. Their actual producers/consumers are explicitly
not accepted until B2/B3. A shape or placeholder must never be exposed as positive runtime evidence meanwhile.

Native cron compilation remains authoritative under the 2026-10-08 design clarification. Shared validates the
complete bounded envelope and mutual-exclusion rules; it does not attest all croniter semantics. Test native
rejection before any effect and representative valid native syntax without introducing a dependency/subset.

## B2: durable rollout, runtime and trusted classification

The owner delegated cadence; root refined the schedule after the actual workload became clear. Native and label
implementation may enter their joint independent check once those owners release the complete self-check/source
handoff, while Core lifecycle implementation and tests continue in disjoint files. The Native/label checker owns
only that released scope. A later Core check and final source/dependency readback still form one B2 acceptance gate;
B3 waits for the whole gate. Cross-scope fixes require explicit ownership coordination and affected reruns. Never
call a partial independent pass full B2 acceptance. Heavy tests/builds/generation remain serial across all phases.

Review the whole operation from admission to selection publication and binding recovery. Require real SQLite
reopen, Native response loss and per-Bank partial application. The unpublished-effect hold must survive failed and
unknown terminal states/restart, cover foreground/background/reflect/read/provision/conflicting admission, and
permit only original-plan recovery. Verify final lease/executor/config/epoch/identity guards after synchronous
read-back; no remote I/O inside SQLite. Selection commit plus binding failure must not repeat Native application.

Preserve W6's offline emergency exception through its existing old-epoch quarantine and incident inventory,
extended with template plan/executor/hold/dispatch/receipt evidence. A hung Native/template call cannot block
takeover. Verify late template callbacks cannot publish/release holds or overwrite unknown outcomes after
quarantine, and restart/healthy reentry cannot automatically reactivate the foreign branch. This is neither
ordinary held-state recovery nor a successful template publication.

Exercise both real extraction paths with fake providers, through exact-version server-owned sidecar to replica
binding and policy. Caller content-wide tags/entities/metadata cannot mint trust. Test all actual mutation/restore
invalidation paths, ambiguous/wrong-scope labels and original/curated priority. No old-fact mass reclassification.

The integrated B2 handoff must map each risk below to its real producer/consumer and test evidence. Tests for
small adapters share this milestone; separate mocks of both sides do not substitute for the integrated path.

| Dimension | Required adversarial or positive evidence |
| --- | --- |
| Durable original plan | Native IDs and fixed Bank set persist before dispatch; lost response, partial Bank commit, generic failed/unknown and physical SQLite reopen retain the same recoverable plan and hold. |
| Admission and lifetime | Persisted hold is read before boot runtime construction and before new captures/live reads/tools/recall/reflect/Utility/source/background/provision/conflicting operations. Frozen captured context and primary witnesses survive; old bindings stop accepting live work. |
| Executor and publication | Competing/expired executor cannot renew or checkpoint; after final synchronous readback, lease/config/secret/epoch/complete Bank identity loss rolls back every selection/default/readiness/receipt/hold change. Post-commit binding failure only rebinds. |
| Offline emergency | Actual W6 path returns without waiting for hung Native/template work, records complete old-epoch inventory, and prevents late callbacks and restart from publishing, clearing a hold or reviving a foreign branch. |
| Structured capture | Both real extraction paths take one valid raw per-fact label before caller merge; failed/fallback config resolution, ambiguous labels, filtering/index changes and collapsed/chunks modes cannot fabricate proof. Tracked-retain frozen settings/replay must preserve the original server-owned successful resolution; old/fallback plans cannot gain proof from a later successful read, and public requests cannot inject that proof. Application capture being off cannot skip sidecar handling. |
| Exact-version lifecycle | Ordinary edits/imports/revert/delete/generation changes invalidate proof. Verified bookkeeping reproof advances the exact version after checking the complete prior payload; exercise extraction -> consolidation -> sync, not just a hand-inserted sidecar row. |
| Trusted consumption | Real Native output crosses the actual bounded client/replica/application-binding path into canonical policy. Verify one successful scope-safe case plus spoofed/ambiguous/neutral cases and original/curated, pinned and mood-gated priority. No remote I/O runs inside synchronous SQLite. |
| Defaults and old builds | Actual provision/revalidate use admitted scope defaults; explicit none continues Hindsight memory and valid user contributions. Legacy v1 and optional-capability absence retain their existing path without invented managed history. |
| Derived result observation | One admitted original plan/Bank/child per read; exact Native target/request/model/definition evidence and post-await config/secret/epoch/Bank checks; bounded deadline and service-stop cancellation. A stopped service or late reply cannot access a closed DB or publish a current observation. Status identifies historical `rollout_record` values; live reads return actual observation time or explicit stale/unavailable, with no DB writes, lease activity, model submission or automatic polling. |

The same-resolution config and materialized-group proof boundary, Core preview/operation API direction and
cross-repository harness ownership are frozen in `b2-dispatch-plan.md`. Concrete source identities and real
command exits must accompany each scope's complete self-check release before its independent check starts.

New Character provisioning also requires lost-create-ACK/reopen and a competing same-ID creation/write after
Core's empty-occupancy reservation. That reservation proves local intent only, not Native creation or ownership.
Recheck actual occupancy/generation and complete fresh before-images before installation; reject preexisting
configuration/resources/content or drift. An independently created but still completely empty Bank may satisfy
the existing fresh/enrollable conditions, but must never be reported as created by Taki. Resource ownership comes
from the actual Native absent-to-insert receipt; pristine/unused proof remains a separate Native fact. Home recovery
availability is Core-produced and shares the real admission checks, rather than a client inference over phase/hold.

## B3: whole-slice completion

The final independent check includes all B1-B3 source, not just Home changes. Verify the real operator dispatcher,
WS client and Home UI through preview/apply/partial/conflict/stale/reconnect/two-observer paths. Confirm that reads
cannot apply or refresh. Check explicit provider/deletion consequences and original-operation recovery.

Use real isolated customized/removed-overlay paired restores. Managed-template state requires equality even when
ordinary Native memory cursors may be ahead. Reject pre-template Core with post-template Native, missing proof,
unknown effects and wrong Bank generation. Verify backup table/FK/receipt accounting and fresh/historical migrations.

Run affected-package quality gates, required builds, canonical SDK generation and applicable startup/integration
checks. Record platform limitations separately; installed environment, original instances and owner/manual
acceptance remain Stage 6. No Git lifecycle or task archival is part of these review milestones.
