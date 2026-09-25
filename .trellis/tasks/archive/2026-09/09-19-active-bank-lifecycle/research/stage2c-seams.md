# Research: Stage 2c active Bank and configuration lifecycle under Hindsight authority (A27 / A31 / A16)

- **Query**: after first activation, what happens today when a new Character appears, when the Hindsight connection
  config/secret changes or the provider recovers from an outage; which primitives exist; what Stage 2c must add
- **Scope**: internal (Core/Shared/Desktop at `main` `f1acf9e`); native read-only from `H:/hindsight`
- **Date**: 2026-09-24

## Index

1. Current behaviour per matrix entry, with the exact failure (§1)
2. Reusable primitives (§2)
3. Gap list G1..G14 (§3)
4. Failure matrix (§4)
5. Operation kinds, family, status read, single-flight, Shared additions (§5)
6. D86 / D87 / D88 disposition (§6)
7. Wave split A/B/C with file lists (§7)
8. Product questions (§8)
9. Caveats / not found

---

## 1. Current behaviour

### A27 — a new Character after activation

Admission path: `server/methods/chat-send.ts:63` `await runs.admit(...)` -> `harness/run-service.ts:76`
`deps.snapshot.capture(...)` -> `harness/run-snapshot-capture.ts:61` `await input.memory.captureRun(characterId)` (no try)
-> `main.ts:348` `memory: { captureRun: memoryRuntime.captureRun }` -> `memory/runtime-composition.ts:75-83` ->
`hindsight-memory-subsystem.ts:68-70` (`assertConnection`, `ingestion.initializeBaseline`, `foreground.captureRun`) ->
`hindsight-memory-runtime.ts:52-60` -> `synchronizeForCapture` (`:63-75`) -> `state.runtime.resolveBanks(characterId)`.
The same admission path is used by `scheduler/scheduled-run-adapter.ts:27` and `server/methods/capability-trigger.ts:84`.

- `hindsight-runtime-connection.ts:57-61`: `resolveBanks` throws `HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH` unless a
  *verified* `hindsight_bank_setup` row exists for both Global and `character:<id>` (`banks()` `:39-49` filters
  `status === "verified"`).
- The throw escapes `captureRun`; `server/method-registry.ts:95-103` turns it into JSON-RPC `INTERNAL_ERROR` with message
  `HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH`. **Exact failure: `chat.send` for Character `mika` is rejected before a Run
  exists.** The recall fallback (`agents/chat-agent.ts:443-447`, `catch { return ""; }`) is never reached; it only runs
  inside an admitted Run.
- No path creates the Bank: `hindsight-setup-service.ts` `validate` (`:87`), `setup` (`:122`) and `llmHealth` (`:177`) all
  call `requireCanonicalLocal` (`:264-267`) -> `HINDSIGHT_STATE_CONFLICT` under marker `hindsight`. `disable` refuses
  under Hindsight (`:166`). The Home activation card offers 应用配置 only under `canonical-local`
  (`apps/desktop/.../hindsight-activation-actions.ts:24-29`).
- `ensureCanonicalLocalBanks` (`canonical-local-banks.ts:14-33`) is reachable only from the Local runtime
  (`canonical-local-runtime.ts:36,75`), which is retired after COMMIT; nothing lazy exists for Hindsight.
- Distinguishability today: a never-provisioned Bank surfaces only as the thrown `HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH`
  on `chat.send`; an existing Bank whose recall fails surfaces inside the Run as `MEMORY_PROVIDER_UNAVAILABLE`
  (`hindsight-memory-provider-context.ts:112-131`) and is swallowed by the chat-agent fallback. No status read names
  per-Character Bank readiness. `memory.authority.status` lists replica state only for verified Banks
  (`memory/operations/memory-authority-status.ts:55-63`).
- Pet UI fixes `ACTIVE_CHARACTER_ID = "taki"` (`apps/desktop/src/lib/active-character.ts:8`); a new Character reaches
  Core today through the protocol (`chat.send` `characterId` is `z.string().min(1)`, `packages/shared/src/chat-schema.ts:33`),
  cron and capability-trigger Runs, or the future D22 soul-swap panel.

### A31 — active provider status, health, revalidation and rebind

- All Hindsight knobs are `apply: "live"` (`config/knob-registry.ts:188-203`); the secret marker changes on key rotation
  (`hindsight-secret-refs.ts:22-26`). The fingerprint covers endpoint, deploymentMode, both timeouts,
  desiredTemplateRevision, model, secret marker and the build constants (`hindsight-compatibility-service.ts:110-126`).
- `hindsight-runtime-connection.ts:30` captures the fingerprint at construction; `assertConnection` (`:33-38`) throws
  `MEMORY_AUTHORITY_MISMATCH` when the config is no longer `ready` (`TAKI_HINDSIGHT_ENABLED=false` -> `disabled`,
  `config/hindsight-config.ts:15`) or the fingerprint differs. **Exact failure: after changing
  `TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS` (or rotating the API key, or toggling the enable flag) every `captureRun`, sync,
  tool call, flush and status evidence read throws `MEMORY_AUTHORITY_MISMATCH` until Core restarts.** `chat.send` fails
  with that message.
