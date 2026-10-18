# B3 Core and Shared independent review

Reviewer: `/root/core_independent`. Review continued through 2026-10-13 UTC under the existing
Stage 5B authorization. Repository: `H:/TakiAgent`, branch `main`, HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.

Status: **static review and owned corrections complete; capacity, all 26 Healthy cases, all 10
capture-sync cases and current Core typecheck are verified**. Root owns final workspace lint,
remaining whole-workspace checks and combined Stage 5B acceptance. The original failed full Core
result remains unchanged; its final source/evidence reconciliation is a separate root gate.

## Scope and evidence boundaries

The review loaded the task PRD, design/implementation and continuation artifacts, all 47 curated
`check.jsonl` entries, the before-development/check/diagnosis guidance, and the accepted B1/B2
independent reports. The session-bound task remains `10-07-hindsight-template-lifecycle`; its empty
global task pointer is expected and was not changed.

Owned review scope covers Shared B3 contracts and Core capture, copied-state reconstruction,
admit/verify/restore/readiness, healthy association/recovery/publication, necessary fixtures and
backend contract/index synchronization. Native and Desktop production were read-only. The seven
accepted trusted-label files and Native-owned lifecycle specification were not edited. No nested
agent, original instance/data/credentials, real provider, new dependency or Git mutation was used.

Unchanged B1/B2 behavior reuses its accepted evidence. Review concentrated on the actual B3 paths
and their interactions with those boundaries. Root's serial check slot covered the authorized
capacity regression, bounded Healthy/D2 diagnostics, complete Healthy/capture-sync regression and
current Core typecheck. It was returned immediately after the final typecheck ended.

## Findings (fixed)

### C1. Capacity setup did not produce a valid canonical Character Bank identity

- File: `packages/core/src/memory/hindsight-backup/hindsight-template-backup-capacity.test.ts`.
- Evidence: `b3-core-resume-consumer-capacity-final-01` completed with exit 1: all nine consumer
  cases passed, while the capacity case failed at its first 256-Bank capture with
  `HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED`. The retained wrapper duration is 134.119 seconds.
- Cause: its additional rows joined `character:capacity-character-<n>` to invented Native IDs
  `capacity-<n>`. The real capture calls `readHindsightCaptureState`, then the template attestation
  reader and `TemplateBankIdentitySchema.parse`; that schema requires the canonical Bank binding.
- Fix: import the existing `hindsightBankBindings` helper and obtain each added Character Bank ID
  from `hindsightBankBindings(characterId)[1].externalBankId`.
- Scope: the original 256/257 backup bounds, 1024/1025 healthy-identity bounds, successful copy,
  rejection before copy, foreign-key checks and 60-second test budget remain intact. Production
  guards, schemas, leases and deadlines were unchanged.
- Before SHA-256: `ab5b6b9b9772e2be0dd2867bdde529fc15bc66bd0b02fe260e6b8ad9e260d59d`.
- After SHA-256: `3a70f0694a48a72e567061c37c39015ae9a9a60224f3161c9fc33d800985dfa2`.

### C2. RETURN drift asserted uncertainty after a positively proven source abort

- File: `packages/core/src/memory/transitions/transition-template-healthy.test.ts`.
- Evidence: all ten RETURN drift cases reached their final status assertion in the original
  full suite, with fault injection and the complete before/after row comparison already passing.
  The isolated selected selection-drift diagnostic additionally captured a non-null failed
  transition result, no receipt/authority commit, complete `source-aborted` resolution, both
  Native Bank aborts and the original published source epoch.
- Contract: with its live lease, this RETURN path can prove safe source abort and reports
  `failed`, `runtime:source`, `queue:settled` and `MEMORY_TRANSITION_UNAVAILABLE`.
  The prepared REENTRY and final-lease-exhaustion cases in this matrix remain `outcome_unknown`.
- Fix: retain the full-row rollback and use existing `toMatchObject` / `readTransitionResolution`
  to require the non-null failed result and matching `source-aborted` resolution only for RETURN
  drift. No helper, Native proof reimplementation or extra matrix was introduced.

### C3. Local test deadlines could expire before complete assertion/cleanup lifetimes

- Files: `transition-template-healthy.test.ts` and `hindsight-capture-sync.test.ts`.
- Evidence: the original full suite had fifteen Healthy timeouts, including removed RETURN
  reaching 164.274 seconds and removed roundtrips reaching 279.016 seconds. D2 independently
  reproduced its default-5000-ms timeout with one worker. A timed-out positive callback continued
  after teardown and overlapped the next case; its late lease-loss status was not accepted as an
  independent production defect.
- Discriminators: the isolated positive with a temporary 180-second envelope completed RETURN
  and REENTRY in 59.776 seconds with both results/resolutions complete and no error logs. The
  original D2 with a temporary 30-second CLI envelope completed every assertion in 3.493 seconds.
- Fix: root approved only local test envelopes: selected RETURN 60 seconds; selected positive /
  REENTRY with prior RETURN 180; removed RETURN 240; removed positive / REENTRY with prior RETURN
  360. D2 alone uses 15 seconds. Every fake/production clock, lease, runtime deadline, preview TTL,
  remaining capture-sync test budget and global test default is unchanged.
