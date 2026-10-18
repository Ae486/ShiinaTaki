# C1 implementation and check plan

Status (2026-10-13): the owner authorized continuation beyond completed Stage 5B. Final design confirmation
and the [post-5B source refresh](../10-07-hindsight-template-lifecycle/research/stage5c-post5b-readiness-2026-10-13.md)
PASS. Independent C1a and C1b SOURCE/full-foundation reviews are complete. Final C1b checks pass 24 Native Windows
tests and 20 observer tests. The subsequent approved temporary-runtime run on 2026-10-14 passed all eight
Linux cases and completed owned cleanup; see `research/c1b-linux-check-2026-10-14.md`. Both original `xhigh`
owners and the new `high` Linux checker released all source/check work. Read `research/leader-now.md`
before dispatching or running checks; do not restart completed source work or mistake it for platform acceptance.

The refresh's six ownership groups and two insertion points are the implementation baseline. In particular,
mint accepted evidence after `settleHostEffect` reaches its final outcome, and pass trusted Host context through
both Rust execute and resume. Reuse the existing Catalog revision rather than creating a second counter.
Core migration head is 059; Native head is e62a3d0b9c54 and build is
`taki-memory-hindsight-0.9.0-template-backup-v1`. C1a has no Native template/backup ownership or reserved migration.

The owner also required build-output cleanup before any disk-growing work. Cleanup is complete in
`research/storage-cleanup-2026-10-13.md`: cleanup restored 15.893 GiB free before the necessary C1a rebuild;
Root's final readback is about 13.40 GiB free. Keep one heavy check at a time, at most two
Vitest workers and one Rust target tree per repository. Use consistent per-command zero debug-info and disabled
incremental settings for the cold Rust checks; keep debug assertions and application behavior unchanged.
Do not repeat passing whole suites or generation without a changed source or an identified gap.
Reuse existing modules and fixed C1 contracts; no general secret broker, framework, speculative fallback or
additional dependency. Original services/data/credentials, real models, service installation and Docker startup
remain excluded. The owner later authorized the existing Ubuntu C1b test environment only. Its Python 3.10.12
and missing python-dotenv initially prevented execution. The owner subsequently approved the bounded G:
temporary-runtime plan, enabling the eight Linux passes. That runtime is removed, system Python remains
unchanged, and no owned test process or directory remains. Docker and Ubuntu credential-service actions
remain excluded. AC7 is accepted; combined Ubuntu service/platform criteria 2 and 6 remain open.

## Readiness checklist

- [x] Reuse completed Host/model and custody source research; preserve real-instance and platform boundaries.
- [x] Seed PRD and draft design with actual codec/Host/packaging gaps and explicit unknowns.
- [x] Curate spec and untruncated source-research context; current implement/check manifests validate.
- [x] Incorporate final independent C1 findings with exact source-backed producer/result/path contracts.
- [x] Freeze finite wire fields/limits, trusted-context/result APIs, artifact trust root and platform checks.
- [x] Resolve C1 process-bootstrap versus C2 Docker/daemon proof and restart-observer implementation ownership.
- [x] Independently review final artifacts; recheck post-5B source and any required migration/compatibility heads.
- [x] Activate and dispatch one cohesive producer owner with explicit source baseline and check stop points.

`c1a_implement` and `c1a_check` completed and released their work. Root owns task/spec/handoff artifacts.
The 19 curated entries and both independent reports remain the context baseline. Further checks need a changed
input or an actual unresolved platform gate; preserve the serial check slot and avoid repeating unchanged suites.

## Implementation order

1. **Codec and release artifact.** Extract the boot-free TSC1 module while preserving Core format/error behavior.
   Build the helper and locked dependency tree outside the checkout. Add manifest/registration validation, explicit
   runtime/adapter resolution and sanitized process environment. No secret-valued public interface.
2. **Authenticated Host custody.** Extend only the necessary trusted invocation/result seams. Bind actual Core and
   Host attempt mapping, current generation/policy, installation and OS owner. Implement Windows get-only and
   Ubuntu protected credential adapters, including an actual release-safe role=node Host path.
3. **Snapshot and publication.** Capture Core boot/private Catalog revision/sealed-byte digest and exact refs.
   Revalidate before accepted output. Test same-millisecond changes, ciphertext restore ABA, publication races,
   identity replacement and locked key-source windows. Keep Core the only catalog writer. Freeze/release source
   for the independent **C1a** custody/provenance/install gate before bootstrap integration; supported-OS evidence
   and any unverified installation path remain explicit and cannot be replaced by mock success.
4. **Fake-secret bootstrap.** Implement the reviewed minimal private delivery/bootstrap and its owned restart
   state machine using fake values and providers. Prove the actual process boundary; add supported-environment
   Docker/daemon evidence only with an explicitly available isolated fixture. Never claim that a fake adapter
   proves real Docker attach/log/restart behavior. This is **C1b**: process protocol plus fake observer state machine.
   C1 owns the release Host lifetime; C2a owns the real durable deployment registry and Docker observer adapter.
5. **Independent foundation check.** Freeze source; review all C1 changes across Shared/Core/Host/helper/native
   bootstrap/packaging as applicable. Correct real findings, rerun affected checks and record remaining platform
   limits before C2 consumes this contract. **C2a** must separately pass actual isolated Docker fake-sentinel,
   inspect/config/log/file, restart/daemon/tmpfs and database-shutdown checks before enabling real delivery or
   trusted deployment receipts. **C2b** consumes accepted deployment ledger references. Full model acceptance
   remains C3/C4/5D.

The readiness review selects C1a and C1b as separate checks because they cross different trust/process boundaries.
Every accepted checkpoint must have a real producer and tests;
unverified capabilities stay unavailable and cannot mint readiness or trusted deployment receipts.

## Check dimensions

| Boundary | Required checks |
| --- | --- |
| Codec | Existing envelopes still open; byte/AAD/key/error semantics; wrong-store/key/tamper; no writer API invoked by helper. |
| Installation | Expected trust root; missing/tampered/redirection; owner/ACL and replacement races; malicious Node preloads; clean outside-checkout execution. |
| Host provenance | Actual broker-issued context and accepted result; role=node registration; wrong attempt/input/Host/generation/policy; operator JSON rejection. |
| Catalog snapshot | Boot + private revision + byte digest; set/clear/restore/rotation; fixed-Date ABA; replaced file; mismatch between prep and acceptance. |
| Confidentiality | Fake sentinel absent from argv, WS, status, logs, persisted helper/container config and files; bounded failures and no raw provider diagnostics. |
| Restart | New bootstrap identity; no old ACK; duplicate delivery; helper/Core/key unavailable; lost replies; exact owned resource observation; safe shutdown. |
| Compatibility | Existing-instance setup without helper; old ordinary capabilities unaffected; wire parity and required package lint/type/build tests. |

Run one heavy check at a time and at most two Vitest workers. Use current exact package specs, isolated temporary
stores and fail-on-call model adapters. Retain failures, actual exit codes, source hashes and owned-fixture cleanup.
No original `.env`/credentials/data, real models, automatic service startup, new third-party dependency or Git lifecycle.
