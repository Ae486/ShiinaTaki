# C2b Native producer and managed setup plan

Date: 2026-10-15. Status: revised for independent delta review; implementation and execution have not started.

## Decision and scope

C2b includes one real Native API producer and a positive managed setup consumer. A resolver that
permanently refuses the current fake consumer is useful scaffolding, not completed C2b. Extend the
existing deployment owner, fixed Native bootstrap and template owner; do not introduce another
deployment ledger, general supervisor, template writer or model configuration service.

The initial API profile deliberately cannot perform model inference. It runs the ordinary
MemoryEngine, PostgreSQL migrations, authenticated compatibility manifest and Stage 5B template
snapshot/apply/result producer. Successful setup means compatible service plus verified Global
and Character Bank definitions. Memory Authority stays canonical-local and modelHealth stays
not-run. Applying the user's six model slots, generation-bound configuration readback, embeddings
or reranker health and real model calls belong to C3.

Root's existing authorization covers this sequence after independent review. Root owns runtime
preparation, the one heavy execution slot, evidence, cleanup and task metadata. This step changes
only this plan. It does not run Docker, WSL, an application, tests, builds, installations or Git.
Original data, original credentials and real models remain outside the entire fixture sequence.
The actual API producer run follows Root's acceptance of the separate database persistence
checkpoint; that checkpoint still cannot stand in for this API's own shutdown/persistence evidence.

## Inputs and present evidence

- [C2b consumer research](c2b-readiness.md) locates both setup entrypoints and the current refusal.
- [Native producer research](c2b-native-producer-readiness.md) verifies startup, tokenizer,
  authentication, manifest, background activity and template producer seams in current source.
- [Independent design review](c2b-design-review.md) supplies the R1 pre-plan ownership correction
  and prerequisite ordering incorporated here; its original reviewed input remains frozen.
- [Recovery R2 review](c2a-recovery-runtime-review.md) is accepted and preserved. Its outer Host
  reply loss, original-resource recovery and fresh startup evidence must not be rerun as C2b proof.
- [Offline database review](c2a-database-extraction-runtime-review.md) proves actual PostgreSQL
  18.1, raw tools, durability settings and checked stop; it does not prove logged-data persistence.
- [Database persistence plan](c2a-database-persistence-plan.md), SHA-256
  186f60061a4ecd7ac26443f90c079225c3bc9efb782f27227b50763ff0088e4c, is released for separate
  review. Reuse its accepted results when available. Its task-only database artifact always has
  deploymentReady false and cannot issue an API endpoint or C2b service identity.
- Stage 5B's accepted template contract and taki-bank-v2 catalog are existing implementation
  inputs. The legacy template import path can schedule mental-model inference and is unsuitable
  for this initial profile.

The cached base image ID is
sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db.
This is an inventory input, not proof that the image contains current Native modules, a usable
cl100k_base cache or compatible extensions. No API execution may precede the image-content gate
below. Host-loopback publication over one internal Docker network is a candidate until verified
on this Windows/Docker engine; there is no implicit external-network fallback.

## Current source seams

Paths in this table are relative to H:/TakiAgent unless prefixed with H:/hindsight.

