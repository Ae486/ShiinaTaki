# Unified Companion initiative — implementation plan

## 1. Entry gate and task tree

This parent owns the consolidated design, source precedence, child dependencies and full first-delivery acceptance. The older `09-08-t4-heartbeat` parent retains discovery/owner decisions. No implementation acceptance is implied by the prepared documents.

Review `prd.md`, `design.md`, the decision/reference register and child artifacts before starting production work. The parent owns the approved baseline integration; afterward activate the child that owns the next deliverable. Task creation itself did not start implementation.

The owner approved development on 2026-09-16 and explicitly authorized a T4-local source snapshot. The [September 19 snapshot contract](research/baseline-snapshot-contract-2026-09-19.md) selects committed main `516e151` through migration 048 and controls the integration. It supersedes the unresolved source choice in the [historical preflight](research/baseline-integration-gate-2026-09-16.md). Integrate and verify the pinned source while preserving main and existing T4 work, then activate child 1.

| Order | Child | Prerequisite and independent deliverable |
| --- | --- | --- |
| 1 | [Runtime foundation](../09-11-initiative-runtime-foundation/prd.md) | Establish compatible Memory/schema baseline, then implement shared admission/context/terminal/delivery/Monitor adapters and User Timezone service. Prove one injected eligible opportunity through the existing execution pipeline. |
| 2 | [Presence and feedback](../09-11-initiative-presence-feedback/prd.md) | Requires foundation delivery identity/report seams. Add real Desktop/source evidence, generation retirement, User Timezone device reporting and response-opportunity facts. |
| 3 | [Patterns and authoring](../09-11-initiative-pattern-authoring/prd.md) | Requires foundation and presence contracts. Add typed Pattern authority, supported Signals/Wake Policy, explicit setup/Skill and the complete conversational/panel authoring loop. |
| 4 | [Intentions and acceptance](../09-11-initiative-intentions-acceptance/prd.md) | Requires the preceding three. Add automatic finite Intentions, bounded related-memory follow-up, final backoff integration and full real-runtime/UI/recovery acceptance. |

Dependencies are explicit; the task tree is not a scheduler. Do not run overlapping production edits in parallel. Research or bounded independent test work can be delegated separately. The first three children are implementation slices, not a reduction of the promised first delivery; all four are needed to close this parent.

## 2. Baseline integration before new writers

- [x] Recheck cwd, branch, worktree list, native `task.py current --source`, working changes and incoming main. Preserve unrelated Avatar Lab/OpenBiliClaw work and other worktrees.
- [x] Record exact current heads and planned integration scope. Reuse main's existing Memory 036/040 convergence and migration-runner changes; do not rename/rewrite applied 035 history or invent another bridge.
- [x] Reconcile current Memory source/confirmation/derived-freshness, runtime provider/context/tool composition and ADR 0009 against the selected B6 checkpoint. Live main implementation does not establish integration into T4 or passed owner acceptance; preserve the recorded provider limitations and separate B7 scope.
- [x] Reconcile the meaning of T4/main D77/D78 by content, not equal numbering. No unrelated deferred item is absorbed automatically.
- [x] Verify supported fresh, T4-applied and main-applied lineages with populated isolated fixtures; unknown/unmappable historical state must refuse atomically. Reserve later migration numbers only after inspecting the integrated registry.
- [x] Establish an isolated compatible baseline for primary chat, Scheduled execution, Monitor replay and canonical Memory reads. No real user database migration occurs as a planning action.

This gate is part of child 1. A new production writer must not land on a guessed migration or Memory contract. Git integration/commit boundaries still follow the owner's actual authorization; the plan itself does not run those actions.

Baseline gate passed on 2026-09-20; see [formal review](research/baseline-review-2026-09-20.md) and `research/baseline-verified-source-2026-09-20.json`. Primary/Scheduled/Monitor compatibility is covered by automated regression evidence; isolated boot proves process lifecycle only. Native/owner acceptance and actual initiative execution remain pending.

## 3. Child 1 — shared runtime foundation

