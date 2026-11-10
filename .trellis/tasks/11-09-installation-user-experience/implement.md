# Execution plan: simpler flows and live configuration

Status: implementation and integration checks recorded on 2026-11-10. S0-S4 and the Local/Legacy index/listener
part of S5 are implemented. S6 has deterministic, real-Core and native UI evidence; owner acceptance and the
reserved Hindsight work remain open. See `research/delivery-20261110.md` for current results and quality limitations.
The [PRD](prd.md) owns scope and acceptance; [design](design.md) owns shared contracts.
No child tasks or new runtime authority are created by this document.

The owner resumed S6 packaged acceptance after binding this existing task. Current
follow-through is tracked in [the acceptance record](research/desktop-acceptance-20261110.md):
packaged model-profile interactions and repeated Core configuration cycles passed.
Imported-avatar checks exposed selected-profile asset resolution, stale Pet costume
metadata and Home's unsupported current-costume highlight; all three are repaired
and passed actual packaged first-import, replacement/failure and reload checks.
Loaded-scene measurement also led to a verified native-focus seeding correction.
Independent review, focused/full applicable checks and bounded resource comparisons
are recorded; owner acceptance and long-duration resource guarantees remain open.

Owner boundary update (2026-11-10): Hindsight internal changes are frozen in favor
of the concurrent dedicated task. This session's transport generation/rebind and replica-index changes were
selectively withdrawn; only documented necessary shared
startup/Utility adapters. See `research/hindsight-change-inventory-20261110.md` for
exact file ownership, withdrawal and remaining compatibility evidence. The original
Hindsight S5 acceptance is a coordination dependency, not passed or silently removed.

## Sequence and integration rule

Work in the following order, retaining one end-to-end delivery. S1 and S2 may proceed
in parallel only after S0 agrees on shared protocol/profile discovery boundaries.
S3 integrates them before expanding configuration families.

| Slice | Deliverable | Depends on | Completion evidence |
| --- | --- | --- | --- |
| S0 | Lock narrow interfaces and resolve local-bootstrap/model-capture feasibility | Planning review | No-model isolated proof and reviewed contracts. |
| S1 | Basic Core/Home available with empty/incomplete configuration; source precedence | S0 | Actual Core with empty profile, stable config/history/status APIs, no model call. |
| S2 | Normal local entry without codes; Shell initialization isolated | S0 | Both startup orders and three operator clients plus Node connect automatically. |
| S3 | Main/Utility drafts, secure save/apply, first reply and subsequent model changes | S1, S2 | Same-running-process first-use and concurrent old/new-Run evidence. |
| S4 | Scalar, prompt, policy, privacy, retention and prepared-query application | S3 | Consumer-family regression matrix; no duplicated workers or stale evidence. |
| S5 | Controlled index, listener and active-integration reconfiguration | S3, relevant S4 owners | Recoverable component transitions; original data/authority retained. |
| S6 | Full journey, native UI and documentation/spec convergence | S1-S5 | PRD coverage, exact remaining limitations, separate owner acceptance. |

The old 10-18 engineer-day installation estimate is historical context only. Re-estimate
after S0 establishes actual helper and captured-model changes; do not promise that
estimate for this materially different scope.

## S0 — Interfaces and feasibility

Read original requirements and existing owner contracts before changing implementations.
Independently challenge the selected architecture once, then resolve real disagreements.

1. Freeze readiness/profile/application concepts in Shared: observed service state,
   desired/applied revisions, explicit no-auth/disable/inherit/reset, unavailable
   feature results, and compatibility with scalar config consumers.
2. Confirm the owner-selected application > environment > default precedence and
   existing-value adoption fixtures. Cover legacy rows previously hidden by env;
   do not preserve env locking through a new undocumented compatibility branch.
3. Isolate the existing native helper build/discovery under both separate commands.
   Prove credential create/read races, native server authentication, ticket binding,
   replay rejection, stale endpoint recovery and both process startup orders.
4. Prototype one newly admitted Run capturing a model and context revision while a
   previous admitted/queued Run keeps its own identity/credentials/policy. Use a local
   deterministic compatible server; no paid provider call is needed.
5. Capture representative before-change journeys and local performance baselines:
   Home/basic-service startup, configured idle CPU/memory, local request overhead,
   apply/reconnect latency, and repeated-change resource retention. Use isolated
   fixtures and a deterministic endpoint to separate local costs from provider latency.
6. Evaluate maintained frameworks/libraries where they can remove meaningful custom
   code; compare compatibility, lifetime management, measured overhead and maintenance.
   The owner permits adoption. Do not force bespoke infrastructure to avoid dependencies.
7. Keep feasibility scoped to this flow/configuration task; do not expand it into an
   installer, unrelated service manager or remote-auth product.