- `memory-authority-status.ts:66-70` maps it to `unavailableReason: "authority_mismatch"`; the Home card shows
  "运行时与权威标记不一致" (`memory-authority-state.ts:45-47`). The authority did not change; the label is wrong.
- The binding snapshot still says `published`, so `hindsightRuntimeAvailability` (`hindsight-runtime-binding.ts:86-92`)
  reports available and `memory.activation.status` never offers `recoverBinding`
  (`hindsight-activation-status.ts:38-50`). Even if called, `selected.recoverHindsight` answers `"healthy"` while a
  runtime is current (`runtime-selector.ts:72-77`); `publish` refuses a second publication (`hindsight-runtime-binding.ts:56`);
  `stop` is final (`:76-81`). **There is no rebind-to-new-config primitive.**
- Under drift the subsystem drops primary-commit witnesses: `hindsight-memory-subsystem.ts:72-74` wraps
  `runtime.assertConnection()` + `ingestion.recordPrimaryCommitted` in a try/catch that only logs
  "Hindsight primary source witness was not committed". (Today this only hits Runs admitted before the edit, because new
  admissions already fail; with a degraded Run it would drop every turn.)
- Under drift the scheduler goes silent: `armTimer` -> `status()` -> `banks()` -> `assertConnection` throws inside the
  `tick().finally` (`hindsight-replica-scheduler.ts:84-94,185-199`), so no wake is re-armed.
- At boot a changed config is accepted silently: construction uses whatever config is current
  (`hindsight-runtime-connection.ts:26-30`); the first sync admits over the network with
  `expectedLineage = epoch.providerLineageId` (`hindsight-application-capability.ts:41-51`,
  `hindsight-application-sync-runner.ts:110-112`) and saves evidence for (epoch, new fingerprint)
  (`hindsight-runtime-state.ts:46-47`). Lineage protects against a different instance; nothing compares the live
  fingerprint to the B3 snapshot (`plan().drifted` computes it, `hindsight-activation-reads.ts:47`, but only the
  activation card uses it) and **nothing checks that `desiredTemplateRevision` still equals the verified Banks'
  `templateRevision`** (runtime `banks()` ignores template columns). A Taki build that bumps
  `HINDSIGHT_COMPATIBILITY_VERSION` also changes every fingerprint.
- If the provider is unreachable at that first boot capture, `synchronizeForCapture` swallows the availability error but
  then requires stored admission evidence for the new fingerprint (`hindsight-memory-runtime.ts:71-74`) and throws the
  availability code -> `chat.send` fails before recall fallback.
- `memory.authority.status.setup` is the historical B3 snapshot (`memory-authority-status.ts:47`); no read reports live
  health; `llmHealth` is Local-only and has no Desktop caller (grep for `llmHealth` / `memory.hindsight` in
  `apps/desktop/src` finds only the activation actions/fixtures and authority card files, none calls it).

### A16 — verified provider-reconnect trigger

- `hindsight-replica-scheduler.ts:108-117` `verifiedReconnect()` = per Bank `ensureBank` + `recover` + `requestCatchUp`,
  clear supervisor retry, `rerun`, `armTimer`. The only references are the interface (`:26`) and the definition (`:108`);
  **no production caller** (grep over `packages/core/src`, tests excluded).