- All temporary probes were removed. The final two-file diff is
  `b3-core-healthy-capture-final-proposal-01.patch.txt`; guarded application is recorded in
  `b3-core-healthy-capture-final-applied-01.json`. Its 2417-input comparison changed only those two
  tests, and both resulting hashes exactly match the reviewed proposed images.

## Findings (not fixed)

No additional concrete production defect or unresolved product decision was identified within
this reviewed scope. Root synchronized the existing Healthy spec paragraph after both Core gates;
remaining workspace gates are not an accepted overall Stage 5B result.

## Actual paths checked

| Boundary | Review conclusion |
| --- | --- |
| Strict Shared wire | Separate v1/v2 request, proof, archive, manifest and observation schemas preserve historical v1 semantics. Complete original Apply/receipt commitments, eleven backup hash domains, duplicate/version/extra-field checks and distinct request/Apply/proof/manifest limits are explicit. Larger transport limits are confined to backup calls. |
| Copied Core | Capture checks the admitted configured connection, raw Bank setup inventory, template/default/history/publication/hold state and exact incarnation. Completed-copy reconstruction is shared by capture, admission, historical verification and restore; live state is reread after copy and before dispatch/sealing. Missing history cannot become an empty selection. |
| Native/Core pairing | Complete receipt inventory is separate from requested operation membership. Selected Apply identity, independent database facet, inherited configuration and full definition projection must agree. An explicit removed overlay remains a selected `none` history. Current configuration readiness and historical pair integrity have separate verdicts. |
| Actual consumers | The nine retained cases use real Core capture, route-b admission, native-host verification, restore and D91 preflight. They cover selected/unselected/removed history, unknown dispatch and missing hold, re-pinned corrupted copied state, changed ZIP identity/inventory/membership, and current target drift before the writer-start trap. |
| Healthy identity and W2 | `transition-template-state.ts` commits complete state with separate 1024-scope healthy bounds. `transition-template-auxiliary.ts` independently reconstructs scoped Apply inventory and requested terminal refresh SQL markers. Associations bind original W2 evidence/proof, exact target incarnation, defaults and hold; unresolved new scopes cannot adopt previous ownership by Bank ID. |
| Recovery observation | Both saved W2 reuse and saved final-candidate reuse call fresh authenticated observation with the original request, a fresh nonce and original schema/per-Bank source context. Full inventory and definition facets are compared, then current Core state is rechecked. Historical association/candidate bytes are not replaced. A final candidate uses current fence/status, without repeating maintenance. |
| Final publication | `publishMemoryTransition` performs the complete publication reader, template association/current-state readback, then `requireTransitionLease` with `input.currentTime()`. It retains the original executor identity and exactly the receipt's one revision step. A failed final check rolls back authority, representations, custody, queue obligations and receipt together. Existing receipt recovery remains read-only. |
| W6 and B2 lifetime | The optional historical W2 verifier is synchronous and has no Native observer dependency. Emergency publication retains its separate offline path. The accepted detached-Apply shutdown fix and its regression sources remain byte-identical to the B2 independent release. |
| Fixtures and contracts | The complete Healthy fixture preserves independently held template receipt/result auxiliary rows before sealing Native proof after delta. It never rewrites persisted Core evidence. Existing production headers, relevant directory indexes, backup/Healthy/publication specs and the Shared named-export-only 625-line allowance agree with the implementation. |

The 26-case `transition-template-healthy.test.ts` matrix contains two complete RETURN/REENTRY
positives, four final-lease rollback cases, and twenty selection/default/hold/incarnation/scope
drift cases across both directions and selected/removed histories. Faults execute the real reader
before injection and compare all persisted table rows across rollback. All 26 cases passed on the
final source, together with all ten capture-sync cases, using the local envelopes documented in
C3. There was no test-name filter, CLI timeout override or temporary instrumentation in that run.

The dedicated healthy-publication lease tests additionally cover nonempty primary custody and
queued obligations, just-before-expiry commit, expired-receipt recovery, exact executor-field
drift, and an omitted live clock. Observer/scope tests cover fresh transport reconstruction,
stored-byte preservation, transaction-external I/O and independent terminal-child marker refusal.

## Preserved accepted sources

- Of the 85 Core/Shared TypeScript inputs in the B2 owned release, 83 are byte-identical. The two
  later B3 changes are `template-lifecycle-fixtures.ts` and the Shared public `index.ts` exports.
- All seven read-only trusted-label inputs match the accepted B2 source manifest.
- All 60 historical production migration source files match the B2 check-input baseline. The
  additional historical migration fixture also matches. No migration was rewritten.
- Immutable v1 remains `9d1f05100444af6c03f319df98cb04bfcf5bfe2504d0c059f2731ee531346952`.
- Migration 058 remains `17138f0f5e05691360331d8a51adcc99fe17f44a8dc0cbe166b576a93922f249`.
- Migration 059 remains `e50671c6311491b05ebf9d5c4bd348f8ad7e0265596b087ad480063cceaac55a`.
- The accepted `template-execution-service.ts` shutdown repair remains
  `f0b0847baad2df429d1ec66ffc0f7e02687c87b7723619ebb217bcd9ba00ba34`.

