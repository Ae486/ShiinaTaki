# Research: Hindsight memory path performance and defensive overhead

- Query: Where does Hindsight-path time go outside model inference, and which costs are over-design or redundant defensive checks?
- Scope: read-only. Saved evidence from the latest real run and the controlled journey 17, Core CPU profile, Core source, Native source. No service run, model call, source edit or Git operation.
- Date: 2026-11-06

## Conclusion

Excluding model inference, Hindsight-path latency is dominated by request machinery, not Core CPU or the model.
Three factors multiply:

1. Each loopback request costs about 170 ms (median), mainly because Native rebuilds its full compatibility
   manifest (about 100 schema-probe queries) on every authenticated Taki extension request.
2. Core issues far more requests than the operation needs: about 13 requests per application command, one
   binding per sync pass with a complete pull after each, uncached admission probes on every sync, re-download
   of bodies Core itself uploaded, and uncached recall hydration.
3. Independent work runs serially: Global then Character Bank, upload then upload, read then read.

The common pattern is repeated whole re-verification at every layer and every call. The guarantees that matter are
already enforced at write/commit boundaries (namespace-keyed SQL, writer fencing, commit receipts, leases, one
hash verification per downloaded body).

## Evidence

| Source | Use |
| --- | --- |
| `G:/taki-real-memory-WLbnTi/{result.json,stage-observations.json,model-observations.jsonl,native.log}` | Latest real run (official `deepseek-flash`): stage/turn timing, model spans, Native request sequence |
| `G:/taki-real-memory-WLbnTi/core-data/CPU.20261106.210811.49520.0.001.cpuprofile` | Core CPU profile, 170 s sampled |
| `first-use-runtime/results/2026-11-05T18-51-25.420Z/{result.json,native.log}` | Controlled journey 17: near-zero model time isolates machinery cost |
| Core and Native source | Cause attribution; citations below |

The latest real run (`WLbnTi`) failed at turn 4 with `REQUESTED_TOOL_NOT_PERSISTED`. Memory tools were offered,
and the model called `recall` but not `retain`. Its first Hindsight retain immediately after activation passed
without warmup, which confirms the activation-preparation correction for that run. The failure is model behavior,
not a performance or availability result. This outcome is not yet recorded in `real-model-delivery-20261106.md`.

### Model versus non-model time (latest real run)

Model time is the union of observed upstream request intervals within each window; overlaps are not summed.

| Window | Wall | Model union | Non-model |
| --- | ---: | ---: | ---: |
| Local retain turn | 6.8 s | 6.2 s | 0.5 s |
| Local recall turn | 3.2 s | 3.0 s | 0.2 s |
| `setup.apply` | 31.6 s | 20.9 s | 10.8 s |
| `hindsight.activate` | 60.1 s | 22.4 s | 37.7 s |
| Hindsight Global retain turn | 21.6 s | 11.0 s | 10.7 s |
| Hindsight study turn | 13.3 s | 5.9 s | 7.4 s |
| Manual `replica.sync` | 23.0 s | 15.5 s | 7.5 s |

Journey 17 with controlled models:

| Measure | Result |
| --- | --- |
| Local turns | 0.17-0.34 s |
| Hindsight turns | 3.7-10.4 s; one first attempt took 73 s |
| Healthy return to Local | 213 s |
| Re-entry to Hindsight | 365 s |
| Native requests | 4,375, of which 2,344 (54%) are body/part GETs |

Core CPU was idle for 140 of 170 sampled seconds. Hashing totals about 3 s. During application-state cycles Core
is 10-40% busy, so per-request latency is mostly I/O wait.

### Request volume (latest real run, 657 Native requests)

| Request class | Count | Share |
| --- | ---: | ---: |
| `GET /v1/default/banks/{b}/operations/{id}` (template refresh polling) | 216 | 33% |
| Application-state body and part GETs | 144 | 22% |
| `/health` + `/version` + `/ext/taki-memory/version` | 71 | 11% |
| Body create/put/seal + commits | 112 | 17% |