- `start()` (`:65-75`) performs the same catch-up once per subsystem start, so a boot or a fresh publication is already
  the "verified startup" catch-up (ADR 0009 line 55/57; `memory-replica-sync.md` §3 "Restart/reconnection performs one
  eligible catch-up").
- Real success signals that exist today: every sync (scheduled or foreground) first runs
  `admitHindsightApplication` (health healthy + database connected, API version, compatibility manifest, lineage equality;
  `hindsight-application-capability.ts:41-51`) and calls `onAdmission` (`hindsight-application-sync-runner.ts:112`,
  wired at `hindsight-runtime-state.ts:46-47`). Foreground capture syncs both Banks every Run
  (`hindsight-memory-runtime.ts:66-69`), catching availability failures (`hindsight-memory-provider-context.ts:112-119`).
  Persisted per-Bank backoff state (`errorCode`, `retryDueAt`, `automatic`, `nextAction`) is visible through
  `scheduler.status()` (projected in `memory-authority-state.ts:71-83`).
- Browser/WS reconnect (`ws-client*`) never reaches Core memory and must not be used.

---

## 2. Reusable primitives

| Primitive | Where | Reuse in 2c |
| --- | --- | --- |
| `hindsightBankBindings(characterId)` -> `[global, character]`, deterministic id `taki-hs-v1-{g,c}-sha256(...)[:32]`; throws for id length outside 1..160 | `hindsight-bank-identity.ts` | provisioning target (character element only) |
| `setupTargets(revision, characterId)` / `dryRunTemplates` | `hindsight-setup-stages.ts:12-32` | template load + dry run for the Character target |
| `applyHindsightBank({deps, target, signal})`: verified -> export re-verify only (throw, **no row write**, `:33-35`); else PUT -> import -> `applied` -> poll -> export verify -> `verified`; any error -> `failed` (`:48-52`) | `hindsight-bank-setup.ts:28-54` | the provisioning producer, unchanged |
| `createHindsightCompatibilityService().validate` (health, version, manifest) | `hindsight-compatibility-service.ts` | revalidation |
| `admitHindsightApplication({client, request, expectedLineage})` | `hindsight-application-capability.ts:41-51` | lineage-equal proof for the new config |
| Admission evidence repo keyed (epoch, fingerprint) | `db/hindsight-runtime-admission-repo.ts` | save evidence for the new fingerprint before republishing |
| `hindsightConnectionFingerprint(projection, marker)` | `hindsight-compatibility-service.ts:106` | drift detection in status/admission |
| `readHindsightActivationPlan().drifted` | `hindsight-activation-reads.ts:47` | B3-vs-live drift, already computed under Hindsight too |
| `witnessHindsightPrimaryCommit({db, commit, logger})` (marker-routed ledger write) | `hindsight-runtime-binding.ts:99-108` | witness path while the runtime refuses |
| Binding `publish/start/current/snapshot/stop`; Local analogue `retire()` | `hindsight-runtime-binding.ts:31-83`; `local-runtime-binding.ts:31-32,65` | pattern for a new `replace(epochId)` |
| Composition seams `recoverHindsightBinding`, `hindsightBindingSnapshot`, `operations()` (live accessor) | `runtime-composition.ts:70-75,138-145` | revalidate/rebind entry |
| Scheduler `requestManual`, `verifiedReconnect`, `status`, `banks` re-read every drain | `hindsight-replica-scheduler.ts:96-117,139-151` | new-Bank catch-up, reconnect signal |
| Operation owner: handler contract, `refuseWhileExclusiveFamilyBusy`, `EXCLUSIVE_MEMORY_FAMILIES` | `memory/operations/memory-operation-contract.ts:26-47`; registry `memory-operation-kinds.ts:17-24` | two new kinds, one new family |
| Deferred-claim + `observeBoot` pattern | `memory-operation-kind-hindsight.ts:25-58,153-160` | the new kinds copy it |
| Fresh-Bank D77 binding: bootstrap evidence returns `undefined` for a Bank without an activation bank receipt (`db/hindsight-application-bootstrap-evidence.ts:45-47`); runner caches `original` per (epoch, bank, namespace) (`hindsight-application-binding-runner.ts:38-56`) | | first bind of a post-activation Bank (unproven by tests, see G6) |
| Test substrate: `hindsightRuntimeFixture({mode, seed, banks, model})`, `runtimeClient` doubles, `hindsightFixtureSecrets().set` bumps key version | `testing/hindsight-runtime-composition-fixtures.ts`; `testing/hindsight-activation-transport.ts` | drift, new-Bank and rebind tests |
| Native `DELETE /v1/default/banks/{bank_id}` (destructive, whole Bank) | `H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6524-6553` | not used in 2c (D88 note) |

No migration is needed: `memory_operations.kind` has no CHECK (`db/migrations/048-memory-operations.ts:11-27`); the
B3 row statuses already exist. Head stays 049.

Post-COMMIT integrity reads do not depend on the B3 row set: `readMemoryAuthoritySelection`
(`legacy-activation-repo.ts:17-46`) checks receipts/epoch only; `readCommittedHindsightProducer` LEFT JOINs
`hindsight_bank_setup` from the bank receipts (`hindsight-activation-reads.ts:126-140`); `requireSetupBanks`
exact-equality (`db/hindsight-authority-repo.ts:143-152`) runs only inside promotion. Adding a verified Character row
after COMMIT is safe for all three. No post-COMMIT read compares the live fingerprint with the receipt fingerprint.

---

## 3. Gap list

| # | Sev | Gap | Grounding | Minimal direction | Owning layer | Proving test |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | HIGH | `captureRun` throws for a Character without verified Banks; `chat.send` fails before recall fallback | §1 A27; `hindsight-runtime-connection.ts:57-61`; `run-snapshot-capture.ts:61` | Under Hindsight, a Character whose Bank is not ready captures a **memory-unavailable Run**: `initializeBaseline` still runs (local only, so the turn is ingested once the Bank is ready), no memory tools, no automatic recall, no memory prompt, snapshot from the stored capabilities; a closed reason (`bank_not_ready`) is logged/diagnosed. Integrity failures (lineage/marker/unbound) keep throwing. | core/memory/hindsight (subsystem + foreground runtime), `runtime-composition.ts` | composition fixture with Global+`taki` verified: `captureRun("mika")` resolves with empty tools; `chat.send`-level test admits a Run and streams a reply; a later ingestion after provisioning consumes the turn |
| G2 | HIGH | First capture after a config change with the provider down throws the availability code (no stored admission evidence) | `hindsight-memory-runtime.ts:71-74` | Same degrade for availability codes when no evidence exists for the current fingerprint (`hindsightAvailabilityFailure` set); existing-Bank recall failure keeps the current in-Run fallback | core/memory/hindsight | fixture: rotate secret (`hindsightFixtureSecrets().set`), transport unreachable, capture resolves memory-unavailable; after reachability, capture is normal |
| G3 | HIGH | No provisioning path under Hindsight authority | `hindsight-setup-service.ts:264-267`; activation card `:24-29` | New kind `bank.provision {characterId}`: requires marker `hindsight`, runtime published, no drift; target = Character element of `hindsightBankBindings`; template revision = **the verified Global row's `templateRevision`** (never the config's desired revision; a mismatch refuses `HINDSIGHT_TEMPLATE_CONFLICT`, since changing revision is Stage 5 upgrade); dry run then `applyHindsightBank`; never touches rows already verified; id length > 160 refuses closed | new `core/memory/hindsight-lifecycle/` + kind file | kind test: happy path writes one `verified` row, Global row untouched; revision mismatch refuses with zero native calls; failure leaves `failed` row and live Banks still served |
| G4 | HIGH | B3 snapshot parse breaks as soon as a non-verified row exists while phase is `configured` | `packages/shared/src/hindsight-setup-schema.ts:45-48`; `db/hindsight-connection-repo.ts:16,23` (`read` parses) | Relax the refine to "configured requires a verified Global row, at least one verified Character row, and compatibility"; non-verified rows become per-Bank readiness evidence. Provisioning keeps phase unchanged | shared + core db | Shared schema test (configured + one `failed` Character row parses; configured without verified Global fails); Core: `setup.status()` readable during and after a failed provisioning |
| G5 | HIGH | Scope crossover: native id is install-independent and `createOrUpdateBank` is a PUT upsert; the fresh-Bank bind accepts whatever the native Bank already holds | `hindsight-bank-identity.ts`; `hindsight-client.ts:94-99`; `hindsight-application-bootstrap-evidence.ts:45-47` | Before the first PUT for a Character with no B3 row, probe the native Bank; if it exists with memory/document content, refuse `HINDSIGHT_BANK_OCCUPIED` (new closed code) and never bind it. A row of ours (any status) means our own earlier attempt and skips the probe | core/memory/hindsight-lifecycle + client | transport double returning an occupied Bank -> refusal, no PUT, no B3 row; empty/absent Bank -> proceeds |
| G6 | MEDIUM | A newly verified Bank gets no catch-up request, and a fresh post-activation Bank reaching a bound replica is unproven | drain re-reads `banks()` (`hindsight-replica-scheduler.ts:147`) but only `start`/`verifiedReconnect` call `requestCatchUp`; `seed:false` tests use pre-populated native bundles | Provisioning requests a full run for the new Bank (`scheduler.requestManual(bankId, "full")`) and settles `completed` only after that Bank's replica is bound (`lastSuccessAt >= admittedAt`, checkpoint present); otherwise `failed` with the replica code and `nextAction` | lifecycle kind | journey test on temp SQLite + transport double: provision `mika`, bind with `original: undefined`, then a captured Run for `mika` has recall routed to the new Bank and Global |
| G7 | MEDIUM | No readable readiness state; never-provisioned vs provisioning vs failed vs ready cannot be told apart | §1 A27 | `memory.authority.status.hindsight.banks[]` per scope: `ready` (verified + replica bound), `syncing` (verified, not yet bound), `provisioning` (open lifecycle row for it), `failed` (row `failed`, `lastError.code`), `not_provisioned` (Character seen in Timeline without a row). Existing-Bank recall failure stays per Run (`MEMORY_PROVIDER_UNAVAILABLE`) plus that Bank's replica `errorCode` — a different field, never a readiness state | shared schema + core status read | status matrix test over the five states + a replica failure on a ready Bank |
| G8 | HIGH | Config/secret drift and the disable flag are reported as `authority_mismatch` | `memory-authority-status.ts:66-70`; `hindsight-runtime-connection.ts:33-38`; `hindsight-config.ts:15` | Status compares the live fingerprint with the runtime's captured one and with the B3 snapshot; new closed reasons `connection_disabled` (config `disabled`/`unconfigured`) and `config_changed` (fingerprint differs, same authority). `authority_mismatch` stays for real epoch/lineage mismatch. The disable flag is never a switch (Stage 4) | shared + core status + desktop labels | status test for each reason; Home state fixture labels |
| G9 | HIGH | No revalidate/rebind primitive | `hindsight-runtime-binding.ts:56,76-81`; `runtime-selector.ts:72-77` | Binding `replace(epochId)`: construct the new draft while the old stays published, swap publication, await `old.stop()`, then `new.start()` (start already does the catch-up). Kind `connection.revalidate {expectedEpochId}`: config must be `ready`; refuse a changed `deploymentMode` or `desiredTemplateRevision` (Stage 5); compatibility validate; `admitHindsightApplication` with `expectedLineage = epoch.providerLineageId` (a different instance refuses `HINDSIGHT_REPLICA_LINEAGE_MISMATCH`, Stage 4); export-verify each live Bank without row writes; persist snapshot fingerprint + compatibility (revision+1, **never `markAllPending`**, `hindsight-setup-service.ts:101-103`); save admission evidence for the new fingerprint; `replace` when the fingerprint changed or the runtime is unavailable, otherwise no swap | core/memory (binding + composition) + lifecycle kind | composition test: bump timeout -> reason `config_changed` -> revalidate -> runtime available with new fingerprint, no Bank row changed, old scheduler stopped once; lineage change refuses and keeps the old binding |
| G10 | MEDIUM | Boot binds a changed config silently; template revision drift is not enforced at runtime | §1 A31; `hindsight-runtime-connection.ts:26-30` | Keep binding at boot (lineage proof exists) but surface `config_changed` vs the B3 snapshot in status until a revalidation records the new fingerprint; runtime construction refuses when `desiredTemplateRevision` differs from the verified rows' revision (closed code, binding `unavailable`) | core/memory/hindsight | boot test with changed timeout -> available + `config_changed` flag; changed template revision -> binding unavailable with code |
| G11 | MEDIUM | Drift drops primary-commit witnesses | `hindsight-memory-subsystem.ts:72-74` | When `assertConnection` refuses, witness through `witnessHindsightPrimaryCommit` (marker-routed, no network) so the degraded turn is ingested after revalidation | core/memory/hindsight | subsystem test: drift, `recordPrimaryCommitted` -> ledger row exists; after rebind ingestion consumes it once |
| G12 | MEDIUM | Scheduler stops re-arming under drift | `hindsight-replica-scheduler.ts:84-94,185-199` | Solved by G9 (the replaced subsystem starts a fresh scheduler); no scheduler change beyond not throwing out of `armTimer` (catch -> `lastError`) | core/memory/hindsight | scheduler test: `banks()` throwing inside `armTimer` records `lastError`, no unhandled rejection |
| G13 | MEDIUM | `verifiedReconnect` has no caller | §1 A16 | Two callers only: (a) `connection.revalidate` without a swap calls `scheduler.verifiedReconnect()` after its proven admission (a swap relies on `start()`); (b) after a foreground capture sync admitted and synced every routed Bank, if any automatic Bank is in backoff with an availability `errorCode`, the subsystem calls `verifiedReconnect()` once. Never from inside the scheduler's own drain (would loop through `rerun`), never from WS/browser events | core/memory/hindsight (subsystem wiring a callback from foreground runtime to scheduler) + lifecycle kind | scheduler/subsystem test: Bank B in retry after `HINDSIGHT_UNREACHABLE`, foreground capture succeeds -> B catches up before `retryDueAt`; no call when no Bank is in availability backoff; no call from scheduled runs |
| G14 | MEDIUM | Home has no readiness rows, no revalidate/provision action, wrong drift label | `memory-authority-card.tsx:29-41`; `memory-authority-state.ts:45-47`; `home-window.md:89-101` | Authority card: per-Character readiness rows and 创建 Bank / 重新校验连接 buttons from server-derived `hindsight.actions`; labels for the new reasons; no client-derived allow rules | apps/desktop operations page | state/card tests over the five readiness states and three reasons; controller serialization unchanged |

