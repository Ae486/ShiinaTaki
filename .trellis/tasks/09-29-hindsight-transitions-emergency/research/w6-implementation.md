# W6 implementation and source handoff

## Result and acceptance boundary

Whole-wave W6 source is ready for parent review and supervised actual-corpus execution. Offline emergency admission,
immutable capture/seal, surviving Local reconstruction, W4 atomic publication, original-identity restart, old-provider
isolation and current D91 paired recovery are implemented. This is SOURCE RELEASE of the implementation and owned
drivers, not W6 product/manual acceptance. The parent alone runs the new actual copies; the implementer has not read
or started those private copies. W7/W8, actual-corpus comparisons and owner/manual acceptance remain open.

Worktree: `H:/TakiAgent`, `main`, initial/current HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
Parent session binding: `codex_01a10bce-c98d-7930-a034-2842a2739758`. Empty legacy pointer was not rebound.
No commits, pushes, rebase/reset, dependency additions, archive/finish, original-user writes or Native production edits.

## Implementation surface

| Boundary | Delivered behavior |
| --- | --- |
| Shared / migration057 | Distinct offline preview, capture/incident/surviving evidence/candidate/publication; immutable quarantine and foreign history; atomic replacement of admission guards without rewriting earlier receipts. |
| Existing operation owner | Separately confirmed emergency, old-epoch healthy/replica/backup/lifecycle quarantine with truthful unknown, exact reentry receipt ownership and late-callback refusal. |
| Existing backup store | Snapshot-derived complete facts, original incident ID, fresh partial + atomic seal, digest/identity read-back, lost ACK reuse and no destruction of an earlier seal. |
| Candidate / COMMIT | Complete paired Native/application/body closure, existing W3 Local projection and mappings, explicit emergency proof in W4's existing outer authority/custody/queue transaction. |
| Runtime / producers | Synchronous old-authority retirement without waiting for unavailable Native; utility/compaction generations, ingestion, Pending/application, scheduler, lifecycle and backup late publication guards. Normal stop remains joined. |
| Restart / foreign branch | Original incident/capture/candidate/receipt/target epoch recovered after five SQLite boundaries; old Hindsight cannot auto-sync, recover or reenter Local. |
| D91 | Genuine route-b operation-owner capture/admit, actual encrypted catalog custody, current Native full-table restore and required trigger gates, complete Core pre-writer identity/body validation. |

Unknown Pending, parent/application requests and incomplete old ingestion retain their old epoch and exact original
row hash, not a manufactured Local success. Primary finalization during copy or after COMMIT before bind is assigned
once. Complete surviving evidence remains usable with pending historical setup; incomplete closure refuses honestly.
All actual Bank scopes are enumerated, including 301-scope coverage beyond the status display's256 limit. Missing
backup, unreadable inventory, incomparable history, remote-only loss and unavailable head stay distinct.

`w6-source-ownership.json` records the explicit review surface and exact source hashes. Its historical W5 hashes,
where available, are references, not a claim that every intervening dirty line belongs to W6. Unrelated preexisting
changes and parent-owned supervisors are preserved. Native dependency hashes identify the current producer exercised;
no W6 production mutation was made in `H:/hindsight`.

## Final executed gates

All TypeScript runs use at most two Vitest workers. These are actual executions, not projected or archived passes.

| Gate | Result |
| --- | --- |
| Final Core emergency/backup/publication/runtime/operation/boot/migration/activation regression group | 30 files,207 PASS,1 existing skipped;115.98s. |
| Shared transition/candidate/operation/backup schemas | 4 files,23 PASS;1.63s. |
| Complete lifecycle journey after current-contract correction | 22 PASS; included new hung provision/revalidate late-export cases. |
| D91 stage/seal/real fixture catalog/Core preflight process protocol | 1 PASS;17.48s total,9.90s test; all Core Native/transport/model dispatch counters0. |
| Two independent Node emergency/restart processes | PASS; original receipt/epoch/counters retained, zero additional dispatch. Included in final Core group. |
| Root `pnpm lint` | PASS. |
| Root `pnpm typecheck` | PASS across all configured packages. |
| Native transition backup | 2 PASS;27.32s; owned `stage4-native-tests/57109b92283e5f03`, stopped=true. |
| Native backup + application backup | 2 PASS;25.78s; owned `stage4-native-tests/f5bc1998c2def8a1`, stopped=true. |
| Current Native CLI synthetic backup/restore | PASS,56 full tables, required guards and exact modes; missing/R-mode cases refuse; no auto-retry; stopped=true. |
| Node syntax, Native helper Ruff E/F/I + format (line length120), task validate, diff/encoding/index | PASS; context-size warning described below. |

Final Core command:

