# W5 healthy transition implementation and incomplete real-data gate

## Status and ownership

W5 production drivers and the deterministic checks below are implemented. **W5 is NOT complete, independently
accepted or PASS.** The required reused-real-corpus return/reentry remains interrupted by HTTP402 and an insufficient
remaining submission bound. No manual, original-environment, W6 emergency or W7 Home acceptance is inferred.

Task: `.trellis/tasks/09-29-hindsight-transitions-emergency`. Core workspace `H:/TakiAgent`, branch `main`,
HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Native workspace `H:/hindsight`, branch `main`,
HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. No commit, push, reset, rebase, dependency change,
original-user authority/data replacement, task finish/archive or new agent was performed.

`w5-source-ownership.json` records all63W5 Core/Shared/spec/index paths and6native paths, with exact final SHA256,
pre-W5 hashes where available, and the original-corpus preservation audit. Manifest SHA256:
`21673440218d85039ef17405a24f4134880a31f7a6872352dc86a50e1b99ea94`.
The Core count includes tests, fixtures and indexes; it is not63production modules. A null prior hash is explicitly
distinguished from a clean tracked HEAD predecessor. Native pre-edit hashes come from the approved billing manifests.

Preserved immutable evidence:

- `w5-prior-source-baseline.json`: `8e8b4dad76f41d25201253969f0baa7777d9412b9e82757595cc804c3434f67d`.
- `w5-first-real-run-source-hashes.json`: `e97459b4918a0ecfd99ea863ba030fd5bb300451d26c8dc9bd5d8bfe7498bef1`.
- `w5-native-billing-prior-hashes.json`: `2742b09dedd3dd9af5d30c450564e1c7023ae3a62115fdb59a98d285a86f82d1`.
- W4 independent source manifest: `8e9474814dcd503b30922576c657038ba88d8fdb19ee46f127c27dc26ee89915`.

## Production composition

`boot/memory-transition-boot.ts` composes `createHealthyTransitionService` against actual config/secret custody,
the existing operation owner and `composeMemoryRuntime(...).transitions`. Main registers the authenticated operator
reads `memory.transitions.preview` and `memory.transitions.status`; execution uses existing `memory.operations.submit`.
Construction and ordinary boot do not start a transition. Healthy directions retain their single explicit confirmation.
Emergency has no W5 producer and is refused by this service.

The synchronous admission plan rechecks the saved preview, complete connection/setup identity, current selected epoch,
common baseline and separately discovered Character coverage. Preview capability I/O remains outside SQLite transactions.
No stale preview, foreign history or missing capability permits a new-Bank/reset/full-copy fallback.

The composed execution is:

1. Claim the existing operation/transition and register every admitted Bank before client construction.
2. Quiesce actual source owners, close queue admission and fence every native Bank under its original command.
3. For return, load complete final native evidence. For reentry, capture current Local state, prepare/persist exact
   per-Bank delta and Source uploads, reuse original replies or submit the recorded request, then obtain final proof.
4. Use W3 verified candidates and W4 final configuration/custody proof and atomic authority publication.
5. Record actual native retirement/activation, bind the selected runtime, settle ordered queued effects through original
   target receipts, then persist final operation truth. Hindsight activation for all Banks precedes its target writers.

Native proof, Core COMMIT, runtime readiness, queue completion and native release remain separate status facts.
An unknown response keeps durable exclusion and original identity. Recovery uses a new authorized operation with the
original transition; old terminal operation results remain immutable. Boot/status reads do not replay an effect.

The actual read-only native physical snapshot API lacks a caller request ID. Its materialization is separate from
the persisted idempotent application-snapshot request and cannot claim maintenance/publication completion.

## Durable recovery repairs

Migration055 adds immutable previews, complete driver Bank registry, acquire/claim/decision/application-snapshot
commands, dispatch/observation evidence, non-dispatch seals and per-operation recovery failures. The real owned database
already recorded055; its SQL was not edited afterward. Migration056 separately adds immutable verification dispatch
evidence binding Bank, transition, exact native executor and hash before a new verify call. It is tested but has not
yet been applied to the stopped real copy.