Out-of-scope pulls to refuse explicitly (never implement in 2c): template revision change or model re-provisioning
(Stage 5 upgrade/managed), `deploymentMode` change (Stage 5), a different provider lineage or disabling Hindsight as a
switch (Stage 4 reverse transition), native Bank delete/reset (Stage 3/5 Bank administration with backup first),
queueing a provisioning request behind a busy family (Stage 4 queued intents — refuse `MEMORY_OPERATION_BUSY`, the Run
degrades, a later Run or the operator resubmits).

---

## 4. Failure matrix

| Condition | Today | Required after 2c |
| --- | --- | --- |
| `chat.send` for a Character with no B3 row | `INTERNAL_ERROR` `HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH` | Run admitted memory-unavailable; readiness `not_provisioned`; provisioning per Q1 |
| provisioning while `setup`/`local-onboarding`/`hindsight-activation`/`hindsight-lifecycle` row open | n/a | `MEMORY_OPERATION_BUSY` + `activeOperationId`; nothing queued |
| provisioning under marker `canonical-local`/`legacy-markdown` | n/a | `MEMORY_OPERATION_UNSUPPORTED`, no row |
| provisioning with config drift or runtime unavailable | n/a | `MEMORY_OPERATION_UNSUPPORTED` (revalidate first) |
| config `desiredTemplateRevision` != verified Global revision | n/a | `failed` / `producer_refused` / `HINDSIGHT_TEMPLATE_CONFLICT`, zero native calls |
| native Bank already occupied, no B3 row | would be adopted | `failed` / `HINDSIGHT_BANK_OCCUPIED`; no PUT, no row |
| dry run / import / poll / export verify fails | n/a | `failed` with the code; row `failed`; Global and other Characters keep serving |
| row verified but first sync fails | n/a | `failed` with replica `errorCode` + `nextAction`; readiness `syncing`; re-submit resumes idempotently (`applyHindsightBank` verified branch) |
| Core restart during provisioning | n/a | `observeBoot`: row `verified` + replica bound -> `completed`; otherwise `outcome_unknown` / `producer_incomplete`; a busy B3 phase is not used, so setup reconciliation is unaffected |
| existing ready Bank, provider down during a Run | recall fails, chat continues (`chat-agent.ts:443-447`) | unchanged; readiness stays `ready`, replica shows the availability `errorCode` |
| config edit / key rotation, same instance | every call `MEMORY_AUTHORITY_MISMATCH`; status `authority_mismatch`; witnesses dropped | status `config_changed`; Runs memory-unavailable; witnesses kept; revalidate per Q2 rebinds |
| `TAKI_HINDSIGHT_ENABLED=false` under Hindsight authority | as above | status `connection_disabled`; revalidate refuses `HINDSIGHT_CONNECTION_DISABLED`; authority unchanged |
| endpoint now points at a different instance | boot binds only if lineage matches (admission refuses otherwise, Runs fail) | revalidate refuses `HINDSIGHT_REPLICA_LINEAGE_MISMATCH`; old binding kept; status names the mismatch |
| `deploymentMode` changed | silently part of fingerprint | revalidate refuses (Stage 5); status `config_changed` |
| revalidate: health/version/manifest fails | n/a | `failed` with the Hindsight code; no snapshot write; binding untouched |
| revalidate: new draft construct/start fails | n/a | binding `unavailable` with code; `failed` / `runtime_unavailable`; `recoverBinding` offered as today |
| provider recovered after outage, same config | only scheduled retry after backoff | foreground success triggers one `verifiedReconnect` (G13) |
| Core restart after revalidate COMMITTED the snapshot but before replace | n/a | boot constructs with the current config = new fingerprint; status clean |

