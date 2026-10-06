# Real converted corpus reuse preflight

Date:2026-10-01. Parent-owned work while the original W3 implementer owns production candidate code.
This records private copy/upgrade, genuine copied first activation and D77 reuse preparation. It does not establish
a completed transition, model-quality test or replacement of the original user authority.

## Verified source and preserved baseline

The prior successful instance `taki-d78-real-654131f0175a` was verified stopped through pg0 and had no postmaster PID
file. Its physical data reports PostgreSQL18/18.1.0, cluster state `shut down`, system identifier
`7683849595319511708`, timeline1 and page checksums1. No reparse points occur in its data tree.

`prepare-native-reuse.ps1` copied1556 files/257082823 bytes into private baseline
`.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/data`.
Every copied file matches the source SHA-256, and the source before/after manifests match exactly. Original instance
remained stopped. Baseline ACL grants only the current Windows user and SYSTEM. Private `files.json` and `inventory.json`
retain exact hashes and ownership; neither the original source nor this baseline is started for tests.

## Actual current-schema upgrade on a working copy

Command, cwd `H:/TakiAgent`:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' .trellis/tasks/09-29-hindsight-transitions-emergency/research/inspect-native-reuse.py --upgrade
```

Successful working copy: baseline directory above / `working-45c36bd87f7f4baba6867a2e934f7d48`.
Only that copied PostgreSQL cluster was started, on loopback port11018, with optional preloads disabled and no
Hindsight engine/model/worker startup. The existing test database password was decrypted in-process from the old
user-scoped DPAPI file; it was not printed or passed on argv. No provider credentials were read.

The actual native `run_migrations` upgraded public schema from `d78c3e6f8b12` to `e30a9d7f6c21`.
All original columns/rows of37 old tables are unchanged by sorted content hashes, excluding the expected Alembic
version marker update. The copied PostgreSQL stopped cleanly; the original instance remained stopped and the retained
baseline hashes still match. Exit0. Exact old-column/current-schema censuses are private alongside `result.json`.

| Existing converted evidence | Actual preserved count |
| --- | ---: |
| Banks | 2 |
| Documents | 722 |
| Live memory units | 1195 |
| Invalidated memory units | 21 |
| Memory links | 43259 |
| Observation history | 151 |
| Mental-model history | 4 |
| Current-state transfers | 2 |
| Transfer mappings | 1446 |
| Cutover verifications | 2 |

The upgraded D77 application tables are empty. Transition Bank-origin and initialization ledgers are also empty:
existing historical Banks correctly receive no invented birth/history. These are reused previously converted Banks,
not eligible fresh unused scopes. Existing native namespace, lineage, content and historical receipts remain intact.

No extraction, full transfer/conversion or LLM call occurred in either copy step. Existing historical109 LLM-request
rows were preserved as old data; they are not new model calls.

## Retained harness failure

The first working copy `working-ffeed11584794d12b632c18af6581864` failed before database startup because Windows
pg_ctl preserved single quotes in `shared_preload_libraries=''` as a literal library name. Native log confirms shutdown,
and an independent pg_ctl status reported no server running. The original and baseline remained untouched.
The helper now passes a true empty assignment, then validates stop/no-process status. The failed copy/evidence remains;
it is not counted as a passing database test or as a data compatibility failure.

## Required W3/W5 follow-up

### Existing Core proofs can be reused without conversion

`node .trellis/tasks/09-29-hindsight-transitions-emergency/research/inspect-conversion-proof.mjs` used a fresh copy
of the previously upgraded52 validation DB. Run `proof-ccdb8e5b-8da0-4f28-948c-d4b44c562a9a` passed the current
production capture/preparation/import readers, all1446 original Bank/source/unit mapping payload hashes, and current
B4 readiness (`eligible=true`, no blocking codes). It preserved722 sources,722 original records/policies and21 invalidated
records. The saved source remained unchanged. No native/model call or activation occurred in that first probe.

The explicit `--activate-copy` invocation then created another private copy,
`.trellis/.runtime/stage4-conversion-source/proof-89f9a26b-f575-42a7-8984-d07e0e1dc1a5/validation.sqlite`.
After the same actual proof checks, it acquired a normal current B4 lease and called existing
`promoteHindsightAuthority` with `carryHindsightActivationCustody` inside the transaction. This produced one genuine
new first-activation receipt through production guards, without inserting synthetic receipts or changing historical
captures/imports. Only this disposable copy now selects Hindsight; no original user authority was changed.

The unchanged production `readHindsightApplicationBootstrapEvidence` accepted that actual receipt and recovered
722 original sources,722 original policies (including21 invalidated records),2 Banks and2 Blocks through the stored
capture/import mappings. Custody carry was truthfully zero because these copied old inputs have no newer custody rows.
Exit0; source file hash unchanged; zero native calls, zero LLM calls and zero conversion/import requests.

This proves a lawful setup path for current D77/candidate tests using the already-converted corpus. It does NOT claim
that D77 artifacts were published to native, a Hindsight runtime was started, the old connection was live-revalidated,
or a Stage4 return/re-entry completed. Those remain explicit next gates on the owned copies.

### Remaining integration gates

- Actual candidates must preserve graph/history evidence as well as flat document/unit records. The43259 links make
  auxiliary pagination/size handling a real-corpus requirement; do not apply a flat10000-record envelope to all history.
- The old Local snapshot has722 real policies. Missing newer D77 artifacts do not justify replacing proven original
  policies with neutral defaults. Recover only through exact historical capture/mapping evidence; genuinely derived
  records without original policy use the explicitly recorded initial policy producer.
- W3 identified a valid-only guard in the ordinary first-policy producer. The parent approved an explicit candidate-only
  producer path for proven invalidated/unbound records, preserving invalidated state, ownership, absence and original
  evidence, without weakening ordinary ingress or inventing successful assessments. Test the real21-invalidated corpus
  plus deterministic boundary cases; raw archival alone cannot replace representable Local lifecycle/restore behavior.
- D77 publication subsequently passed on copies as recorded below. Current W2 final-proof and transition-receipt
  integration remain open. No missing receipt was fabricated, no old Bank was marked newly born, and no full
  real-corpus reconversion is permitted as a workaround.

## Actual D77 publication on reused native and Core copies

Parent-owned `publish-reused-application.py` and `publish-reused-application.mjs` start only a new physical copy of
the upgraded native cluster and copy the genuine B4-selected SQLite above. They invoke existing Core application
sync/binding/command producers over authenticated loopback HTTP, using actual original bootstrap evidence, current
native snapshots, immutable application commands and paired pulls. No retain/extraction/current-state-transfer or
model endpoint is admitted by the transport. Native embedding/model attempts are refused and counted; original
LLM-request/content/history table hashes are checked independently. This probes those production seams, not a fully
configured/started product runtime or a completed transition.

First invocation:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' .trellis/tasks/09-29-hindsight-transitions-emergency/research/publish-reused-application.py
```