- [ ] Add strict selected-context, structural-decision, delivery/continuation and bounded policy contracts in Shared. Add v1/v2 event readers before new business-event writers; retain old history and compatible Monitor projection.
- [ ] Extend the existing Character coordinator with primary reservations before asynchronous admission, priority/FIFO/cancellation cleanup and atomic background reservation. Adapt primary/Scheduled call sites without introducing another queue.
- [ ] Add the initiative Run adapter over existing RunService and ChatAgent. Use stable opportunity identity, current policy/source checks and an actual thin request through the existing request-preparation seam.
- [ ] Add captured stricter-only tool policy and the registered `heartbeat_respond` control. Stop only on an accepted structural decision; preserve primary presentation behavior and telemetry.
- [ ] Implement shared delivery state/repository and transaction-aware ordinary Timeline append. Separate model-opportunity reservations, publication quota, transport result and presentation evidence.
- [ ] Implement same-Run presentation hold/resume plus recovery classification together. Release the Character slot while held; no effect after terminal state, no model rerun and no new delivery Run.
- [ ] Extend existing sender/Monitor projections with real staging/dispatch/unknown/expiry facts. Integrate the Scheduled result consumer with Class A policy and ordinary delivery instead of discarding text.
- [ ] Extend the existing User Timezone singleton/service with fixed/follow-primary-device contracts and schedule future recomputation. Desktop reporting/UI is completed by child 2.
- [ ] Prove an eligible test opportunity -> existing Run/Attempt -> same Agent loop -> silent/express/speak -> existing Monitor/Timeline path, including crash cuts and primary-priority races. Keep autonomous dispatch disabled by default until required source/setup slices exist.

Rollback point: compatible readers and additive repositories may remain installed with initiative admission/presentation disabled. Do not downgrade the DB to a binary unable to parse new events.

## 4. Child 2 — presence, presentation and response opportunity

- [x] Preserve nullable idle and actual routed Host/connection/catalog metadata in accepted Perception evidence. Introduce an observation/consent generation, including post-await validation for foreground/VLM results.
- [x] Add Shared source/report validation, Core connection-bound leases and aggregate presence. Separate each Home/Chat/Pet source even when they share operator device identity.
- [x] Add source-owned Desktop direct-interaction and own-surface reporters. No extra sampling, content/key/pointer telemetry, input-age reset on renewal, or replay on reconnect.
- [x] Add actual committed-message exposure reporting at Chat/Pet render/visibility seams. Preserve reading position, focus, layout and existing connection generation rules.
- [x] Compute bounded same-attributable-device response intervals and one feedback disposition per Class B utterance. Unknown/offline gaps remain uncounted; false Node/operator co-location is forbidden.
- [x] Add User Timezone settings and designated-device reporting through the child-1 authority; verify fixed mode, last-known offline behavior, stale/foreign report refusal and existing schedule future recomputation. The new Pattern consumer and its future recomputation integrate in child 3.
- [x] Feed actual presence/presentation/feedback facts into existing Monitor projections without treating them as reading evidence.
- [x] Verify simultaneous windows, null idle, pause during async capture, replacement, reconnect, partial visibility and phone-shaped protocol fixtures. Native coverage limitations remain explicit.

C2's implementation and automated/native-fixture gate is recorded in the
[September 28 evidence](../09-11-initiative-presence-feedback/research/implementation-evidence-2026-09-28.md).
Independent QQMM root-lint and dependency reproducibility limitations remain separate. Owner acceptance and full
Live2D experience remain pending; these implementation checks do not close the parent. Child 3 is next, not activated.

Rollback point: disable reporters/consumers, retire source leases and retain compatible evidence readers. Do not reclassify unknown gaps as negative feedback after reenabling.

## 5. Child 3 — Patterns, wake policy and full authoring

