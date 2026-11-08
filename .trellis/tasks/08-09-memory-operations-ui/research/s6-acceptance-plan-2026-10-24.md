# Hindsight journey acceptance and owner observations

Updated 2026-10-28 after the owner prioritized practical use and plan contraction.
Owner: the existing B7 parent. This is the existing acceptance map, not a new task or ledger.
No case, build, service or owner criterion was executed or accepted by this update.

Read the [2026-10-29 evidence and wiring audit](first-use-evidence-2026-10-29.md) before executing
these allocations. D78/D77/B6, the corrected real Native smoke, W5/W6/W8 and Stage 5B already supply
bounded passing evidence. Reuse it for unchanged behavior and verify current UI, configuration,
template/migration and build differences. The case table allocates coverage; it does not mean every
listed journey is untested or must be recreated. No current full-build PASS is inferred by reuse.

## Delivery scopes and entry conditions

The [current execution plan](../implement.md) supersedes the former global C2b entry gate and
all-upgrades-before-first-use scheduling. Retain the original [C01-C16 cases](../../09-14-hindsight-integration-completeness-audit/research/closure-plan.md)
and [accepted preservation amendments](../../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md).

| Delivery scope | Start when | Evidence required before claiming that scope usable |
| --- | --- | --- |
| First existing-instance use | Actual compatible Taki/Native builds and a controlled isolated setup are available. C2b/D1 completion is not required. | C01; existing-instance C02/C03; ordinary Bank/use/sync/reopen parts of C04-C06/C09; applicable current-platform and template parts of C12/C16. Keep the actual case boundaries explicit. |
| Existing backup and transition journeys | Their implemented producers and isolated inputs are available. | Relevant C07/C08/C10 subcases; do not wait for unfinished candidate-upgrade work merely to exercise existing backup/transition behavior. |
| Managed installation/model application | The selected managed path has a real producer and connected setup/configuration controls. | Managed C02 and affected C04/C09/C12/C16. Required API/authentication/persistence and cleanup checks remain; diagnostic relay or tokenizer results alone are insufficient. |
| Full software/model upgrades | D95 is resumed for a concrete upgrade or the post-first-use lifecycle increment. | Complete applicable C11 plus upgrade-related C02/C09/C10/C16, including needed model transformation and guarded publication. A refusal is not upgrade support. |

First-use delivery is not full parent completion. D94-D96 in
[Deferred Decisions](../../../../docs/deferred-decisions.md) retain the remaining work and triggers.
Supported-platform claims cover only verified environments. A postponed failure matrix does not
excuse a known reachable defect in a path being enabled.

## Execution order and proportionate evidence

1. Identify the actual tested source/build/schema, relevant uncommitted changes, environment and
   controlled inputs. Keep one concise reproducible run record; do not require a new full-tree
   hash-release packet for every unchanged prerequisite.
2. Reuse the existing Native smoke and integrated fixtures, supported service entrypoints and package
   tooling. Preserve the no-original-data/no-paid-call boundary; controlled-provider results are
   distinguished from real-model evidence. Do not automatically require a new network-none relay.
3. Run affected checks once for the increment, then exercise actual registered operations and Home.
   Do not seed ready receipts or authority markers to bypass the user path.
4. First journey: Local onboarding -> existing-instance setup -> activation -> Global/Character
   retain/recall -> incremental sync -> Home reopen/Core restart -> bounded outage/Pending recovery.
   Repair actual blockers and document usable setup steps before expanding experimental coverage.
5. Exercise existing backup/transition branches on isolated data as their paths become ready.
   Verify backup/recovery capability and the concrete paired backup before original-data activation.
6. Present the four D89 owner observations together for the first usable scope when their machine
   prerequisites pass. Do not wait for unrelated managed or upgrade work. Preserve later lifecycle
   acceptance as unfinished; request only affected additional observations after later changes.

Use necessary targeted regressions for deterministic contracts and hard-to-reproduce failures, one
independent challenge for material design changes, and one consolidated review per completed increment.
A defect or changed dependency justifies additional checks; routine intermediate packets do not.

## Case allocation

All statuses here are allocations, not new PASS claims. The original case text remains authoritative.

