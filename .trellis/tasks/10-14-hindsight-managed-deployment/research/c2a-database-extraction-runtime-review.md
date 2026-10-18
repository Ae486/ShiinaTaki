# C2a offline extraction and first-start runtime review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS_PREREQUISITE_ONLY.** The existing run proves offline extraction, usable raw PostgreSQL
tools, one real SQL startup and checked clean shutdown of the disposable standalone database.
It does not accept the admitted database child or generated logged-data persistence after restart.
`deploymentReady` remains false.

The reviewer read the retained evidence and corresponding frozen source, independently compared
53 facts and recomputed file/log hashes. No target, Docker, test, build or installation command
was run; only this report and its [JSON companion](c2a-database-extraction-runtime-review.json)
were added. All 53 comparisons passed.

## Findings (fixed)

None. No implementation or evidence repair was required.

## Findings (not fixed)

None within this prerequisite. The separately reviewed admitted child and its original-volume
restart/persistence test remain later work, not acceptance supplied by this result.

## Input and command boundaries

Evidence root: `G:/TakiAgent-c2a-database/first-fd3e5b9c-c0f8-4fd8-b1d1-17a8dd1cce7e`.

All seven frozen inputs match the manifest and the released hashes. The consumed supervisor is
`first-start.py`, 28,600 bytes, SHA-256
`7d1ee67f7b3027da781795e365b58a9cb93f847cdba7cc31425f05030d2f7ff6`.
The [accepted implementation review](c2a-database-extraction-implementation-review.md) and its
unchanged static-check evidence therefore apply without rerunning them.

The 22 recorded Docker calls use the pinned executable, explicit Linux-engine endpoint, isolated
client config and only SystemRoot/TEMP/TMP host environment keys. Actual creation matches the
accepted plan: cached image, `--pull never`, network none, read-only rootfs, UID/GID 1000, no TTY,
open stdin, 512 MiB memory, one CPU, 64 PIDs, no published ports or bind mounts, and only the fresh
labelled named volume. Recorded mutation counts are one volume create, one container create,
one attached start, one stopped-container removal and one volume removal. There is no Docker
exec, stop, restart, image build/pull, daemon mutation or mutation of an original workload.

Root's retained source hash-checks the frozen supervisor, sends those bytes to stdin and closes it.
`first-start-command.json` equals command record 10; its actual stdout parses exactly to
`first-start-runtime.json`. The attached client returned exit 0 in 2.911 seconds, with 18,200
stdout bytes, empty stderr and no timeout/output failure. The four exit-1 inspect calls are the
expected fresh-name and post-removal absence checks.

