# C2a preliminary source review

Date: 2026-10-14. Reviewer: `/root/c2_design_check`.

Disposition: **CHANGES_REQUIRED for the inspected snapshot; preliminary review only.**
This is not an overall SOURCE PASS or process/platform acceptance.

## Scope and ownership

The implementer retains SOURCE and the serial CHECK SLOT. This reviewer inspected the nine requested
Core/Host files and narrow referenced lifecycle, registration and transport seams. The only file written
by this review is this report. No source fix, test, lint, type-check, build, Git action, environment start,
credential access or Docker experiment was performed. The implementation was still in progress.

The PRD, curated check context, frozen design, implementation plan and accepted design review govern
this audit. The explicit vacant-registry clarification in `design.md:168-172` is compatible with that
design. The earlier R1/R2 design findings remain resolved at the design level.

## Findings (fixed)

None fixed by this reviewer. Both findings below were sent directly to Root and the source owner.
The source owner acknowledged the uncertainty correction and is implementing focused repairs and
regressions. Acknowledgement is not a verified fix; retain the findings until the corrected snapshot
and its checks are independently reviewed.

## Findings (not fixed)

### S1 - P1: dispatched uncertainty becomes a definitive failure or completed Effect

- Files: `packages/core/src/capabilities/capability-broker-state.ts:101-123`,
  `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts:170-175,191-195,217-220`,
  `apps/hindsight-host/src/deployment-injection.ts:61-67`,
  `apps/hindsight-host/src/deployment-owner.ts:171-177`.
- Contract: `design.md:106-122` and `research/c2a-contract-design.md:96` require currency revalidation,
  suppressed accepted publication and retained uncertainty when authority changes after dispatch.
- Confirmed Core path: a valid completed response reaches `settlePending` through
  `capability-broker.ts:158-172`. `capability-response.ts:21-26` verifies control/authorization lineage;
  owner currency is checked later. `settlePending` first calls `settleHostEffect` with the success
  outcome. That commits `completed` through `capability-effect-lifecycle.ts:61-76,97-102`. Only then
  does it check current owner/deadline/approval generation. A failed check changes the returned result
  to `CANCELLED`, while the Effect is already terminal. The deployment owner maps that result to
  `host-unavailable` and requests a failed Run. Thus a Catalog change before acceptance can leave a
  completed Effect and a failed Run for an already dispatched injection. The owner also returns
  ordinary `snapshot-stale` if its post-route currency check fails.
- Confirmed Host path: the sender publishes `submit-dispatched`, awaits the private submission, then
  calls `validate`. A Catalog-byte change or expired control can throw `snapshot-stale` at that point.
  `deploymentReason` preserves the closed error (`deployment-error.ts:16-17`), and `failure` returns
  ordinary `unavailable` without considering this invocation's dispatch fence. The durable record can
  still correctly prevent replay and permit later original-resource observation; that does not make
  this immediate failure classification accurate.
- Required minimal fix: evaluate checkable final C2 currency before committing the Effect outcome;
  when dispatched C2 acceptance or final settlement cannot be accepted, preserve `outcome_unknown`
  and suppress `onAccepted`. Propagate that state through the deployment owner. On the Host, classify
  uncertainty using the current request/control's matching attempt and its fences. Do not use a
  historical attempt's fence to relabel an unrelated pre-dispatch refusal. Preserve original IDs and
  the existing no-replay rule. Keep unrelated capability behavior unchanged.
- Required focused evidence: invalidate Catalog/owner currency after submit/dispatch and before final
  acceptance; verify unknown durable/public outcome, no accepted callback and no repeated submission.
  Verify original-resource observation remains available. This review established the branch behavior
  statically; it did not execute a fault-injection test.

### S2 - P2: the Core owner ignores the canonical Run settlement result

- File: `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts:191-195`.
- Issue: `runs.settle` returns `RunStatusResult`, but the owner treats any non-throwing call as acceptance
  and returns the earlier Host status. This is not the repository's contract.
- Confirmed supporting paths: `harness/run-service.ts:100-109` returns the repository result unchanged.
  `db/run-repo.ts:180-189` can return an already-terminal or different-active-attempt state without an
  exception. Its settlement helper at `286-288` converts a requested completed/failed result to
  cancelled when the Run is `cancel_requested`. The shutdown path requests durable Run cancellation
  at `main.ts:606-610`. The current owner never inspects those accepted/refused terminal results.