Fixture `application-7da01c104b984f65bc55c55111c18cbf` under the private native baseline stopped cleanly with exit1.
The actual30-minute per-Bank lease expired during the first Bank's binding work and correctly raised
`HINDSIGHT_REPLICA_LEASE_LOST`. It made20,757 application/snapshot HTTP requests, no model/embedding attempt and no
corpus conversion. Its partially published artifacts, original command receipts and body cache are retained.
Original historical storage, the upgraded source and the SQLite source hashes remain unchanged. This is retained
bounded-harness failure evidence, not a completed D77/Bank/transition PASS or evidence of a second corpus conversion.

Native `initialize_capture` legitimately turns on the additive `replication_bank_state.application_capture_required`
flag. The original first harness's small protected-table list contained several inaccurate historical table names;
do not use its `protectedTablesUnchanged` alone as complete preservation evidence. The corrected helper compares all
35 original table column/row digests against `working-45c36bd87f7f4baba6867a2e934f7d48/after-original-columns.json`,
excluding only the two logical-snapshot storage tables to which this test adds snapshots. This includes original
replication Bank cursors/lineage while excluding the new D77 flag from the original-column set. It separately checks
19 correctly named current-schema content/history tables.

The resumed invocation:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' .trellis/tasks/09-29-hindsight-transitions-emergency/research/publish-reused-application.py --reuse application-7da01c104b984f65bc55c55111c18cbf
```

It created `application-ad325c12054d4d92b91a81ad2b18fee1`, again a new private native/SQLite pair. The inherited
35 original table-column digests passed before engine startup. It resumed existing artifacts/jobs/cache through
normal Core recovery, with a60-minute Bank budget and retained private runtime logs. **This invocation passed with
exit0 and verified native shutdown.** The actual Core producer completed both Banks and9,851 HTTP requests in the
resumed run. All722 original Source bodies and722 original records/policies match the authentic bootstrap inputs;
21 original invalidated records remain invalidated and2 Blocks match. The first Bank contains562 original Sources/
policies and1 Block; the second contains160 and1. All35 original table-column digests and19 current content/history
tables match after execution. Source native/SQLite copies and the stopped original/baseline remain unchanged.
Native model and embedding attempts are both0; no conversion occurred. Request counts across the failed and resumed
run describe their respective HTTP work, not unique memory records or model calls.

Reusable stopped pair, relative to `H:/TakiAgent`:

```text
.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/application-ad325c12054d4d92b91a81ad2b18fee1/data
.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/application-ad325c12054d4d92b91a81ad2b18fee1/application.sqlite
```

Use new private copies for later tests. `result.json`, `application-result.json`, before/after original-column and
current-table manifests and private Node/native logs retain evidence. This pair has a genuine copied first-activation
receipt and actual D77 publication; it still has no new W2 transition proof or completed return/reentry receipt.

The W3 real-data stage compares full original Local capture/mappings and current D77 projection/field closure.
Deterministic genuine W2 fixtures prove candidate boundaries. W5 still must perform an actual real-corpus transition,
current final maintenance and candidate join. New W2 maintenance may call the model for its actual requirements;
old D78 receipts cannot be relabeled as a current W2 proof. Do not synthesize proof, disable observations for a pass
or repeat extraction merely to prepare this dataset.

## Full real D77 projection and reference readback

The parent took ownership of this probe while the W3 implementer completed historical-reference code/tests.

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/inspect-reused-projection.mjs
```

