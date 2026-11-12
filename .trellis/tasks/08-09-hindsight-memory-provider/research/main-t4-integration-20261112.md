# Hindsight changes during main/T4 baseline integration

Updated 2026-11-12. This is the Hindsight maintenance handoff for the active
[integration task](../../11-11-main-t4-baseline-integration/prd.md), not parent-task completion.

## Identity and authority

- Integration checkout: `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`.
- Frozen main input: `9b98794a673efb561682b9fd451fe1da2db95086`; frozen T4 input:
  `63faf8119be1747b685aacf43529d754626ab35c`.
- Changes described below are the integrated working tree relative to main, including the integration repairs.
  They are not a new Hindsight redesign. Main remains authoritative for Hindsight; T4 supplies the accepted
  startup/configuration, source-context, delegation and other runtime behavior.
- Recovered session: `01a1ce3d-2104-7d50-b8ab-a549357c9619`; continuation session:
  `01a1cf03-3415-7d93-9028-6a82ce7dfee1`. The latter is explicitly bound to the existing integration task in G:.
- Original H: branches/profiles have not yet been aligned or upgraded. Do not use their current files as proof
  that these integration repairs are installed. No push or original-task archive is included.

## Change map for the Hindsight follow-up

Paths in this table are relative to the integration repository. Read the linked implementation records for
the exact tests and subsidiary files; this map groups changes by behavior rather than counting every test file.
A bare filename in an entry-point cell shares the last explicitly named directory in that cell.