- Required minimal fix: consume the returned status and require settlement of this exact Run/Attempt
  to the intended terminal outcome before returning the preceding successful deployment result.
  Preserve a conservative unknown/refusal when the canonical result refuses or downgrades it; do not
  overwrite the terminal Run or introduce a retry. Account for this together with S1's uncertainty
  propagation.
- Required focused evidence: use the actual Run repository's non-throwing refusal/downgrade behavior,
  including a terminal or changed-attempt result, and assert the owner does not publish its preceding
  running/stopped result as accepted execution.
- Evidence limit: this is a confirmed return-value contract gap. No concurrent shutdown/interleaving
  reproduction was run, and none is claimed.

## Other static observations

- Durable initial admission follows R1: the deterministic start trigger and `findByIdempotency` lookup
  precede fresh admission/custody. Reused admission observes the stored initial Run UUID. Startup keys
  retain the original Run in provenance and the existing/fenced startup branches observe only.
- The Core owner retains the real C1 evidence handle and calls its validator; the serialized custody
  projection is not used to reconstruct a handle. The narrow authenticated Node checkpoint requires
  a live dispatched inject pending, exact current control/generation/authorization, committed matching
  Effect and synchronous one-use consumption before returning the permit.
- R2 is present in the Host sender: all selected values must match `C2A_FAKE_[0-9a-f]{64}` before
  checkpoint/grant dispatch or credential frame construction. The private callback rechecks Catalog
  identity/current bytes after awaits, and the frame buffers are cleared. These are static findings,
  not proof of sentinel absence or actual Native/process delivery.
- Host registration validates its C2 installation/Core/Host against the actual local C1 registration.
  No independent wrong-Host finding is asserted from the public custody projection alone.
- No finding is asserted for transient compilation/style state, unfinished Rust/fixture wiring or tests
  still being authored. An already-terminal Effect duplicate is a relevant final-settlement edge, but
  this bounded review did not establish an additional live C2 production race and does not label one
  as a confirmed defect.

## Inspected source identities

Hashes identify the inspected preliminary snapshot, not a frozen implementation release. The nine
primary hashes were rechecked before this report and still matched the inspected bytes. Later source
owner changes require a new final manifest and relevant reinspection.