---

## 5. Operation kinds, family, status read, single-flight, Shared additions

**Kinds** (one handler file each, one registry row each in `memory-operation-kinds.ts:17-24`):

- `bank.provision` — request `{ kind, characterId }` (1..160, matches `hindsightBankBindings`); producer ref
  `{ kind: "bank", characterId, nativeBankId, templateRevision, admittedEpochId, phase: "reserved" | "probing" |
  "applying" | "syncing" | "completed" }`; result `{ kind: "bank", characterId, nativeBankId, readiness: "ready" |
  "syncing" | "failed" }`.
- `connection.revalidate` — request `{ kind, expectedEpochId }`; producer ref `{ kind: "connection", epochId,
  fingerprintBefore, fingerprintAfter | null, phase: "reserved" | "validating" | "verifying-banks" | "recording" |
  "rebinding" | "completed" }`; result `{ kind: "connection", outcome: "unchanged" | "rebound" | "binding_unavailable",
  fingerprint }`.

Both follow the Stage 2a/2b rules: synchronous side-effect-free `admit`, Core-minted identities, deferred claim via
`tryClaim` one macrotask later, cancel only while `admitted`, `observeBoot` read-only (G3/G9 settle from the B3 row,
replica state and binding snapshot, otherwise `outcome_unknown`).