| Source | Design consequence |
| --- | --- |
| packages/core/src/memory/hindsight/hindsight-deployment-owner.ts; packages/core/src/boot/hindsight-deployment-boot.ts | Keep the resolver with the owner of original/startup Runs, custody, accepted callbacks and checked settlement. |
| packages/core/src/capabilities/capability-effect-lifecycle.ts:85-102 | A completed generic Effect has a Host sourceRef, executor generation and input digest; completion alone does not prove successful deployment-domain output. |
| apps/hindsight-host/src/deployment-registry.ts; apps/hindsight-host/src/deployment-owner.ts | Host remains sole writer of the protected plan, resources, attempts and dispatch/verified fences. Core obtains a bounded authenticated observation. |
| packages/shared/src/hindsight-deployment-schema.ts | V1 is explicitly c2a-fake-v1 and deploymentReady false. Preserve its schema, encoded bytes and hash domains. |
| packages/core/src/memory/hindsight/hindsight-setup-service.ts:117-158,212-222 | Both the direct method and setup.apply reach the same managed refusal before Bank/template effects. B3 requires canonical-local. |
| packages/core/src/memory/operations/memory-operation-service.ts:69-174; packages/core/src/memory/operations/memory-operation-kind-setup.ts | Reuse durable operation admission, running/terminal rows and the existing in-flight promise ownership. |
| packages/core/src/memory/hindsight/template-lifecycle/{template-provision,template-plan-guard,template-executor-store}.ts | Current provisioning/guards require Hindsight Authority, an established connection and real running operation admission. They cannot be called unchanged during B3 setup. |
| packages/core/src/db/migrations/059-hindsight-template-execution.ts | Plans, reservations, admissions and executors already refer to memory_operations. Direct setup must obtain that real owner rather than invent a fake operation. |
| packages/core/src/memory/hindsight/template-lifecycle/{template-plan-store,template-rollout,template-publication}.ts | Reuse immutable requests, dispatch fences, receipts, observations and selections; separate initial publication from runtime checkpoint/quiesce/rebind. |
| packages/core/src/main.ts:254-278,386-389 | Setup/templates/operations are composed before deployment. Use fail-closed late dependencies and preserve the Run/operation boot recovery barrier. |
| H:/hindsight/docker/standalone/managed_bootstrap/bootstrap.py:93-124 | Credential consumption and child launch are one-use and rechecked against the original 90-second grant. API initialization must not extend this grant. |
| H:/hindsight/hindsight-api-slim/hindsight_api/server.py:28-81 | The production ASGI entry constructs the actual MemoryEngine, tenant extension and create_app with initialize_memory true. |
| H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:3950-3980,4092-4123,4484-4543 | The internal pg0 path does not pass the needed persistent configuration and its stop return is not checked PostgreSQL shutdown. An explicit local PostgreSQL URL avoids a second embedded owner. |

## Fixed producer profile and pre-execution gate

Add a distinct managed-api-initial-v1 artifact/profile in versioned deployment registration,
plan/effect and service-observation contracts. The image is immutable and contains one fixed
entrypoint; requests cannot choose commands, module names, provider maps, environment variables,
paths or network options. Preserve c2a-fake-v1 validation and every existing V1 digest. Extend
Shared exports, installation validation, Host protocol and applicable Shell/Rust mirrors together
after an exact symbol search; do not broaden only one transport decoder.

The reviewed artifact manifest binds the actual installed Native/compatibility build, bootstrap
modules, Python/SDK/tokenizer versions, pg0 and raw PostgreSQL tools, profile digest and tokenizer
cache bytes. Use the cached base plus reviewed local files only; no dependency/cache download,
package update or model download is part of this work.

Before any API import or execution, a fixed offline check must verify in the exact resulting image:

1. The interpreter and installed files that will actually be imported, including the tiktoken
   reader and encoding definitions, Native API/compatibility modules and required PG extensions.
   Source checkout paths or Dockerfile COPY statements are not evidence of the installed bytes.
2. The actual cl100k_base cache location, filename derivation, expected content hash and readable
   bytes under the effective unprivileged child environment. Pin TIKTOKEN_CACHE_DIR to that
   verified immutable directory; do not depend on HOME, which the bootstrap changes to the volume.
3. The consumer has no cache-miss/download fallback. A missing, unreadable or mismatched file
   refuses before importing hindsight_api, opening SQL or listening on the API port. A later
   offline encoding load must consume that same checked file and installed module.
4. The raw PostgreSQL binaries/libraries and pg0 package match the reviewed artifact. Distinguish
   the base ID, result image ID, compatibility build identity and database cluster identifier.

Freeze these actual image/cache facts before broad source work or the first API run. Follow the
inventory gate with only the minimal actual producer slice: ordinary API migration/authentication,
listener/resource binding, checked API plus PG stop and authorized same-volume restart. Broader
trusted lookup/setup integration starts only after that producer gate passes. The normal child
also rechecks the small immutable manifest before its API import. This is one prerequisite
sequence, not a new probe matrix. An inventory failure leaves the API unstarted and the failed
gate preserved for Root; it cannot be repaired by enabling a network fallback.

The initial configuration is fixed in the artifact, with these explicit values:

| Setting | Initial value and meaning |
| --- | --- |
| HINDSIGHT_API_LLM_PROVIDER / HINDSIGHT_API_SKIP_LLM_VERIFICATION | none / true; no LLM verification or usable inference provider. |
| HINDSIGHT_API_EMBEDDINGS_PROVIDER | openai; avoids loading/downloading a local model. |
| HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL / DIMENSIONS | taki-c2b-unused-embedding-v1 / 1536; explicit positive dimensions avoid the initialization dimension probe. |
| HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY / BASE_URL | C2B_UNUSED_NOT_A_SECRET / http://127.0.0.1:1/v1; fixed non-secret placeholder and verified unlistened loopback destination. No encode request is permitted. |
| HINDSIGHT_API_RERANKER_PROVIDER | rrf; the present factory does not implement a none provider. |
| HINDSIGHT_API_TENANT_EXTENSION | hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension. |
| HINDSIGHT_API_TENANT_API_KEY | Only the privately delivered CONNECTION slot, in the API child's private environment. |
| HINDSIGHT_API_WORKER_ENABLED / MCP_ENABLED / ENABLE_BANK_LLM_HEALTH / LLM_TRACE_ENABLED | false for each corresponding HINDSIGHT_API setting. |
| HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS / MENTAL_MODEL_REFRESH_TICK_SECONDS | 0 for both corresponding HINDSIGHT_API settings. |
| HINDSIGHT_API_OPERATION_RETENTION_DAYS / AUDIT_LOG_RETENTION_DAYS | 0 / -1; no scheduled retention work in this profile. |
| HINDSIGHT_API_DB_POOL_MIN_SIZE / MAX_SIZE; READ_DB_POOL_MIN_SIZE / MAX_SIZE | 1 / 4 for both pool configurations, with no separate read database URL. |
| HINDSIGHT_API_HOST / PORT | 0.0.0.0 / 8000 inside the one owned network namespace. |
| Other extension, webhook, default Bank-template, proxy and provider settings | Unset by the clean-environment allowlist; no remote extension or automatic template injection. |
| PYTHON_DOTENV_DISABLED | true, retained and asserted before the ordinary entrypoint runs. |
| Core desired template revision | Explicit taki-bank-v2; never redefine the frozen v1 catalog or silently migrate v1. |

Only CONNECTION becomes an API credential. The six delivered model slots are not mapped to
working provider keys, written to configuration, sent to PostgreSQL descendants or reported as
applied. C2b tests use generated Catalog values only. This fixed initial profile and its declared
embedding metadata are visible in the producer evidence; they are not readback of user models.

## Native process, database and endpoint ownership

### One API child and one database owner

Add fixed API consumer/child modules beside managed_bootstrap's existing consumer. Reuse
clean_environment, OwnedChild and enable_linux_reaping. The API child is the actual single-worker
ASGI process; it must not spawn a daemon, reload watcher, worker pool or automatically replaced
API child. Keep stdout/stderr private and public failures bounded to closed codes.

The child validates its inputs, immutable cache/build prerequisites and startup ID before
publishing a bounded private launch marker. That marker proves the independently checked child
PID/start identity only. The consumer returns OwnedChild within the lesser of its five-second
launch bound and the original grant's remaining time; Bootstrap retains its post-consumption
grant check. Any launch/late-ACK failure stops the original owned child and consumes the attempt.
Do not wait for migrations or API readiness inside credential acceptance, renew the grant or
allow a second submit. Subsequent readiness observation is a bounded read of that launched child.
The initial SQL/API readiness budget is 60 seconds from that original child launch, with no reset
on observation. Expiry fails the startup and begins the shared shutdown path; it does not permit
another credential consumption or automatic child restart.

In the same child, before importing the production ASGI app:

1. Become the nearest Linux subreaper using the existing helper. The accepted pg0 CLI can detach
   postmaster into a different PGID/SID; process-group membership is not database ownership.
2. Own a fixed cluster below the already owned fresh named volume. Initialize/extract once using
   the accepted offline pg0 invocation and explicit fsync, synchronous_commit and full_page_writes
   overrides. Do not use the Python embedded wrapper's automatic retries or default -F behavior.
3. Record the actual cluster/tool identity and exact postmaster/logger/CLI PID, start ticks, PPID,
   PGID, SID and executable; prove SQL backend ancestry and all three effective durability settings.
   Every PostgreSQL subprocess gets a separate non-secret environment allowlist.
4. On a later explicit startup of that same volume, verify the prior checked stop and exact cluster
   and tools, then invoke the raw postgres binary directly. Never call initdb/pg0 creation again,
   adopt another cluster, silently reseed, remove stale PID files or recreate storage. Incomplete
   initialization or an unclean/ambiguous cluster remains unavailable for this bounded slice.
5. Supply the owned loopback PostgreSQL URL to the normal production ASGI app. It must select
   parse_pg0_url's external-URL branch, so MemoryEngine neither starts nor stops a second pg0.
   Local SQL is confined to the namespace, with fixed local authentication and no published PG port.