```powershell
pnpm --filter @taki/core exec vitest run emergency hindsight-backup src/memory/transitions/transition-local-candidate.test.ts src/memory/transitions/transition-runtime.test.ts src/memory/transitions/transition-runtime-recovery.test.ts src/memory/transitions/transition-healthy-service.test.ts src/memory/canonical-local-write-fence.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/migrations/index-list.test.ts src/boot/memory-transition-boot.test.ts src/memory/operations/memory-operation-kind-transition.test.ts src/memory/operations/memory-operation-service.test.ts src/memory/hindsight-activation/hindsight-activation-service.test.ts --maxWorkers=2
pnpm --filter @taki/shared exec vitest run memory-transition hindsight-backup memory-operation --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/memory/hindsight-lifecycle/hindsight-lifecycle-journey.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/testing/memory-transition-paired-process.test.ts --maxWorkers=2
pnpm lint
pnpm typecheck
python .trellis/scripts/task.py validate .trellis/tasks/09-29-hindsight-transitions-emergency
```

The current Native commands, each run only on a new owned PG instance:

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/native_results/test_transition_backup.py
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/native_results/test_backup.py tests/native_results/test_application_backup.py
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-native-restore-smoke.mjs --run-owned-synthetic
```

Latest CLI synthetic root: `.trellis/.runtime/stage4-w6-restore/synthetic-8ea538d3-5c9f-47f6-a3d0-b7ba1ecfd677`.
Its full-history hash is `32145490fc2a264cd24445f43bec70135745064f67f832cd29368744a4e9703a`.
It proves all56table full rows, nonempty Bank origin, original modes, actual restored proof and source preservation.
Other Native tests prove retired/quarantined/deleted origin history, COPY rollback, stale executor guard refusal,
original partial append preparation/part/result recovery and complete application Source/Memory/Block bodies.

## Findings resolved during this wave

- Emergency following a committed-but-unbound reentry initially encountered the old Local publication. Synchronous
  retirement now withdraws that old Local binding only while Hindsight is selected; recovery never retires its new Local.
- Pending test initially used the obsolete Native-only reader; it now constructs the real D77 runtime state and its
  actual epoch/namespace guard. No production Bank validation was weakened.
- Emergency backup retirement initially shared normal stop cleanup behavior. It now uses a distinct authority reason,
  preserving ordinary scheduler restart/partial cleanup while forbidding old-authority resurrection.
- D91 trigger proof originally only rejected disabled existing triggers. It now requires the actual migration's full
  publication/association set plus admission/immutable history guards and O/A mode, tested with actual missing/R guards.
- Actual catalog initialization cannot rely on `SecretCatalogDeps.now` for set provenance: set allocates current time.
  Explicit owned fixture initialization uses the existing authenticated `sealCatalog`/`catalog.restore` path for the
  original test HTTP key/time, then real catalog read-back. No production secret code or fingerprint guard changed.
- Initial D87 test expected lazy new-Character Bank creation during a W4 fence. Parent verified that the current
  canonical-runtime contract forbids that creation. The corrected test proves unavailable capture/no new Bank,
  exact late primary custody, later `bank.provision`, once-only flush/ingestion and one model call. Existing genuine
  stale Local source mutation cases in activation-service tests remain passing; B4 production was not changed.
- Held old Run retain now returns structured `MEMORY_AUTHORITY_FENCED`, while retired recall rejects. Its stale test
  was corrected to the current writer-fence contract with unchanged no-provider-dispatch assertion.
- Windows credential test module import now uses a file URL. Early helper syntax/fixture errors were fixed before
  the passing process test; original synthetic diagnostic roots remain available, never relabeled actual acceptance.

## Parent execution and remaining limits

Use [D91 runbook](w6-d91-runbook.md), parent [emergency supervisor](w6-owned-emergency-runner.md) and
[paired supervisor](w6-owned-paired-restore-runner.md). Emergency driver uses `--phase emergency|restart`; each phase
is a distinct supervised Node process. Original failures/checkpoints are never cleared. D91 stage/seal constructs
the actual runtime without starting it, preserves the original fixture connection fingerprint and uses actual
encrypted fixture custody. This does not claim production-host or DPAPI secret portability.

Review exact captured/installed state before Local startup, then require real producer receipts/expiry input for
retention changes. The current audit refuses unexplained record membership/deletion; a real rolling-window hard
delete needs concrete producer evidence before extending that audit. Do not disable the sweeper or pin an expected
invalidated count. Foreign Hindsight reconciliation remains future work.

Trellis validation passes, but existing `memory-transitions.md` is33379bytes above the32768-byte injection limit.
The parent/checker must directly read the complete file; the new emergency contract is separate and below the limit.
No broad Native typecheck, original-environment restore, W7 Home or owner/manual acceptance was claimed.