Every request used a new TCP connection: the harness counted 656 connections.

Sequential application-state GET-to-GET interval:

| Run | p50 | p90 |
| --- | ---: | ---: |
| Real run | 172 ms | 236 ms |
| Journey 17 | 78 ms | 443 ms |

These intervals include Core-side work between requests.

## Findings

### F1. Native rebuilds its compatibility manifest on every Taki request (largest per-request cost)

- `hindsight-api-slim/hindsight_api/engine/memory_engine.py:2053-2067` calls `build_taki_compatibility_manifest`
  (`engine/taki_compatibility.py:421-519`) for every application-state call. The transition service,
  native-result and `/ext/taki-memory/version` paths do the same.
- By code count this is about 104 schema-existence probes over two pool checkouts, mostly in
  `transition_storage.py:67-152`. The application-state operation itself adds about 6 statements on a third
  checkout. Each checkout runs asyncpg setup `SET`s.
- The behavior is intentional (`engine/bank_maintenance.py:86-91`: do not cache across migrations or restores).
- Judgment: redundant within one process lifetime. A per-process manifest invalidated on migration, restore or
  extension reload preserves the stated concern.
- Harness factor: both the controlled and the real launcher withhold `winloop`
  (`archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py:120`), so the default asyncio loop
  carries every round-trip. Production latency may be lower; not measured.
- Native's `[DB POOL] Slow acquire` warnings during template polling most likely reflect contention between these
  heavy requests, the in-process worker's Reflect and the poll. The poll itself is one query. This is inference.
- `Unknown parameters ignored: [provider_lineage, bank_generation]` is a false warning. The parameters are
  consumed through a FastAPI sub-dependency (`api/taki_application_state.py:75-79`) and key every SQL statement
  (`application_state/store.py:43`). The middleware (`api/http.py:3578-3653`) only inspects endpoint signatures.

### F2. Core repeats capability admission on every synchronization

- `packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:118` runs `admitHindsightApplication`
  (`hindsight-application-capability.ts:45-56`: health, version, compatibility) at the start of every sync run.
- There is no in-pass or per-connection cache. `onAdmission` persists the manifest, but nothing reads it back to
  skip a later admission.
- Trigger points:
  - A chat capture syncs once per routed Bank (`hindsight-capture-sync.ts:61-73`).
  - A recall syncs once or twice more (`hindsight-memory-recall.ts:21,32`).
  - Reflect admits twice (`hindsight-memory-reflect.ts:23-25`).
  - Pending recovery can run up to three syncs plus an extra version read (`hindsight-pending-recovery-runner.ts:56-80,131-133`; `hindsight-runtime-bank-service.ts:159-161`).
- Judgment: lineage and capability validation per connection identity or epoch is required. Repeating it per
  pass is redundant. Invalidate on availability errors or configuration change.

### F3. One application command costs about 13 sequential requests, about 3 of them avoidable

Command path: `hindsight-application-binding-runner.ts:149-179` → `hindsight-application-command-runner.ts:70-100`
→ `hindsight-application-body-transfer.ts`.

| Step | Requests | Assessment |
| --- | ---: | --- |
| Upload artifact body (create, part, seal) | 3 | Protocol-required |
| Upload command-envelope body (create, part, seal) | 3 | Protocol-required; it is uploaded serially after the artifact body, though the two are independent |
| `POST commits` | 1 | Required |
| Receipt `affected_versions_ref` body: status + part | 2 | Protocol proof; its content also arrives in the following change event |
| Change list + change page | 2 | Required by the pull-before-local-publication rule |
| Own just-uploaded payload body: status + part | 2 | **Redundant** |

- Why the own body is re-downloaded: uploaded bodies live in `hindsight_application_command_bodies`
  (`db/hindsight-application-command-storage.ts:65-87`). The bundle loader's cache lookup
  (`hindsight-application-bundle-loader.ts:121-128`) only consults `hindsight_application_replica_bodies`.