| Primary path | SHA-256 |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts` | `c93fcf614ec512ae6720f5d02639a37917711bfb29f0f3abec3ae485d3a02a74` |
| `packages/core/src/capabilities/capability-broker.ts` | `e6e6b3c70f8311fdc71225086be271a81e283b3c725d977ae211195fe251e6d1` |
| `packages/core/src/capabilities/capability-challenge.ts` | `f737cd0650aa41401454e03a2bdb51d841815f64b2b188a7937c4938b6ff1ca1` |
| `packages/core/src/capabilities/capability-broker-state.ts` | `6f3e3cf3abcda6708b6cb1f7bada78fc437d165d472fb8d549806b6d3c1323a9` |
| `packages/core/src/capabilities/hindsight-injection-checkpoint.ts` | `d8088d0e06bfe9711e065f61b6ab7314f4957f77bd063530a42ae31516c1a9a1` |
| `packages/core/src/capabilities/route-capability.ts` | `3eda1254b2a43f9adcd00916f82b64aa365631754742ec987fc5c061b2b7f69e` |
| `apps/hindsight-host/src/catalog-selection.ts` | `29dcaff7274e624d5360e289702cd40ed828eb10b87ba4094bfc0cda203d75d4` |
| `apps/hindsight-host/src/deployment-injection.ts` | `5e95d37677a70a014512cf84452d6b25f9d9949a9519677a2eb5addaae434b50` |
| `apps/hindsight-host/src/deployment-owner.ts` | `e18e0aa3941abeef6682f3c3cd3d1a03b009e32535b7cbd459776480e6ed7782` |

| Narrow supporting path | SHA-256 |
| --- | --- |
| `packages/core/src/capabilities/capability-effect-lifecycle.ts` | `7fb32c68e8a26ed3b1ae7651679fcb23086b2f7dd64e7af05fce86b6b9d3724c` |
| `packages/core/src/capabilities/capability-response.ts` | `83581346d9907dd12a419ec02498fabff5bff2bf54a4808a9de28660b5e9355f` |
| `packages/core/src/db/run-repo.ts` | `7836712577f00a29c2ae210a6b9cab065c9d778d819f11fc14577bf6d1b35b51` |
| `packages/core/src/db/effect-repo.ts` | `06911cd23059d1715a5c6441ecb35f219ed8f5fd3417cdea1a8304f72c9f4ffc` |
| `packages/core/src/harness/run-service.ts` | `0f5ed3014645cd3648fbf4c31acdd40cc49f07ae8f54dda52c18210a22c0a60e` |
| `packages/core/src/harness/effect-lifecycle-service.ts` | `3f1f2dc8615e80fb27950d8bfa31f992ef875cf7e21cbe9e45939e5114046062` |
| `packages/core/src/harness/recovery-coordinator.ts` | `3d893363071406eedc2de567198d95c13051250f1750480fa19e43675a610d67` |
| `packages/core/src/main.ts` | `e1286ed20bb938db4ac10d42d36d8664b44aefff4a65f1aab75c8af7894f4de7` |
| `packages/core/src/memory/hindsight/hindsight-custody-owner.ts` | `f6aa22f2c718b28bc987c2ff7edc25b8f4217ce748ae2a03fc09835cf3e603ec` |
| `packages/core/src/boot/hindsight-deployment-boot.ts` | `e9c5d842e9d6fe90b69dae74b7aa037454d54da82307e72da5b12914e884fb86` |
| `packages/core/src/server/methods/hindsight-deployment-checkpoint.ts` | `e100a104cd547e3f603fe99135fed90bbdc22360f491f47e11b6ea9f6fde0cc8` |
| `packages/shared/src/hindsight-deployment-schema.ts` | `8f15f0719b9ade574f41799ea29febfcd718e1743667daf2c21666b127b4f8a0` |
| `apps/hindsight-host/src/deployment-error.ts` | `1ece2518e8336c2949a2390a584eb5f5b596766ce6b18699192c146824c9eec5` |
| `apps/hindsight-host/src/deployment-registration.ts` | `a64a259fe49eeb3091fea61fb9fa58d81b58d2f97767c63554569113bba2a6b7` |

Design identity: `design.md` =
`b406084f01a37c10fa41ca610cbb2ad4296162901defd3482a49bd9aef2bc904`.
Accepted design review identity: `research/c2a-design-review.md` =
`77c134fd8122d0e89bcce5324e5a1cc8ff431b6f4b5cb246381bcc0a645c14b8`.

## Verification

- Lint: not run; CHECK SLOT remains with the implementer.
- TypeCheck: not run; CHECK SLOT remains with the implementer.
- Tests: not run. Static paths and hashes above are the evidence for this preliminary review.
- Source fixes: not performed by this reviewer; S1/S2 await corrected-source verification.
- Final gate: pending explicit source/check release, correction reinspection and the affected checks in
  `implement.md`. Real fake-process delivery, packaging and owned cleanup need their own actual evidence.
  Actual Docker, C1 Ubuntu platform acceptance, C2b receipts and real-provider readiness remain separate.

This report is released to Root after read-back. Preserve the original findings and append the final
check result when ownership transfers; do not turn this preliminary snapshot into a retroactive PASS.

## Read-ahead extension - 2026-10-14

Root authorized an additional bounded read-only review while the implementer retained all SOURCE
and the serial CHECK SLOT. The 19-entry check context now includes
`.trellis/spec/backend/hindsight-managed-deployment.md`
(SHA-256 `7d316cb63f4dc4738d0a48e532e1b61da34f6a03354b6589289ba20c29d8ad4c`).
This extension preserves the original S1/S2 findings and their inspected hashes above. It is not a
whole-slice check, a source freeze or a retroactive PASS.

### S1/S2 reinspection

- S1's Core correction is visible at `capability-broker-state.ts:102-105`: the C2 semantic outcome
  and applicable currency are checked before Effect settlement. Failed settlement and post-settlement
  acceptance failure return unknown for a dispatched deployment. The narrow
  `hindsight-deployment-outcome.ts:10-28` also distinguishes a completed transport envelope from an
  unavailable/unknown deployment result and checks the original resource/startup/attempt binding.
- S1's Host correction is visible at `deployment-owner.ts:172-184`: it finds this exact request/control
  attempt, then classifies its dispatch fence. It does not borrow an unrelated historical fence.
- During this extension, the Core owner's post-route check still returned ordinary `snapshot-stale`
  at line 171 in snapshot `0ac59dffece8dffc0b5fa86b0efe95600664980c5cf07ba601e9b5c127728e8b`.
  A C1 deadline expiring while the completed route returns to its awaiting owner would therefore still
  request a failed Run. This remaining S1 branch was reported directly to Root and the implementer,
  without claiming an executed timing reproduction. The implementer changed it immediately to
  `outcome-unknown`; that exact branch was reread in
  `07e034f1d820a095a4dc2703992be609a9e6820092b5e574412c06ce6e395b7d`.
  Its additional regression was still being authored.
- S2's correction is visible at `hindsight-deployment-owner.ts:191-201`: it consumes the real settlement
  result, checks Run identity, active Attempt and both outcomes, preserves original deployment/config
  IDs, and returns unknown if settlement throws or does not accept the intended result.
- Existing regression sources inspected: `deployment-core.test.ts:269-280` changes the real Catalog
  before the broker receives the inject response, asserts unknown Run and Effect, then observes the
  original child with one submission. Lines 283-294 drive real Run cancellation/attempt replacement
  through the repository settlement seam. `deployment-owner.test.ts:78-95` changes Catalog bytes after
  actual private submit and checks unknown followed by same-child observation.
- These are source-level correction and regression-content observations. S1/S2 remain pending the
  formal independent execution gate; the implementer's reported passes are not this review's results.

### Additional boundaries inspected

| Boundary | Concrete source evidence and provisional result |
| --- | --- |
| Shared contracts and permission | `hindsight-deployment-schema.ts:31-80,91-130` retains strict plan/effect/control/status shapes, the fixed fake consumer, exact original identity and literal false readiness. `governance-registry.ts:13,28-43` adds registry revision 3 with separate create/start/inject once-only cells and independent observation, retaining C1. The scoped Shared test pins canonical plan bytes and descriptor cells. |
| Fixed Docker invocation | `docker-adapter.ts:29-37,51-129` derives original names/labels, validates engine/image/container/mounts, disables pulls and network, and uses fixed no-TTY Python control/submitter commands. `docker-process.ts:13-41` uses the registered executable/endpoint/config, cleared environment, hidden no-shell child and bounded discarded diagnostics. No delete or arbitrary command path was found in this scope. |
| Registration and durable registry | `deployment-registration.ts:13-33` binds the local C1 installation/Host and protected file/state identities. `deployment-registry.ts:30-42,53-105` distinguishes explicitly provisioned vacant state, bounds history, verifies current bytes, and flushes/stages/atomically replaces a monotonic record. Missing/corrupt ownership does not create a new record. |
| Private sender and resident entry | The previously inspected `catalog-selection.ts` and `deployment-injection.ts` hashes remain unchanged. Fake-only selection still precedes checkpoint, grant and frame construction. `deployment-host.ts:15-42` composes the actual registration/registry/adapter/owner and relays checkpoints separately from results. Shell lifetime/relay behavior remains outside this read-ahead. |
| Independent Native authority | `owner.py:22-36` lets Bootstrap generate the startup and installs LiveGrant only through owner control. `owner_protocol.py:30-83` strictly parses bounded status/authorize requests and fixed selection. `bootstrap.py:78-136` locks grant/acceptance, matches the exact grant/frame, fences one attempt and rejects reuse. |
| Native private transport | `control.py:50-60,103-121` uses the fixed protected control socket, peer/current-path checks, bounded framed I/O and safe statuses. The referenced `unix_socket.py:74-110,162-177` retains kernel UID/path identity checks and restricts socket kinds to the two fixed names. This read does not establish actual Linux/Docker transport acceptance. |
| Fixed fake child | `fake_consumer.py:51-97` independently rejects every non-fake resolved value, rebuilds the environment, uses the fixed child, discards output and waits for a same-PID/startup marker. `fake_child.py:17-50` checks its environment and dotenv suppression, writes only safe markers and has a finite lifetime. `supervision.py:20-37` drops ambient credentials. |
| Native recipe and regressions | `Dockerfile.c2a-fake:3-9` installs the package in the existing venv and selects the fixed owner. `test_c2a_bootstrap_owner.py:49-107` exercises independent grant, actual child, expiry observation, reuse/refusal, fake-only input, binding errors and strict control input. Neither this recipe nor these tests were executed by the reviewer. |

No additional confirmed contract defect was found in this bounded extension. Do not infer acceptance
of still-authored Rust/Shell/copied-entry work from this statement. Recovered-resource correctness,
malformed protocol cases, installed reachability and owned cleanup still need the final whole-slice
evidence; this review did not substitute an assumed fault matrix or an implementation-reported count
for that evidence.

### Read-ahead identities

Paths below are relative to `H:/TakiAgent` unless prefixed `H:/hindsight/`. Hashes identify the bytes
read, including narrow referenced seams; they are not a frozen final input manifest. Unchanged Shared
deployment schema, Host registration, private sender and Catalog-selection hashes remain as recorded
above. The additional post-route regression is not covered by the test hash below.

| Inspected path | SHA-256 |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-deployment-owner.ts` | `07e034f1d820a095a4dc2703992be609a9e6820092b5e574412c06ce6e395b7d` |
| `packages/core/src/capabilities/capability-broker-state.ts` | `7db1e0adf4f2435f9272d0a561aefc5ce99099501788535c977ce37312548d61` |
| `packages/core/src/capabilities/hindsight-deployment-outcome.ts` | `f778824877a051fab5ba78f465e3f5e31c1c7931d9930265883407ed561b5167` |
| `packages/shared/src/governance-registry.ts` | `c2593dfc1451213c03e705be355f3bdc9cdc09f005802b9ec9b0d25ef4689de9` |
| `apps/hindsight-host/src/deployment-owner.ts` | `9a4998b184b439d9ae469f6bbcdfa12e7f7bc161b2bdefc9d3be1aef81f1fe4d` |
| `apps/hindsight-host/src/credential-source.ts` | `658bb65aea7c2088d2e7f2e16bc5b6dd2e0a721464e87ce9edabc3abd0db049e` |
| `apps/hindsight-host/src/docker-adapter.ts` | `645719dfecd52de481f032826e7f535455a057ed06e321843f78151f373bbe88` |
| `apps/hindsight-host/src/docker-process.ts` | `3979f4c2276ffd3ede148209cceb5fcd47689216437eacfaf052aeb7e592c5d8` |
| `apps/hindsight-host/src/deployment-registry.ts` | `18edaefcc3ff2e50916611a300f82589784ac0460363c4c93835c92c29f8d2cf` |
| `apps/hindsight-host/src/deployment-host.ts` | `be96cf9ec0d9018b6fc594ea4ed754fc8c9f724de9eec429d7aa407c13104697` |
| `apps/hindsight-host/src/deployment-core.test.ts` | `52eccb198c647304344bdefd6ffbb10f59084dda8e6531e76fd5644a0ccb21c0` |
| `apps/hindsight-host/src/deployment-owner.test.ts` | `bf8d3bc5222dae18c411e3b0d77bf05879a884157b2959b76ea26099048a6ccc` |
| `packages/shared/src/hindsight-deployment-schema.test.ts` | `605c174d7c3f67822de845aa3829c1b7c75f9c6b15a57376fb1dea11966069e8` |
| `H:/hindsight/docker/standalone/managed_bootstrap/owner.py` | `5b10f9f09def8ff985c96fed56c31f4ec4976f684d7e3b044fdc8a66afb38acc` |
| `H:/hindsight/docker/standalone/managed_bootstrap/owner_protocol.py` | `c8480e30f57962e024a5493ecb0d681ab7a7d3344e3da9f59729b0a7bcf8381c` |
| `H:/hindsight/docker/standalone/managed_bootstrap/control.py` | `b96283b65d4d800cd5f244398b0d922b3243c4bd1cfe163b1b51a3265378177a` |
| `H:/hindsight/docker/standalone/managed_bootstrap/fake_consumer.py` | `8ee15c7f21af13aa831f818c0d1fb98066aef2a899892db56654fbeb91d31d00` |
| `H:/hindsight/docker/standalone/managed_bootstrap/fake_child.py` | `81bed2f701222931648b9d96a4a83f4d3fc5b5ab61952d38c9cedeed4666a332` |
| `H:/hindsight/docker/standalone/managed_bootstrap/bootstrap.py` | `b8331bd8c9645d265578ed65f9f77402f170813f20d1d2683b5aa0a7d0768101` |
| `H:/hindsight/docker/standalone/managed_bootstrap/unix_socket.py` | `858292af24c0fae43aa4e3d43099b24018a13ed2ea944e4efb760f934a592db0` |
| `H:/hindsight/docker/standalone/managed_bootstrap/supervision.py` | `ff768434e0cef9eb2b6996351ba31e1dedede95211809d2ab8e8d09b5d9a5064` |
| `H:/hindsight/docker/standalone/Dockerfile.c2a-fake` | `2be1279ef4621f5d42397879fab2e436d780224eb3c02d591180faf9e9a9fcff` |
| `H:/hindsight/docker/standalone/tests/test_c2a_bootstrap_owner.py` | `46242bb2e410ad5b46505e4dbfb0fc9b89810330aaa33044998efb28218ce4fe` |