| Identity | Actual value |
| --- | --- |
| Engine | `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Cached image | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Container | `324ae76d27cec7966558b0842c6386a1ceb6c7b969dd678b513398a306dfa6bb` |
| Volume | `taki-c2a-db-first-fd3e5b9c-c0f8-4fd8-b1d1-17a8dd1cce7e-data` |
| Cluster | `7696846713986908180` |

## Real database and process evidence

| Observation | Result |
| --- | --- |
| Empty owned seed | UID/GID 1000; only supervisor PID 1 in the initial process namespace. |
| Single startup | pg0 0.15.0, one start dispatch, CLI exit 0, one psycopg2 2.9.11 connection and one fixed SELECT. |
| SQL readiness | PostgreSQL 18.1; actual `data_directory=/home/hindsight/.pg0/c2a-first/data`, port 55432, loopback listener and owned socket directory. |
| Effective durability | `fsync=on`, `synchronous_commit=on`, `full_page_writes=on` from actual SQL. |
| Live CLI | PID 9, start ticks 874051, PPID 1, PGID/session 9, exact pinned pg0 executable and accepted argv. |
| Live postmaster | PID 27, start ticks 874204, PPID 1, PGID/session 27; exact extracted postgres executable. |
| Live SQL backend | PID 37, start ticks 874223, parent 27; same postgres executable and SQL backend PID. |
| Metadata | Instance PID/data/installation/version/port match the live database. |
| Timing | SQL ready 1.737 seconds after dispatch; complete payload 2.226 seconds. |

The retained `/proc` stat/status fields independently agree with those process records.
The pg0-generated postmaster argv includes `-F` and a later explicit `-c fsync=on`.
The actual SQL settings establish that durability was enabled; argv appearance alone is not the
basis for the verdict. Preserve the explicit settings and effective SQL readback in the later child.

All four exact tools under `/home/hindsight/.pg0/.pg0/installation/18.1.0/bin` report
PostgreSQL 18.1 and successfully run as UID 1000. The executed supervisor records regular ELF
files, readable/executable access and traversable parents:

| Tool | Bytes | Recorded SHA-256 |
| --- | ---: | --- |
| `postgres` | 11223384 | `c51a24681dd5002766ea2f2081340d894762144a75148f89b3d2b4f98995f46d` |
| `initdb` | 210736 | `3ca6d4b1cecbd837ef33320e37ff2ecd1abec29aa052bf04b71991f226d34549` |
| `pg_ctl` | 85208 | `cda21f47857542878b0c687ece522ef96cafeacd3cc3f1bd2ceebd25d71cc76a` |
| `pg_controldata` | 69816 | `72d19abe534d1823a02cb2418d57b1b2f815bcc031cbe9c3946d01b2b8f6c499` |

The aggregate CLI/tool hash input is 45,794,816 bytes. The largest sampled volume metadata total
is 113,951,227 bytes with 2,515 entries, below the accepted 1 GiB / 4,096-entry bounds.
These are sampled metadata measurements, not a filesystem quota or continuous allocated-byte peak.

## Checked shutdown and cleanup

One exact raw `pg_ctl stop -D /home/hindsight/.pg0/c2a-first/data -m fast -w -t 15` returned
exit 0 in 0.122 seconds. The original postmaster PID 27 was actually reaped with wait status
and exit code 0. Another adopted PID 28 was reaped with status 0; its role is not separately
identified by the retained process snapshots. Only the original supervisor PID 1 remained.

Raw `pg_controldata` then returned exit 0 in 0.021 seconds and reported
`Database cluster state: shut down` for SQL cluster `7696846713986908180`.
The shared shutdown phase took 0.144 seconds. The complete PostgreSQL log records readiness,
fast shutdown, its shutdown checkpoint and `database system is shut down`.
The 573-byte startup log and 1,174-byte PostgreSQL log were captured without truncation;
their recorded byte counts and SHA-256 hashes independently match the retained output text.

The exact container was already exited with code 0, no OOM and no error before Root cleanup.
Cleanup revalidated engine/CID/name/image/labels/mounts and the volume driver/label, removed the
stopped CID without force, confirmed the volume unmounted, removed only that volume and observed
both absent. No outer Docker stop was needed. Raw before/after snapshots and command outputs
agree for all seven original IDs, names, states, start times and restart-policy names; the complete
before/after container ID sets are also identical. The recorded Windows cleanup interval is
1.824 seconds, inside the shared 60-second budget.

Windows and Linux/daemon wall clocks are separate domains. This review uses command sequence and
same-domain elapsed values; it does not infer a global timeline from their wall-clock timestamps.

## Evidence and verification limits

| Evidence file | Bytes | SHA-256 |
| --- | ---: | --- |
| `first-start-result.json` | 8201 | `2db443fb5b74d9ed0b98ebddda6156cfce75e0fcb20d0cf24b485bea0ac2557d` |
| `first-start-runtime.json` | 20851 | `9c3666b38752f715d7624b96ec1bbf57d0b18857757ef861930f9d4c44cd0962` |
| `first-start-command.json` | 20137 | `6721a2f8113f2ba737880c32ffb07063f51ed7f4472fe4e4d52aa3c52a422d34` |
| `commands.jsonl` | 44255 | `52fcf316fb5d4c72f8422ed93da4360395960da7dc5be04a6cf661a0569f49d0` |
| `input-manifest.json` | 1819 | `0569c35fce38fc6433179a22ff10fb944520865bee6ddc9f43ccff73e04e2af3` |
| `resource-identities.json` | 370 | `bc7663b8b8963b23ea1960c472788d5f0659e1850c7e6ca6d967676d021bf184` |
| `original-before-containers.json` | 1546 | `c4667b5486b3ab64f761f6393845248518f4178026d162173d4e4d269d8fc079` |
| `original-after-containers.json` | 1546 | `c4667b5486b3ab64f761f6393845248518f4178026d162173d4e4d269d8fc079` |

The JSON companion also binds the seven frozen inputs, prerequisite/resource records, both Root
runner sources and derived comparisons. Root runner hashes are
`08036c099c53e7d58c39f40c649e2930d7930d2a16eb93b54964d4b82acc569a`
(`run-first-start.mjs`) and
`92cc067e25aff35c1ce4e260d380170f3cc5235123fe28c46402409c05dfddd7`
(`command-runner.mjs`).

Environment clearing, original PID-file binding/revalidation/absence, exact ELF/access checks
and active shared deadlines are supported by the successful, hash-bound source path. Separate
raw environment or PID-file dumps were not retained. Binary hashes were emitted by that source;
this reviewer did not reread the removed Linux binaries. The successful run does not test
timeout/forced-cleanup failures or establish reproducible-build provenance.

Original workload protection is supported by exact command targets and the two observations,
not a continuous audit of all host activity. No workload table or generated logged row was
written and read after restart. The admitted Host/Core/private-delivery child, original-volume
database persistence, Native API/provider readiness, C2b receipts, inner ACK/daemon faults,
C1 service and owner manual acceptance remain separate.

## Verification

- Lint: **PASS reused** from the byte-identical supervisor's recorded Ruff E/F/I check.
- Format / syntax: **PASS reused** from its recorded Ruff format, AST and in-memory compile checks.
- TypeCheck: **not applicable** to this Python fixture and evidence-only report.
- Runtime: **PASS_PREREQUISITE_ONLY**, based on the existing actual Root execution and independent evidence comparisons.
- Tests / Docker / target runtime / builds: **not rerun** by this reviewer.
- Spec/template sync: not required; no production contract or implementation changed.

Root retains ownership of preservation, archive verification and removal of the marked G: stage.
The stage is still present at review time; this report does not claim it is archived or removed.
After preservation, the separately owned database-child plan can use these measured facts.
The reviewer leaves R1/R2 evidence, task metadata, raw staging and all accepted checks unchanged.

