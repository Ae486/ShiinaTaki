# W5 snapshot renewal repair checkpoint

- Task: `09-29-hindsight-transitions-emergency`; Taki cwd `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Assigned scope: Core recovery repair only. Native checkout is read-only. No model request, service start, dependency or Git mutation.
- Parent owns real-test helper preparation, `leader-now.md` and `execution-status.md`.
- Original W4/W5 source inventories are immutable and will not be overwritten.

## RED checkpoint (2026-10-03)

Command: `pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-healthy-snapshot-recovery.test.ts --maxWorkers=2 --reporter=verbose`.
Raw exit: **1**; 1 file, 2 failed tests. Output: `w5-snapshot-renewal-red.log`.

Both tests use the real B2/B4 predecessor, healthy return, Local Bank creation, operation owner, production healthy
reentry and physical SQLite close/reopen with all Core owners reconstructed. Native transport remains a deterministic
double with the actual `HindsightApplicationRefusal` and the native `snapshot.py` same-request/page TTL contract.

1. A new Bank's application snapshot materializes, then its response is lost before its delta is prepared. Another
   Bank already has immutable preparation/effect/proof, so abort correctly remains forbidden. Advance 601 seconds,
   reconstruct Core and recover: the same request receives `snapshot_expired`, but recovery remains `outcome_unknown`.
   This isolated case holds the already proven Bank's executor live to distinguish the second defect. Reproduced twice.
2. Advance only 301 seconds (snapshot still valid), expire all nonterminal Native executors and reconstruct Core.
   Reacquisition changes an earlier proven Bank's live status; rebuilding its evidence produces a different evidence ID
   for the immutable existing Bank slot. Recovery raises `MEMORY_TRANSITION_CONFLICT` and remains unknown.

Native source confirms ordinary snapshots stay expired (`application_state/snapshot.py:190-223`), page reads use that
same guard (`:276-280`), and proven status still computes executor liveness from lease time (`transition_storage.py:286`).

## Ranked falsifiable hypotheses sent to parent before production edits

1. An immutable request permanently names an expired read-only materialization. An append-only successor request,
   created only after the typed expiry refusal, should repair case 1; non-expiry failures must not mint a successor.
2. Immutable proof evidence embeds volatile live status. Reusing previously verified evidence under the exact original
   request and sealed proof should repair case 2; changed proof or request must still refuse.
3. Core lease/configuration/source guards may reject stale ownership. The observed failures occur after those guards,
   making this a lower-ranked cause; the repair must preserve and explicitly exercise those guards.
4. Earlier delta replay might duplicate effects. Existing exact-history lookup should keep previous apply counts fixed;
   full-driver assertions will verify that prediction after repair.

## Delivery checkpoint (2026-10-03)

The parent relayed the ranked diagnoses before authorizing production edits. Both original RED cases now pass.
An additional parent-identified stale executor after mid-inventory claim was independently reproduced and repaired
by refreshing the executor before delta dispatch. Fifteen complete-driver recovery cases pass on the final production
code. No production changes were made for the Source timing investigation.

The existing Source integration test exceeded its30-second limit on both the byte-exact pre-repair candidate and the
repair. A diagnostic completed all original assertions at30.573s; the original test was restored. A smaller genuine
multipart fixture did not reliably fit30s and was withdrawn. After explicit parent review and user-facing disclosure,
the final test retains the original100,000-character payload and all old assertions, strengthens exact two-part
coverage, and uses a60-second limit for this integration test only. Final run: **exit0,1/1PASS,31.225s**.

Whole workspace typecheck and final Core typecheck passed. Final scoped ESLint passed. Root lint remains **exit1**
with the same seven pre-existing function-length errors and no new diagnostics. Context validation and whitespace
checks passed. Four fresh Legacy/Local boot/restart cycles passed with zero model requests.

Final report: `w5-snapshot-renewal-implementation.md`.
Final source inventory: `w5-snapshot-renewal-source-hashes.json`, SHA256
`f3d67950fc370905b07617e721a6948233cc4b77edecb309397963cd55ca4464`.
Six owned source/spec/index/test files;139 previous Core paths audited (four expected changes/two new files),355 Native
paths unchanged, nine original manifests preserved. All temporary baseline/timing source toggles restored exact
preimages; the final reviewed Source timeout/two-part assertion are deliberate recorded changes.

Next: parent dispatches independent review of the six owned files and measured test-budget decision. Real-model and
reused-real-corpus continuation remains parent-owned and must wait for independent checking. Native code, original
data, original W4/W5 inventories, Git history, task lifecycle and W6-W8 remain untouched by this repair agent.