## Verification

| Check | Result and scope |
| --- | --- |
| Independent capacity regression | PASS, exit 0; 1/1 test, 10.053-second test body, 28.593-second wrapper. All 1599 recorded inputs were identical before/after execution. |
| Existing actual consumers | Reuse the nine passing cases from `b3-core-resume-consumer-capacity-final-01`; the overall original run remains exit 1 in history. Its only input difference from current source is C1's separate capacity test. These nine cases were not rerun or counted twice. |
| Shared typecheck | Reused current root PASS, exit 0, 19.750 seconds: `b3-whole-shared-types-01-result.json`; 2417 inputs, no drift or fixture leftovers. |
| Current Core typecheck | PASS, exit 0, 39.454 seconds: `b3-whole-core-healthy-capture-typecheck-01-result.json`; 2417 inputs, no drift or fixture leftovers. The earlier 82.125-second root pass remains historical evidence. |
| Current workspace lint | Pending root's single serial final check. Earlier scoped lint remains historical evidence only. |
| Complete Healthy/capture-sync regression | PASS, exit 0, 36/36 cases across both full files in 1515.516 seconds: `b3-whole-core-healthy-capture-tests-01-result.json`; 2417 inputs, no drift, empty TEMP removed. |
| Original full Core suite | Historical exit 1: 6 failed / 516 passed files and 31 failed / 4077 passed / 1 skipped cases. Root must join the separately owned four-old-test corrections with this final 36-case result and remaining gates; this report does not relabel the original result. |
| Native/Core physical restore | Root/Native-owned `b3-native-joint-06` passed customized and removed scenarios on its frozen joint input. This report does not relabel those checks as independently run by the Core reviewer. |

Exact independent invocation, from `H:/TakiAgent`:

```text
python .trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-core-source-check.py independent-capacity-01 H:/TakiAgent G:/Roaming/npm/pnpm.cmd --filter @taki/core exec vitest run src/memory/hindsight-backup/hindsight-template-backup-capacity.test.ts --maxWorkers=1
```

The actual child argv is retained in `b3-core-independent-capacity-01-result.json`. Its log,
before/after source manifests and `-cleanup.json` are retained under the same prefix. The isolated
TEMP root had zero leftovers and was removed. No reviewer-owned test or service process remains.
All older failure, interrupted-run and diagnostic artifacts are preserved. Root independently
removed the original full-Core run's four owned leftover entries after verifying its precise
boundary and absence of associated processes. `b3-whole-core-tests-01-cleanup-readback-01.json`
records that cleanup and confirms the original failed result's hash was unchanged; it is not a
pending cleanup item.

Final-source complete regression and typecheck used the existing whole-workspace recorder:

```text
python .trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-whole-check.py core-healthy-capture-tests-01 H:/TakiAgent G:/Roaming/npm/pnpm.cmd --filter @taki/core exec vitest run src/memory/transitions/transition-template-healthy.test.ts src/memory/hindsight/hindsight-capture-sync.test.ts --maxWorkers=1
python .trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-whole-check.py core-healthy-capture-typecheck-01 H:/TakiAgent G:/Roaming/npm/pnpm.cmd --filter @taki/core run typecheck
```

## Source freeze and release

`b3-independent-core-source-2026-10-12.json` retains the original Core/Shared inputs, reviewed-source
and accepted-baseline comparisons, relevant document/dependency hashes, the capacity correction,
and reused result artifacts. Its follow-up section records the final guarded Healthy/capture-sync
corrections, complete 36-case result, current Core typecheck and tested input identities. The
original 1599-input snapshot remains historical evidence rather than being silently overwritten.

The final Core/Shared comparison differs from that original snapshot only in six test files:
this reviewer's two corrected tests and the four old-test files separately owned by
`/root/native_independent`. Shared and Core production, fixtures, historical migrations, immutable
v1 and the accepted B2 repair remain unchanged across that comparison.

- Healthy final SHA-256: `2fcc757b3443abe2d1a5919339a6c0524d6eabecb198f0c271283effaf118918`.
- Capture-sync final SHA-256: `ae3b49e6c47ada489883eda36f2f586b41f8d9797805325c8d307c7486856c54`.

Core/Shared production and tests are frozen and released to root. This reviewer has no active
check slot. Only research reports and source/evidence records are updated after release; root
completed the subsequent existing-spec paragraph sync (SHA-256
`8bf92616b960d14a2d8f20ea2b17ee4823d5c471e9a91cba0dd4f0e2436393bd`). This documented
test-budget/result-state update is the explicit post-check documentation difference; it does not
change tested production or test bytes. Root must join final lint, full-suite/follow-up results and the other independent
reviews against the final source before accepting the automatic Stage 5B criteria. Installed,
original-data, real-model and manual product acceptance remain separate. No 5C work is authorized.