Use hindsight_api.server:app with the ordinary MemoryEngine/create_app lifespan and migrations
enabled. A small fixed managed server hook observes first shutdown and bounds it; reuse the
production app instead of duplicating its constructor or adding a synthetic initialization mode.
The hook may specialize uvicorn's exit/shutdown handling for this profile. It is not a new
pluggable server/supervisor API. Preserve other CLI/ASGI entrypoints.

Readiness must prove successful normal initialization, a real SQL SELECT, effective DB settings,
the expected authenticated manifest/build/contracts and the SQL-backed provider lineage UUID.
The existing manifest migration/read supplies that lineage without creating a Bank. Container ID,
PostgreSQL cluster ID, engine session UUID and configuration digest are distinct identities.

### Shared shutdown deadline

The first TERM, initialization failure, owned-process loss or other stop trigger records one
monotonic shutdown deadline of 25 seconds. Repeated signals and finally blocks cannot reset it.
The same bound covers API request/lifespan shutdown, actual engine/pool closure, PostgreSQL stop,
process reap and final control-state observation. Native OwnedChild retains its 30-second outer
budget; the concrete Docker fixture uses the separately reviewed outer stop/client deadlines.

- Withdraw current service readiness immediately. Stop accepting HTTP work and allow at most
  five seconds, or the remaining total budget, for the normal API lifespan and engine closure.
  A timeout or cancelled/incomplete lifespan is retained as failure, even if later SQL cleanup works.
- Revalidate the owned postmaster and invoke raw pg_ctl stop with fast mode, wait and the accepted
  15-second utility timeout; its wait/reap allowance is at most 17 seconds and shares the total bound.
- Reap the original postmaster, logger and adopted descendants using exact process ownership.
  Direct Popen owners reap their own children before generic adopted-child waitpid.
- Require no remaining matching PG writers, no postmaster.pid, and successful pg_controldata with
  the same SQL cluster ID and state shut down, within the remaining budget.

Successful Uvicorn exit, pg0.stop return, a marker or group KILL is insufficient. Forced/timeout/
unknown shutdown cannot become a graceful PASS. Stable-volume privacy scanning belongs to the
task's evidence/cleanup path after writers are gone; do not insert a general scanner into Native
production lifecycle or extend the 25-second API/database budget to obtain acceptance.

### Endpoint identity chain

The proposed topology is one owned internal bridge, one exact container connection and one
127.0.0.1:hostPort to 8000/tcp publication. Root freezes hostPort in the resource manifest and
registration before admission. An occupied port refuses; there is no alternate-port discovery,
external bridge fallback, host networking, additional container network or PostgreSQL publication.

The network is a resource of the original Host plan/registry, with its actual ID and labels,
dispatch-before-create and verified fences, and exact owned cleanup. Reopen observes the original
network/container/volume; it cannot adopt similarly named resources or silently recreate a network.
Before inject, actual engine/namespace inspection checks the fixed network/port mapping, absence
of an external route and the original Native waiting state. Actual host-loopback HTTP reachability
is checked only after the independently admitted API launch, and must pass with authentication and
listener binding before a usable reference or setup result is published. Admission cannot require
HTTP from an API it has not yet allowed to start; do not add a canary service. Freeze these commands
and artifact bytes for Root review as part of the first useful producer run.

The complete binding is:

    accepted Core Effects -> Host plan/registry -> engine/image/container/volume/network
      -> current Native startup -> exact owned API PID/start identity/listening socket
      -> authenticated manifest build/provider lineage -> Core loopback endpoint

Native correlates the owned child's /proc file descriptors with /proc/net/tcp and tcp6 listener
inodes, then queries local health and the Bearer-authenticated manifest and rechecks the process
identity. Single-worker ownership makes that check precise. Readiness cannot be inferred from an
open port, a matching image label or /health alone. Host inspects actual resource/mount/network/
port mappings before and after obtaining this bounded observation. Core independently reads the
same loopback endpoint's authenticated manifest and requires matching lineage/build/contracts.
For those authenticated reads the Native consumer retains only CONNECTION in a private in-process
observer bound to the original OwnedChild until shutdown; it never serializes that key into the
observation or stores the six model keys. Disposal drops its references without claiming secure
memory erasure. This observer can read that service, not start/reinject a process or issue authority.

