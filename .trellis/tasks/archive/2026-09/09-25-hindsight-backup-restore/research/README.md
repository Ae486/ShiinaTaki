# Research index: 09-25-hindsight-backup-restore

| File | Summary |
| --- | --- |
| [`stage3-seams.md`](./stage3-seams.md) | Stage 3 seams: native CLI backup/restore mechanics and Core state (§1), reusable primitives (§2), gaps G1-G12 (§3), capture/admit/verify/resume failure matrix (§4), proposed kinds, Core-first capture order, Hindsight write pause, `backupTo`, pair manifest/verifier, rollback detection, status/emergency seal, credential custody, error codes (§5), PR02 route comparison with recommendation and the one owner question (§6), waves W1-W5 (§7), automated vs environment evidence (§8), caveats (§9). |
| [`restore-drill-2026-09-27.md`](./restore-drill-2026-09-27.md) | W6 AC11 environment drill: route b and route c capture, isolated native restore into fresh pg0, restored Core on the captured `core.sqlite`, read-back, resume without a repeated native effect, behind-native rollback negative; two Core defects fixed, one intermittent native 500, observations. |
| [`restore-drill/`](./restore-drill/) | The W6 drill harness (`node restore-drill.mjs`), copied from the archived native-smoke harness, and its `evidence/`. |