Targets: Shared config/auth/Run schemas; Core boot/config/harness; Shell helper/keyring
and operator connection boundaries. Update required specs in the same implementation
slice that changes their contracts, without presenting future behavior as shipped.

## S1 — Empty configuration and source ownership

- Separate DB/config/secret-health/device/history/resource/status composition from
  Main/Utility model-dependent construction. Bring the basic WS service up with
  absent models; register stable methods with dependency-scoped admission checks.
- Change ConfigSource/writer and CLI/UI source metadata together. Application-saved
  values win, including false and zero. Keep data root bootstrap-governed.
- Treat invalid feature configuration as a visible scoped problem, not successful
  defaults or a global crash. DB corruption and invalid bootstrap transport are
  distinct failure classes; never reset an existing profile.
- Keep Memory authority selection and persisted scheduler state; only block work
  whose actual dependency is unavailable. Independently configured Utility may run.
- Make readiness subscribable with generation-safe reads. Home remains navigable
  when Core is unavailable; avoid fabricated diagnoses.
- Verify empty profile, Main partial, Utility partial, independent Utility, unreadable
  catalog, invalid feature settings and existing-history reopening. Assert zero
  provider calls during startup/status/config reads.

Targets: core-bootstrap.ts, main.ts composition modules, config-source/config-writer,
Memory composition and relevant admission adapters, Shared, CLI, Home/Settings.

## S2 — Remove local connection ceremony

- Open Home before fallible Shell Node/browser initialization; use local recovery
  state when optional config or credential reads fail.
- Implement the S0-proven native bootstrap route and helper preparation in the
  existing separate component commands. Preserve profile identity namespaces.
- Reuse DeviceRegistry, role checks, Permission Gate and independent Home/Pet/Chat
  generations. Remove the normal native connection-code page/fields and redundant
  prerequisite gates. Preserve explicitly supported remote/headless pairing.
- Define the old loopback-trust option's compatibility behavior explicitly; do not
  expand it to Node or bypass credential revocation.
- Verify Core-first, Desktop-first, unavailable Core, repaired optional adapter,
  simultaneous windows, reconnect, stale endpoint, replayed ticket, unrelated
  Origin/client, denied native role, and unchanged capability permission decisions.

Targets: Shell lib/node/browser initialization and keyring/helper modules, Tauri
window/capability declarations, operator-auth/device identity/recovery, Core connect
and device registry, Shared wire schemas, existing development scripts.

## S3 — Model drafts, application and Run capture

- Add a coherent Main/Utility profile editor within existing Settings/Chat entry
  points. One ordinary complete-profile save applies it; incomplete draft save is
  allowed. Test remains optional and explicitly cost-labelled.
- Implement credential-reference staging, candidate publication, expected revisions,
  last-applied selection and crash reconciliation in the existing Core SQLite and
  Secret Catalog owners. Preserve masked/presence-only reads.
- Support keyless compatible services; enforce only locally necessary connection
  structure. Never require model catalog membership, list-model success or an
  automatic provider probe.
- Bind model/prompt/context/identity at admission and retain through retries, queue
  wait and continuation; propagate the same identity into Run receipts and usage.
  Calibration from an old binding cannot alter a new one.
- Keep Utility's one queue; implement inherit, independent profile and disabled.
  Main/Utility clear must suppress environment resurrection; reset intentionally
  resumes fallback and shows it.
- Verify first reply after empty startup, same-conversation model switch, active and
  queued old work, Main absent/Utility present, failed secret or DB writes, failed
  preparation, competing editors, dropped acknowledgements, restart reconciliation,
  explicit no-auth/disable/reset, and no secret leakage in ordinary state/logs.
- Exercise at least one actual live-reload configuration path through the native UI.
  A local deterministic endpoint proves wiring; real-provider behavior is a separate,
  explicitly authorized observation, and owner acceptance remains unmarked.

Targets: profile/config/secret services and Shared APIs; run-service/snapshot capture,
ChatAgent and Utility admission; calibration/usage projection; existing Home drafts,
config controller and connection recovery.

## S4 — Remaining ordinary application families

Use [the complete matrix](research/config-runtime-application.md) as the checklist.
Do not defer the 31 restart-labelled keys as a block or trust the 52 live labels.

- Logging and existing live timing/initiative/permission consumers: preserve actual
  boundaries and verify current generation handling.
- Prompt and context policy: replace the producer/capture at new operation boundaries.
- Tidy/compaction/pinned context: one existing queue/owner and coherent operation limits.
- Ambient sampling/retention and attachment GC: one restartable owner; immediate
  privacy retirement, protected leases and clear old-content effects.