| Boundary | Integrated behavior and reason | Main implementation entry points |
| --- | --- | --- |
| Core startup and live configuration | Preserve T4's basic-plane boot without a model and its captured, revision-fenced configuration. Retain main's Hindsight setup, configuration observation, templates, lifecycle, backup, transitions and deployment owners. Hindsight connection changes still use their dedicated owners; generic config does not silently replace authority. | `packages/core/src/main.ts`, `packages/core/src/boot/core-bootstrap.ts`, `packages/core/src/memory/runtime-composition.ts`, `packages/core/src/memory/runtime-configuration-application.ts` |
| Runtime policy and source context | Carry T4 primary-source context through Hindsight ingestion, capture Run/initiative retention and recall policy, retain immutable authority/Bank bindings, and validate real Source evidence before stronger recall attribution. Opaque records do not become proven primary sources. | `packages/core/src/memory/hindsight/hindsight-memory-runtime.ts`, `hindsight-memory-subsystem.ts`, `hindsight-memory-write-retain.ts`, `hindsight-recall-evidence.ts`, `packages/core/src/memory/initiative-memory-recall.ts`, `packages/core/src/db/primary-source-row.ts` |
| Model-facing Memory output | Canonical tools now project validated raw envelopes through SDK `toModelOutput`. Retain exposes scope/status/memory references; recall preserves semantic records, pending state and branch failures. Internal request/authority/Bank routing fields remain with runtime consumers. D77 serialization and untrusted-data fencing remain in force. This changes the model-facing contract consumed by the old journey harness, not the durable write contract. | `packages/core/src/memory/canonical-tools/canonical-memory-tools.ts`, `memory-tool-model-output.ts`, `memory-record-model-view.ts` |
| Source lifetime evidence | Completed retain journals may carry optional `sourceLifetime`: the verified Source native head and exact per-memory head/policy bindings. Ingestion reuses the matching durable completion evidence for later initiative currentness; older terminal rows remain readable without inventing that evidence. Direct-source recall also requires current replica/namespace/eligibility proof; opaque derived records do not gain stronger attribution. | `packages/core/src/db/hindsight-memory-write-contract.ts`, `packages/core/src/memory/hindsight/hindsight-memory-write-retain.ts`, `hindsight-source-lifetime.ts`, `hindsight-recall-evidence.ts` |
| Utility and policy-review capture | The existing Utility Slot supports optional/live model configuration. Hindsight policy-curator enqueue captures its Utility binding and Memory/policy configuration before queueing; later edits cannot replace an admitted job's inputs. Automatic `maybeRun` skips unavailable Utility admission. The existing durable policy-review, failure and publication owners remain responsible for results. | `packages/core/src/memory/utility-slot.ts`, `packages/core/src/memory/hindsight/hindsight-policy-curator.ts`, `hindsight-memory-subsystem.ts` |
| Ingestion coverage and missing sources | Split work at unproven user occurrences. Validate every selected witness/digest and reject omitted user messages inside a supplied span. Revalidate completed source/outbox receipts and advance current coverage only to the first actual gap. Already stored cursors remain historical monotone high-water marks; they cannot excuse a current gap. | `packages/core/src/db/hindsight-ingestion-source-repo.ts`, `hindsight-ingestion-repo.ts`, `hindsight-ingestion-durability.ts`, `primary-ingestion-progress.ts`, `packages/core/src/memory/hindsight/hindsight-ingestion.ts` |
| Pre-baseline custody and retirement | Check actual open custody/coverage gaps before the historical eligibility exemption for both Local and Hindsight. Assistant-only and pre-baseline open groups remain protected; incomplete evidence returns a retryable flush failure. | `packages/core/src/db/primary-memory-custody-repo.ts`, `hindsight-ingestion-source-repo.ts`, `packages/core/src/memory/memory-flush-port.ts`, `packages/core/src/memory/hindsight/hindsight-ingestion.ts` |
| Compaction versus source retirement | Published Local and a published, matching Hindsight binding can commit nonretiring summaries while retaining all raw Timeline/source rows. Unpublished, unavailable or mismatched Hindsight bindings still refuse the factual flush. Summary publication does not certify extraction or authorize source deletion. | `packages/core/src/memory/runtime-compaction-composition.ts`, `runtime-composition.ts`, `hindsight-runtime-binding.ts` |
| Transition back to Local | A confirmed regression left Local search unready after a successful bind and prevented queued writes from settling. The configuration owner now prepares the existing search projection; transition bind and source recovery await it and recheck liveness/authority. Post-COMMIT failure preserves the committed authority, original queue and receipt for recovery. | `packages/core/src/memory/runtime-configuration-application.ts`, `packages/core/src/memory/transitions/transition-runtime.ts` |
| Runtime shutdown | The extracted existing lifetime owner joins configuration, transition, Utility, maintenance and retired-binding producers before SQLite closes. Repeated stop returns the same completion. | `packages/core/src/memory/runtime-lifetime.ts`, `runtime-composition.ts` |
| SQLite lineage | Preserve main 001-063 and T4 historical exports/receipts; append guarded convergence 073-077. Fresh/main histories do not gain invented 064-072 receipts. Historical Hindsight fixtures retain their capped schemas until their actual upgrade boundary. Unknown schemas still refuse; atomicity is per migration. | `packages/core/src/db/migrations/index-list.ts`, convergence modules 073-077, `packages/core/src/db/migration-runner.ts`, `sqlite.ts`, `packages/core/src/testing/memory-historical-timeline-fixture.ts` |
| Governance | Union governance revision 4 retains main's Hindsight cells and T4's cells. Supported historical revisions 1/3 preserve valid Approval decisions; future/unsupported history still refuses. Chinese capability/cell labels cover the union. | `packages/shared/src/governance-registry.ts`, `governance-registry-history.ts`, `governance-presentation.ts`, `packages/core/src/governance/`, `apps/desktop/src-tauri/` |
| Home operations and settings | Retain Hindsight operator surfaces alongside T4 model settings and durable Character-filtered Tidy. Status reads wait for subscription acknowledgement and respect page visibility; hidden pushes retain a refresh obligation, while hiding preserves the mutation lock/outcome without replay. Authority epochs and opaque Bank/operation IDs remain correlation fields rather than display labels. | `apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts`, `memory-authority-state.ts`, `memory-authority-card.tsx`, `operations-page.tsx`, `apps/desktop/src/windows/home/pages/settings/config-groups.ts` |
| Hindsight Host test environment | Remove reliance on an absent old temporary executable. The fixture builds the retained fake-only Rust key adapter on demand and validates its actual output. This repairs reproducibility, not production custody behavior or installed-distribution acceptance. | `apps/hindsight-host/src/deployment-test-fixtures.ts`, `apps/hindsight-host/test-fixtures/deployment-key-adapter-fixture.ts`; [Host fixture repair](../../11-11-main-t4-baseline-integration/research/host-deployment-fixture-repair-20261112.md) |

