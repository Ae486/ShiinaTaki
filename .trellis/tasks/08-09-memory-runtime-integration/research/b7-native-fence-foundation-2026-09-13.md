# Research: B7 native source-fence foundation

2026-09-14 qualification: [the grounded B7 record](../../08-09-memory-operations-ui/grill.md) applies the accepted
verified-baseline/mapping/change-reuse rule. The source findings below identify missing handoff guarantees; the proposed
native contract is not an accepted decision. A former epoch staying historical must not be interpreted as forbidding
verified Bank reuse under a later explicit authority epoch. Any fence proposal must cover that continuation before it
is frozen or implemented, and cannot require new Banks/full copying merely to simplify the handoff.

- Query: Which implemented Hindsight mechanisms can support a healthy Hindsight-to-Local final source writer fence, accepted-work and maintenance drain, and complete snapshot; which minimum native contract is still missing?
- Scope: Internal source research in the explicitly authorized TakiAgent and Hindsight roots; backup/restore entrypoints only, without a deployment or administration survey.
- Date: 2026-09-13
- Status: Research for existing B7 planning. Every proposed handoff operation below is **not implemented** by the inspected G1/D78/D77 contracts.

## Findings

The existing mechanisms provide useful serialization, finite maintenance execution, historical proof, and complete native/application reads. They do **not** currently provide a general source-authority fence that remains closed after Local commits. B7 cannot obtain that guarantee by renaming a D78 lease, treating a zero queue count as a drain, or holding a normal snapshot open.

One proposed additional native surface is a versioned **Bank source handoff** contract: close new native/application admissions, account for accepted work through its final publications, run the required finite maintenance against the current native Bank, and seal a retained native/application boundary under a durable write prohibition. Its owner execution lease can expire; its sealed write prohibition must not expire into a writable old authority. Reuse the existing Bank locks, actual maintenance producers and proof machinery internally. Preserve all frozen G1/D78 requests, hashes and certificate meanings. This proposal still needs to specify verified later re-entry against the accepted continuation contract; it is not a complete round-trip design.

### Verified scope and anchors