| Case | Integrated machine work | Required producer or remaining dependency |
| --- | --- | --- |
| C01 | Empty and supported historical Local onboarding, exclusions, resume/verify/activate and ordinary Local memory use. | Existing Stage 2a producer; new intended-build journey remains to run. |
| C02 | Existing and managed setup, authenticated observation, template initialization, actual configuration/readback, interrupted original attempts. | C2b enables managed setup; C3 is still required for complete model apply/readback. `modelHealth: not-run` is not model readiness. |
| C03 | Complete current-Local capture/import/maintenance/replica/activation with real foreground/background writer drain, late source commitment and pre/post-COMMIT recovery. | Existing activation and Stage 4 custody foundations; new integrated source/runtime path. |
| C04 | New Character Bank readiness, existing-Bank failures, credential/configuration changes and recovery without authority drift. | Existing Bank/lifecycle producers plus affected C3 configuration behavior. |
| C05 | Real registered chat/tools, Global/Character isolation, source routing, retain/recall, mutations, Blocks and maintenance. | Machine semantics use controlled providers; subjective actual-model quality is D89 item 4. D81 remains separately disclosed. |
| C06 | Incremental/full sync, lost Native/application replies, restart, superseded revisions, due catch-up, manual mode and truthful Pending/unknown results. | Existing sync/recovery producers; exercise through actual integrated operation paths. |
| C07 | Local -> Hindsight -> Local -> Hindsight with additions, edits, invalidation/restoration, policy/expiry/deletion and Blocks; queued writes and old-reference refusal. | Stage 4 and final live custody/lease checks. Reuse identities/baselines; no default full retransmission into new Banks. |
| C08 | Unavailable provider, incident snapshot, explicit takeover, missing-interval display, restart and foreign-old-provider exclusion. | Existing emergency producer on disposable copies; no original-data takeover in machine fixtures. |
| C09 | Admitted operation survives initiating Home closure/reply loss; two observers, cancellation stages, stale epoch/revision and recovery retain one identity. | Existing operation owner plus each new C2b/D1/D2 producer. Home is not an operation ledger. |
| C10 | Complete paired capture/admission/verification, credential custody, isolated restore and original unresolved-work recovery. | Existing Stage 3 plus accepted 5B v2 template proof; D1 adds physical candidate/inventory evidence, not a weaker restore rule. |
| C11 | Same-version candidate baseline, declared forward path, complete model transformation where needed, validation, final publication and committed-candidate recovery. | D1 -> C4 -> D2. Same-dimension semantic model change and changed dimensions are both required. D1-only restore or refusal of an unsupported model change cannot close this case. |
| C12 | Intended installed payload, Windows and supported headless custody, actual Native build, persistent storage, restart and same-Core client authentication. | C1 platform AC2/6 remain open until actual compatible-environment evidence. C2b Windows/Docker proof cannot close headless service acceptance. |
| C13 | Optional vectors/export only if advertised. | Keep visibly unavailable or validate their separately scoped implementation. Do not make them a new sparse-Local prerequisite. |
| C14 | Accurate disclosure of derived freshness, retention/review/assessment/promotion/latency limitations. | Preserve D79-D83, including the recorded D81 limitation. Disclosure PASS does not mean the deferred feature passes. |
| C15 | Same-Core supported boundary and explicit no-merge/remote-Core limits. | D23 remains separate; do not add independent-Core merging to this task. |
| C16 | Template/user-overlay apply/customize/update/remove and neutral fallback, carried intact through backup, D1 restore and D2 upgrade. | Accepted 5B foundations plus the new candidate/publication edges. Complete restore evidence does not alone close upgrade. |

C02/C09/C12/C16 span several producers. Record subcases without closing the entire case from one passing slice. Preserve failures and corrected reruns; do not describe a combined unchanged baseline plus targeted reruns as a newly executed full suite.

## Engineering work that is not D89

- **D88:** prove the supported remedy and ownership for persistent activation `target_conflict`; ordinary transient retry is not that remedy. Allocate to Stage 5 Home/admin and test it before claiming the complete corresponding journey.
- **D90:** prove deliberately owned cleanup of backup/staged/refused/incident/Native/candidate artifacts, preserving the only recovery point, historical receipts and unresolved references. Test candidate disposition as part of D1/D2 integration; a failed test artifact is not automatically disposable.
- **D91:** prepare and verify the paired stopped-Core/Native restore procedure and its explicit original-environment boundary. The isolated drill is evidence for its scope; it does not authorize replacing the owner's actual database.
- **C2a residual faults:** inner Native ACK/effect-loss and shared-daemon restart remain distinct from accepted outer-completion-loss/container/PG restart cases. Preserve their coverage status. Shared-daemon interruption must use an environment where unrelated workloads are unaffected.

