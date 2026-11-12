# Verified engineering baseline delivery

The main/T4 engineering integration and gated first alignment are complete. Application merge commit:
`95ce75eed5baedfd3c4f35f3fb1ade48a54a678c`, with exact parents main `9b98794` and T4 `63faf81`.
The G integration branch, H main and H T4 were verified clean at the same commit/tree. Both original histories
are retained; alignment used fast-forward only. The current session is bound to the existing integration task
in G and H main. No original task was archived and no real profile was upgraded.

## Evidence

- [Alignment/dependency/backup receipt](baseline-alignment-receipt-20261112.json)
- [Final independent whole-integration review](final-continuation-check-20261112.md)
- [Complete connected journey](connected-journey-acceptance-20261112.md): 24/24 stages, natural teardown,
  actual Native/PostgreSQL/Home/Core with controlled models; minimum sampled available RAM 2.072 GiB.
- [Current process E2E](test-e2e-final-20261112.json): 26/26, zero failures/skips, ten files, 184.358 s.
- Current lint and seven workspace typechecks pass. Final full TS reports record 8,960 passed and eight
  conditional skips; codec declares zero tests. Rust receipts record 225 library/seven binary tests and clippy;
  Desktop build records production assets and a debug application, without an installer bundle.
- Frozen stopped-copy replay reaches migration077/governance4 while preserving seven valid Approvals.
  Original frozen database hash was read back unchanged after alignment.

## Dependency layout and reproducibility

Both original H layouts completed `pnpm install --frozen-lockfile --ignore-scripts --offline`, with no downloads.
Core dependency imports and the QQ import-only ESM client pass in both layouts; no Core service, live database,
credential helper or model provider was started by these module checks.

The T4 retry required an additive `H:/TakiAgent-worktrees/QQMessageMonitor` junction to existing
`H:/QQMessageMonitor`, because the integrated pnpm lock's `../QQMessageMonitor` tarball path otherwise raised
ENOENT in the nested checkout. The already reviewed client tarball hash remained exact; no source, crate,
lockfile or real data was changed to repair the environment. G retains its equivalent companion alias.
This is a development dependency-install prerequisite, not observed proof of a required product setting.

Git checkout normalizes configured text line endings. Passing test reports retain original run bytes/hashes;
[formatting receipt](precommit-formatting-20261112.json) records the two EOF-only source cleanups. Source/spec/
current documents pass staged whitespace checks; 112 frozen historical artifacts and eight raw current logs
retain explicitly inventoried whitespace without claiming global archival cleanliness.

## Open product work and scope

The canonical [Hindsight change handoff](../../08-09-hindsight-memory-provider/research/main-t4-integration-20261112.md)
records actual integration ownership, reasons, changed boundaries and validation. The canonical
[startup blocker ledger](../../08-09-hindsight-memory-provider/research/startup-configuration-blockers.md)
keeps HS-START-01/02 open: prepare embedding and reranking after startup, keep settings reachable, preserve
accepted writes/authority and verify each absent/invalid model separately with real producer retry/readiness.
The successful configured journey copied both caches before boot and cannot close these requirements.
`docs/deferred-decisions.md` links that owner-requested follow-up without duplicating its status.

Actual QQ observation, Pet/WebGL, real-provider inference, installer/manual and large-library acceptance remain
separate. Real-profile upgrade, external push/release and original-task archival were not performed. The task
stays available for owner follow-up; engineering completion does not imply those broader product acceptances.

Final documentation commit and aligned ref identities are recorded externally at
`G:/taki-codex-work/main-t4-alignment-20261112/receipt.json`, avoiding a commit recording its own future hash.