| Item | Observation |
| --- | --- |
| TakiAgent | `H:/TakiAgent/.git/HEAD` names `refs/heads/main`; that ref contains `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`. |
| Native source | `H:/hindsight/.git/HEAD` names `refs/heads/main`; that ref contains `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. |
| Task | Legacy `.trellis/.current-task` is empty. The already specified `.trellis/.runtime/sessions/codex_01a07553-c738-75f0-93c4-bd8a7cd0b014.json` points to `.trellis/tasks/08-09-memory-runtime-integration`. The parent supplied this exact output path; no task or session pointer was changed. |
| Native instructions | `H:/hindsight/AGENTS.md` delegates to `CLAUDE.md`; relevant architecture, Bank isolation, PostgreSQL and compatibility conventions were read. No native `.trellis/spec` directory was found. |
| Source version | Native `hindsight-api-slim/pyproject.toml:7` declares `0.9.0`; the current working-tree `engine/taki_compatibility.py:36` declares build `taki-memory-hindsight-0.9.0-d77-v1`. Older D78 ledger sections still describe their historical `d78-v1` build. |
| Evidence limit | These are ref-anchor checks and current working-tree source reads, not a claim that either tree is clean or byte-identical to its HEAD. No Git command, service/database access, model call, dependency installation or test execution occurred. |

Source notation below: native `engine/`, `api/`, `admin/` and `alembic/` paths are relative to **`H:/hindsight/hindsight-api-slim/hindsight_api/`**. Native `tests/` paths are relative to **`H:/hindsight/hindsight-api-slim/`**. Taki paths are relative to **`H:/TakiAgent/`**.

### Files found

| File | Responsibility relevant to B7 |
| --- | --- |
| `engine/replication.py` | Durable provider lineage/Bank generation, per-Bank writer row lock, canonical journal and same-transaction D77 publication. |
| `engine/bank_maintenance.py` | D78 owner-row locking, ordinary producer pre-await tokens, and final maintenance publication checks. |
| `engine/cutover_maintenance.py` | Transfer-bound finite owner acquisition, attempt tokens, bounded renewal and release. |
| `alembic/versions/d78c3e6f8b12_add_bank_maintenance_ownership.py` | Maintenance ownership schema and accepted-operation MVCC signaling trigger. |
| `engine/cutover_verification.py` | Frozen first-activation request and certificate DTOs. |
| `engine/cutover_verification_candidate.py` | Complete transferred-Bank candidate validation, accepted-work refusal, source/scope/model enumeration. |
| `engine/cutover_verification_runner.py` | Real finite source/model execution and retained snapshot sealing. |
| `engine/cutover_verification_certificate.py` | Same-view source/evidence validation and certificate publication. |
| `engine/cutover_verification_store.py` | Durable attempt CAS, immutable proof pages, completion and owner release. |
| `engine/logical_snapshot.py` | Complete canonical snapshot loading, deterministic pages, expiry and certificate retention. |
| `engine/native_operation_receipts.py`, `engine/retain/receipt_context.py` | G1 historical result identities and tracked Bank/source/attempt guards. |
| `engine/retain/orchestrator.py`, `engine/memory_engine.py`, `engine/task_backend.py` | Actual canonical and task admission paths, including intentional non-maintenance exceptions to D78 ownership. |
| `engine/application_state/{store,commits,publication,snapshot,service}.py` | D77 namespace, artifact retirement, native/application paired publication, complete original-body closure and coherent reads. |
| `engine/taki_compatibility.py` | Actual advertised versions and capability probes; no generic source-handoff capability is advertised. |
| `admin/cli.py` | PostgreSQL data backup and destructive target restore with all compatibility/application tables. |
| `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts`, `hindsight-runtime-consumers.ts` | Taki-local connection/epoch guards, stop admission and foreground promise drain. |
| `.trellis/tasks/08-09-memory-operations-ui/design.md` | Existing B7 planning draft, including the explicitly unresolved provider fence/drain foundation. |

### Implemented capability table

| Mechanism | Implemented behavior and code evidence | Boundary for B7 |
| --- | --- | --- |
| Bank writer serialization | `engine/replication.py:376-402` locks `replication_bank_state FOR UPDATE` before canonical object locks. Cursor allocation and journal writes share the caller transaction (`:1030-1115`). | This is a transaction mutex. It has no durable `Local now owns this Bank` state and releases at commit. A later writer can acquire it. |
| Native identity and tracked G1 writes | `engine/native_operation_receipts.py:512-530` validates provider lineage, Bank generation and non-deletion under the same Bank lock. Historical receipts retain exact operation/request identity (`:533-561`). | Bank generation is a native lifetime identity, not Taki's Authority Epoch. Tracked identity does not prohibit later writes to a still-live generation. Ordinary `retain_batch_async` permits both `operation_id` and `native_receipt_execution` to be absent (`engine/memory_engine.py:4424-4439`). |
| All-writer publication foundation | `engine/replication.py:1111-1115` invokes D77 publication inside each instrumented native logical append. `engine/application_state/publication.py:274-312` checks capture continuity; `:317-383` publishes heads, tombstones and dependent rebinding work with the native batch. | This couples publication to an instrumented native writer, not to authority permission. App-only commits take a separate path. It is not a database-wide trigger covering arbitrary SQL, old binaries or alternative memory stores. |
| D78 ordinary-maintenance hold | `engine/bank_maintenance.py:98-120` uses cursor-row then owner-row ordering. `:170-187` checks occupied ownership and token/lineage/generation at publication; `:190-222` captures the token before native awaits. | Only ordinary maintenance is refused by the finite lease. `:113-117` explicitly says non-maintenance work participates in serialization but is **not denied**. Supported storage is PostgreSQL and SQL-backed memories; ordinary paths preserve their old behavior where that schema/capability is absent (`:87-95`, `:194-205`). |
| Durable late-result protection | `engine/cutover_maintenance.py:35-39` uses a 300-second lease and 30-second heartbeat. Attempt acquisition/assertion/release are token-bound (`:142-212`, `:234-275`). The retained last fence prevents an old ordinary producer from publishing even after release. | Execution ownership expires and ordinary scheduling can resume. A finite D78 owner is unsuitable as the permanent read-only disposition of the former authority. |
| Accepted-work visibility | `engine/cutover_verification_candidate.py:33-44` refuses any `async_operations` row in `pending` or `processing`. The migration's trigger touches the owner row's MVCC version when any operation enters that set (`alembic/versions/d78c3e6f8b12_add_bank_maintenance_ownership.py:78-101`). | The trigger signals admission; it does not forbid it. The query is a quiescence check, explicitly not maintenance-completion evidence. It does not constitute a durable census of every synchronous or untracked in-flight writer. |
| Real finite maintenance and proof | `engine/cutover_verification_candidate.py:204-234` enumerates every valid world/experience source scope and every mental model. `engine/cutover_verification_runner.py:352-395` runs actual source/model work, then seals evidence. `engine/cutover_verification_certificate.py:47-65` checks attempt, policy, accepted work, snapshot and required evidence together. | Current request and candidate must prove the exact committed Local transfer (`engine/cutover_verification.py:48-59`; candidate `:115-202`). They are not a generic current-Hindsight-Bank drain API. An ordinary long-lived Bank that has evolved since activation cannot reuse its old transfer as today's source proof. |
| Native complete logical snapshot | `engine/logical_snapshot.py:317-370` loads Bank, documents, live/archive memory units, mental models and directives from one view; pages and manifest bind identities/revisions/cursor. `:434-460` supports a binding that acquires/validates the source before capture. `:535-539` publishes the certificate in the same transaction. | An unbound snapshot deliberately permits concurrent writers (`:323-325`). D78 can retain native pages, but that pin neither fences future writes nor includes D77 application artifacts or Taki operational state. |
| D77 complete application snapshot | `engine/application_state/snapshot.py:78-111` checks paired native/state cursors and complete native-head coverage; `:129-154` retains original artifact/source history for hydration. `:192-244` materializes an idempotent hashed bundle. Service reads use repeatable read (`engine/application_state/service.py:47-66`). | It is a coherent historical read. App-only edits can advance `state_cursor` without advancing native cursor. Bundle expiry is enforced (`snapshot.py:181-189`); there is no D78-equivalent retained source-handoff bundle contract. |
| D77 retirement and binding | `engine/application_state/commits.py:221-233` restricts retirement to its own binding. `:321-365` appends a tombstoned artifact retaining its original body/binding and changes its native head to `binding_missing`. Native Bank deletion closes a generation, with new capture for recreation (`publication.py:299-309`, `:354-383`). | Artifact retirement does not retire the native Bank or fence native writers. Bank deletion/recreation would change the source lifetime and erase canonical state; it is not a read-only historical-branch operation. |
| Taki runtime stop | `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:32-55` refuses a stopped connection or mismatching epoch/configuration. `hindsight-runtime-consumers.ts:10-40` tracks and settles owned foreground promises. | This is Taki process lifetime control. It cannot stop Control Plane/MCP/direct native callers. Settling a cancelled local call does not prove that a dispatched remote write was cancelled; see `.trellis/spec/backend/hindsight-application-runtime.md:169-178`. |

### What happens to writes at the boundary today

| Race | Current behavior | Consequence |
| --- | --- | --- |
| Canonical transaction already owns the Bank row | Another owner waits. A committed writer's canonical values, journal cursor and required D77 event commit together. Retain uses this order at `engine/retain/orchestrator.py:1901-1918`. | Useful atomic serialization for the handoff's acquisition point. A repeatable-read view fixed before waiting must still be retried when stale; acquiring a lock does not refresh its MVCC snapshot. |
| Native retain started an expensive await but has not entered its final SQL transaction | Its later final transaction can acquire the Bank lock. Neither a general authority disposition nor a universal pre-await admission ticket is required by the ordinary retain signature. | A snapshot/short lock alone cannot account for or stop that late write. Queue emptiness cannot certify its absence. |
| Ordinary consolidation/model refresh started before a D78 lease | Its pre-await token is rechecked at its final SQL write. Occupied, changed-generation or changed-token ownership defers it. A late old finite attempt also fails its exact attempt/fence check (`cutover_verification_store.py:200-214`). | This is the correct pattern to reuse for final publication fencing. It does not by itself complete the work or transfer its accepted intent to Local. |
| Already accepted ordinary maintenance meets the hold | Worker entry rejects it through `assert_ordinary_maintenance_write` (`engine/memory_engine.py:2819-2822`); `:2864-2867` preserves it via `DeferOperation`. | Work remains accepted and retryable; it must not be marked completed or dropped merely to make cutover quiet. |
| New generic task or direct authored edit arrives during a D78 hold | Generic admission checks the hold only for `consolidation` / `refresh_mental_model` (`memory_engine.py:17225-17239`, `bank_maintenance.py:23`). Direct mental-model edits explicitly retain ordinary semantics and invalidate the candidate (`memory_engine.py:14717-14726`). | A concrete native write can escape a Taki-only or D78-only fence. This is intentional current behavior, not evidence that B7 already has the needed prohibition. |
| D78 certificate seals successfully | The certificate and native snapshot commit, then the maintenance owner is released in the same transaction (`engine/cutover_verification_store.py:442-482`). | The certificate proves a historical boundary. A fresh ordinary producer can write afterward. `engine/cutover_verification.py:1-6` explicitly states this limitation. |
| Local commits while native has only the existing locks/leases | Native remains a live Bank, and future native/API/application writes do not consult the Taki SQLite Authority Epoch. | Current source cannot establish the required read-only former authority. Old Taki guards also do not protect independent native clients. |
| D77 policy changes after a native-only snapshot | The application command can append a new artifact/state event without a native factual edit (`engine/application_state/commits.py:287-367`). | Native cursor equality alone is insufficient for the final complete handoff. Both clocks and the exact artifact/body closure must be sealed. |

### Proposed minimum native contract — not implemented

Use a new separately negotiated capability, provisionally `bank_source_handoff: 1.0.0`. This name and the operations below are design suggestions, not existing endpoints. Keep G1 `native_results`, D78 `current_state_transfer` / `cutover_verification`, D77 application contracts and their hash domains unchanged. Reuse tagged encoding primitives under a new domain where useful.

The preliminary source-closing proposal has four responsibilities; a complete round-trip contract must additionally
cover verified re-entry:

1. **Durable source disposition and admissions.** Bind a handoff ID/request hash, exact provider lineage, Bank ID/generation, coordinator/transition identity, Bank-set digest and CAS revision. Install the source gate under the existing Bank writer lock. Every admitted canonical or application mutation needs an admission identity captured before any await that can outlive acquisition. Record which already accepted operations and permitted descendants belong to the drain. A caller-supplied ID or an in-memory counter is not proof of membership.
2. **Final publication fence and drain.** All writers recheck that disposition and their admission/generation token inside the same transaction as their canonical mutation, journal/receipt and D77 publication. Existing accepted factual work may finish in `draining` so the final snapshot includes it. New ordinary mutation requests receive a typed retryable refusal; Taki places its own new intents in the transition's durable queue. External callers are not silently enqueued by Taki. An unresolved pre-boundary write prevents sealing, including a synchronous untracked write unless it has been accounted for by the new admission mechanism.
3. **Current-native finite proof plus complete sealed data.** Add a source mode for the actual current native Bank, independent of a Local transfer receipt. Reuse provider enumeration, native source/model execution, immutable action/input/outcome evidence and retained snapshot publication, while designing the new candidate/history validation explicitly. Include the full D77 application snapshot/body closure at the same final native cursor and exact application cursor. Seal only after every required accepted publication and required maintenance result is accounted for and the source remains fenced.
4. **Durable read/recovery/final disposition.** Provide idempotent historical status, proof and page retrieval; exact `seal`, commit-decision/retirement, and safe abort resolution. Retain sealed data for response-loss/restart recovery. The old source cannot become writable through heartbeat expiry, process restart, retry, or a late abort once the Local commit decision is durable.

Suggested state meanings:

| Proposed state | Admission/publication rule | Recovery rule |
| --- | --- | --- |
| `open` | Ordinary current-generation writes allowed. | A new handoff must CAS the current disposition and capture its accepted boundary. |
| `draining` | Refuse new external/Taki ordinary admissions; allow only recorded pre-boundary work and explicitly owned drain/proof descendants. | Owner lease loss may permit another executor to resume the same durable handoff, never silently reopen the source. |
| `sealed` | Refuse all ordinary canonical/application memory publication; immutable final proof and complete data are retained. | Remain closed while the coordinator outcome is unknown, even beyond an execution lease TTL. |
| `retired` | Preserve the sealed former epoch as history; record the final transition/target-epoch association. | Restart and old tokens stay closed. Later re-entry requires an explicit verified authority transition with baseline/mapping/change reuse; it is not implicit revival or mandatory allocation of a fresh destination. That continuation protocol remains to be designed. |

Abort/reopen must be an explicit token/CAS transition backed by the coordinator's durable pre-commit abort decision. A new token fences all old awaits after reopening. A sealed source may be reopened only if the design proves that no Local commit decision exists or can still commit; if that cannot be established, it remains sealed for recovery. A timeout or missing acknowledgement is not abort authority.

The native service and Taki SQLite cannot atomically commit a shared transaction. Therefore the source must already be durably sealed before Taki commits Local. Taki's final SQLite transaction binds the complete Bank-set proof, verified local snapshot/checkpoints, captured source epoch, queue ownership and new Local epoch. A later native `retired` acknowledgement may be retried while `sealed` keeps the old source closed. Conversely, an old outstanding `abort` request must never reopen a source after the coordinator has durably decided to commit. Exact coordinator decision/CAS ordering is required design work, not supplied by the existing D78 API.

#### Producer placement and narrow gaps

| Existing seam to reuse | Required extension |
| --- | --- |
| `lock_replication_bank_state`, `lock_native_bank` and canonical transaction boundaries | Check the new durable source disposition before accepting/publishing writes. A check only in `append_logical_changes` is too narrow for separate application commits and for establishing pre-await admission. |
| Ordinary-maintenance context and `assert_ordinary_maintenance_write` | Keep the existing D78 execution lease semantics; add/compose a separate source-authority token. Final closure must cover late old native producers even after the old maintenance lease expires. |
| Generic task submission, broker path, worker entry, retain/conversion/import and descendants | Preserve accepted identities and actual outcomes; classify/track every writer crossing the drain boundary. The existing maintenance-type whitelist is not the source-fence inventory. |
| `ApplicationStateStore.require_live`, `commit_artifacts`, native application publication | Fence app-only policy/Block/source commits as well as native writes. Preserve exact bindings, original body history and paired checkpoints. Artifact tombstones are not the authority gate. |
| `CutoverCertificateBinding` and `LogicalSnapshotBinding` | Add a separately versioned current-native candidate and source-handoff binding. The old candidate's exact transfer-map checks cannot be deleted or bypassed. Generalize private helpers only where their invariants still hold. |
| D77 `create_bundle` and content-addressed bodies | Add explicit handoff retention/binding, or equivalent immutable retained references to the already verified complete closure. Ordinary TTL snapshots cannot be the sole long-operation recovery source. |
| Manifest/storage probes and migration backup list | Advertise support only when the full new writer/drain/seal contract is installed; include durable source disposition/admission/proof state in backup and restore. |

The generic candidate needs a deliberate history policy for a long-lived Bank. Current D78 checks journal retention back to its transfer (`engine/cutover_verification_candidate.py:151-202`) and records lifecycle history; routine Hindsight may have advanced or pruned that history. Reuse current source/scope/model enumeration, but do not assert that dropping the transfer check alone creates equivalent lifecycle/completeness proof. Required but unavailable history must produce an explicit refusal or a newly defined complete-baseline proof.

#### Ordering for the B7 orchestrator

1. Verify the current source lineage, compatible writer implementation and exact configured Bank set. Preserve initial sync/reconciliation and accepted-work checks already required by ADR 0009.
2. Reserve the Taki transition and route new Taki memory intents into its durable queue. Close native admissions for the entire selected Bank set. Optimistic earlier drains are preparation; a final drain/recheck must occur after admissions close.
3. Finish or truthfully resolve all recorded accepted native/application work and permitted children. No new identity, fake cancellation, queue deletion or success-by-count is allowed. Drain required maintenance using its actual producer proof. Use the new source mode rather than an old Local import identity.
4. Complete current D77 bindings/publications needed for faithful reconstruction, then seal the full native/application boundary. Native-derived changes must be represented with their actual policy/binding status and provenance. `due` / retryable assessment state is not automatically lost or rewritten; D81 propagation remains a separate limitation.
5. Consume the sealed final changes and perform full reconciliation against every sealed Bank, including empty Banks. Verify both clocks, complete native records, original application bodies/history, Blocks and mappings. Persist the complete snapshot/checkpoints and transition backup references before Local publication.
6. Commit the new Local Authority Epoch and transition queue association atomically in Taki; retire old runtime references and bind the committed Local runtime. Resolve the source handoff idempotently. A bind failure recovers the committed Local epoch while the source remains sealed; it does not switch authority back.

Do not assume a global simultaneous database snapshot across all Banks. Current native maintenance renewal explicitly avoids holding two Bank locks together (`engine/cutover_maintenance.py:294-306`). Seal per Bank under one immutable transition/Bank-set identity and require the whole set before the Local commit. Cross-Bank parent operations, including `both` routing, must finish their complete recorded Bank coverage before that decision.

### Can external or direct native writers escape?

**Today, yes.** Direct authored mental-model edits are an explicit example (`engine/memory_engine.py:14717-14726`); non-maintenance admissions and D77 application commits are further examples. A Taki capability/epoch fence is not consulted by those native paths.

For the proposed contract, compatible HTTP, Control Plane, MCP, SDK, worker and in-process engine callers must converge on the same native admission and final SQL gate. The capability must refuse if any writer affecting the transferred state is unsupported or unaudited. A reverse proxy or Taki adapter refusal alone cannot make this claim.

Old processes and raw database/admin writers require an explicit perimeter. `H:/hindsight/TAKI_PATCHES.md:488-490` already warns that an old writer does not honor the D78 fence. The current accepted-work trigger is not a universal canonical-write prohibition. If the claim must include writers outside the compatible engine, the implementation needs database-enforced protection for the relevant tables/roles or verified exclusion/drain of those writers; superuser SQL, disabled triggers and destructive restore cannot be made safe by a Python token check. Do not claim universal coverage from a static manifest while such writers retain independent write access. Actual deployed writer/process/credential topology was outside this research's authorized reads.

### Native backup and restore entrypoints

These are existing commands, inspected but **not executed**. They are useful native data producers for a B7 helper, not a completed B7 backup operation.

| Entrypoint | Actual behavior | B7 implication |
| --- | --- | --- |
| `hindsight-admin backup <output.zip> --schema <schema>` | CLI entry is declared in `hindsight-api-slim/pyproject.toml:161`; `admin/cli.py:439-461` reads `HindsightConfig.from_env()` and configured database URL. `:283-344` uses PostgreSQL binary COPY into a ZIP under one repeatable-read transaction, with manifest version `2`, row counts and ordered column/type descriptions. | Produces a coherent database data archive while writers may continue. It does not install a handoff fence, identify the Taki transition, or make the backup the final source boundary. A B7 helper must bind artifact identity, compatible build, epoch/Bank set and checkpoints separately. |
| `hindsight-admin restore <input.zip> --schema <schema>` | `admin/cli.py:465-490` offers an explicit destructive confirmation (`--yes` bypasses it). `:351-412` validates target schema first, then truncates the configured table set and restores it in one transaction, refreshing BM25 afterward. | Use only an explicitly selected isolated/prepared candidate or separately authorized recovery target. The command is not an in-place healthy handoff and must not run against an active source to prove read-only retirement. |
| `_effective_backup_tables`, `_run_backup`, `_run_restore` | `admin/cli.py:244-260` incorporates declared extension tables; `:419-436` resolves the configured URL, including embedded PostgreSQL. | Helper ownership must select the intended instance/schema and capture required extension registration. The archive is database data, not a full deployment image or schema migration procedure. |

The core inventory at `admin/cli.py:50-94` includes provider lineage, Bank generations/cursors, logical journal and snapshot pages, G1 receipts/parts, live and invalidated facts, sources/chunks, models/history, directives, queues, all D78 transfer/owner/proof tables and all eight D77 application tables. The file explicitly requires all persistent PostgreSQL tables in dependency order (`:39-49`). This is materially more complete than a logical replica export.

The archive does not by itself preserve Taki SQLite Authority/queue/operation state, process/environment configuration, deployment artifacts or the Taki host Secret Catalog. Database-resident configuration is included with its table data; do not assume the archive contains no sensitive values. Manifest/status projections must not expose secret material. Restore expects a compatible prepared target schema and can intentionally omit obsolete source columns; table inventory and post-restore native/application contract checks remain required. The new proposed source-fence state would also have to survive backup/restore without reopening the historical source.

### Failure and race cases required for implementation

These are proposed tests, not test results from this turn. Existing source regressions are references for fixture patterns only.

| Case | Required observable result |
| --- | --- |
| A writer holds the Bank lock as the gate is acquired | Either the write commits before the recorded boundary and is included, or it is refused before mutation. No old repeatable-read view reports false quiet. |
| A direct retain is paused before its final SQL transaction | Its durable pre-boundary admission is drained and included, or it is refused with a truthful outcome. Untracked outstanding work prevents seal; zero `async_operations` is insufficient. |
| Parent retain/conversion/import spawns a child after admission closes | Only an explicitly owned pre-boundary descendant can continue; closure and final factual receipts cover every child. A missed/unknown child blocks seal. |
| Every compatible external write entrypoint runs during/after seal | HTTP/Control Plane/MCP/SDK/engine writes, curation, document changes, authored models, directives, Bank configuration and Bank deletion/recreation respect the same source gate. No new journal/application memory event can appear after the final boundary. |
| Native cursor stays fixed while a D77 policy/Block command races | The application gate serializes it before the paired snapshot or refuses it. Native cursor equality cannot hide a changed application cursor or missing original body. |
| An ordinary or finite maintenance model returns after lease expiry/token replacement | Its old result cannot publish canonical changes, proof, source bookkeeping or a certificate. Failure remains operational or stale according to actual evidence, not an invented source drift. |
| Accepted task is deferred by the fence | Its identity, retry count and genuine partial effects remain recoverable. It is neither dropped nor marked complete to satisfy a count. |
| Queue is empty but required source/model outcomes are incomplete | Seal refuses; only real action/no-op/input/lifecycle evidence discharges each provider-enumerated requirement. |
| A long-lived Bank has no applicable Local transfer or has pruned required history | The new current-native contract provides its independently valid baseline/history proof or refuses explicitly. G1 and old D78 bytes remain unchanged. |
| Source/application data changes while final pages are prepared | No mismatched paired certificate is published. Native pages, complete D77 bodies/history and all integrity manifests are bound to one final allowed state. |
| More than one Bank, including an empty Character Bank or a `both` parent | Partial seal cannot commit Local. Every exact Bank/generation, accepted parent effect and snapshot is covered by the same transition. |
| Lost response after native admission, seal, Local commit or native retirement | Reopen/status lookup finds the same handoff/request and proofs. Sealed source stays closed while unknown; no fresh native operation or automatic unseal is issued. |
| Local runtime binding fails after Local commit | Recovery uses the already committed Local epoch. Source remains sealed/retired; held old consumers and late effects refuse. |
| Abort crosses a delayed Local commit decision | Only the recorded coordinator decision wins. A stale abort never reopens a source whose Local commit is committed or durably decided. |
| Backup/restore, worker restart or older binary encounters the sealed source | Native/application/fence identities and closed disposition survive, or compatibility refuses operation. Unsupported writers cannot silently bypass the claimed boundary. |

Useful existing source tests: `tests/native_results/test_cutover_maintenance_leases.py:95-151` preserves accepted work and distinguishes lease loss from drift; `:155-194` rejects a late replaced attempt. `test_cutover_maintenance_admission.py:23-94` covers accepted admission across an older RR view. `test_application_state.py:90`, `:132`, `:179` cover atomic publication, snapshot/event equality and Bank generation closure. `tests/test_taki_replication_admin_writers.py:950` covers competing Bank writers; `:1019`, `:1162`, `:1208` cover capability/storage boundaries. `tests/native_results/test_application_backup.py:23` exercises the D77 archive path. None was rerun here.

### Related specifications and external references

- `docs/adr/0009-single-memory-authority-with-local-replica.md:3`, `:25`, `:47`, `:51`: one authority, full logical replica, routine factual confirmation versus independent cutover proof, and healthy return with a read-only former authority.
- `.trellis/tasks/08-09-memory-operations-ui/design.md:92-110`: existing healthy-return draft and the missing native fence/drain grounding. Its orchestration/queue work remains planning.
- `.trellis/spec/backend/memory-current-state-cutover.md:62-97`: exact native input/outcome certificate and finite ordinary-maintenance coordination; `:81-85` limits the certificate to a historical boundary.
- `.trellis/spec/backend/memory-native-result-recovery.md:81-84`: G1 explicitly does not implement the separate cutover/source-fence proposal.
- `.trellis/spec/backend/hindsight-application-runtime.md:43-92`, `:150-182`: D77 paired data/original evidence and complete local runtime lifetime; no automatic native authority retirement.
- `H:/hindsight/TAKI_PATCHES.md:425-453`, `:488-492`: D78 ownership implementation and coherent-writer deployment limitation. The source implementation and current manifest, rather than historical build prose, determine present behavior.
- No external documentation or live service was fetched. Native version evidence is the local `0.9.0` package and current `d77-v1` compatibility build; proposed handoff version `1.0.0` is only a design label.

## Caveats / Not Found

- No implemented generic source handoff, permanent native read-only authority disposition, universal admission-ticket census, or retained paired D77 handoff certificate was found in the inspected mechanisms. This is a concrete gap, not authorization to implement it during B7 planning.
- One focused `jbcontext search` in `H:/hindsight` failed with the JetBrains search API returning HTTP 404 and no results. Research then used known symbols, direct reads and exact searches; no repeated broad semantic search was performed.
- The memory quick pass contained old Slice 0/Docker acceptance notes only. No historical test count, running-service claim or compatibility result from memory is used as current evidence here.
- Source alone cannot answer which independent writers, binaries, database roles or administration paths the eventual deployment permits. The helper/deployment contract must make the claimed writer perimeter explicit and verifiable.
- The exact durable coordinator commit/abort decision ordering, admitted-descendant inventory and current-native lifecycle/history baseline must be specified and tested. Existing sources expose the primitives and limitations but do not resolve those new engineering contracts.
- D81's derived-content policy propagation limitation and failed/retryable B6 assessment work remain their recorded facts. A source-fence certificate is not semantic-quality acceptance and must not silently reclassify those outcomes.
- Only this research file was created. Production code, specs, task activation, other worktrees, original databases, private acceptance inputs, services and credentials were untouched.
