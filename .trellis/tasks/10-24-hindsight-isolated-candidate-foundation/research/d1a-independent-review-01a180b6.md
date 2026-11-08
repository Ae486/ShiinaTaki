# D1-A independent source review (01a180b6)

## Final verdict

**PASS for independent D1-A deterministic source acceptance.** No independently confirmed defect or required source correction was found. All 19 released source/document files remain byte-identical. This is not complete D1 acceptance, a production candidate issuer, actual PostgreSQL restore, installed Host/API evidence, or model-upgrade acceptance.

### Findings (fixed)

None. No production source, test, central export, spec, task metadata or existing release record was changed by this reviewer. Only this report and its new integrity evidence/script were added.

### Findings (not fixed)

None within D1-A. D1-B/C/D remain explicit later implementation and runtime gates rather than defects in this admitted source slice.

### Verification

- Lint: PASS, exact unchanged-source scoped root ESLint command from the recovered release.
- TypeCheck: PASS, exact unchanged-source Shared and Core commands.
- Tests: PASS, existing Shared 24 tests / 3 files and Core 39 tests / 7 files. Their actual logs were read and hashes reverified; these suites were not rerun during this independent review.
- Whitespace: the recovered tracked `git diff --check` exited 0. Untracked candidate bytes are covered by the source integrity record and scoped ESLint; no claim is made that a tracked-only diff checks untracked files.
- Independent integrity/parity command: `python .trellis/tasks/10-24-hindsight-isolated-candidate-foundation/research/d1a-independent-review-01a180b6/verify-release.py`, exit 0. It checked 19 source files, 3 related files, 14 evidence files, all 6 exit-0 command records and exact set equality with the current Native 61-table `BACKUP_TABLES`, using AST parsing without importing or executing Native.
- Exact source/check commands, byte counts, SHA-256 values and Native/profile input hashes: [integrity.json](d1a-independent-review-01a180b6/integrity.json), SHA-256 `4d30234fab3e0ba1221c61ece95896b7451ae668949fff972011a7dc16be357d`.
- No heavy slot, new test process, listener, Docker/Host/Native runtime, migration, original data/key, provider call, dependency or Git lifecycle action was used by this review.

### Requirements-grounded evidence

| Requirement | Verified implementation and meaningful coverage |
| --- | --- |
| Complete archive and body/Pending/template preservation | `hindsight-candidate-archive.ts` joins actual ZIP streams, manifest columns/counts and pinned entry digests; the reused Stage 3 reader checks exact entry-set parity. COPY tuple digests preserve duplicates, NULL/empty distinctions and binary bytes independently of row order. SQL file references require unique stored keys and non-null body data. Admission tests omit each of 61 tables and exercise nonempty bodies, selected/removed templates and Pending. |
| Exact original versions and immutable Core | `hindsight-candidate-schema-admission.ts` pins the supported Native build/upstream/Alembic and exact ordered source/target columns; unknown tables/types and inconsistent vector dimensions refuse. `hindsight-candidate-core.ts` requires the original v2 Core head and contiguous migration history, whole-file commitment, copied Bank/receipt/template attestation and current replica/body closure. It uses only the existing `immutable=1`, read-only SQLite entry; tests prove no writer/migration call, no new sidecar and unchanged copied/source bytes. |
| Pair semantics and historical identity | The original pair verifier is reused unchanged, including Native-ahead cursors. Historical capture provenance is bound to backup/request/Core/archive identities; it is deliberately distinct from the current source identity used for physical exclusion. Source restart need not equal its historical capture identity. |
| Physical identity and fresh observation | Ownership/schema validation precedes endpoint derivation. The verifier refuses source/shared/foreign identities and writable attachments, computes every restored table itself from two independent snapshot streams around the real v2 preflight adapter, checks fresh nonce/context and rechecks whole-file/observer currency before returning. Missing optional producer ports return explicit unverified evidence. |
| Failure truth and asynchronous drift | Closed refusal fields keep absent/unreadable/unsupported/tampered/omitted-data distinctions without leaking raw exceptions. Input paths/schema/manifest/ownership are captured before asynchronous work; tests cover input mutation, archive/sidecar mutation, revoked sessions, source-authority drift and changed post-observation rows. |

### Required spec and producer handoff to Root

Root owns spec integration. Preserve these executable contracts and limits in the candidate spec/index:

1. D1-A is an experimental internal consumer, not a trust issuer or registered operation. `baseline_verified` from a synthetic `CandidateObserver` proves only deterministic consumer behavior. Public JSON, supplied schema/ready fields, digest strings, image labels or a matching object cannot establish actual source/Host/restore provenance.
2. The admitted profile is v2, Core migration head 59, Native `e62a3d0b9c54`, template-backup build and pinned upstream; it requires SQL-backed bodies and the complete supported table set. Future schema/build/inventory changes require a reviewed profile and matching actual producer evidence. Unknown tables/extensions/body backends refuse. `alembic_version` and `bank_stats_cache` remain explicitly classified, not silently included in preserved-row equality.
3. D1-C/D must independently authenticate and resolve the original capture evidence against the exact backup/request/Core/archive/source environment. Do not reconstruct historical environment/schema facts from today's source or the restored target. Actual version, complete schema objects/types/constraints/triggers, PG/extensions and artifact identity must be established by that producer; matching caller-supplied inventories alone are insufficient.
4. The installed producer must bind the complete source exclusion set and candidate to actual Host/installation/engine/image/container/volume backing/attachments/PG/startup/listener facts. Its schema and COPY streams must come from the actual same candidate under read-only snapshots, and its authenticated transport must enforce current session identity at dispatch and across in-flight replacement. The local port currently has no installed provenance implementation.
5. The producer must prove the validation-only execution fence with migrations/workers/maintenance/webhooks/model paths disabled and preserved due/processing rows. Current deterministic fixtures use synthetic Native columns/COPY and physical identities; they are not complete Native SQL schemas, actual platform isolation, runtime no-effects or stopped-restore evidence.
6. Keep original-operation/restore-commit identity and no-replay recovery in D1-B/C, full runtime acceptance in D1-D, and C3/C4/D2 model/publication obligations visible. D1 does not select authority, replace live Core, re-embed or complete a model upgrade.
7. Existing limits are transport/profile bounds, not a performance guarantee: manifests are capped at 4 MiB and tables at 512. COPY payload bytes stream, but row digests and collected body keys remain proportional to row/key cardinality; admission also rereads archives for the unchanged Stage 3 check. Do not claim constant-memory whole-database verification.

**Ownership released to Root. Review complete; no further editing or test work is pending.** Historical checkpoints below are retained for interruption recovery.

## Checkpoint 1 - review resumed

- Scope: independent D1-A source acceptance only; later candidate runtime and D1-B/C/D remain unaccepted.
- Workspace checked: `H:/TakiAgent`, branch `main`, HEAD `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`.
- The global `.trellis/.current-task` file is present and empty. This review uses Root's explicit existing D1 session binding (`01a180b6-1dac-7fc2-b365-15fcb34dd4b4`) and task path.
- Ownership: candidate module, Shared candidate schema/tests, and this review evidence directory. Root retains central exports/specs/task/release records. Inherited changes are preserved.
- Original PRD, curated context list, quality/backup/template/Host/managed-deployment contracts read. Remaining curated context is being read in bounded chunks after detecting a truncated aggregate tool response.
- No source mutation, runtime operation, test execution, dependency change, Git lifecycle action, or acceptance conclusion has occurred in this review.
- Next: complete the required context and full source-readiness study, verify release hashes/logs, then inspect actual source/backup/immutable-reader paths and D1-A exit criteria.

## Checkpoint 2 - requirements and primary contract read

- Read the curated backup/template/Host/deployment/operation/SQLite specifications and the preparation advisor, C2b preflight, S6 acceptance allocation, D1 design and D1-A exit. Read the complete source-readiness study directly in two chunks (lines 1-95 and 96-184). The original complete-preservation and same-version requirements remain the review basis.
- Read the check/before-development skills and backend/guide indexes. Package discovery succeeded with installed `python`; no environment change occurred.
- Verified the recovered release record hash: `3777f2f7b8a985d34da42dfa6a7d616a772602b21b3e09e5c4143b3a716da75a`. Read the actual Shared/Core test logs: 24 tests in 3 files and 39 tests in 7 files passed. Root independently verified all 19 source files and all six command records.
- Read all of the Shared candidate schema, candidate admission, schema admission, verifier and physical-identity implementation. Confirmed the verifier is an explicitly experimental internal port, not a production Host evidence issuer; later D1-C/D wiring remains a gate.
- On recovery, the persisted review file had only the intended checkpoint; no matching Vitest/TypeScript/ESLint review process was found. No source mutation or new test run has occurred.
- Remaining review: archive/COPY/body and immutable-Core readers, exact reusable backup/SQLite guards, candidate regression tests and pinned profile parity. Resolve any concrete defect before deciding source acceptance; otherwise reuse the unchanged green checks. No finding is established yet.

## Checkpoint 3 - source and regression review complete

- Read all 19 released candidate/Shared source, test and index files. Read the reused immutable SQLite entry, copied-Core identity/readback, strict restore/preflight, template observation, pair verifier and deep ZIP entry verifier; read Native's current `BACKUP_TABLES` directly.
- Archive admission checks required tables, exact ordered source/target columns, build/upstream/Alembic, consistent explicit vector dimensions, binary stream structure/counts/hashes, SQL file-body keys/data and complete per-entry proof. Whole-file Core checks retain source/body/Pending/template bytes and use the existing copied-scope attestation.
- Verified tests contain selected and removed templates, nonempty bodies/Pending, all 61 omitted-table cases, malformed stream vectors, wrong schema/types, absent/unreadable/tampered distinctions, live sidecars, changed paths/schema during admission, source/shared/foreign identities, missing provenance, two complete restored snapshots, fresh nonce/context checks and revoked-session/drift refusals.
- No independently confirmed D1-A defect or required source correction was found. All positive Host/Native row fixtures are explicitly synthetic; they do not supply production provenance or runtime acceptance.
- Remaining before handoff: independently hash the release source/check records, record Native-profile name parity and the precise later-producer obligations, then publish the scoped verdict and release ownership. No heavy test slot has been used.