The integration also preserves installed Host resources and both branches' dependency edges. The authoritative
cross-layer review is [the independent check](../../11-11-main-t4-baseline-integration/research/final-independent-check-20261112.md).
The detailed repair account is [Memory regression evidence](../../11-11-main-t4-baseline-integration/research/memory-regression-repair.md).
The original frozen history is not rewritten to make the new tests pass.

The controlled journey now checks compact model output separately from Shared-validated captured Run/Source/Effect
identity and the original durable Hindsight parent/Native child. The stopped-database replay passes 19 assertions
without changing its hash; see [the harness repair](../../11-11-main-t4-baseline-integration/research/memory-tool-harness-repair-20261112.md).
This is a test adaptation to the accepted projection, not a production write/receipt change. Browser isolation and
preflight are recorded in [the browser harness repair](../../11-11-main-t4-baseline-integration/research/browser-harness-repair-20261112.md).
The separate `real-model-memory.mjs` and `post-reentry-replay.mjs` still assume full model-output envelopes;
repair and verify them before their future suites. Neither is exercised by the current controlled journey.

An additional Windows journey correction releases the harness-owned IPC after dispatching the real Core SIGINT
handler. Current Core deliberately exits naturally to drain native I/O. Before the fix its completed teardown was
kept alive by the test channel until the unchanged 60-second deadline; afterward an actual fresh Core with an
authenticated peer exits naturally in 83 ms (`code=0`, `forced=false`). Production source is unchanged. See
[the shutdown comparison](../../11-11-main-t4-baseline-integration/research/core-shutdown-harness-repair-20261112.md).

The model projection is covered in `canonical-tools/memory-tool-model-output.test.ts` and
`hindsight-memory-consumer.test.ts` under `packages/core/src/memory/`; these are included in the full Core receipt
below, not additional independent totals. The Source lifetime extension changes internal terminal JSON while
keeping the field optional; it does not rewrite old receipts, extend Native HTTP schemas or authorize source deletion.
Relevant spec truth remains in `.trellis/spec/backend/hindsight-application-runtime.md`,
`memory-operations.md` and `compaction-harness.md`; this handoff does not replace those contracts.

## Native Hindsight checkout and patch ownership

The connected-service harness uses the existing `H:/hindsight` checkout and its Python environment read-only.
Its HEAD is `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`; the checkout already contains uncommitted Native changes.
HEAD alone therefore does not identify the tested Native implementation. Each journey's `result.json` records
`baseline.native.changedSource` hashes; the 07:51 journey records `sourceUnchanged: true`.
These pre-existing Native patches are not newly authored main/T4 integration changes.

Native patch history remains in `H:/hindsight/TAKI_PATCHES.md`. This continuation has made no Native source edits.
If later integration work changes Native code, add a dated entry here with the Native paths, before/after behavior,
reason, compatibility/migration effect, exact validation receipt and remaining limits; also update that Native
ledger in the authorized Native task. Keep task-specific test workarounds separate from shipped behavior.

## Verification receipts and limits

Raw reports were read back during this continuation; they are prior-run evidence, not newly rerun suites.
All report names below resolve under `../../11-11-main-t4-baseline-integration/research/`.

