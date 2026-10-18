# C2a disposable database design review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the bounded task-only candidate and the initial metadata probe described below.**
The existing approval covers this work. Cached Linux PostgreSQL availability remains a runtime
prerequisite; no database behavior or remaining acceptance criterion is passed by this review.

## Reviewed contract

The [readiness report](c2a-database-readiness.md) proposes a sound limited claim: the existing admitted
Core/Shell/Host/bootstrap path gates one task-specific PostgreSQL descendant, whose generated SQL
data survives a clean stop and restart of the original container and volume.

The current code supports that boundary. Native owner.py:23-30 fixes C2FakeConsumer; fake_consumer.py:54-98
validates fake values, launches the fixed child in its owned Linux session and accepts only the exact
child PID/startup marker. Host deployment-injection.ts:29-63 independently rejects real values before
grant/frame dispatch. docker-adapter.ts:84-115 fixes the image, UID, network-none topology, original
volume and private submission. Shared hindsight-deployment-schema.ts:31-35,111-119 pins the immutable
image alongside the fake-only consumer contract.

Keeping c2a-fake-v1 is acceptable here as the unchanged fake-input/bootstrap protocol. Explicitly name
the new artifact a task-specific database fixture, replace only the staged fake_child.py, and record
that file, the complete context and the new image identity. Its PostgreSQL behavior is a newly reviewed
test variant; none of the accepted first-case executable/evidence identity is reused. No production
consumer selector, schema, provider mapping or framework change is needed.

## First probe: concrete scope

Root may prepare and run one fresh, labelled, short-lived probe on cached image
sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db.
Reuse the pinned explicit Docker executable/engine/config discipline. Use pull=never, network=none,
read-only rootfs, UID/GID 1000 and the fixed /app/api/.venv/bin/python entrypoint with -I -B -;
feed one hashed stdlib-only script through stdin. Use no existing volume or host-data mount.
Bound execution to 60 seconds, returned evidence to 128 KiB and owned cleanup to 60 seconds.

The script reads pg0-embedded and one installed SQL client's metadata, relevant pg0 source and
package-listed assets. Return versions, exact relevant paths/hashes, UID traversal, data-seed metadata,
HOME/data-dir selection and whether PostgreSQL assets already exist. Only confirmed existing
postgres/initdb/pg_ctl/pg_controldata paths may receive bounded version-only invocations. Do not import
hindsight_api, start/stop/info a pg0 instance, initialize storage, download/extract assets or scan models.
Creating/removing this probe container is an authorized engine effect; its payload is non-starting.

Missing assets or an extraction-only layout produce an explicit unresolved prerequisite. Freeze a
small offline extraction/start proposal before that additional effect; do not silently add a download,
PATH fallback or normal Native startup. Metadata and version output cannot establish actual postmaster
ownership, SQL data_directory or graceful shutdown; the subsequent database case must establish them.

## Required implementation and acceptance details

- Preserve independent fake-value and dotenv checks, then construct a fresh allowlisted DB-child
  environment without any fake variables. Use distinct nonsecret local database parameters; no
  sentinel enters a password, URI, SQL row, argv, log or database file.
- Install termination handling before initialization. Publish the existing five-second marker as
  validated wrapper liveness; SQL readiness has its separate 60-second budget. The marker does not
  mean database readiness. Prefer confirmed raw foreground PostgreSQL binaries with an explicit
  process handle; verify actual PID/start identity/PGID/session rather than assuming no detachment.
- Keep one exact data directory beneath the admitted named volume. Capture actual SQL settings with
  durability enabled, cluster identity and a committed ordinary logged-table payload digest. Verify
  from a fresh connection, then after original-container restart query without recreating/reseeding.
  The original image/volume/cluster remain; the Native startup and authorized startup attempt change.
- Close SQL clients and finish the fixed database stop/wait/control-state collection within 25 seconds,
  leaving room inside OwnedChild's unchanged 30-second group budget (supervision.py:97-130). Keep a
  45-second outer container-stop bound for diagnosis/cleanup. Require actual postmaster exit and
  pg_controldata state "shut down", with bounded utility/stop output and elapsed evidence retained.
  A successful Pg0.stop(), wrapper marker or container exit alone cannot pass; forced/unknown shutdown
  fails this case. If an offline inspector is used, mount only this same volume read-only.
- Before injection and after the restarted owner's read-only observation, assert no DB postmaster.
  Only fresh resumeStartup authority may launch it again. Keep SQL/DB evidence outside public Native
  status and leave deploymentReady false. Adapt the task scanner to stream the bounded DB files with
  chunk-boundary matches covered; retain raw nonsecret decisive utility/SQL facts, not only booleans.
- Use fresh tokens, G: staging, the established small protected C: installation and the readiness
  report's finite storage/runtime ceilings. Remove only exact manifest-owned resources after
  preservation. A timeout retains identities for cleanup; it never authorizes daemon/workload changes.

If the probed package cannot support explicit bounded postmaster ownership and checked shutdown,
the minimal alternative is the readiness report's separate operational DB fixture on the same cached
base. It can prove PostgreSQL storage/shutdown only; it cannot substitute for admitted-chain acceptance.
No production generalization is justified to make this test run.

## Findings (fixed)

No source defect was found or changed. This review resolves the consumer-identity interpretation and
freezes the first probe plus the shutdown budget/decisive evidence above; no product decision remains.

## Findings (not fixed)

No design blocker within this conditional scope. Actual cached PG inventory/process behavior remains
unverified. Database runtime, recovery matrix, C1 service AC2/6, C2b and real-model/business-data/manual
acceptance remain separate. Root owns subsequent implementation/execution and acceptance updates.

## Verification

- Lint / TypeCheck / Tests: not run; this assignment permits source/design inspection and this report only.
- The accepted 182 source tests and first Docker case were neither rehashed nor rerun.
- No runtime, Docker/WSL, build/install, production edit or Git lifecycle action occurred.

Ownership of this report is released to Root. The reviewer remains available for recovery-plan review.