Do not create a Bank merely to call a Bank-scoped identity API. This plan uses existing manifest
lineage and process/listener ownership. If that exact listener binding proves impossible on the
actual artifact, stop the producer gate and review a narrowly scoped authenticated process-identity
read before adding it; do not silently weaken the proof to matching health responses.

## Lookup reference and acceptance policy

Add this strict, bounded reference to managed setup requests; all identifiers are UUIDs:

    ManagedDeploymentReferenceV1 = {
      version: 1,
      deploymentId,
      startupId,
      startupRunId,
      coreAttemptId,
      injectEffectId
    }

These fields are lookup keys, not authority. They contain no endpoint, ready flag, resource/storage
assertion, serialized grant, receipt body or reusable owner handle. Reject a legacy managedReceipt
for fresh admission, references on existing-instance requests, and mixed receipt/reference input.
Keep old requests and historical snapshots readable without upgrading their trust.

HindsightDeploymentOwner resolves the reference using existing Run/Attempt/Effect repository
reads and a bounded authenticated Host observation. The Host projection supplies only the original
plan/digest, exact matched control/custody correlation, verified resource fences and current Native
service facts needed for the join. It is not a registry dump. Core never reads Host registry files,
calls Docker, copies registry truth into another table or treats a passed-in object as trusted.

Acceptance distinguishes **original resource provenance** from **current startup acceptance**:

| Required link | Rule |
| --- | --- |
| Original deployment | The original Run key/provenance, plan deployment/operation IDs, selected co-located Hosts, installation/registration, engine, immutable API artifact, source configuration digest and fixed profile all match. Caller idempotency UUID is not the deployment/Run UUID. |
| Original resource Effects | Exact create/start Effects are completed and join their original Core attempt, Host source operation, executor/generation and input digest to verified Host dispatch/resource fences. A completed generic refusal or unrelated Effect cannot satisfy this link. |
| Current startup Run | Either the original completed initial Run, or a distinct completed explicit resumeStartup Run with the exact original-deployment parent and startup idempotency key. The matched attempt and inject Effect must also be completed. |
| Current injection | Host attempt/control, Core attempt/Effect, configuration/startup/checkpoint/authorization IDs and exact original injection digest match. Expired historical grant IDs are correlation facts, never reusable authority. |
| Current observation | The authenticated current Host connection, actual original resources and current Native API process/listener/manifest match. Historical executor generation is checked against historical records; the read generation is checked against the current transport. A reconnect need not have a numerically larger generation. |
| Configuration | Compare each digest in its own domain: deployment configuration projection, fixed artifact/profile and B3 configuration fingerprint/secret marker are not interchangeable hashes. |

An original deployment Run may remain outcome_unknown after losing its injection completion
reply. That does not prevent a later independently admitted, completed startup from using the
same proven resources. Its old unknown inject Effect is never upgraded or accepted as the current
injection. Conversely, a current startup's unknown/cancelled/failed Run, attempt or inject Effect
refuses even if the API responds. This policy is required for the accepted R2 recovery shape.

Return a safe reference only after the owner has these facts; resolve it again on consumption.
A process-local resolved result may carry bounded facts to the setup owner but is not serialized
as caller authority. Historical acceptance and observed current availability are separate. API/PG
exit, a disconnected Host or a replacement startup withdraws usability of the old reference.
Resolution never creates, starts, injects, renews a grant or repairs uncertain settlement.

## Managed setup through the existing operation and template owners

### Both public entrypoints share durable admission

For managed requests, memory.hindsight.setup normalizes into the existing setup.apply operation
owner. Add a bounded client requestId for idempotent lookup on both request surfaces. The same
requestId and canonical request resolve the same Core-minted operation; changed input under that
key refuses. Implement this lookup in the setup kind's existing handler.existing hook, called
inside MemoryOperationService's admission transaction before the admission guard and handler.admit
(memory-operation-service.ts:118-123). Thus a duplicate resolves before today's revision check and
cannot mint another attempt; no separate idempotency registry is needed. Existing-instance behavior
and legacy direct-call compatibility remain unchanged.

The direct method can keep its snapshot response by awaiting the exact existing operation promise
and reading that operation's persisted result. Add a narrow internal wait method to
MemoryOperationService's current in-flight map; no polling loop, second scheduler or fake operation.
The durable kind invokes a lower-level managed setup execution method with its real operation
context, avoiding direct-method -> operation -> direct-method recursion.

