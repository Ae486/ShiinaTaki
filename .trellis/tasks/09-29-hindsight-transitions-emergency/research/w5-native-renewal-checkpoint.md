# W5 Native renewal repair checkpoint

2026-10-03: implementation complete; worker stopped for parent independent review.

- Existing task: `09-29-hindsight-transitions-emergency`; no task or Git lifecycle mutation.
- Root cause: final atomic native/application snapshot Bank lock starved exact-executor renewal.
- Minimal repair: owner-row NO KEY UPDATE renew, live identity checks/CAS, locked claim expiry decision,
  transition-only RC with original canonical locks, exact live final-proof CAS. Ordinary/D78 RR unchanged.
- Evidence: RED lock graph; 12 new PG cases pass; affected broader run 26 pass/10 generic ML fixture setup errors;
  exact original ordinary-RR concurrent test reused through native fixture passes separately.
- Scoped Ruff/format/diff checks pass; 2 existing optional-value ty diagnostics remain and match preimages.
- All owned PG fixtures stopped/data removed. Real/work pair and original were never started by this worker.
- Parent owns supervisor shutdown overlay and future real resume. Last parent count 276/329 (53 remaining).
- Implementation/coverage/commands/limitations: `w5-native-renewal-implementation.md`.
- Source preimages: `w5-native-renewal-preimages/`; new inventory: `w5-native-renewal-source-hashes.json`.
- Next: parent hands Native + supervisor overlays to existing independent checker; no real-model test before that gate.