Naming note: the Shared superRefine infers the producer kind from the kind prefix
(`memory-operation-schema.ts:99-100`: `local.` / `setup.` / `hindsight.` / else `replica`). A `hindsight.bank.*` name
would be forced onto the activation producer shape. Recommendation: replace the nested ternary with a local
`Record<MemoryOperationKind, ProducerKind>` table in the same file (not exported), and use the two prefixes above.

**Family**: `hindsight-lifecycle` for both kinds (a rebind must never swap the runtime under a running provisioning).
Add it to `EXCLUSIVE_MEMORY_FAMILIES` (`memory-operation-contract.ts:41`), so `setup`, `local-onboarding`,
`hindsight-activation` and `hindsight-lifecycle` are mutually single-flight through the existing
`refuseWhileExclusiveFamilyBusy`. `replica:<bankId>` stays independent (as in Stage 1); a replica operation spanning a
`replace` settles from the shared DB schedule state, which both schedulers use.

Direct setup RPCs (`memory.hindsight.validate/setup/disable/llmHealth`) keep refusing under Hindsight; the new kinds are
the only post-activation writers of `hindsight_bank_setup` and `hindsight_connection_state`.

**Context**: `MemoryOperationContext` (`memory-operation-contract.ts:26-40`) gains `lifecycle?: HindsightLifecycleService`,
composed in a new `core/boot/hindsight-lifecycle-boot.ts` from the same config source, secret catalog, client factory,
bank/connection repos and the composition's `operations()` + new `replaceHindsightBinding` seam.

**Status read**: extend `memory.authority.status` (one read, already invalidated by `memory.operations.changed`) with
`hindsight: { connection: { config: "ready" | "disabled" | "unconfigured", drift: "none" | "config_changed" | "unreviewed",
admittedAt: timestamp | null }, banks: [{ scope, characterId, nativeBankId, readiness, errorCode }], actions: { revalidate:
boolean, provision: string[] } } | null` — non-null exactly when the marker is `hindsight`, readable even when the runtime
is unavailable (unlike `replica`/`pending`). `MemoryRuntimeUnavailableReasonSchema` gains `connection_disabled` and
`config_changed`. "unreviewed" = runtime fingerprint equals live config but differs from the B3 snapshot (G10 boot case).
`admittedAt` is the stored admission evidence time for (epoch, current fingerprint); status never probes the network.

**Shared additions** (`packages/shared/src/`):

- new `memory-hindsight-lifecycle-schema.ts`: two request, two producer, two result schemas, lifecycle error codes, the
  `hindsight` status section schema;
- `memory-operation-schema.ts`: kind enum (`:26`), request/producer/result unions (`:41-68`), error-code union (`:73`),
  producer-kind table (`:99-100`);
- `memory-authority-status-schema.ts`: `hindsight` section + two reasons + superRefine (`hindsight !== null` iff mode
  `hindsight`);
- `hindsight-connection-schema.ts:99-107`: `HINDSIGHT_BANK_OCCUPIED`, `HINDSIGHT_CONNECTION_DISABLED`;
- `hindsight-setup-schema.ts:45-48`: relaxed `configured` refine (G4).