Before a B3 attempt or any Bank mutation: require canonical-local and no activation; compare the
expected revision, resolved config clock, secret marker, desired taki-bank-v2 revision and current
compatibility; resolve the managed reference and independently match the live manifest. Configured
endpoint must exactly equal the owner-bound loopback endpoint. Resolver output never rewrites
arbitrary connection settings. A failed admission may leave a failed operation row but no invented
B3 attempt, Native template request or resource effect.

### Explicit setup-initialization purpose in the same template owner

Add a versioned setup-initialization purpose/guard to the existing template plan/executor code.
Do not insert a default purpose into old immutable plan JSON or rehash historical bytes. The
current runtime-template and bank.provision modes keep their Hindsight Authority, checkpoint and
binding requirements. The new mode is limited to managed initial setup, fresh owned Bank
reservations and the exact running setup or admitted original-owner recovery operation.

The original guard binds the canonical-local epoch, setup operation/attempt, admission revision,
durable configuration clock, secret marker, managed reference/profile, provider lineage, template
catalog digest and namespace/Character target. Reserve the plan ID before effects, but record Bank
generations only when actually returned. The immutable application plan requires those real Bank
and snapshot identities. A reserved ID is not a plan row: migration 059:33-50,94-100 makes existing
holds/admissions reference a real plan, whereas reservations can reference the original operation.
Do not create a placeholder plan, relax those foreign keys or invent an epoch/checkpoint/incarnation.

The execution sequence is:

1. Before any Bank mutation, atomically claim the already proposed connection-row capsule as the
   pre-plan hold, bound to the original operation/attempt, reserved plan ID, managed reference and
   original guard. Persist the corresponding setup producer/progress revision in that transaction.
   No template hold, executor or plan admission is inserted before the real plan exists.
2. Reserve both targets in the existing operation-bound reservation table. Keep each reservation
   ID, original dispatch correlation, no-dispatch/dispatched/known-result state and actual returned
   Bank/generation facts in the existing producer/capsule. Prove each target unoccupied before its
   first create and persist dispatch before sending it. An uncertain create without exact ownership
   evidence stays unknown; a matching name or empty Bank does not authorize adoption or retry.
3. Obtain real snapshots and build/sign the two taki-bank-v2 applications with their original
   request IDs/hashes, expected snapshots, initialization proofs and refresh=[]. In one checked
   SQLite transaction, verify the unchanged capsule owner/guard, materialize the real immutable
   plan with its existing admission/executor/hold, and transfer the capsule to plan-backed state.
   There is no unheld interval; rollback retains the pre-plan hold and its recorded facts. Do not
   call legacy import/mental-model refresh endpoints or bypass their inference waits.
4. Reuse dispatch fences, result-before-retry lookup, original receipt persistence, definition
   observation and selection checks. On an ambiguous apply response read the result for the same
   request/hash before any retry. Never create a replacement application request to obtain success.
5. Recheck the captured local/configuration/secret/operation/reference guards around asynchronous
   work, before each mutation and after final observation. Re-resolve live managed provenance at
   publication. A-to-B-to-A values fail through their monotonic generation/clock changes; equality
   of the final text or endpoint is insufficient.
6. Publish verified Bank state, template selections, B3 configured/fingerprint/compatibility and
   the bound managed pointer in one checked Core transaction. No runtime admission, quiesce,
   synchronize, checkpoint or rebind occurs in this purpose, and Authority remains canonical-local.

memory-operation-template-guard and direct managed setup must consult the same pre-plan capsule
or plan-backed hold before allowing conflicting work, including under canonical-local. The Run-owned
deployment start/resume entrypoints must also check it before admission and effect dispatch; they
do not pass through the memory-operation guard. Capsule acquisition refuses an already conflicting
deployment mutation. Preserve the original owner/guard across transfer; only its explicitly admitted
continuation may advance it. This is a narrow read of existing owners, not a general hold framework.

The setup owner owns final B3 publication. The template owner supplies a checked publication
participant/result so selections and B3 state commit together on the same database connection.
Return the new revision to B3; do not let B3's stale working snapshot overwrite a revision changed
inside template publication. Require both Global and Character verified before configured, and
keep modelHealth not-run. Partial remote application retains its hold and original receipts rather
than reporting configured or starting unrelated cleanup.

### Durable continuation and reopen