- Every body download fetches status before parts (`body-transfer.ts:75-85`).
- Each body is fully decoded and hashed twice: once in `loadHindsightApplicationBody`, once in `loadBodyBatch`
  (`bundle-loader.ts:126`).

### F4. One binding per sync pass, with a complete pull after each

- `hindsight-application-binding-runner.ts:55-85` commits exactly one artifact per pass (Bank, Source, Block,
  Document or Memory with `limit: 1`) and returns.
- `hindsight-application-sync-runner.ts:138-156` then pulls again before the next pass.
- One Bank's activation preparation took about 5 cycles (about 19 s); a manual Sync-now for one Pending retain
  took 5 cycles (about 23 s).
- The command body is already a list, and receipt verification accepts several commands.
- Only two ordering constraints are real: Bank first, and Sources before dependent Memories
  (`binding-runner.ts:63-64`). Batching within those groups gives a floor of about 2-3 cycles per Bank.
- Side note, unverified: `binding-runner.ts:179` returns `false` when a job is already applied, which may end the
  pass loop while other work remains.

### F5. Serial Global then Character processing

- `runtime-composition.ts:206-209` (activation preparation), `hindsight-capture-sync.ts:62-64` (Run admission) and
  `hindsight-replica-scheduler.ts:190-193` loop over Banks with `await`.
- Leases (`db/hindsight-replica-lease-repo.ts`) and the Bank service queue (`hindsight-runtime-bank-service.ts:45-53`)
  are already per Bank.
- Native's worker does not serialize Reflect across Banks: only consolidation is per-Bank serialized
  (`engine/db/ops_postgresql.py:1380-1396`).
- Setup applies Bank templates sequentially and waits for each refresh to complete
  (`hindsight-setup-service.ts:143-145`).
- Judgment: no correctness constraint found for the serial order.

### F6. Template refresh polling at a fixed 100 ms

- `hindsight-bank-setup.ts:78-92` polls each operation every 100 ms with no backoff, for about 14 s per Bank.
  This produced 216 GETs in the latest run.
- Judgment: polling is required; the fixed short interval is wasteful and adds load to Native's shared pool.

### F7. Recall hydration downloads all candidate bodies on every turn

- `hindsight-memory-recall.ts:21-64`:
  1. A full sync.
  2. Native recall (about 1 s handler time).
  3. `hydrateHindsightApplication`, which passes no `cachedBody`. It re-downloads every candidate's native-record,
     memory-artifact and source bodies: about 20 sequential-pair GETs, 3.5-6 s per recall turn in the real run.
- Hydration of the fresh head-to-artifact mapping is required because Native recall can return candidates newer
  than the replica.
- Bodies are immutable and descriptor-hashed, so re-downloading their content is redundant when the replica
  already holds them.

### F8. A new TCP connection per request

- `hindsight-http-transport.ts:43-44,57-61` uses `agent: false` and destroys request and response sockets every
  time. The stated rationale is no inherited socket timeout or implicit replay.
- Node's HTTP agent does not replay requests, and Core signals already own the deadline.
- Cost is small on loopback. On a remote HTTPS production instance (Ubuntu VPS) it would add a TLS handshake to
  every request.
- Judgment: defensive overkill. A per-client keep-alive agent with the existing abort signals preserves the
  semantics.

### F9. Policy curator blocks the Core event loop for about 2 s per burst

- The CPU profile shows three 2-second windows at 100% CPU, all inside the curator re-check chain.
- Every tool call, including `block_read` (which reads an in-memory snapshot), and every model step's
  `assertInput` runs `assertCuratorReviewInputs` (`hindsight-policy-curator-tools.ts:78`,
  `hindsight-policy-curator-execution.ts:35`, `hindsight-policy-curator-targets.ts:122-136`). That function:
  - re-captures all Blocks;
  - re-reads every record's head, artifact and body, with full decode and hash;
  - for Block targets, rescans all Block artifacts and re-reads every source.
