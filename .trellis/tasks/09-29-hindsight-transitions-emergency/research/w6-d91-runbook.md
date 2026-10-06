# W6 D91 paired recovery runbook

## Status and boundaries

Actual execution passed on2026-10-06; see [final W6 report](w6-final-result-2026-10-06.md) and its machine-readable
evidence. The owned root`stage4-w6-restore/06f1a45b700f447aa313d355ee94f35e` completed every step below and stopped
all processes. Its create-only runner must not be invoked again. This completed drill does not authorize original
environment replacement or establish user/DPAPI credential portability.

This is a current-code operator procedure, not permission to replace original authority. Execute only against a
new owned `.trellis/.runtime/stage4-w6-restore/<id>/` copy, supervised by the parent. Preserve the stopped W5 pair
and every prior failed attempt. Do not start W5 directly, repeat corpus conversion, or apply Native-only rollback.
The actual corpus gate is reported by the parent after source release; synthetic results below do not replace it.

Emergency and paired restore are distinct drills. The emergency copy uses `<emergency-root>/core/taki.db`;
`<emergency-root>/application.sqlite` is the preserved W5 input. Never start its `<root>/data` before emergency:
the initial hash preflight would correctly refuse changed data. D91 uses another fresh copy, with its own PGDATA.

## Current interfaces and sequence

1. Require successful supervised emergency and independent-process restart, or an explicit parent decision to run
   the independent D91 drill. Keep the original incident/capture/receipt, full installed state hash, retention
   audit and zero additional Native/model counts. Do not turn a failed attempt into success by retrying silently.
2. With original Core/Native stopped, verify preserved W5 inventory/hash and copy its `data/` and
   `application.sqlite` to a fresh D91 root. Make a separate work Core at `<root>/core/taki.db`. Keep the source
   input byte-identical. Parent records file count/size/hash, source identities and new root before starting anything.
3. Prepare custody explicitly. Original W5 used the known test HTTP credential adapter, not a disk Secret Catalog.
   For this drill the parent creates a new owned 32-byte master key in an owned credentials directory. Stage's
   `initializeOwnedFixtureCustody:true` creates a new host identity and real encrypted Secret Catalog containing
   only that original fixture HTTP key/provenance. This proves fixture custody through the actual catalog engine;
   it does not prove production-host/DPAPI portability, recover Native model credentials, or inspect user secrets.
   Normal operator use instead supplies its separately preserved matching catalog, host ID and supported key source.
4. Stage a real route-b backup through the existing operation owner:

   ```powershell
   node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-core-capture.mjs --run-owned-pair --plan <capture-plan.json> --phase stage
   ```

   The helper checks the initial Core SHA, applies current additive migrations to the work copy, verifies the
   actual configured fingerprint against copied reviewed state, and constructs the real Hindsight runtime idle.
   It never calls `runtime.start`. `backup.capture` pauses its local owners and creates the genuine staged Core,
   identity, terminal-operation list, Native request and actual custody record. It then stops/closes everything.
   Native/model/transport counts must all remain zero. `paired-capture.json` records the original backup ID,
   operation ID, request path, artifact SHA and stopped working-Core SHA; `stage-result.json` must be complete.

   Capture plan fields:

   ```json
   {
     "ownedRoot": "<repo>/.trellis/.runtime/stage4-w6-restore/<new-id>",
     "coreStopped": true,
     "coreDataDir": "<root>/core",
     "coreDbPath": "<root>/core/taki.db",
     "expectedCoreSha256": "<verified initial work Core SHA>",
     "initializeOwnedFixtureCustody": true,
     "connectionEnv": {
       "TAKI_HINDSIGHT_ENABLED": "true",
       "TAKI_HINDSIGHT_DEPLOYMENT_MODE": "existing-instance",
       "TAKI_HINDSIGHT_ENDPOINT": "http://127.0.0.1:18496",
       "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS": "60000",
       "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS": "120000"
     },
     "nativeArchivePath": "<root>/native.zip",
     "nativeResultPath": "<root>/native-restore-result.json"
   }
   ```

   These connection values retain W5's reviewed fixture identity; the helper cannot send to that endpoint. Parent
   supplies `TAKI_CREDENTIALS_DIRECTORY` naming only this root's owned key directory, never raw keys in the plan.