### Verification and handoff

- Lint: not run.
- TypeCheck: not run.
- Tests/builds/process experiments: not run by this reviewer.
- Writes: this report only.
- Provisional result: S1/S2 corrective code observed, including the remaining post-route S1 correction;
  final independent source/regression verification pending.
- SOURCE and CHECK SLOT: remain with the implementer. Root will issue the formal whole-slice task and
  final input manifest after explicit release. This updated report is released back to Root.

## Final independent C2a source verdict - 2026-10-14

**PASS: C2a source and substituted-engine real-process checkpoint.** SOURCE + CHECK SLOT released to Root.
This final disposition applies to the verified final snapshot; preliminary history above is preserved.
No SOURCE edits were made during the formal gate, and no confirmed source defect remains open.

### Findings (fixed)
- **S1 / P1:** final currency precedes Effect settlement; dispatched uncertainty suppresses accepted publication and cannot replay. Real Core/Host regressions pass.
- **S2 / P2:** actual Run/Attempt settlement is consumed; cancelled/replaced attempts cannot publish earlier success. Both repository regressions pass.
- **S3 / P1:** default Rust field teardown released guards/lock too early; explicit process-first Drop now reaps the resident first. Static review, Clippy and installed cleanup pass.
- Both admissions isolate snapshot runId enrichment with a top-level operator copy; fixtures reproduce production mutation and initial/new-startup paths pass.
- The implementer applied these corrections before formal handoff; the reviewer independently verified them.