**`index.ts` line count**: 513 physical lines; 486 non-blank, non-comment lines by a line filter (ESLint `max-lines`
500 with `skipBlankLines`/`skipComments`, `eslint.config.js:52`). Stage 2b's research reported 479/500; the current
headroom is about 14 lines. The additions fit in 2 statements / 4 physical lines if written in the existing dense style
(`index.ts:507-513`); exporting nothing that desktop can derive from `MemoryAuthorityStatus["hindsight"]`.

---

## 6. D86 / D87 / D88 disposition

- **D86 (Local Bank id schemes) — keep OPEN, retarget.** Under Hindsight authority the native id is scope-derived
  (`hindsight-bank-identity.ts`) and never uses the Local Bank id; `ensureCanonicalLocalBanks` is unreachable after
  COMMIT (only `canonical-local-runtime.ts:36,75`). Stage 2c therefore needs no Local id stability. New trigger: Stage 4
  reverse transition (Hindsight -> Local creates Local Banks again) or Stage 3 backup/restore identity, or the first
  post-Local-activation multi-Character use.
- **D87 (lazy Local Bank creation during the activation interval) — close in 2c, conditionally.** Before COMMIT the gap
  is observable and remedied by 应用配置 then 继续 (`hindsight-activation-actions.ts:27-28`; promotion exact-equality
  `db/hindsight-authority-repo.ts:143-152`, `hindsight-activation-service.ts:177-179`). Fencing the creation would make
  chat for that Character fail during the interval, contradicting grill Q1 "chat stays usable". The residual tail (a
  Character whose witness is carried at COMMIT but whose Bank never reached promotion) becomes an ordinary A27 case once
  G1/G3/G11 land: the carried witness waits in the Hindsight ledger until the Bank is provisioned. Close condition: one
  journey test proving both halves (interval Character -> resume blocking -> apply -> resume completes; post-COMMIT
  Character -> provision -> carried/degraded turns ingested once).
- **D88 (`target_conflict` remedy) — keep OPEN, retarget to Stage 3/5.** It is a pre-COMMIT activation refusal; Stage 2c
  provisioning never uses current-state transfer. Native facts: `target_conflict` is raised both for a persistent
  occupied target (counts/keys mismatch, `engine/transfer/current_state_admission.py:150-169`) and for a transient cause
  (pending/processing async operations on the target, `:144-149`), for which the current re-POST on 继续 is correct.
  A distinct remedy needs the native refusal to say which, and the only native reset is whole-Bank `DELETE`
  (`http.py:6524-6553`, "cannot be undone") — Bank administration with backup first, i.e. Stage 3/5. G5's occupancy guard
  is the post-activation counterpart and does not need D88.

---

## 7. Wave split (one implementer per wave, sequential)

**Wave A — contracts, degrade path, truthful status (no new producer).** G1, G2, G4, G7 (read side), G8, G10 (status
flag + template-revision refusal at construction), G11, G12.

- `packages/shared/src/memory-hindsight-lifecycle-schema.ts` (new; the status section and readiness schemas only) + `.test.ts`
- `packages/shared/src/memory-authority-status-schema.ts` + test
- `packages/shared/src/hindsight-setup-schema.ts` + test (G4)
- `packages/shared/src/hindsight-connection-schema.ts` (two codes)
- `packages/shared/src/index.ts` (<= 4 lines)
- `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts` (degraded capture routing, G11 witness)
- `packages/core/src/memory/hindsight/hindsight-memory-runtime.ts` (memory-unavailable capture, G2)
- new `packages/core/src/memory/hindsight/hindsight-unavailable-run.ts` (the memory-unavailable `CapturedMemoryRun`)
- `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts` (template-revision check, readiness helpers)
- `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts` (`armTimer` catch, G12)
- `packages/core/src/memory/operations/memory-authority-status.ts` + new `memory-hindsight-lifecycle-status.ts` (section read)
- `packages/core/src/memory/hindsight/index.md`, `memory/operations/index.md`
- tests: `hindsight-runtime-composition.test.ts` (new-Character capture, drift reasons), status tests, scheduler test

The operation kinds stay out of Wave A: adding them to the Shared kind enum forces registry handlers
(`MemoryOperationKindRegistry`, `memory-operation-kinds.ts:13-15`), so they land with their handlers in Wave B and every
wave stays shippable. Wave A adds only the status section, reasons, codes and G4; the section's `actions` are
`revalidate: false, provision: []` until Wave B.

**Wave B — producers, rebind, reconnect, automatic triggers.** G3, G5, G6, G9, G13 and the Q1/Q2 triggers.