An old055database has no verification rows. Missing rows never establish historical non-dispatch. Explicit recovery
records a new continuation only from actual native state/refusal; no historical dispatch is fabricated. First verify
failure does not immediately repeat maintenance while handling the failure. Completed actions/steps and sealed proofs
are reused, and source release requires positive outcomes for every sent acquisition. Unsent Banks receive only
factual non-dispatch evidence after sent acquisitions have positively aborted.

An original pre-proof abort has `proof_hash=null`. If recovery finishes its partial plan, the native abort must name
the observed final proof. `transition-native-decision.ts` saves a separate proof-qualified command and preserves the
original refused command. Lost replies match either exact historical decision; neither command is overwritten.
The original real-copy control inspection found two acquire commands and **no abort command**, so its future recovery
can continue the original return rather than being redirected by an existing abort intent.

Other implemented recovery corrections include constructor failure before dispatch, all-Bank partial progress,
no second quiescence of an already fenced source, native executor takeover before/after proof, current lease revision
renewal, binding-only repair after COMMIT, original target receipt recovery after ACK loss, and separately stored
failed recovery results. All active producer promises participate in joined service shutdown.

## Native billing refusal

The approved production extension touches only:

- `engine/llm_interface.py`: sanitized `ProviderBillingError`.
- `engine/providers/openai_compatible_llm.py`: factual HTTP402 classification in both `call` and `call_with_tools`.
- `engine/consolidation/consolidator.py`: propagate this exact type before generic retry/failed-batch subdivision.

HTTP401/403 retain their existing behavior;429/500 still retry when followed by success. Billing refusal sends once,
does not sleep/retry/subdivide, and does not become a reusable synthetic failed-content plan. The exception suppresses
the original provider cause in formatted tracebacks, verified against a private-diagnostic sentinel. No OpenAPI,
dependency, native migration or proof/history relaxation was introduced.

The actual owned-PG maintenance test commits a first observation step/action, encounters billing on the next call,
asserts incomplete state with no proof/outcome, expires the executor, takes over at generation2 and completes the same
candidate/required set. Previously committed step/action rows are byte-equal; repeated sealed verification invokes no
additional model. Its model is deterministic and isolated, not the configured real provider.

Task helper `w5-model-budget.py` additionally persists a cumulative submission counter before HTTP and latches the first
402 response. The original first response is returned unchanged; subsequent attempts, including after restart, refuse
locally. This does not alter native retry settings or automatically reset the latch. The original run preceded this
latch, so no historical latch was fabricated. Its209counter remains unchanged.

## Deterministic evidence and checks

Core fixtures use actual B2/B4 predecessor setup, operation owner, SQLite, current Local writers, W3/W4 joins and started
provider/runtime composition. Their native transport envelopes are explicitly synthetic and cannot certify native
maintenance or replace the real-corpus gate.

The7healthy test files contain32cases covering complete cycles; original acquire/delta/verify/resolve/upload/claim reply
loss; constructor and binding failure; partial maintenance and055-to056continuation; every-Bank release; real canonical
tools/coordinator queue ACK, capacity/cutoff, order/conflict, target-effect-before-ACK and source cancellation; primary
append/finalization through drain/unbound/reopen; new Character, empty Bank and ordered/repeated multiversion Sources
from actual Local copy/reinforce; edits/policy/invalidation/restore; actual activity expiry and a later cycle retaining
the deletion; foreign proof/corrupt body/late inventory/publication rollback; real manual-sync admission in both orders;
and physically reopened SQLite with newly constructed runtime/service/operation owners.