- `node:sqlite` is synchronous, so the WS server, chat streaming and HTTP callbacks stall during these bursts.
  Cost grows with records and sources per review.
- Judgment: a currentness check before publishing proposals is required. Full re-verification on every read-only
  tool call is over-defensive.

### F10. Four Reflect runs during setup and activation

- Template import always queues an initial Mental Model refresh. Native has no option to skip it
  (`api/http.py:2282-2290,2803-2819`).
- Activation's cutover verification refreshes the same models again inside the HTTP request, after the Local data
  has been imported (`engine/cutover_verification_model.py:224-229`).
- In the latest run: setup 2 × about 14 s, activation 2 × about 12 s, all serial.
- This is a sequencing/product question, already noted in `real-admission-review-20261106.md`, not a code
  defect. The low-risk improvement is running the two Banks in parallel.

### Ruled out or minor

- No per-request full historical proof reconstruction remains. `hindsight-runtime-authority.ts:25-41` reads
  publication proof once at binding.
- Core-local guards (`publicationGuard`, lease asserts, command-job re-decodes, connection drift checks) are
  repetitive, but each costs milliseconds. They are not the latency source; consolidate opportunistically.
- IPv6 `localhost` stalls do not apply: the endpoint is `127.0.0.1` (`real-model-memory.mjs:379`).
- Native API-key authentication is a plain comparison (`extensions/builtin/tenant.py:93`).

## Defensive-overhead classification

| Class | Items |
| --- | --- |
| Redundant; remove or cache | F1 per-request manifest; F2 per-sync admission; F3 own-body re-download and second full decode; F7 recall body re-download; F8 per-request connection; F9 per-tool full re-verification |
| Defensive but cheap; consolidate later | Status GET before parts; layered timeout/abort wrappers; repeated command-job decodes; per-request drift guard; per-request secret read |
| Required; keep | Hash verification once per downloaded body; namespace-keyed SQL and writer fencing; commit receipts; pull before local publication (preserved under batching); leases; current authority/data checks at boundaries |
| Product/sequencing, not a code defect | F10 duplicate Reflect; activation awaiting first Bank preparation (the correction that made first use work) |

## Recommended order (not implemented)

| # | Change | Expected effect (estimate) | Owner |
| --- | --- | --- | --- |
| 1 | F1: per-process Native compatibility manifest with migration/restore invalidation | Per-request latency from about 170 ms to tens of ms; affects every stage | `H:/hindsight` |
| 2 | F2: cache admission per connection identity, invalidate on availability error or config change | About 11% fewer requests; several fewer round-trip sets per turn and write | Core |
| 3 | F3/F7: serve own uploaded and replica-held bodies locally | 2 of 13 requests per command; 3-6 s per recall turn | Core |
| 4 | F4/F5: batch bindings within dependency groups; process Banks concurrently | Preparation and sync from about 5 cycles per Bank to 2-3, with Banks overlapping | Core |
| 5 | F6: polling backoff (100 ms growing to 1-2 s) | 216 polls reduced to a few dozen; less pool contention | Core |
| 6 | F8: per-client keep-alive agent | Minor locally; avoids a TLS handshake per request remotely | Core |
| 7 | F9: verify once before publication, not on read-only tools | Removes 2 s event-loop stalls | Core |
| 8 | F10: parallel template apply; reconsider initial refresh | 14-28 s off setup | Product decision |

Items 1-3 change neither protocol shape nor ordering semantics. Item 4 needs a short design check against the
pull-before-publication and Source-before-Memory contracts in `.trellis/spec/backend/hindsight-application-runtime.md`.

## Caveats

- Native per-request query counts and checkout costs are from code reading, not live measurement.
- Production-like latency (with `winloop`, without the harness audit hook and access log) was not measured.
- All improvement figures are estimates. Verify with the existing real and controlled harnesses before and after
  each change.
- No private conversation content or credential is included here.
