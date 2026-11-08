# First-use path: original questions and verification results

Recorded: 2026-10-29.
Task: [Memory operations and setup UI](../prd.md), [execution plan section 1](../implement.md#1-establish-the-first-usable-path).

This document pairs the original Q1-Q5 dispatch questions with the completed verification report. Questions are preserved verbatim; result content is preserved with repository links made relative to this document. It records the earlier read-only verification, not a new runtime or acceptance run. The later owner request authorizes this documentation-only persistence.

- Original research session: `01a1877f-15a9-7393-a5db-0ad8ca120074`; original question message at transcript line 12.
- Recovery/report session: `01a187be-e5a4-72d0-891a-69b92b8c7991`; final report at transcript line 191.
- Source baseline: `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd` plus the uncommitted integration set described in Q4.
- Evidence convention: `[source]` identifies inspected source or retained records; `[inference]` identifies deductions; `UNKNOWN` preserves missing evidence.
- Related records: [dispatch history](codex-dispatch-log-2026-10-29.md), [leader verification](first-use-pre-report-leader-verification-2026-10-29.md), [baseline inventory](baseline-freeze-2026-10-29.md).

## Q1 Journey trace

### Original question

> Q1 Journey trace — the first-use journey is: "Local onboarding -> existing-instance setup (endpoint, authenticated key, effective model configuration, Global/Character Banks, Taki templates) -> activation -> retain/recall -> sync -> reopen". For every step list: (a) the registered operation / WS RPC method name; (b) its definition site file:line (protocol schema in packages/shared and the handler side); (c) the Home UI entry point that reaches it (page/component file:line); (d) the Core-side service/capability that executes it (file:line); (e) status: IMPLEMENTED+REACHABLE / IMPLEMENTED-NOT-REACHABLE-FROM-HOME / MISSING / UNKNOWN. Present as a table, then short notes only for non-obvious rows.

### Verification result

[source] This report resumes the read-only verification requested in session `01a1877f-15a9-7393-a5db-0ad8ca120074`. No files were modified and no services, builds or tests were run during this continuation.

Paths below use `S = packages/shared/src`, `C = packages/core/src`, `H = apps/desktop/src/windows/home`, and `T = .trellis/tasks`.

[source] The common operation transport is `memory.operations.submit/status/list/cancel/subscribe`, with `memory.operations.changed` notifications: `S/memory-operation-schema.ts:23`; handlers: `C/server/methods/memory-operation-methods.ts:23`. Production composition registers these services at `C/main.ts:266–289`.

| Journey step | Registered operation / RPC and definition | Home entry point | Core execution | Status |
|---|---|---|---|---|
| Local preview and exception handling | [source] `memory.onboarding.preview/status/exceptions/exclude/subscribe`; `S/memory-local-onboarding-schema.ts:13`; handlers `C/server/methods/memory-onboarding-methods.ts:30` | [source] `H/pages/operations/operations-page.tsx:45` → `LocalOnboardingCard` | [source] `LocalOnboardingService.preview/exceptions/exclude`; `C/memory/local-onboarding/local-onboarding-service.ts:72` | [inference] **IMPLEMENTED+REACHABLE** |
| Local preparation and activation | [source] `memory.operations.submit`, kinds `local.onboard.prepare`, `local.onboard.activate`; `S/memory-operation-schema.ts:36`; handlers `C/memory/operations/memory-operation-kind-local.ts:25,49` | [source] `H/pages/operations/local-onboarding-actions.ts:21` constructs new/retry/resume/activate requests | [source] `LocalOnboardingService.prepare/resumePreparation/activate`; activation execution at `memory-operation-kind-local.ts:61` | [inference] **IMPLEMENTED+REACHABLE** |
| Existing-instance endpoint and enablement | [source] `config.list/set/subscribe`; `S/config-schema.ts:9`; handler `C/server/methods/config-set.ts:18`; knobs `C/config/knob-registry.ts:188–190` | [source] Settings, through `H/pages/settings/use-config.ts:86` | [source] `ConfigWriter`; resolved connection in `C/config/hindsight-config.ts:13` | [inference] **IMPLEMENTED+REACHABLE**, subject to configuration ownership/environment locks |
| Authenticated API key | [source] `secret.set/clear/presence/list`; `S/secret-catalog-schema.ts:11`; handlers `C/server/methods/secret-methods.ts:31` | [source] No Hindsight key-entry surface found. Settings renders secret presence only: `H/pages/settings/knob-input.tsx:42`. The production `secretSet` caller is MCP-specific: `H/pages/mcp/mcp-controller.ts:128` | [source] `SecretCatalogService.set`; fixed reference `memory.hindsight.connection.api-key` in `C/config/hindsight-config.ts:22` | [inference] **IMPLEMENTED-NOT-REACHABLE-FROM-HOME** for the Hindsight connection key |
| Connection validation | [source] `memory.operations.submit`, kind `setup.validate`; handler `C/memory/operations/memory-operation-kind-setup.ts:14` | [source] Activation card; request at `H/pages/operations/hindsight-activation-actions.ts:41`, visibility/admission rules at `:18–28` | [source] `HindsightSetupService.validate`, `C/memory/hindsight/hindsight-setup-service.ts:82` | [inference] **IMPLEMENTED-NOT-REACHABLE-FROM-HOME on a fresh setup**; see Q2 |
| Initial Global/Character Banks and Taki templates | [source] `memory.operations.submit`, kind `setup.apply`; handler `C/memory/operations/memory-operation-kind-setup.ts:23` | [source] Activation card “应用配置”; `H/pages/operations/hindsight-activation-actions.ts:42,49` | [source] `HindsightSetupService.setup`, `C/memory/hindsight/hindsight-setup-service.ts:117`; targets/dry-run in `hindsight-setup-stages.ts:12,19` | [inference] **IMPLEMENTED+REACHABLE once compatible**, but the fresh journey cannot reach that prerequisite through Home |
| Existing effective model/configuration observation | [source] `memory.hindsight.configuration.status/observe`; `S/hindsight-configuration-observation-schema.ts:13`; handlers `C/server/methods/hindsight-configuration-methods.ts:12` | [source] `H/pages/operations/operations-page.tsx:47`; controller `hindsight-configuration-controller.ts:36,45` | [source] `createHindsightConfigurationService`, composed with the actual connection/secret resolver in `C/boot/hindsight-configuration-boot.ts:20–25` | [inference] **IMPLEMENTED+REACHABLE** as observation |
| Versioned templates and user overlays | [source] `memory.templates.preview`, `memory.templates.preview.bank`, `memory.templates.status`, `memory.templates.derived`; `S/memory-template-schema.ts:13`; writes use `template.apply/recover`, `S/memory-operation-schema.ts:40`; read handlers `C/server/methods/hindsight-template-methods.ts:14` | [source] `H/pages/operations/operations-page.tsx:48`; `hindsight-template-controller.ts:46,98` | [source] `createHindsightTemplateLifecycleService`, `C/memory/hindsight/template-lifecycle/template-lifecycle-service.ts:21`; production composition `C/boot/hindsight-template-boot.ts:16` | [inference] **IMPLEMENTED+REACHABLE**, with the advertised Native capability and valid preview required |
| First Hindsight activation/resume/runtime recovery | [source] `memory.operations.submit`, kind `hindsight.activate`; read `memory.activation.status`, `S/memory-activation-schema.ts:16`; handlers `C/memory/operations/memory-operation-kind-hindsight.ts:25` and `C/server/methods/memory-activation-methods.ts:11` | [source] `H/pages/operations/hindsight-activation-actions.ts:43–45` | [source] `HindsightActivationService.start/resumeActivation/recover`; factory at `C/memory/hindsight-activation/hindsight-activation-service.ts:97`; execution at `memory-operation-kind-hindsight.ts:110,144` | [inference] **IMPLEMENTED+REACHABLE once setup prerequisites pass** |
| Retain and recall | [source] Home enters through `chat.send`; `S/chat-schema.ts:9,31`; handler `C/server/methods/chat-send.ts:43`. Runtime tools are named **`retain` and `recall`**, not separate `memory.retain/recall` RPCs | [source] Chat → `H/pages/chat/use-chat-timeline.ts:35` | [source] `runs.admit` at `chat-send.ts:63`; Hindsight Run capture at `C/memory/hindsight/hindsight-memory-runtime.ts:59`; canonical tools and coordinator calls at `C/memory/canonical-tools/canonical-memory-tools.ts:36,70,81` | [inference] **IMPLEMENTED+REACHABLE** with an admitted, capable runtime |
| Manual incremental/full synchronization | [source] `memory.operations.submit`, kind `replica.sync`; `S/memory-operation-schema.ts:37`; handler `C/memory/operations/memory-operation-kind-replica.ts:26` | [source] Authority card at `H/pages/operations/operations-page.tsx:43`; `use-memory-operations.ts:58` → controller | [source] `scheduler.requestManual(bankId, syncKind, requestId)` and `tick`, `memory-operation-kind-replica.ts:31,42` | [inference] **IMPLEMENTED+REACHABLE** |
| Reopen Home / reconnect observer | [source] Operation subscribe/list/status plus composite authority/onboarding/activation reads; common handler `C/server/methods/memory-operation-methods.ts:23` | [source] `H/pages/operations/use-memory-operations.ts:49`; controller subscribes before reading at `memory-operations-controller.ts:62–81`, replaces connections at `:156` | [source] Durable `MemoryOperationService`; boot observation before foreign-boot reconciliation at `C/memory/operations/memory-operation-service.ts:73–87` | [inference] **IMPLEMENTED+REACHABLE**; current complete journey remains unmeasured |
| Bounded provider interruption and Pending recovery | [source] Recovery runs through the existing scheduler; operator requests use `replica.sync` and `connection.revalidate`, registered in `C/memory/operations/memory-operation-kinds.ts` | [source] Operations status/sync and lifecycle controls; common page entry `H/pages/operations/operations-page.tsx:43` | [source] Pull → original Pending replay → confirmation pull: `C/memory/hindsight/hindsight-pending-recovery-runner.ts:55–85`; verified reconnect callers at `hindsight-memory-subsystem.ts:112` and `hindsight-lifecycle/hindsight-lifecycle-revalidate.ts:89` | [inference] **IMPLEMENTED+REACHABLE** for supported recovery; no new outage execution was performed |

[inference] “Reachable” above describes source wiring from an eligible state. It does **not** establish that the uninterrupted fresh Home journey succeeds: the key-entry and initial-validation edges block it.

[source] Existing-instance configuration is explicitly observation of externally effective settings, not proof that Taki provisions or changes the server: `T/08-09-memory-operations-ui/implement.md:42–44`.

## Q2 Concrete missing or broken edges on this journey only

### Original question

> Q2 Concrete missing or broken edges on this journey only — using the 54-entry ledger and the C01-C16 acceptance cases as the checklist, list the gaps that actually lie on this specific path (do NOT re-audit the whole subsystem). For each: short name; what exactly is missing/broken with file:line or UNKNOWN; [source-proven] or [needs runtime reproduction]; blocker for the first-use exit criteria (yes/no). Sort blockers first, then non-blockers.

### Verification result

| Gap | Evidence and classification | First-use exit blocker |
|---|---|---|
| **No Home input for the Hindsight API key** — A28/A41, C02/C12 | **[source-proven]** The fixed reference is `memory.hindsight.connection.api-key`; [resolver](../../../../packages/core/src/config/hindsight-config.ts:22). Settings’ [secret renderer](../../../../apps/desktop/src/windows/home/pages/settings/knob-input.tsx:42) only displays presence. The production Desktop `secretSet` caller found is `mcp-controller.ts:128`; no Home Hindsight caller names the fixed reference. [inference] A fresh user cannot supply the authenticated connection key through the intended interface. | **Yes** |
| **Fresh setup cannot expose “validate”** — A28/A30, C02 | **[source-proven]** Migration 022 seeds `phase='unconfigured'`: [migration](../../../../packages/core/src/db/migrations/022-hindsight-connection-setup.ts:21). [Home rules](../../../../apps/desktop/src/windows/home/pages/operations/hindsight-activation-actions.ts:18) permit validation only in `ready-to-validate`, `compatible`, or `failed`. The activation read passes through persisted phase: `C/memory/hindsight-activation/hindsight-activation-reads.ts:42–48`. The production search found no writer of `ready-to-validate`; its only Core occurrence is the migration constraint. [inference] Saving endpoint/enablement leaves fresh Home unable to submit validation, although Core’s `validate` implementation accepts the idle starting state. | **Yes**, independently of the key-entry gap |
| **The default historical smoke cannot run unchanged from its archived location** — C01–C06/C09 evidence preparation | **[source-proven]** `T/archive/2026-09/09-25-hindsight-native-smoke/research/native-smoke.mjs:16` and `smoke-core.mjs:14` retain `../../../../packages/shared/src/index.ts`; `smoke-core.mjs:16` uses the same depth for the repository root. Read-only resolution produced `H:/TakiAgent/.trellis/tasks/packages/shared/src/index.ts`, which does not exist, and incorrectly selected `.trellis/tasks` as the repository root. | **Yes for executing that unchanged harness**; it is a fixture-path defect, not absence of the underlying service |
| **D1-B release checkpoint still says review pending** — measured-baseline requirement | **[source-proven]** [Source release](../../10-24-hindsight-isolated-candidate-foundation/research/d1b-source-release-01a180b6.md:17) says the combined verdict is pending. [Completed review](../../10-14-hindsight-managed-deployment/research/combined-d1b-api-artifact-review-01a180b6.md:32) and `D1/research/leader-now.md:3–10` already report no blocking D1-B source/integration finding. [inference] The pending checkpoint is stale; it does not establish another unresolved D1-B defect. | **Yes for the plan’s baseline-record gate**, not a runtime dependency |
| **No current connected first-use acceptance result** — A54, scoped C01–C06/C09/C12/C16 | **[needs runtime reproduction]** `T/08-09-memory-operations-ui/implement.md:47–58` still requires the connected Home journey and bounded outage. Historical fixture records establish their stated scopes, not this current head060/Home combination. **UNKNOWN — missing:** a current result tied to the exact Taki/Native build, isolated dataset and intended interface. | **Yes for claiming first-use delivery** |
| **Real-model quality and owner UI acceptance** — A54, C05/C12 | **[needs runtime reproduction / owner observation]** The acceptance boundary remains explicit in `implement.md:56–58`; Stage 5B’s isolated gate excludes real-model and installed WebView2/manual acceptance in `T/10-07-hindsight-template-lifecycle/research/b3-whole-acceptance.md:52–54`. | **No for a narrowly labelled controlled-provider result; yes for those broader claims** |

[source] The historical ledger is not a current list of missing implementations. The following old entries must not be repeated as present defects:

- **Manual-sync false completion:** the current handler looks up the exact request ID and classifies its persisted state; it no longer infers this operation’s success from another run’s timestamp. `C/memory/operations/memory-operation-kind-replica.ts:85–97`.
- **No verified-reconnect caller:** current callers exist after successful foreground sync and connection revalidation. `C/memory/hindsight/hindsight-memory-subsystem.ts:112–116`; `C/memory/hindsight-lifecycle/hindsight-lifecycle-revalidate.ts:89–95`.
- **Stale compatibility survives failed validation:** current failure explicitly withdraws compatibility. `C/memory/hindsight/hindsight-setup-service.ts:110–113`.
- **No activation/onboarding/operation facade:** the registered source chain is identified in Q1, including `C/main.ts:266–286`.
- **Templates are only the old fixed-v1 implementation:** later lifecycle source and scoped automatic acceptance exist. `C/boot/hindsight-template-boot.ts:16–24`; `T/10-07-hindsight-template-lifecycle/research/b3-whole-acceptance.md:97–114`.

[source] Managed installation and candidate upgrades are retained requirements but are not first-use prerequisites: `T/08-09-memory-operations-ui/implement.md:36–44,95–116`. They are not added to the blocker list.

## Q3 Controlled-provider entry point inputs

### Original question

> Q3 Controlled-provider entry point inputs — implement.md section 1 requires naming a controlled provider entry point, defaulting to "the existing Native smoke/runtime fixtures and ordinary supported service entrypoints". Locate concretely what exists today: the accepted Stage 1-4 fixture paths and runbooks inside the .trellis task research directories (look in .trellis/tasks/08-09-hindsight-initial-cutover, .trellis/tasks/09-07-hindsight-recovery-evidence, .trellis/tasks/09-29-hindsight-transitions-emergency, both .trellis/tasks/10-07-* tasks, and .trellis/tasks/08-09-memory-operations-ui). Report: exact fixture/entrypoint identities and where defined (file:line); what each requires (service, data, env, keys) as documented/sourced; what "the actual compatible application build and isolated data" concretely refers to in the current repo state — is the D1-B candidate build required for this path, or does the current tree work; and any hard constraints found. Do not re-analyze the C2b managed-bootstrap producer; its cleanup defect is already recorded elsewhere.

### Verification result

| Existing fixture / entry point | Concrete inputs and scope | Evidence and present limitation |
|---|---|---|
| **Native smoke:** `T/archive/2026-09/09-25-hindsight-native-smoke/research/native-smoke.mjs`, with `smoke-core.mjs`, `smoke-native.mjs`, `smoke-fake-provider.mjs`, `native_launcher.py` | [source] Fresh temporary Core data and credentials; independently owned PostgreSQL data; free loopback ports; generated API credential; scripted Core provider; Native mock LLM. `native-smoke.mjs:1–26`; `smoke-core.mjs:72–81`; `smoke-native.mjs:122,169–183`. Native launcher calls ordinary `hindsight_api.main:main`: `native_launcher.py:123–126`. | [source] Recorded steps 1–8 passed, including direct RPC setup/activation/sync/restart, while additional post-ingestion probe 6b failed: `native-smoke-2026-09-25.md:19–29`. It uses direct `secret.set`/setup submissions, so it never proved the fresh Home edges. [inference] Its archived imports currently prevent unchanged execution, as established in Q2. |
| **G1 isolated Native/recovery harness:** `T/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py` | [source] Installed `H:/hindsight/.venv/Scripts/python.exe`; unique bundled PostgreSQL 18.1 instance; clean environment; deterministic extraction/embedding/Batch API fixtures. `--allow-http-fixture` permits the specifically owned HTTP fixture. `validation/README.md:3–23`. | [source] Runbook commands include `--probe` and `--allow-http-fixture -- tests/native_results -q --tb=short`. This exercises Native/recovery contracts, not the full Home journey. |
| **D78 current-state HTTP consumer:** `T/08-09-hindsight-initial-cutover/research/validation/current-cutover-http.fixture.ts`, with `current-cutover-local.fixture.ts` | [source] Explicitly owned Native endpoint, two fixture Banks and a new SQLite path; fixed test authentication; `TAKI_D78_HTTP_FIXTURE=1`. Header/imports at `current-cutover-http.fixture.ts:1–24`, client at `:45`, opt-in at `:178`. | [source] Actual two-Bank HTTP→SQLite evidence, lost replies and stale-Local refusal are recorded in `research/d78-validation-2026-09-09.md:62–68`. This fixture seeds controlled Local state; it is not evidence that a user completed Local onboarding in Home. |
| **Stage 4 W3 Native consumer:** `T/09-29-hindsight-transitions-emergency/research/validation/w3-native.fixture.ts` | [source] Real HTTP/PostgreSQL fixture ownership and maintenance are supplied by the Native test owner; imports consume actual transition/application clients and evidence loaders. `w3-native.fixture.ts:1–10`. | [inference] A reusable contract-consumer fixture, not a standalone fresh-user launcher. **UNKNOWN — missing:** a newly selected current invocation/input plan for this verification. |
| **Stage 4 authenticated W5 journey:** `T/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone` | [source] The retained functional record names the installed Native interpreter and the reviewed-clone runner: `research/w5-http-functional-result-2026-10-06.md:3–11`. | [source] Historical authenticated functional PASS and owned cleanup are recorded there, including `:43`. This is historical copied-data evidence, not a newly measured baseline. |
| **Stage 3 backup / Stage 4 paired recovery:** `w6-paired-core-capture.mjs`, `w6-paired-native-restore.py`, `w6-paired-core-restore.mjs` under the transition task’s `research/` | [source] A fresh owned copy of the stopped W5 pair; separate work Core DB and PostgreSQL data; explicit capture/native/preflight plans; fixture credential custody. Exact stage/seal/preflight commands and inputs: `w6-d91-runbook.md:19–105`. | [source] The completed create-only runner must not be replayed: `w6-d91-runbook.md:5–17`. Fixture custody does not prove production DPAPI portability: `:27–32`. |
| **Stage 5A configuration observation evidence** | [source] The Native chain uses the existing G1 harness and `tests/test_configuration_observation.py::test_version_then_observation_never_initializes_a_store`. `T/10-07-hindsight-configuration-observation/research/independent-check.md:99`. Actual Core boot uses fresh owned SQLite and authenticated status/observe: `:131`. | [source] Scoped historical observation evidence; it does not establish server-side model application. |
| **Stage 5B template/runtime evidence** | [source] Actual Core main/WS boot, head059, authenticated status/preview/derived; physical customized/removed overlay restores across 61 tables. `T/10-07-hindsight-template-lifecycle/research/b3-whole-acceptance.md:46–50`. | [source] The actual boot records are `b3-whole-core-boot-01-result.json`, `b2-core-boot-02-result.json`, and associated cleanup; physical restore record `b3-native-joint-06-result.json`. These are accepted historical results, not a head060 rerun. |

**Compatible application build**

[source] Compatibility is an exact contract/build check, not acceptance of arbitrary upstream Hindsight 0.9.0. `C/memory/hindsight/hindsight-compatibility-service.ts:52–77` checks health, API version, immutable build identity, PostgreSQL/sql-row lineage and required contracts.

[source] Concrete identities in the current source include:

| Capability generation | Exact identity |
|---|---|
| Application runtime | `taki-memory-hindsight-0.9.0-d77-v1` — `S/hindsight-application-primitives-schema.ts:9` |
| Configuration observation | `taki-memory-hindsight-0.9.0-config-observation-v1` — `S/hindsight-configuration-observation-schema.ts:9` |
| Template lifecycle | `taki-memory-hindsight-0.9.0-template-lifecycle-v1` — `S/hindsight-template-definition-schema.ts:9` |
| Template backup | `taki-memory-hindsight-0.9.0-template-backup-v1` — `S/hindsight-template-backup-schema.ts:11` |

[inference] The selected provider must advertise the contracts used by the measured journey. The old D77 smoke identity alone does not prove later configuration/template capabilities.

**Is D1-B required?**

[source] No candidate driver is supplied to the ordinary operation-service composition in `C/main.ts:277–280`. The current plan explicitly excludes candidate-driver and C2b completion as first-use gates: `T/08-09-memory-operations-ui/implement.md:36–41`.

[inference] There is no separate “D1-B candidate build” prerequisite for first use. The current checkout supplies the ordinary application path and includes D1-B’s additive controlling-Core migration. That does not mean the current Home journey works unchanged: Q2’s blockers remain.

[source] The current Native interpreter, bundled `pg0.exe`, and the tokenizer-cache file named by `smoke-native.mjs:18–21` exist. Only filesystem existence was checked.

**UNKNOWN — missing:** the selected running provider’s authenticated manifest, its actual source/artifact identity, a fresh isolated dataset identity, and a successful run against that exact combination.

[source] “Isolated data” concretely means separately owned Core SQLite/data, credential directory/catalog, PostgreSQL data/schema, fixture Banks and test credentials—not the owner’s ordinary workspace. This follows the smoke input contracts and `w6-d91-runbook.md:24–32`. No original data or credentials were inspected in this continuation.

## Q4 Baseline freeze facts

### Original question

> Q4 Baseline freeze facts — from git status/diff and the task files, enumerate the current uncommitted integration set relevant to the first-use path (the plan names: D1-B migration 060, candidate-operation wiring, affected labels — find the actual file paths), and state whether any release record for that work is open (name the record file) or none exists. Conclude with what a truthful measured-baseline build identity must include (build/commit identity, uncommitted set, data-set identity).

### Verification result

[source] Current Git HEAD is:

```text
e260ff4b0bf663b5faa0187bc6ec701fd2f007cd
```

[source] Current tracked diff is **41 files, 633 insertions, 211 deletions**; the staged diff is empty. This agrees with the recorded [baseline inventory](baseline-freeze-2026-10-29.md:3). Untracked files are additional to that tracked-diff count.

The relevant uncommitted integration set is:

| Area | Actual paths |
|---|---|
| Migration 060 | [source] New `C/db/migrations/060-hindsight-candidates.ts` and `.test.ts`; modified `index-list.ts`, `index-list.test.ts`, `lineage-reopen-matrix.test.ts`, `041-canonical-memory-maintenance.test.ts`, `059-hindsight-template-execution.test.ts`, and migration `index.md` |
| Candidate operation wiring | [source] New `C/memory/operations/memory-operation-kind-candidate.ts` and `.test.ts`; modified `memory-operation-contract.ts`, `memory-operation-kinds.ts`, `memory-operation-service.ts`, and operations `index.md` |
| Shared contracts/public exports | [source] New `S/hindsight-candidate-schema.ts`, `.test.ts`, `hindsight-candidate-domain-schema.ts`, `.test.ts`; modified `S/memory-operation-schema.ts`, `S/index.ts`, `S/index.md`, and `packages/shared/package.json` |
| Home labels | [source] Modified `H/pages/operations/memory-authority-state.ts` and operations `index.md`; labels cover `candidate.prepare`, `candidate.inspect`, `candidate.resume` |
| Fixture integration | [source] Modified `C/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts`, its `index.md`, `C/testing/hindsight-runtime-composition-fixtures.ts`, `hindsight-template-backup-consumer-fixture.ts`, `hindsight-template-backup-joint-fixture.ts`, and testing `index.md` |
| Candidate source tree | [source] Untracked `C/memory/hindsight-candidates/`, including the admission/profile/archive/copy/verifier modules and the D1-B domain SQL/read/admission/progress/service modules listed below |
| Decision/evidence records | [source] `T/10-24-hindsight-isolated-candidate-foundation/`; `.trellis/spec/backend/hindsight-isolated-candidates.md`; modified parent execution/design/PRD/context records, `docs/HANDOFF.md`, and `docs/deferred-decisions.md`. Full path inventory: baseline file `:12–142` |

[source] The untracked candidate directory contains:

```text
hindsight-candidate-admission.ts
hindsight-candidate-admission.test.ts
hindsight-candidate-archive.ts
hindsight-candidate-copy-stream.ts
hindsight-candidate-copy-stream.test.ts
hindsight-candidate-core.ts
hindsight-candidate-domain-admission.ts
hindsight-candidate-domain-fixture.ts
hindsight-candidate-domain-progress.ts
hindsight-candidate-domain-read.ts
hindsight-candidate-domain-sql.ts
hindsight-candidate-domain.test.ts
hindsight-candidate-files.ts
hindsight-candidate-files.test.ts
hindsight-candidate-fixtures.ts
hindsight-candidate-identity.ts
hindsight-candidate-identity.test.ts
hindsight-candidate-profile.ts
hindsight-candidate-refusal.ts
hindsight-candidate-schema-admission.ts
hindsight-candidate-service.ts
hindsight-candidate-verifier.ts
hindsight-candidate-verifier.test.ts
index.md
```

**Release-record status**

[source] A release record exists and still carries pending wording: `T/10-24-hindsight-isolated-candidate-foundation/research/d1b-source-release-01a180b6.md:17–19`.

[source] The later completed combined review reports **no blocking D1-B source/integration finding**, while its overall `CHANGES_REQUIRED` concerns the separate Native lifecycle issue: `T/10-14-hindsight-managed-deployment/research/combined-d1b-api-artifact-review-01a180b6.md:32–35`. D1’s latest routing record agrees: `research/leader-now.md:3–10`.

[inference] The accurate description is **review completed, release-checkpoint wording not reconciled**. Candidate restore/upgrade acceptance remains separately open.

[source] Migration 060 is additive for the controlling Core; it does not widen the immutable archived-Core reader to admit source060. The review explicitly preserves head059 fixture/profile boundaries: `combined-d1b-api-artifact-review-01a180b6.md:66–68`.

**Truthful measured-baseline identity**

[inference, from `implement.md:50–54` and the source/review state above] A measurement must identify:

1. Taki HEAD **plus the exact tracked and untracked integration content**, especially migration 060, Shared unions, operation handling and Home labels.
2. The actual built/launched Taki artifact and Native source/artifact, with authenticated manifest/build/capability identity.
3. The isolated Core dataset and migration head, provider lineage and Bank identities, PostgreSQL dataset/schema, and credential-custody identity without secret values.
4. Which historical review/check records apply, which current journey was executed, and its actual result.

[source] The existing `baseline-freeze-2026-10-29.md` is a Git-state inventory. It is not itself a built-artifact identity or a completed journey result.

## Q5 Footer

### Original question

> Q5 Footer — "Commands run" (exact commands you executed), "Files read" (list), "Uncertainties and unknowns" (anything you could not establish).

### Verification result

**Commands run**

[source] Verbatim tool inputs, recorded shell commands, results and failures are preserved in:

- [Original research transcript](/C:/Users/55473/.codex/sessions/2026/10/29/rollout-2026-10-29T19-50-15-01a1877f-15a9-7393-a5db-0ad8ca120074.jsonl).
- [This continuation’s transcript](/C:/Users/55473/.codex/sessions/2026/10/29/rollout-2026-10-29T20-59-57-01a187be-e5a4-72d0-891a-69b92b8c7991.jsonl).

[source] Repository/environment commands included:

```powershell
Get-Location
git status --short --branch
git worktree list
git log -5 --oneline --decorate
git rev-parse HEAD
git diff --stat
git diff --cached --stat

python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/get_context.py --mode phase

jbcontext search "Home memory operations existing Hindsight instance connection setup Local onboarding first activation sync durable operation RPC registration"

rg -n 'memory.hindsight.connection.api-key|secretSet\(' apps/desktop/src packages/core/src/config/hindsight-config.ts
rg -n 'ready-to-validate' packages/core/src -g '*.ts' -g '!*.test.ts'
rg --files packages/core/src/memory/hindsight-candidates

rg -n 'taki-memory-hindsight-0.9.0|SUPPORTED.*BUILD|IMMUTABLE.*BUILD' packages/shared/src packages/core/src/memory/hindsight -g '*.ts' -g '!*.test.ts' -g '!*-fixtures.ts' -g '!*-fixture.ts'
```

[source] Additional commands were range-numbered source reads, exact-symbol/file searches, Git diffs of the integration files, JSONL recovery, and read-only path-existence/resolution checks. Their exact arguments and selected line ranges are retained in the transcripts above. Some initial filename/glob probes failed; corrected paths were subsequently read. The original `jbcontext` attempt required login, so no semantic-search result was treated as evidence.

[source] No test/build/service command quoted in Q3 was executed by this continuation.

**Files read**

[source] Source files cited in Q1–Q4 were read or searched at the cited locations. Additional source/document context recovered from the original session or read during continuation includes:

- Project authority: `CLAUDE.md`, `CONTEXT.md`, `.trellis/workflow.md`, `docs/HANDOFF.md`, `docs/adr/0009-single-memory-authority-with-local-replica.md`.
- Parent task: `T/08-09-memory-operations-ui/{prd.md,implement.md,grill.md}` and `research/{stage5-execution-map-2026-10-07.md,s6-acceptance-plan-2026-10-24.md,baseline-freeze-2026-10-29.md,codex-dispatch-log-2026-10-29.md,first-use-pre-report-leader-verification-2026-10-29.md}`.
- Audit: `T/09-14-hindsight-integration-completeness-audit/research/{completeness-matrix.md,closure-plan.md}`.
- Cutover/recovery: `T/08-09-hindsight-initial-cutover/research/{d78-native-preflight.md,d78-validation-2026-09-09.md}` and its `validation/current-cutover-http.fixture.ts`; `T/09-07-hindsight-recovery-evidence/research/validation/README.md`.
- Transition evidence: `T/09-29-hindsight-transitions-emergency/research/{acceptance-stages-1-2.md,stage-4-runtime-prerequisites.md,w5-http-functional-result-2026-10-06.md,w6-d91-runbook.md,w6-paired-native-restore-smoke.mjs}` and `validation/w3-native.fixture.ts`.
- Stage 5 evidence: configuration `research/independent-check.md`; template lifecycle `research/{source-runtime-and-acceptance.md,b3-whole-acceptance.md}`; D1 release/leader records and the combined review identified in Q4.
- Archived smoke: `native-smoke-2026-09-25.md`, `native-smoke.mjs`, `smoke-core.mjs`, `smoke-native.mjs`, and `native_launcher.py`.
- Shared: configuration, secret/catalog, onboarding/local-operation, activation/Hindsight-operation, setup, operation, template-operation/template, chat, and Hindsight capability/build schema files named in Q1–Q3.
- Core setup/configuration: `boot/{hindsight-setup-boot.ts,hindsight-configuration-boot.ts,hindsight-template-boot.ts}`, `config/{config-writer.ts,hindsight-config.ts,knob-registry.ts}`, `db/hindsight-connection-repo.ts`, migrations 022/060, and `secrets/secret-catalog-service.ts`.
- Core memory: operation service/registry/handlers/status; Local onboarding and Hindsight activation services/read/status; setup service/stages/recovery/secret refs; configuration service/context; compatibility; runtime/subsystem/scheduler/Pending recovery; lifecycle revalidation; canonical tools; template lifecycle service.
- Core RPC: `server/methods/{config.ts,config-set.ts,secret-methods.ts,chat-send.ts,memory-operation-methods.ts,memory-onboarding-methods.ts,memory-activation-methods.ts,hindsight-setup-methods.ts,hindsight-configuration-methods.ts,hindsight-template-methods.ts}`.
- Home: operations page, authority card/state, operation controller/hook, onboarding actions, activation actions/card, configuration/template controllers; Settings page/state/input/hook; MCP state/controller; Chat page/timeline hook.

**Uncertainties and unknowns**

- **UNKNOWN — missing:** a fresh connected Home journey after the two source-proven setup blockers.
- **UNKNOWN — missing:** the actual selected provider’s current authenticated manifest and executable/source identity. Supported source constants and historical manifests are not current service observations.
- **UNKNOWN — missing:** a measured head060 Taki build and isolated dataset tied to that journey, including bounded outage/Pending recovery and reopen.
- **UNKNOWN — missing:** current execution readiness of the historical fixtures after correcting their archived path assumptions and selecting fresh inputs.
- **UNKNOWN — missing:** owner UI acceptance, real-model quality, original-environment activation and production credential-portability observations.
- [source] Historical passing tests, the failed smoke probe, and later scoped acceptance retain their separate meanings. None was rerun or relabelled as a current end-to-end pass.