- [ ] Implement one Pattern/revision/CAS authority and bounded supported-condition grammar. Seed, user and Agent proposals share it; no arbitrary evaluator or per-behavior engine.
- [ ] Implement accepted Signal adapters, candidate coalescing/selection, deterministic chance, current source/target/quiet/budget checks and bounded pre-admission policy diagnostics.
- [ ] Bind cadence/events to the same adapter and global budget. Add one explicit initiative target; imported Characters do not automatically subscribe, and target/zone changes cannot reset counters or reuse stale output.
- [ ] Add primary conversation tools and Core operator methods for candidate/revision/management. Confirmation activates only the concrete current proposal; stale/duplicate paths are explicit and permission-independent.
- [ ] Reuse the approval-card visual primitives with a Pattern controller and meaningful fields. Complete create/clarify/review/confirm/activate/revise/pause/resume/history/rollback in conversation and panel.
- [ ] Ship/import the authoring runtime Skill through the existing package/lifecycle and explicit setup. Protect same-name user packages, disabled state and revision-bound replacement. No developer Skill directory or legacy seed bypass.
- [ ] Add readable configuration/setup for target, sources, timing/caps and effective User Timezone; enable only a reviewed seed set. Do not silently adopt every seed on upgrade.
- [ ] Show all new policy/decision facts in the existing Monitor; prove adding a second supported behavior changes data rather than model-loop/control code.

Rollback point: pause Pattern admission and disable Class B dispatch while preserving revisions, user edits and diagnostics. Already committed Timeline history is not undone.

## 6. Child 4 — finite Intentions and complete acceptance

- [ ] Add the source-bound automatic Intention operation through primary Agent tools and Core authority. No extra extraction model or legacy MemoryRepo dependency.
- [ ] Implement immutable source-opportunity deduplication, finite due/expiry, transactional claim/link, same-Run retry/disposition and expired-source non-renewal.
- [ ] Add the due-Intention Signal and bounded provider-neutral related-memory read/context seam. Underlying factual Memory is never deleted/resolved by plan expiry or a generic user reply.
- [ ] Complete feedback-driven next-eligibility/backoff consumption using real child-2 evidence and the established stage/reset rule; hard caps remain independent.
- [ ] Prove the missed-interview path: old Intention expires offline; new independent eligibility may recall the matter and ask before a user message; old trigger/text remain closed.
- [ ] Run the full acceptance matrix, migration/crash/reconnect/privacy/primary regression and native multi-window flows. Recheck supported Memory authority/degraded states without automatic authority promotion.
- [ ] Update affected executable specs, indexes and parent evidence. Keep deferred D79/D78/phone/evolution boundaries explicit.

Rollback point: stop new Intention creation/admission and Class B output; retain finite expiry/tombstones and ordinary Memory/Timeline history. Rollback does not resurrect old opportunities.

## 7. Acceptance ownership

| Parent criteria | Primary evidence owner | Required integration evidence |
| --- | --- | --- |
| AC01, AC09-AC11 | Child 1 | Child 4 reuses real producer paths, not only a builder fixture |
| AC12-AC13 | Child 1 + Child 3 | Child 4 global budgets, concurrency, late callbacks and restart |
| AC14 | Child 1 + Child 2 + Child 3 | Post-await pause/source retirement and no stale output |
| AC15-AC16 | Child 2 | Child 4 backoff consumers and phone-shaped/no-device-association cases |
| AC02-AC06 | Child 3 | Child 4 actual complete authoring and multi-candidate behavior |
| AC07-AC08 | Child 4 | Actual source/Memory/expiry behavior on shared Run pipeline |
| AC17 | Every producer child | Child 4 mixed-version live/replay equality and same Monitor |
| AC18 | Child 1 | Recheck after all additive migrations, including safe unsupported-state refusal |
| AC19 | Every child + parent integration | Distinct automated, isolated runtime, native and owner-only evidence |

All acceptance boxes remain pending until implementation supplies evidence. Research/source assertions are not green test results.

## 8. Verification commands and scenarios

