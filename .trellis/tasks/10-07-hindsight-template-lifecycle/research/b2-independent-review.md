# B2 combined independent acceptance

Status: **PASS on 2026-10-09**. The independently released Core and Native/trusted-label scopes are reconciled
on current source. This accepts B2 and releases the approved B3 implementation; it does not accept whole Stage 5B.

## Reviewed outcomes

- Core: `b2-independent-core-review.md` and `b2-independent-core-final-source.json`. The review reproduced and
  fixed a detached Apply outliving SQLite after W6 and normal shutdown. The existing bounded-work helper now
  settles the executor before close and abort immediately revokes its timers. Ordinary stop and actual W6 close
  regressions pass. Six valid final-readback drift injections prove complete local publication rollback.
- Native/seven-file label: `b2-native-label-independent-review.md` and
  `b2-independent-native-source-reviewed-final-01.json`. Accepted N1 revokes trusted origin after Bank read/config
  fallback; N2 preserves raw JSON field uniqueness and rejects repaired/unproven parser output as label authority.
  Both fixes and their exact-version producer/consumer evidence remain unchanged.

## Verification and reconciliation

| Scope | Evidence retained on its verified source |
| --- | --- |
| Core affected independent regressions | 93 non-overlapping passes: 80 unchanged-file cases from green-02 and 13 final rollout cases from green-03. |
| Core static checks | 87 scoped ESLint files and Core typecheck pass; diff check and owned fixture cleanup pass. |
| Native/label independent checks | Parser/provider 141, Native labels/storage/backup/HTTP 46, Core consumer 69; the first two batches overlap by 10 and are not summed. |
| Native static/generated checks | Accepted scoped Ruff/format, Linux-target types, actual HTTP-to-Core/SQLite reopen and 912 canonical generated artifacts remain valid. This is not a Windows-wide Native typecheck claim. |
| Earlier B1/B2 evidence | Unchanged compatibility/runtime, composition/storage, migrations, Shared/Desktop/CLI and isolated actual main/WS boot checks retain the scope stated in their implementation/review reports. |

Root's `b2-joint-source-readback-2026-10-09.json` verifies 2994 unique source/input/generated/evidence paths,
including the 101 Core owned files, 1939 Core frozen inputs, 242 Native files, seven label files and 912 generated
artifacts, with zero mismatches. Both repository HEADs remain unchanged. Removing only the added Core executor
lifetime spec section reproduces the complete previously accepted spec hash, including Native N1/N2 text.

Core final manifest SHA-256: `7207ebc61078a54e426240af2b1d6fc531debac1798e1294b982e0415b2e9b28`.
Native final manifest SHA-256: `96bfcd500d5b29230bb248dbf5ce3996f85a399d3bb131764ed66125127ec284`.
The original red, Windows launcher 9009 failure and intermediate fixture failures remain retained. No failed
run is relabeled as passing. Both review owners released their source and heavy-check ownership; no owned check
process or temporary test root remains.

## B3 release and remaining scope

Proceed with `b3-dispatch-plan.md` and `b3-resume-checkpoint-2026-10-09.md`. The original Core, Native and Home
implementers completed read-only handoff and found no unresolved contract gap. Core publishes the strict Shared
wire/hash fixture first; Native aligns its producer and canonical generation; Home consumes the already released
template operation/read contracts. Keep one heavy-check slot and at most two Vitest workers.

B3 must deliver the actual Home lifecycle, versioned paired backup/restore, current-target preflight and healthy
transition template association, followed by independent whole-slice reviews. Installed/original-environment
and owner/manual acceptance remain Stage 6. Stop after whole Stage 5B; no Stage 5C, original services/data/models,
dependency changes, commit, push, finish or archive are included.