| Command/group | Actual result |
| --- | --- |
| Core transitions + migrations + driver/abort/native-outcome + transition/replica/owner regressions |59files/274PASS,112.46s |
| Complete transition group after fixture type/lint repairs |19files/87PASS,89.11s; overlaps preceding group |
| Later deleted-activity second-cycle extension |1PASS/2skipped; remaining cases unchanged |
| Shared transition/candidate/operation schemas |4files/14PASS |
| Actual Local onboarding and Hindsight first-activation services |2files/25PASS |
| `pnpm -r typecheck` |PASS; final Core-only repeat and scoped ESLint after the last fixture extension also PASS |
| `pnpm lint` |exit1, exactly7approved cohesive-function overruns; no lint PASS claim |
| Trellis task validate |PASS, implement38entries/check39entries |
| `git diff --check` and owned UTF-8/header/whitespace audit |PASS; existing unrelated Git CRLF advisories retained |
| Task-owned budget unittest |2PASS, fully offline |

All Vitest commands use only `--maxWorkers=2`. Exact final commands:

```text
pnpm --filter @taki/core exec vitest run src/memory/transitions src/db/migrations src/db/memory-transition-driver-repo.test.ts src/db/memory-transition-abort.test.ts src/db/memory-transition-native-outcome.test.ts src/memory/operations/memory-operation-kind-transition.test.ts src/memory/operations/memory-operation-kind-replica.test.ts src/memory/operations/memory-operation-service.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/memory/transitions --maxWorkers=2
pnpm --filter @taki/shared exec vitest run src/hindsight-transition-schema.test.ts src/memory-transition-candidate-schema.test.ts src/memory-transition-schema.test.ts src/memory-operation-schema.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/memory/hindsight-activation/hindsight-activation-service.test.ts src/memory/local-onboarding/local-onboarding-service.test.ts --maxWorkers=2
pnpm -r typecheck
pnpm lint
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-boot.mjs
```

Root lint's7errors are the5prior approved W4 overruns (`createHindsightRuntimeBinding`55,
`composeMemoryRuntime`51, `selectMemoryRuntime`55, `projectTransitionLocalBank`51, `createMemoryTransitionRuntime`51)
and2W5 overruns (`createHealthyTransitionService`55, `createTransitionNativeSession`63), against the50-line limit.
Earlier max-params, fixture-unused-variable and closure-narrowing failures were fixed. No lint suppression was added.