These are engineering outcomes or bounded environment cases. Do not transfer them to the owner as subjective acceptance questions.

## Verification commands and runtime preparation

At an integrated implementation boundary, applicable package scripts include `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, and per-package `pnpm --filter <package> test --maxWorkers=2` for Shared, Core, Desktop and Hindsight Host. Include other affected workspace packages rather than silently excluding them. Desktop UI build is `pnpm --filter @taki/desktop build`; installed delivery uses the existing root `desktop:build` pipeline. Rust checks use the affected Cargo manifests and strict Clippy. Record the actual Native runner invocation and relevant inputs, reusing existing fixtures where applicable; do not use a convenience development command that reads the owner's `.env`.

These are future implementation checks, not commands to run for this document-only update. The root test/typecheck scripts use parallel recursion; use explicit serial package scheduling for the constrained heavy slot. Builds, temporary data and retained runtime evidence use explicitly owned G: staging with the established protected C: fixture exception when required by Windows ACLs. H: had only 2,480,586,752 bytes free at the preparation snapshot; recheck before every material allocation, with no automatic cleanup or cache migration.

Each journey record contains the case/subcase, relevant build/environment and input, reproducible command, expected and observed result, `passed`/`failed`/`not-run`/`blocked`, necessary failure evidence, owned resource disposition and remaining owner observation. Reference existing producer identities where relevant rather than duplicating their ledgers. Ordinary records exclude secrets and sensitive source bodies. Missing model metrics remain unknown.

## D89 owner observations for the stated delivery scope

The packet indexes machine evidence for the stated usable delivery scope. Present the four existing D89 observations together once that scope is ready; full model-upgrade completion is no longer a prerequisite for first-use feedback. Report later managed/upgrade/platform cases explicitly as unfinished, and do not use first-use acceptance to close them. A blocker within the presented scope must be fixed before asking the owner to accept that scope.

Credential wording is grounded in the existing Secret Catalog contract, not a new storage design: `hindsight-secret-refs.ts` resolves the API key from encrypted TSC1; `secrets/master-key.ts` and the Windows helper obtain only its master key from Credential Manager. D89 item 2 retains real app entry and Windows ownership observation, with that distinction clarified in `docs/deferred-decisions.md`. It does not promise a nonexistent direct API-key entry or add a fifth manual item.

| Owner-only item from D89 | Preparation supplied once | Owner result |
| --- | --- | --- |
| Real Tauri appearance and click-through of the Stage 1/2 cards. | Exact intended build, short navigation script, automated loading/empty/error/progress/success/reopen evidence and relevant new-flow context. | One explicit accept/reject with any observed issue. Browser rendering is supporting evidence, not the judgment. |
| Enter the real Hindsight key through the app and verify Windows credential ownership. | Generated-value set/clear/presence and non-disclosure checks first; show encrypted-catalog value-free presence and the Windows catalog master-key entry without reading either secret back. | Owner performs real entry and confirms the expected ownership/presence behavior. No secret-valued screenshot or log is required. |
| Activate the owner's existing real Hindsight instance with real data after Stage 3 backup exists. | Passed isolated complete journey, current paired backup/custody/recovery prerequisites and a concrete preview of the exact real-instance action. Existing-instance independence remains intact. | Owner explicitly authorizes/performs the bounded action and confirms its result; preparation is not original-data mutation authority. |
| Subjective recall quality with the real model. | Exact model/configuration identity, agreed representative questions and concise factual provenance/observations. Automated correctness and quality judgment remain separate. | Owner's quality judgment; a health check or mocked provider never substitutes for it. |

Present all four items together, state which machine/environment results support them, and record the owner's actual response. Do not mark human criteria passed from agent screenshots, automated tests or prior unrelated confirmations. Do not ask for the same accepted authorization again; new original-environment effects are made concrete in this one packet.

## Current preparation result

This plan maps the original cases, required producer dependencies and exact D89 boundary. No case, build, real service, original environment or manual criterion has been newly accepted. The execution map and child plans own implementation scheduling; this document owns only the Stage 6 journey/packet contract.