| Evidence | Actual outcome | Scope |
| --- | --- | --- |
| `test-core-final-20261112.json` | 6,282 pass, 0 fail, 7 conditional skips | Full Core deterministic suite; supersedes the initial 90 failures |
| `test-memory-repair-final.json` | 165/165 pass in 20 actual files | Synthetic ports/models with real Core/SQLite; coverage, lifetime and Local recovery |
| `test-host-preparation-final-20261112.json` | 87 pass, 0 fail, 1 existing opt-in skip | Real helper/adapter processes with substituted engine; supersedes `test-host-final-20261112.json` |
| `test-shared-final-20261112.json`, `test-desktop-final-20261112.json` | 908/908 and 1,633/1,633 pass | Protocol and frontend automated tests |
| `governance-replay-result-20261112.json` | Migration 077; governance 3 to 4; seven valid decisions and legal overrides preserved; original hash unchanged | Isolated frozen database copy; zero provider calls; Core not started |
| `smoke-core-result-2026-11-12T10-02-55-540Z-35220.json` | Same Core process/socket: no-model refusal with zero Runs, Main configuration/test, then one exact completed streaming Chat Run; reopen preserves it | Actual Core/RPC/SDK/SQLite with two keyless loopback provider requests. Independent optional-invalid-Memory case still boots. Does not prove Native model setup |
| `recovered-build-receipt-20261112.json` | Prior build exit 0; production Vite assets and debug `taki-desktop.exe` with Host preparation | Recovered from source session line 860; no installer bundle or owner acceptance. CLI/Shared declare typecheck/tests but no separate build script |
| First connected journey, `2026-11-12T07-32-09.111Z/result.json` | Native boot failed before business steps | Missing offline embedding/reranking caches; see startup ledger |
| Second connected journey, `2026-11-12T07-51-08.211Z/result.json` | Native boot 45,444 ms; Core/Legacy step 1 passed; Home onboarding step 2 failed | Real Native/PostgreSQL and controlled models; Python Playwright import missing |
| Third connected journey, `2026-11-12T09-21-17.541Z/result.json` | Native boot 44,510 ms; steps 1-4 passed; step 5 failed | Home onboarding, connection and first activation passed; old harness expects an internal retain envelope but receives the compact model-facing result |
| Fourth connected journey, `2026-11-12T09-42-31.030Z/result.json` | Eleven stages passed through step 7; step 8 clean-shutdown/restart failed after 60 seconds | Includes real retain/replica confirmation, multiple Home connections/settings, interval/manual-only windows, new Character provisioning, ingestion race, Pending outage recovery and connection revalidation. The Core shutdown logs reach MCP closure, but the child requires forced termination; IPC ownership is under isolated reproduction. |
| Final connected journey, `2026-11-12T10-14-33.205Z/result.json` | All 24 stages passed; four Core exits and Native exit are natural `code=0`, nonforced; no surviving owned processes/listeners | Real Native/PostgreSQL, Home Chromium and Core with controlled model responses. Covers restart, pending recovery, template updates, backup-v2 at migration077, healthy Local return, re-entry, offline takeover and authenticated paired restore. [Acceptance and resource receipt](../../11-11-main-t4-baseline-integration/research/connected-journey-acceptance-20261112.md). |

Journey reports live under `../../08-09-memory-operations-ui/research/first-use-runtime/results/`.
The second and third journeys report no surviving owned processes/listeners after cleanup; Core termination was forced,
so this does not prove graceful Core shutdown. Suite totals overlap and must not be added into a unique-test total.

The third run records `sourceUnchanged: true`, six controlled loopback provider requests and zero unexpected
provider paths. The Core attempted a `models.dev:443` catalog connection, which the isolation guard refused;
Native had no refused egress. Do not describe this as proof of zero attempted external network access.
Twenty-eight approximately five-second resource samples span 09:21:36-09:24:23 UTC: minimum available memory
3.513 GiB and maximum summed owned-process working set 2,942.797 MiB. The process sum includes shared pages and
harness/browser processes; it is a sampled observation, not a precise unique-memory peak or a minimum product requirement.
See `journey-resources-20261112T092108256Z-7107d850.jsonl` under the integration research directory.

## Open follow-up

- The configured complete Native/PostgreSQL/Home journey now passes; retain every failed run and its tested source.
  A final provenance read-back matches all surviving Taki and Native changed-source hashes, with seven intentionally
  deleted Taki paths represented by null hashes. No Native source edits were made in this continuation.
- Maintain [the startup configuration blocker ledger](startup-configuration-blockers.md) during every E2E run.
  Missing embedding/reranking setup must become configurable after application startup in the later product task.
- Keep installed-distribution, live-provider, owner/manual and large-library acceptance separate. The prior main-only
  real-provider receipts do not certify this integrated source.
- Verified application merge `95ce75e` now contains both original histories and both H branches fast-forwarded
  to it after engineering validation. [Delivery/alignment receipt](../../11-11-main-t4-baseline-integration/research/baseline-delivery-20261112.md)
  records final dependency checks and explicit scope limits. No parent completion, real-data upgrade, authority
  promotion or missing-model Native readiness is inferred from this baseline alignment.