Native checks, using the existing isolated supervisor from the Taki root:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/test_provider_billing_refusal.py tests/test_consolidation_retry_budget.py tests/native_results/test_transition_billing_recovery.py -q --tb=short -n 0
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-native-billing-type-baseline.py
```

The first full native group `fd359c38f3d0` had12PASS/9FAIL: HTTP cases and actual-PG recovery passed;9existing retry tests
had a stale mock missing `observations_instructions`. That fixture was repaired toNone, then its provider-cache mock
was explicitly disabled. Provider+retry final `bb4b544380d9`:20PASS, no pytest warnings. After traceback sanitization,
provider/consolidation rerun `e3bd644518b8`:11PASS. All owned fixtures were stopped and their owned data/registry removed;
logs remain below `.trellis/.runtime/g1-validation/`. The expected external-cost-map attempt was blocked by the offline
fixture guard and used its local backup; no real provider/model request occurred.

Scoped Ruff check and `format --check` for3production+3test files pass. Scoped ty remains **exit1/12diagnostics**.
`w5-native-billing-type-baseline.py` reconstructed the exact3pre-edit files and matched all saved SHA256 values before
checking. Final evidence `.trellis/.runtime/w5-billing-types-e02e3deb4e274132b3e6ddae1f5c12b8/result.json` proves both
preimage/current have the same12diagnostics, including exact source fragments, columns, messages and severity. This
establishes no new diagnostics, not a green typecheck. No unrelated native type defects were expanded into W5 scope.

## Real process smoke

`.trellis/.runtime/w5-boot/a700ccee-b949-4fd9-ba3a-98b5f9a25fe0/result.json` records Node24.18.0 native type stripping,
Legacy and genuine B2-produced Local each booted twice, actual authenticated WebSocket authority/runtime status and
transition status/preview refusal paths, actual SIGINT shutdown, exit0and SQLite integrity after reopen. All4processes
stopped. The model HTTP trap observed0requests. This is ordinary boot/RPC regression, not Hindsight real-corpus acceptance.

## Interrupted real corpus and preservation

Exclusive stopped working copy:
`H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/`.
PG18495/HTTP18496are loopback-only and stopped. The original preserved `application-ad325c12054d4d92b91a81ad2b18fee1`
pair was never started or mutated. Final audit rehashed1647files/421681143bytes: all expected digests match, with no
extra/missing files. Its immutable preflight file still hashes to
`d27ab04843cd82e1d574b06dda5512ad469bb85a541887414a8ce8707499ab1d`.

The original real run is still exit1/interrupted, transition `df47f32c-48a8-47bc-9792-2e24e8642084`, operation
`ecc4bdc8-0768-4ff7-8a13-fa8c0741210e`. Original `run-result.json` retains its failed redundant-stop result;
`manual-stop-state.json` separately proves the successful stop. Prior attempts are preserved. No final proof,
Core authority COMMIT or Local mutation was produced. The original operation remains outcome_unknown.

- Cumulative209/240submissions:9HTTP200and200HTTP402Insufficient Balance. Remaining31is a submission cap, not balance.
- Reported successful-response usage:prompt94857,completion25173,total120030. Reasoning18785is within completion.
  HTTP402usage and monetary cost are unknown, not zero.
- Original finite plan:Character544scopes/69batches,Global157scopes/20batches, batch size8, one dynamic model each.
  This is maintenance over previously converted units, not permission to repeat corpus extraction/import.
- PG-only read-only inspection `remaining-plan-8e242288de004200b7a8fbcd4de73834.json` found9complete steps covering
  60requirements;16prepared entries contain15failed saved plans and1missing plan, none reusable. Remaining484Character
  scopes require61batches plus1dynamic model; Global needs20batches plus1model. The first remaining return therefore
  requires **at least83submissions**, excluding retry/dedup and the later reentry plan.31is insufficient.
- Same candidate hash:`242996f715606f99dfd82b8d0b594f03ffcdae85190cfed90dde62cfa2f36fdb`;
  required-set hash:`45889a1516af190f1ff7c633b91fc85223f4e7f6c3a9c928f1b810a93264fedd`.
- Later read-only SQLite control inspection found only the2original acquisition commands, no abort command;
  SQLite SHA256before/after:`cdef425b17e120fa4f8e7ae111e5af36353ea48cdd1cf5a961d06b6e0902c670`.

## Remaining gates and rollout boundary

1. Parent must resolve the pending account-readiness decision and approve a revised finite submission budget before
   any real request. No credential/provider/model switch, probe, cap increase or automatic latch clearing is allowed.
2. Apply additive056to the owned Core copy, reconstruct the original transition and resume its original native plan.
   Preserve the9complete steps/actions and original identifiers. Do not repeat corpus conversion or completed maintenance.
3. Complete the genuine final proof, checked W3/W4 return COMMIT, controlled Local policy/Block changes and same-Bank
   reentry with new native proof and exact current-state/mapping/body-reuse assertions. Measure the real reentry plan
   before approving its submissions;83does not cover that later phase.
4. Recheck original hashes, stop owned processes, retain recoverable outputs, update this incomplete report and final
   ownership, then obtain the parent's independent W5 check. Owner/manual acceptance remains separate.

Deploy the already reviewed native transition capability plus the scoped billing repair before enabling these healthy
drivers. Core applies055/056additively. No new environment variable, dependency or destructive schema step is required.
Runtime rollback must retain immutable receipts/fences and selected authority; downgrading or deleting evidence cannot
undo a committed transition. W6/W7remain outside this implementation and the real-data gate cannot be waived by the
deterministic tests above.