Reuse memory_operations request/producer/result JSON and existing template admission/executor/
receipt/observation tables for history. Add only a bounded managed-setup capsule to the existing
hindsight_connection_state row for its active binding: original operation/attempt/plan/reference,
pre-plan/plan-backed state, reservation/dispatch/known Bank facts, admitted guard, current continuation
operation ID, last owner-written progress revision and final publication identity. Historical rows
keep the new nullable column NULL.
Do not copy Host resource records into this capsule or create a deployment/setup ledger table.

The purpose-specific guard distinguishes the immutable admission revision from later known
setup progress revisions. Every owner-written progress transaction updates the capsule and current
connection revision together; guard checks require that exact recorded current revision plus the
unchanged durable config clock/secret/epoch. Unrelated state changes cannot be accepted as progress.
This avoids both stale B3 writes and rewriting an old immutable template plan after a restart.

Preserve existing-instance boot recovery. For a managed attempt, inspect the capsule before any
readTemplatePlan call. A pre-plan capsule may legitimately have no plan row; retain its original
binding, reservations, dispatch/known Bank facts and hold. A plan-backed capsule with a missing or
inconsistent plan fails closed without reconstructing it. recoverInterruptedSetup must retain
partial receipts/verified evidence rather than reset them or manufacture a retry. Boot only reads
and classifies local state; no Host/Native read, custody or resource action runs. Foreign-boot work
without exact terminal proof retains outcome_unknown.

The explicit template.recover entry first resolves its plan ID against the original pre-plan
capsule when no plan exists, before routing to the plan store. Its normal memory-operation admission
may claim continuation by checked capsule revision for one current recovery operation ID, preserving
the original setup operation/attempt/reference/guard. Only that operation's running execution may
continue; competing claims refuse, and no plan-backed executor is inserted yet. A target with durable
no-dispatch evidence may receive its first explicit dispatch. A known created Bank may be reread
only against its exact recorded identity/generation to obtain missing snapshots. Dispatched creation
without exact producer-owned completion remains unknown: do not retry, adopt from name/emptiness
or mint a replacement request. If the producer cannot supply exact evidence, retain the hold and
uncertainty. Once all real identities exist, use the same atomic plan/hold transfer described above.

Plan-backed template.recover takes the existing executor lease but keeps the original setup
operation, attempt, reference and immutable Native request identities. It reads original Native results before further
application. Its checked publication may finish the bound B3 setup; it does not turn the original
unknown operation into a historical completed execution. Direct/duplicate responses may use only
their exact persisted result or bound publication evidence, never the current global configured
snapshot of an unrelated attempt. No new setup.recover kind or automatic boot recovery loop is needed.

A replacement Native startup invalidates the interrupted plan's captured reference. It cannot be
silently substituted during template recovery, even on the same volume. The C2b runtime sequence
therefore proves graceful same-volume API restart before initial setup, and Core-only reopen with
the same Native startup during setup recovery. Later configured-instance startup rebinding must
use an explicit reviewed revalidation path; a stored configured snapshot alone is historical Bank
definition evidence, not current managed service readiness or C3 model-application evidence.

## Implementation slices and ownership

| Slice | Focused source ownership after review | Exit evidence |
| --- | --- | --- |
| 1. Actual image prerequisite | Exact offline installed-image/cache inventory before broad source work; Root-reviewed artifact manifest and fixed pre-import check before API execution. | Exact installed modules/cache/tool hashes and no-download refusal case. |
| 2. Minimal actual producer | Only H:/hindsight managed_bootstrap API consumer/child and fixed recipe plus necessary V2 Host/network/observation wiring and required Shared/Shell mirrors. | Ordinary migrations/authentication, exact listener/lineage/resource binding, checked API+PG stop and same-volume authorized fresh startup. |
| 3. Trusted lookup | Existing Core deployment owner/boot composition, bounded Host observation and Shared reference contract. | Positive accepted lineage, original-unknown/new-completed positive case, precise refusal of mismatched/current-unknown references. |
| 4. Positive setup | Existing setup service/boot, operation kind/service/contracts, existing template owner purpose/guards/publication and additive connection-row migration. | Both entrypoints share a real durable setup operation; actual no-inference definitions and exact recovery/publication evidence. |
| 5. Scoped integration review | Affected tests/specs and one Root-owned runtime fixture/evidence bundle. | Independent source/runtime review with claim boundaries and exact cleanup. |

These are ordered gates: complete the exact offline inventory, then the minimal actual producer,
then the broader trusted lookup/setup consumer. Do not start slices 3-4 while slice 2 is unproved;
source-only scaffolding or a database-only pass cannot satisfy its API lifecycle requirement.

