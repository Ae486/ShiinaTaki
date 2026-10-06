# W5 snapshot recovery repair and staged helper independent check

Task: `09-29-hindsight-transitions-emergency`. Reviewer: `/root/w45_readonly_review`.
Checked on 2026-10-03 in `H:/TakiAgent`, branch `main`, HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.

**Verdict: PASS for the scoped repair and staged helper gate, under the existing seven root-lint length exceptions.**
The parent may resume the original real **RETURN only** using the authorized cumulative submission ceiling **329**,
preserving the existing **209** submissions. This is not a completed RETURN, overall W5 PASS, reentry budget,
manual acceptance, or permission to begin W6-W8.

## Scope and source identity

- Reviewed the complete implementation report/checkpoint, applicable publication and healthy-driver contracts,
  and `w5-repair-resume-2026-10-03.md`. The empty legacy task pointer does not replace the explicit existing assignment.
- Reviewed all six repair-owned source/test/index/spec paths and all four parent-owned helper paths. Compared helper
  changes against their exact preserved preimages. No production/helper/test source was changed by this checker.
- Independently verified the repair manifest SHA256
  `f3d67950fc370905b07617e721a6948233cc4b77edecb309397963cd55ca4464`, all ten current source hashes, the139-path prior
  Core overlay with only the four declared changed paths, all355 Native paths unchanged, and12 preserved input
  manifests including the three repair/helper inputs. Native remains read-only.
- New independent inventory: `w5-snapshot-renewal-independent-source-hashes.json`, SHA256
  `61f332f46c0941c6b6c84d568b5a19c5299bb1e7b285698a3bb77f9a97927ff6`.
  It records current file sizes/hashes and preserves every predecessor manifest instead of regenerating it.

## Findings (fixed by the delivered repair, independently verified)

### F1 - An expired unused-Bank snapshot permanently stranded recovery

- Files: `transition-unused-inventory.ts` and `transition-healthy-candidate.ts` under `packages/core/src/memory/transitions/`.
- The former fixed request slot could only replay a Native TTL-expired materialization after interruption. Earlier
  Bank preparations correctly forbade abort, leaving the original transition fenced and unknown indefinitely.
- The repair appends a predecessor-command-linked successor only after the actual typed `snapshot_expired` refusal
  from snapshot creation/page reads. It follows the existing durable leaf on restart, persists dispatch before I/O,
  and permits at most one renewal per Bank/invocation. Original request/delta/proof identities remain immutable.
- Before renewal and after loading, the current acquisition, admitted unused scope, lineage/generation, live fence,
  zero writers/accepted operations, absence of preparation, and Core source/configuration/lease are checked.
  W3 still verifies complete paired pages/body/hash/cursor closure. Missing/conflicting/foreign/untyped errors and
  body failures cannot enter the renewal branch.
- Fresh complete-driver tests pass for601-second expiry, lost renewed response plus physical reopen, original leaf
  reuse, page expiry, bounded repeated expiry, refused renewal, unchanged earlier preparations/evidence and no repeated delta.

### F2 - Live executor drift conflicted with immutable proven evidence

- File: `transition-healthy-candidate.ts`, `nativeEvidence`.
- A Native takeover changes live status even when the sealed proof is unchanged. Rebuilding the document would
  collide with its original immutable Bank slot.
- The repair fully reconstructs the stored evidence through `readTransitionNativeEvidence` and requires the exact
  original acquisition and entire sealed proof, exact Bank/transition, proven phase, no outcome and zero writers/work.
  Only then is the original evidence ID reused. A rehashed but divergent proof still refuses.
- Fresh physical-reopen tests independently cover successful301-second executor takeover and divergent-proof refusal.

### F3 - Inventory-time takeover left delta dispatch using an old executor

- File: `transition-healthy-candidate.ts`, immediately before `executeTransitionDelta`.
- The repair obtains the current fence/executor after inventory preparation while retaining the original prepared
  logical request. The regression applies Native's exact live-executor guard and passes without duplicate delta calls.

## Findings (not fixed)

None identified within this repair/helper gate. No new production defect was demonstrated during the independent check.

## Source test budget decision

Compared the current Source test against preserved original bytes with SHA256
`e9d84d52c534390b5c707f1935a773ff8b0b94abc0390ba8d0264808004cbc76`.
The only differences are the exact two-part assertion, explanatory comments, and this test's30-to60-second budget.
The original100,000-character multibyte body and every original assertion remain intact. No global/production timeout changed.