5. Start only the copied PostgreSQL on a free loopback port. Validate exact PID/executable/start time and actual
   `SHOW data_directory`; no other client/session/Core/worker may use it. Parent's owned supervisor handles process
   startup/stop. Invoke the Native helper with the stage's original Native request:

   ```powershell
   & H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-native-restore.py --run-owned-restore --plan <native-plan.json>
   ```

   Native plan: `ownedRoot`, `coreStopped:true`, owned `databaseUrlFile`, `sourceSchema:"public"`, and
   `nativeRequestPath` from `stage-result.json`. It uses existing `_backup`, migrations and `_restore`, preserves
   source schema and restores into fresh `w6_restore_<uuid>`. Full sorted row bytes of every `BACKUP_TABLES` table
   and all trigger modes must match; required transition guards must exist and run O/A. It rereads actual restored
   `read_backup_proof` and joins the original archive request, not merely counts. It records a create-only attempt
   marker and sanitized result. Stop the owned PG in `finally` and verify it is stopped before continuing.
6. Seal the real pair through the original `backup.admit` operation owner in a second Core process:

   ```powershell
   node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-core-capture.mjs --run-owned-pair --plan <capture-plan.json> --phase seal
   ```

   It requires the stage's stopped Core SHA and same backup ID, copies the original CLI ZIP create-only to the
   existing store inbox, deeply verifies its per-entry hashes, and lets the production admit/store write the
   sealed manifest. No hand-composed manifest or credential-presence stub is accepted. `seal-result.json` names
   the final pair directory. Preserve original Native archive/result and stage result.
7. Run the complete Core pre-writer preflight with actual catalog access:

   ```powershell
   node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-core-restore.mjs --run-owned-preflight --plan <preflight-plan.json>
   ```

   Plan: `ownedRoot`, `coreStopped:true`, `pairDir` from seal, `nativeResultPath`, `nativeArchivePath`, and
   `custodyDataDir:<root>/core`. It uses the current configured key mechanism with key creation disabled. Catalog
   host AAD, health and required refs, Core SHA/bytes/migration/authority/receipt, actual Bank set/generations/native
   and application checkpoints, terminal receipt scope and full retained Source/artifact/body closure must pass.
   Source schema identity stays the archive's `public`; actual target schema is separately recorded. It reads no
   credential values into reports and constructs no runtime. Input files remain byte-identical.
8. A production replacement is a separate operator action after all gates: stop Core/Native workers and stale
   executors, retain current files for rollback, install both exact artifacts and matching custody, rerun identity
   gates before enabling writers. Original unfinished native effects recover by original operation/part/result
   lookup through current Pending/parent recovery; never reissue as a new request. The current owned fixture tests
   prove partial-operation recovery and guard refusal; actual corpus need not manufacture an unfinished effect.

## Refusal and rollback handling

Missing/locked catalog, wrong host/key, absent original pair, changed Core/archive, schema/build/revision mismatch,
missing Bank/body/receipt, Native behind Core, missing or R/D writer guard, extra live client or changed source
leaves all Core writers gated. Keep failed result/marker/files and diagnose; create another explicitly reviewed
attempt if necessary. Never overwrite a complete result, reset cumulative counters, delete a valid incident, or
mark Native-only restore accepted because a full replica rebuild appears to work.

Ordinary late-primary custody and legitimate Local retention are distinct from data loss. Compare installed state
before Local startup, then require exact producer receipts and expiry inputs for each subsequent lifecycle change.
Unproved membership/deletion cannot be excused as drift; rolling-window hard deletion needs its own concrete audit.

## Evidence and limits

Current deterministic coverage includes all five SQLite seal/ACK/COMMIT/bind reopen boundaries, held Pending/parent/
application identity and late rejection, primary finalize races, full Native history/trigger preservation, COPY
rollback, original partial-operation continuation, complete Source/Memory/Block bodies and credential gate refusal.
See `w6-implementation.md` for exact commands/results and parent-owned reports for actual reused-corpus outcomes.
No original user authority replacement, broad Native typecheck claim, W7 UI acceptance or owner/manual signoff is
implied by these results. Fixture HTTP custody is explicitly separate from production secret portability.
