# B3 Core/Shared bounded-stop handoff

Status on 2026-10-10: **current Healthy/W2/W9 fixes and necessary self-checks complete; stopped at the owner's
requested boundary; no Core/B3 release or combined Stage 5B PASS**.
The owner's latest instruction is to finish the already active Healthy/W2/W9 fixes and necessary self-checks,
then stop. The remaining acceptance matrix is recorded below, not newly dispatched.

Workspace: `H:/TakiAgent`, branch `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
The authorized task is `10-07-hindsight-template-lifecycle`; the empty global pointer is not recreated.
Root owns task metadata and `docs/HANDOFF.md`; Native owns Native/generated source and the lifecycle spec.
Original services/data/credentials, real models, new dependencies, performance work, Stage 5C and
commit/push/finish/archive remain outside this implementation.

## Implemented source and file ownership

- Shared backup-v2 request, proof/body, observer, archive, manifest and healthy association schemas retain
  separate v1 parsing. The published wire fixture and separate request/response/manifest limits are preserved.
- `packages/core/src/memory/hindsight-backup/` owns versioned capture/staging/manifest assembly, copied-Core
  history/execution/publication attestation, common pair readers and explicit D91 preflight. These reconstruct
  actual immutable copy state; today's resolver cannot rewrite historical artifact integrity. Ordinary Native
  cursor progress is distinct from exact Apply inventory and selected-definition equality.
- D91 is an explicit read-only operator/harness preflight over the authenticated Native observer. It does not
  start writers, restore files, migrate databases or install an automatic boot hook.
- `transition-current-identity.ts`, `transition-template-state.ts`, `transition-native-evidence.ts` and the
  candidate/publication readers retain the separately versioned complete Core template/default/history/hold
  commitment. A matching Bank ID cannot transfer old ownership into a new Native incarnation.
- `transition-healthy-candidate.ts`, `transition-template-observer.ts` and `transition-template-evidence.ts`
  now reobserve each saved W2 document or saved final candidate before live reuse. The check preserves the
  original request, fresh nonce, original schema and per-Bank authenticated context, complete receipt inventory,
  selected anchor, database facet, inherited configuration and full definition projection. Current Core state
  is checked around I/O. Final candidates use current fence/status reads without repeating maintenance;
  original evidence/candidate rows and bytes remain immutable. Historical validation and W6 remain offline.
- `hindsight-template-backup-attestation.ts` exposes already verified receipts internally, without changing
  the wire/body. Healthy requests contain only the exact Bank's verified receipt and Core-observed terminal
  semantic-refresh IDs. `transition-template-auxiliary.ts` independently verifies each requested W2 marker's
  SQL child/Bank, target/request/child/model/definition, allowed terminal state and coherent result fields.
  This membership check is separate from the complete Apply inventory.
- The final production order remains `readVerifiedTransitionPublication` ->
  `assertTransitionTemplatePublication` -> the existing `requireTransitionLease(input.currentTime())`.
  The B2 detached-Apply shutdown repair is preserved. Neither lifetime nor lease guards were relaxed.
- The capture connection guard commits the actual configured revision/fingerprint/reviewed deployment mode
  and every raw setup column before `backupTo`, compares the completed copy and rereads before Native dispatch
  and sealing/staging. The configured joint seed is confined to
  `testing/hindsight-template-backup-joint-fixture.ts`; the generic B2 compatible seed remains unchanged.
- New/extended regressions are `hindsight-backup-capture-state.test.ts`, `transition-template-observer.test.ts`
  and `transition-healthy-publication-lease.test.ts`. Independent synthetic Native maps and complete W2 closure
  live in `testing/hindsight-template-observation-fixtures.ts`,
  `testing/memory-transition-template-evidence-fixtures.ts` and `testing/memory-transition-template-fixtures.ts`.
  The actual association producer and its complete history validation remain in use. Only the fixture work
  guard avoids redundant history reconstruction on every body read; it still checks the real lease and full
  configured connection/setup identity.
- Backend backup/healthy/publication specs and the backup/transitions/testing indexes document these contracts.
  The Native owner received the narrow lifecycle-spec amendment. The internal 1024-Bank healthy capacity and
  separate 256-Bank backup capacity are retained in source; the capacity boundary regression is still pending.

## Necessary closure evidence

Each prefix below has a retained `.log`, `-result.json`, `-source.json` and `-source-after.json` from the existing
credential-free `run-b3-core-source-check.py`. Source manifests cover every current Core/Shared TS/JSON and relevant
package/runner/root configuration input, not only B3 files. All checks below exited naturally, with no process kill.

| Evidence prefix | Result and duration | Actual boundary |
| --- | --- | --- |
| `b3-core-copied-readiness-red-02` | FAIL, 11.931 s; 1587 inputs, no drift | Reproduced `HINDSIGHT_BACKUP_READBACK_MISMATCH` on the joint fixture's compatibility-only connection. |
| `b3-core-copied-readiness-green-03` | PASS, 17.693 s; 1587 inputs, no drift | Same actual Core lifecycle/publication/copy path after the verified configured joint seed correction. |
| `b3-core-copied-capture-guards-01` | FAIL, 48.283 s; 1588 inputs, no drift | Fixture expectation omitted `mismatch: null`; removed-overlay setup exceeded its default test budget. |
| `b3-core-copied-capture-guards-02` | PASS, 9/9, 53.316 s; 1588 inputs, no drift | Full removed user model; compatible refusal; connection revision/fingerprint/mode and raw setup races before/after copying, dispatch and staging. |
| `b3-core-joint-configured-types-01` | PASS, 71.216 s; 1588 inputs, no drift | Core typecheck at that recorded capture-checkpoint source. |
| `b3-core-healthy-template-red-01` | FAIL, 8 actual assertions, 374.008 s; 1592 inputs, no drift | Missing per-Bank membership; stale saved candidate/W2 reuse; missing fresh reconstruction; four invalid terminal-marker cases. No fixture or timeout failure. |
| `b3-core-healthy-template-green-01` | PASS, 21/21, 69.828 s; 1592 inputs, no drift | Eight observer/W2 cases plus thirteen W9 publication cases. |
| `b3-core-healthy-legacy-reuse-01` | PASS, 1 selected / 14 deselected, 29.932 s; 1592 inputs, no drift | Existing sealed W2 reuse after proven Native executor expiry and reopened Core claim. |
| `b3-core-healthy-offline-w6-01` | PASS, 1 selected / 10 deselected, 30.121 s; 1592 inputs, no drift | Actual offline Local COMMIT/bind without credentials/backup or any new Native dispatch. |
| `b3-core-healthy-template-types-01` | FAIL, TS2345, 58.852 s; 1592 inputs, no drift | New fixture omitted the hash field required by the shared observation-value helper's parameter type. |
| `b3-core-healthy-template-types-02` | PASS, 56.514 s; 1592 inputs, no drift | Final fixture initializes the self-excluded hash slot, then derives the actual hash before response validation. |
| `b3-core-healthy-owned-lint-01` | PASS, 10.369 s; 1592 inputs, no drift | Explicit owned Core backup/transition/client/db/fixture and Shared backup/transition/export paths; `--max-warnings=0`. |
| `b3-core-healthy-observer-final-01` | PASS, 8/8, 70.271 s; 1592 inputs, no drift | Entire observer file on the final typed fixture bytes; selected observations and all negative marker/drift assertions retained. |

Final owned tracked whitespace evidence is `b3-core-healthy-owned-diff-02`; untracked-file UTF-8/BOM/whitespace,
index coverage and explicit reused-check input reconciliation are recorded separately in
`b3-core-healthy-owned-files-02`. Their command/result/log/source artifacts retain the actual exits; the latter
also writes a distinct `-files.json` inventory with the checked owned file hashes.
The first file check is retained as a failure: two missing index entries and one extra EOF blank line in the new
v1 schema file. Both navigation entries were added, and only the extra EOF newline was removed. That whitespace-only
Shared change is explicitly reconciled against the passing source hashes; it changes no schema or executable logic.

The eight observer cases include per-Bank receipt/refresh separation; fresh candidate rejection for nonce, schema,
context, inventory, database, inherited and full-definition drift; interrupted-W2 reuse; compatible transport
reconstruction outside transactions with unchanged stored bytes; and missing/wrong-request/wrong-target/pending
semantic markers. Synthetic Native envelopes establish Core joins only.

The thirteen W9 cases preserve the original eleven and add both directions after the actual template publication
read-back. These new cases are **template-aware unselected** paths, with nonempty primary custody and queue
obligations and whole-database rollback at `leaseUntil`. They do not establish selected/full-history W9 acceptance.
The later fixture type fix only initializes the selected-observation branch's self-excluded hash slot. Legacy/W6
do not use that helper, and the W9 extension uses its unselected branch. Their recorded evidence is reused on that
explicit boundary; the selected-observation file was rerun against the final fixture bytes. The later schema EOF
cleanup is the only additional executable-input byte difference from the passing types/lint/final-observer checks.

The removed-overlay capture test alone has a 20-second test budget, with its successful measured case at 12.934 s.
No production timeout or global test budget was changed. The slow initial Healthy red finished naturally after
374.008 s; an earlier suspicion of a blocked process was corrected when all eight real assertion failures arrived.

## Earlier evidence and joint limitations

The earlier `integrated-types-01` and `integrated-types-02` failures remain retained (legacy fixture/erasable
syntax/config-key diagnostics, then TS4058 for an exported fixture state). `integrated-types-03` passed in
31.315 s and `joint-entry-seed-01` passed the actual Node import/seed in 2.877 s, each with 1587 inputs and no drift.
`copied-readiness-01` passed in 10.518 s before the stronger configured-connection guard. These older passes are
not relabeled as final-source or Native acceptance; their original evidence and limitations remain available.

Native joint-01 failed before HTTP/Apply at Core module loading because the config-value validator lacked a public
Shared export; the export and actual CLI import were subsequently repaired. Native joint-02 reached the stronger
Core capture guard and failed on the compatibility-only fixture seed. The configured seed is now independently
green on the Core path, but joint-02 remains failure evidence: no managed CLI/physical-restore acceptance was reached.
No joint-03 is started under the owner's stop instruction.

## Pending, not dispatched

- Complete unselected backup-v2, corrupt/missing history, unknown effects/holds and the 1024/256 capacity boundary.
- Full real pair-consumer matrix: staged request/copy/ZIP mismatches, historical versus current resolver behavior,
  and fresh target nonce/schema/context/generation drift across every consumer. The new consumer test file
  `hindsight-template-backup-consumers.test.ts` was not created.
- D91 writer-start refusal traps and actual customized/removed Native physical restore with full original user
  models, receipt children, semantic markers and nonempty B2 provenance sidecars. No joint-03 or real service run.
- Full selected/removed Healthy RETURN/REENTRY cycles, selected/default/hold mutation at final read-back, complete
  incarnation and new-scope matrix, expanded v1/W2/W6 compatibility and preserved B2 shutdown regression matrix.
- Independent B3/Core and combined whole-5B review; full workspace/root quality gates; final runbook/installed/manual
  acceptance. No new reviewer or consumer/boundary test agent is dispatched.

These residuals block a Core/B3/5B release claim. Root retains overall acceptance ownership. This implementer stops
after the necessary handoff, with no continuing test process, new matrix work or task lifecycle mutation.