### Findings (not fixed)
None within the source checkpoint. Docker/database/platform/receipt/provider acceptance remains separate.

### Verification
- Lint/TypeCheck: PASS - Core/Shared/Host types, 43 changed TS files, 8 changed Python files (Ruff/format/Linux-target ty), strict all-target Clippy.
- Tests: **182 passed**, four unchanged C1 manual fixtures ignored: Core/adapter/registry 28; Host 17; Native 4; Shared 121; Rust 10 + golden 1; installed 1.
- Reused the unchanged 42-case Core/C1 compatibility result after log-hash verification; it is not counted as an independent rerun.
- All 109 source hashes, 113 baseline entries and 54 original check records reconciled; 50 retained logs verified, four disclosed silent-command logs remain absent.
- Source tree SHA-256: b0e7896be6c5e49c7d588fb59a537787c1614c6bc302cacda30372c001eca2f9; formal review delta is empty.
- [Independent commands, hashes, per-AC evidence and limits](c2a-independent-source-evidence.json).
- Installed proof: G:/Temp/taki-c2a-source-20261014-impl/taki-c2a-fixture-f9a819b1-00c2-4475-9d41-d1b4d3132413.json.
- Proof SHA-256: bcf2221d8e9738b757eb9db950cb900e54666c70db04178135f149dd38d49ba0.
- Real Core/operator -> Rust Gate -> protected copied Host/fixed adapter -> fake executable/private pipe -> Native owner/child passed, with one of each effect/grant/submit.
- Installed teardown asserted PID 33644 exited and removed its marked C: root; ownedCleanup is true.
- Retain G:/Temp/taki-c2a-independent-20261014-check and implementation staging for Root. A later Ruff-cache cleanup tool call was interrupted; cache deletion is unconfirmed.
- Root owns final preservation/reconciliation/staging cleanup. No further checks or process/cache mutations after ownership release.
- All deployment statuses remain deploymentReady: false; no Docker/DB/Linux C2 socket/C2b/C3/manual acceptance is claimed.