- `packages/shared/src/memory-hindsight-lifecycle-schema.ts` (request/producer/result arms), `memory-operation-schema.ts`, `index.ts`
- new `packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-service.ts` (provision + revalidate producers)
- new `packages/core/src/memory/hindsight-lifecycle/hindsight-bank-occupancy.ts` (G5 probe)
- new `packages/core/src/memory/operations/memory-operation-kind-bank.ts`, `memory-operation-kind-connection.ts`
- `packages/core/src/memory/operations/memory-operation-kinds.ts`, `memory-operation-contract.ts` (family, `lifecycle?` ctx)
- `packages/core/src/memory/operations/memory-operation-service.ts` (pass `lifecycle` into ctx)
- `packages/core/src/memory/hindsight-runtime-binding.ts` (`replace`), `runtime-selector.ts`, `runtime-composition.ts` (seam)
- `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts` (G13 callback), `hindsight-client.ts` (probe method if needed)
- new `packages/core/src/boot/hindsight-lifecycle-boot.ts`; `packages/core/src/main.ts` (compose + late-bound automatic submit)
- `packages/core/src/boot/hindsight-setup-boot.ts` only if the setup service must expose the repos (prefer passing repos)
- index.md files for the touched folders
- tests: kind tests (admission matrix, busy with each of the four families, pre-claim cancel, boot observation),
  lifecycle journey test (temp SQLite + `hindsight-activation-transport.ts` double: provision + fresh-Bank bind +
  Run recall; drift + revalidate + rebind; lineage change refusal; outage -> reconnect), isolated Core boot check
  (migration head 049, both status reads, kinds registered, zero fetches at boot)

**Wave C — Home.** G14.

- `apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts` (+ test): readiness rows, new reason labels, kind labels for `bank.provision` / `connection.revalidate`
- `memory-authority-card.tsx` (+ test): readiness block, 创建 Bank / 重新校验连接 from `hindsight.actions`
- `memory-authority-fixtures.ts`, `use-memory-operations.ts` (submit helpers), `memory-operations-controller.ts` only if a new busy key is needed
- `apps/desktop/src/lib/ws-client-memory-operations.ts` only if request typing needs it (the submit method is generic)
- `apps/desktop/src/windows/home/pages/operations/index.md`

After the waves (main agent, `update-spec`): `memory-operations.md` (kinds, fourth exclusive family),
`memory-hindsight-activation.md` known limits (D87), `memory-replica-sync.md` (reconnect callers),
`home-window.md` §Memory authority card, new `memory-hindsight-lifecycle.md`; `docs/deferred-decisions.md` D86/D88
retarget and D87 close.

---

## 8. Product questions (owner choices only)

**Q1. Who starts Bank provisioning for a Character first used after activation?**
- A (recommended): Core starts it automatically when a Run first finds the Character without a Bank; one automatic
  attempt per Character per connection fingerprint; after a failure only the operator's 创建 Bank retries. The Run itself
  continues without memory.
- B: operator only — Home shows the Character as "not provisioned" with 创建 Bank; chat continues without memory until then.
- Grounding: Local already creates a new Character's Banks lazily (`canonical-local-banks.ts:24-31`); ADR 0009 lines 11/44
  promise one Character Bank per Character-user relationship; B3 setup is documented as operator-only with no boot network
  calls (`boot/hindsight-setup-boot.ts:1-4`) — automatic provisioning is Core-initiated network writes to Hindsight
  outside an operator click. A new Character currently comes only from protocol callers or the future D22 panel
  (`active-character.ts:8`).

**Q2. What happens when the Hindsight connection settings or API key change while Hindsight is the authority?**
- A (recommended): Core revalidates and rebinds automatically at first detection, only when the instance lineage,
  deployment mode and template revision are unchanged; Runs continue without memory in between; a failed attempt waits
  for the operator's 重新校验连接.
- B: operator only — status shows "configuration changed", Runs continue without memory until 重新校验连接.
- C: operator only, and chat is refused (structured code) until revalidated — today's behaviour minus the wrong label.
- Grounding: every Hindsight knob is `apply: "live"` (`knob-registry.ts:188-203`), so one settings edit currently stops
  all memory (`hindsight-runtime-connection.ts:33-38`); lineage equality is already proven by every admission
  (`hindsight-application-capability.ts:50`), which is what makes A safe for the same instance.

(The enable-flag case is not a question: A31 forbids treating it as a switch, so it is `connection_disabled`, memory
unavailable, authority unchanged.)

---

## 9. Caveats / not found

- The native occupancy probe for G5 is not chosen. `factPage` needs a `document_id` (`hindsight-client.ts:126-130`); a
  missing Bank maps to the generic `HINDSIGHT_RESPONSE_INVALID` (`:269-281`). Candidates to verify in native source before
  coding: `GET /v1/default/banks/{bank_id}/stats` (`http.py:4522`), the bank profile route, or the ext
  `changes` journal from cursor 0 (`hindsight-client.ts:138-150`).
- "Memory-unavailable Run" snapshot shape: `RunMemoryReference` (`packages/shared/src/harness-schema.ts:91-98`) requires
  capabilities and has no availability field. With stored admission evidence the provider capabilities are truthful; with
  none (G2) the implementer must decide between a non-Hindsight snapshot and a new optional field — a Shared change in
  `harness-schema.ts` (not in `index.ts`). Not decided here.
- The fresh-Bank D77 bind (`original: undefined`) is read-verified only; no existing test proves a never-imported native
  Bank reaches `bindingState: "bound"` (G6 test required).
- The exact promotion-time behaviour when a Local Bank is created after the final coverage comparison was not traced to
  the transaction boundary; D87's close condition asks for the journey test rather than relying on this reading.
- `replace` concurrency: in-flight Runs keep the old coordinator; after `old.stop()` their recall/tool calls fail
  `MEMORY_OPERATION_CANCELLED`, which the chat-agent fallback and tool error envelopes absorb. Not exercised by a test yet.
- `.trellis/.current-task` is empty; the task path came from the lead's dispatch.