The recorded exact-preimage differential and30.573-second diagnostic support the parent's disclosed, explicit scoped
budget decision; earlier30-second failures remain failures. This independent run passed at17.193 seconds for the test
and24.54 seconds overall. That faster run does not invalidate the separately measured prior timing or require another
timeout change. No broad test was rerun merely to relabel an old failure.

## Staged helper review

- `w5-model-budget.py`: the default240 remains; an explicit positive finite integer changes only the cumulative
  ceiling. The counter is persisted before network await. Restart, cap increases and budget checks never reset the
  counter or clear a402 latch. Four fresh offline tests pass, with fake transports and no credentials/network.
- `w5-reused-native.py`: forwards the reviewed stage/cap, retains prior attempt logs and before/after evidence,
  requires actual Node success and absence of supervisor errors, stops its owned service pair, and verifies source
  preservation. Completed-step/action comparison uses whole-row hashes and Counter inclusion, so disappearance,
  mutation or duplicate-count loss cannot be hidden by new rows. No empty/failed inspection becomes a success.
- `w5-reused-driver.mjs`: return-only stops after the completed real operation, verified candidate and expected corpus
  assertions, before Local edits/reentry. Reentry requires the saved prior return and still checks its operation via
  `runDirection`. A current error prevents exit0 even if an older completion flag exists. Original transition/recovery
  identity handling and the conversion-request refusal remain intact.
- Independently parsed all three Python helpers and ran Node syntax checking. Read and checked the parent's existing
  zero-model supervisor evidence for attempt `49db9448fb3b4b73b17a1224fd06d861`: return stage/cap329,9 complete steps,
  59 actions preserved, model requests0, original source reported unchanged and services stopped. That was the parent's
  executed supervisor probe, not a new execution by this checker.

## Fresh independent verification

| Check | Actual result | Evidence |
| --- | --- | --- |
| Snapshot recovery, maintenance and reconstruction |3 files/22 tests PASS, exit0,82.46s overall; at most2 workers | `w5-snapshot-renewal-independent-core.log` |
| Original multipart Source integration, separately |1 file/1 test PASS, exit0,17.193s test/24.54s overall;1 worker, no heavy concurrent check | `w5-snapshot-renewal-independent-source.log` |
| Offline cumulative budget and billing latch |4 tests PASS, exit0 | `w5-snapshot-renewal-independent-budget.log` |
| All five workspaces typecheck |PASS, exit0 | `w5-snapshot-renewal-independent-typecheck.log` |
| Root lint |exit1; exactly7 existing `max-lines-per-function` errors,0 warnings, no new diagnostics | `w5-snapshot-renewal-independent-lint.log` |
| Four changed TypeScript files, scoped ESLint |PASS, exit0 | `w5-snapshot-renewal-independent-scoped-lint.log` |
| Node syntax / three Python AST parses |PASS, exit0 | Tool trace |
| Source hashes, UTF-8/no BOM, trailing whitespace, tracked diff check |PASS; unrelated existing CRLF notices retained | New independent inventory and tool trace |

The seven root-lint functions remain `createHindsightRuntimeBinding`, `composeMemoryRuntime`, `selectMemoryRuntime`,
`createHealthyTransitionService`, `projectTransitionLocalBank`, `createTransitionNativeSession` and
`createMemoryTransitionRuntime`. Root lint is not globally green.

## Continuation boundary and limits

Read-only final preflight found the original working copy stopped, no PG owner PID, cumulative counter209 and no402
latch. The checker started no Native/PG/model service, changed no credentials/cap, touched no original corpus and made
no Git/task lifecycle mutation. The repair implementer's four zero-model boot cycles were reviewed as prior evidence,
not independently repeated here. Synthetic Native envelopes demonstrate Core recovery, not actual Native/model E2E.

The passed gate permits the parent to resume original transition
`df47f32c-48a8-47bc-9792-2e24e8642084` on the existing exclusive working pair with `--stage return --submission-cap329`.
Keep the original terminal operation, original acquired identities, completed steps/actions and cumulative counter.
Stop at the genuine return result, inspect it, then establish a separate reentry bound before any Local changes/reentry.
Overall W5 remains INCOMPLETE until the required real return/modification/reentry and preservation checks complete;
W6-W8 and owner/manual acceptance remain separate.