Run `projection-de759cdd-48de-4b41-b35e-9abdef77b609` beneath the same private baseline **passed, exit0**. The helper
created a new SQLite copy of the stopped successful D77 pair. No native server, client, model or authority writer
was invoked. SQLite `total_changes()` remained0 and the source file hash was unchanged. An initial harness-only
import error pointed at the wrong Shared encoding module before opening any data; correcting the import allowed
the actual probe below to run.

Every stored native head was reconstructed through the production D77 projector from its exact decoded native/
artifact/body evidence and compared with the guarded repository projection. Memory facts and lifecycle fields were
also compared directly against native payload fields; policy/metadata/provenance were checked against application
originals without flattening typed values. Public memory-record reads included hidden/invalidated rows for complete
structural coverage, not a claim that those rows are normally recall-eligible.

| Actual current projection | Verified count |
| --- | ---: |
| Banks | 2 |
| Documents / Sources | 722 |
| Memory units | 1216 |
| Invalidated units, included above | 21 |
| Units with original policies | 722 |
| Additional units with explicit neutral, assessment-due policies | 494 |
| Mental models | 2 |
| Directives | 2 |
| Blocks | 2 |
| Memory-to-document references, each present in the same Bank | 722 |
| Memory-to-memory references, each present in the same Bank | 673 |
| Original typed metadata field comparisons | 5728 |

The Character Bank has951 units/562 documents/18 invalidated units; Global has265/160/3. There were no withheld or
missing current projections in this corpus. Projection digest:
`5a53cc016547e9def802d567bdc1d1546f4a31d6822ea3f72ddd7ed14b82af41`.
Private `result.json` retains counts and the copied database. These673 source-memory references are not the43,259
native graph-link rows: graph/history preservation is separately proven by the native table digests, not claimed
as projected SQLite graph coverage. This is current D77 structural evidence, not a newly forged W2 final proof,
a W3 Local candidate built from such a proof, or a completed real transition.