Keep one cohesive implementer for the cross-owner setup change so operation identity, template
guard and final transaction are not implemented as competing owners. Search mirrored registration,
transport/type/export lists before edits. No new third-party dependency, UI flow, arbitrary provider
matrix, original-volume adoption, installer framework or .trellis/scripts change is proposed.

The concrete runtime manifest freezes the image/result hashes, tool paths, one new resource token,
network/port, original container/volume IDs, staging/storage limits, startup/stop/client deadlines,
generated values and exact cleanup before execution. Reuse reviewed fixture helpers and scans.
Do not reuse historical G: paths as active staging or claim DB-task resource limits apply to an
API artifact with different memory/process needs. Root keeps unrelated workloads and the daemon intact.

## Focused verification and completion gate

These are future checks, not results from this planning step. Use generated values and temporary
SQLite/Host stores; at most two Vitest workers and one heavy runtime slot. Do not rerun the 182
unchanged source cases, accepted C1 matrix, R2 recovery or the offline database prerequisite.

| Check | Required observation |
| --- | --- |
| Image/pre-import gate | Missing/corrupt tokenizer cache or wrong installed build refuses before API import, SQL or listen; no attempted download. Actual fixed profile loads the verified encoding offline. |
| Real Native producer | Normal migrations and API-key tenant auth work; unauthenticated manifest access refuses; actual owner-bound manifest yields build and persistent provider lineage. Worker/maintenance/model paths stay disabled, and no model/provider request occurs. |
| Actual stop/restart | Shared 25-second API/PG stop proves engine closure, exact reap and shut down control state. A new explicitly authorized startup uses the original container/volume/cluster, fresh process/startup identity and unchanged generated data/provider lineage. |
| Real reference join | Generate records through actual admitted owners, not hand-authored trusted=true fixtures. Accept original unknown deployment plus completed explicit resume. Reject unknown current inject, generic completed refusal, wrong digest/Host/generation/resource/image/profile, fake/DB-only artifact and stopped child. |
| Both setup entries | Exercise actual method wiring and setup.apply with the same canonical requestId. Observe one operation/attempt, two real verified Bank definitions, Stage 5B receipts/selections, configured B3, canonical-local and modelHealth not-run. Same-ID changed input refuses. |
| Pre-plan ownership/reopen | Before a plan exists, the capsule blocks conflicting operation and deployment start/resume admission/dispatch. Reopen retains exact reservations/dispatch/Bank facts; uncertain create is neither adopted nor retried. Atomic real-plan/hold transfer has no unheld state or placeholder plan. |
| Initial-purpose recovery | With real SQLite and Native SQL receipts, drop one apply/result or final setup response and reopen Core. Recover only the original plan/request, query result before retry, preserve ambiguous original settlement and reject success inferred from unrelated global state. Reuse prior Stage 5B tests for unchanged producer semantics. |
| Guard/publication drift | Change config or secret generation A-B-A, registration/startup, operation settlement or connection revision during awaited work. No stale mutation/publication, fake checkpoint, partial configured state or stale B3 overwrite is accepted. |
| Compatibility and privacy | Existing-instance and V1 bytes/digests stay compatible; boot is network-free; fake values are absent from argv, Docker environment options, registry/config/operation records, public outputs/logs and stopped persistent files. CONNECTION is confined to expected private bootstrap/observer/API memory and the API environment. |

Run only affected type/lint/tests and packaging checks after source changes. Use the real API and
PostgreSQL producer for the final positive setup evidence; substituted adapters or task-only DB
reports cannot fulfill it. Record actual dispatch counts, original IDs, error outcomes and bounded
completed scans. A failed attempt remains preserved; no retry silently replaces its evidence.

C2b is complete only after the actual producer, trusted reference consumer, positive initial setup,
targeted reopen/rejection checks and independent reviews pass. C1 service/platform criteria, inner
Native ACK loss, shared-daemon restart, real six-slot application/health and populated re-embedding
remain separate. The offline cache/build, internal-network reachability, actual API shutdown and
new initial-purpose integration are currently design gates, not accepted runtime facts.

## This step's verification and handoff

Only this document is written. Verify its UTF-8 encoding, relative links, source-path references
and content hash by readback; no code/test/build/runtime check is appropriate during PLAN ONLY.
Release the file and SHA-256 to Root for independent review. Root owns subsequent dispatch,
resource manifests, acceptance records and task metadata; no additional user permission request
is introduced by this plan.