- Legacy BM25 prepared search: update applicable queries; report other backends'
  applicability without inventing shared ranking semantics.
- Observe representative dispatches and repeated-update cleanup for each consumer
  family. Pure registry tests alone cannot close these items.

## S5 — Controlled component changes

- Stoplist/index: use existing Memory operation ownership to build an authoritative,
  complete derived projection and coordinate reader/writer tokenizer generation.
  Test concurrent writes and interrupted rebuild; no silent no-results fallback.
  Capture a Run's Memory tools before the switch, then recall/write through those
  retained tools afterward and prove a matching tokenizer/index generation without
  changing the Run's model/prompt or Memory authority.
- Listener host/port: stage binding, preserve old endpoint on failure, publish
  authenticated discovery, reconnect via existing owners and reconcile unknown RPC
  outcomes. Explain existing cancellation-on-disconnect effects; do not imply seamless
  continuation of active chat.
- Hindsight and other existing integration settings: separate local policy/timeout
  changes, same-authority connection rebinding, and external template/setup operations.
  Verify immutable authority/Bank lineage; do not perform an implicit authority switch
  or claim an external server changed because a local setting was saved.
- Any setting that truly requires full process restart must have a concrete technical
  justification reviewed against the PRD before retaining that boundary. A data-root
  move remains an explicit migration/reopen and is not performed in this slice.

## S6 — Acceptance and project checks

End-to-end spine: empty Core + Desktop started separately -> Home without a code ->
incomplete draft -> complete/keyless profile -> first reply -> change model/policy ->
next message uses it -> failure/clear/recovery -> reconnect/reopen preserves state.
Also exercise missing avatar/optional service and old-profile source adoption.

Optimization is a delivery gate. Compare the same hardware/build/profile/fixture and
record meaningful timing distributions and resource observations, including measurement
noise. Existing configured paths must not regress; set budgets for new paths from the
baseline before their implementation, not afterward to excuse a slowdown. Verify that
repeated edits/reconnects release retired model handles, listeners, timers and subscriptions
and that maintenance does not make Home unresponsive. Compare necessary steps and recovery
actions as well as machine metrics. Fix regressions or return to design; a material tradeoff
against the owner's usability/performance requirement needs explicit discussion and cannot
be silently accepted because functional tests pass. Report unknown metrics as unmeasured.

| Evidence layer | Required scope |
| --- | --- |
| Deterministic unit/contract | Source precedence, profile/apply state, staged failures, complete registry classification, privacy/index/model captures. |
| Local integration | Real Core/SQLite/helper and local compatible endpoint; concurrent old/new work, restart reconciliation and missing dependencies. |
| Native Desktop | Actual Home/window labels, setup recovery, connection tickets, drafts and reconnect; built WebView/CSP smoke with existing separate Core. |
| Provider observation | Optional separately authorized real-model run; record provider outcome/cost scope without using mocks as proof. |
| Owner acceptance | User confirms the intended flow; automated evidence never marks it passed. |

Run affected package tests/typechecks and scoped lint after each meaningful slice.
At final code delivery, run required checks for Shared, Core, Desktop, CLI, Shell and
affected E2E paths, following each package's Quality Check section. Check native code
with project Cargo commands. Do not broaden repeatedly after passing without cause.
A built-native UI smoke does not create a clean-machine installer/release requirement.

Synchronize config-store/source metadata, model capability display, Run/Memory capture,
connection/auth recovery, Home/packaged visible-floor specs, D24, and relevant folder
indexes with the actual implementation. Preserve D18 distribution, D83 conditional
profile compatibility and D85 restart continuation as separate needs.

## Current planning verification and handoff

Planning checks: task/source binding, row inventory and installed adapter behavior,
local reference existence, JSON/JSONL validity, document consistency and independent
architecture challenge. These do not prove runtime implementation or manual acceptance.

The owner has authorized scoped implementation and necessary isolated validation.
Preserve real user profiles/credentials and unrelated work; paid-provider calls,
commit, push, deployment, archive and finish are not included in that authorization.
Do not mark a later slice or manual acceptance complete from S0 evidence alone.

Planning review recorded on 2026-11-09:

- Independent source-backed challenge found no architecture reversal necessary.
  Clarified automatic adoption of complete application-first legacy profiles and
  retained-Run recall/write correctness across tokenizer/index publication.
- Executing the current registry confirmed 84 rows (52 live, 31 restart, one
  environment-only); every restart key appears in the consumer matrix.
- Local Markdown references, task metadata/context paths and UTF-8/whitespace were
  checked. Task binding still resolves to this planning task in the T4 worktree.
- Helper/ticket feasibility, hot-update runtime behavior, provider outcomes and
  owner acceptance remain future execution evidence; no such result is claimed.