Use the actual package scripts; root owns lint. Run focused tests while implementing, then the proportional full gate once changes stabilize. Existing regression anchors are listed in the two research reports. New test filenames are chosen by their owner alongside the changed module.

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/desktop typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core test
pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop build
pnpm lint
git diff --check
python .trellis/scripts/task.py validate <active-child-path>
```

For the actual Core/Node process path, use `e2e/` and its existing `withStack`/loopback provider fixtures. Add focused initiative scenarios, then run:

```text
pnpm --filter @taki/e2e typecheck
pnpm --filter @taki/e2e exec vitest run src/initiative-runtime.e2e.test.ts
pnpm --filter @taki/e2e exec vitest run src/initiative-recovery.e2e.test.ts
```

Those two initiative E2E files are new child-1/child-4 deliverables. Use isolated temporary data/ports, a deterministic local provider, authenticated clients and bounded teardown. Do not add a production bypass to make the test possible. Real model/provider trials use existing authorization and are recorded separately from local scripted-provider checks.

If Rust source, self-window reporting or Tauri capability declarations change, add the relevant native tests and run:

```text
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings
```

Required scenario groups:

1. Actual outgoing request: thin context, captured source/authority, same Main Model, no primary memory/pressure side effects.
2. Negative eligibility: zero model/Run growth for repeated idle checks, unsupported/null/stale data, quiet/busy/privacy/budget failures and source replay.
3. State/crash cuts: claim/admit/link, decision commit, hold, quota/Timeline transaction, fan-out uncertainty, executable dispatch/settlement, restart and cancellation.
4. Real sources: nullable idle, host/source changes, late foreground/VLM publication, separate window lifecycles, actual rendered message exposure and unknown device association.
5. Product loops: concrete Pattern confirmation/CAS, user edits preserved across seed/Skill updates, finite Intention expiry and new-memory follow-up.
6. Existing Monitor: same Run identity, model/tool metrics, business events, pre-admission policy counts, mixed v1/v2 reopen, bounded cursors and observer failure isolation.
7. Regression: primary chat streaming/scroll/geometry, Scheduled Class A, existing permission/Host/costume semantics, local/canonical Memory and migration history.

Native UI acceptance must cover actual WebView2 Chat/Pet visibility/minimize/focus, whole-utterance rendering, multiple windows, reconnect and stale callbacks. Browser fixtures or a reported ACK cannot certify human reading. Preserve independent operator evidence for subjective noise, Persona quality and usability. Do not mark those owner trials passed without the owner's confirmation.

## 9. Dispatch and change control

Main-session production work uses `trellis-implement`, followed by `trellis-check`, then the appropriate spec update. Each dispatch starts with `Active task: <the native current child path>` and explicitly names ownership, parent/child artifacts, source precedence, validation and no-commit boundaries. The implementer reads curated JSONL entries, child PRD/design/implement, then named parent sources.

Use the inherited model/effort unless the owner or applicable current instructions specify otherwise. Historical research/task examples are not authorization to change agent models, add dependencies or run another worktree.

If a missing detail is engineering-only, descend into the cited source/code/installed API and update the design before diverging. Reopen one focused grill question only for the product changes listed in the decision register. Do not reopen accepted scope, create a second runtime to avoid a seam, or silently postpone an accepted requirement.

## 10. Planning validation versus implementation evidence

Planning validation checks task links, required artifacts, complete acceptance mapping, curated context paths, source/version claims, UTF-8/no-BOM and whitespace. It does not execute production tests or certify behavior. Store that result in `research/planning-validation.md` after the document review.

Implementation evidence records actual commands/results, runtime profile/lineage, screenshots where relevant, limitations and pending owner checks. Do not archive/finish, commit or push solely because the planning files are complete.

## 2026-09-28 integrated child-4 gate

C1-C4 engineering implementation and integrated verification are recorded in
[C4 implementation evidence](../09-11-initiative-intentions-acceptance/research/implementation-evidence-2026-09-28.md),
including the complete AC01-AC19 evidence map, real model compatibility, native-fixture boundaries and source audit.
Owner acceptance remains pending. Follow the
[four owner flows and verified production Shell isolation limits](../09-11-initiative-intentions-acceptance/research/owner-manual-acceptance.md)
before claiming the full first delivery accepted. No next implementation child, commit, push or archive is implied.
