# Maintenance Run Monitor delivery

## Delivered behavior

Home Run Monitor now separates **normal chains** and **background maintenance**. Tidy and conversation compaction
use their existing operation records; the background detail shows status, progress, elapsed time, attempts where
available, explicitly associated model calls, known input/output tokens and coverage. It issues no execution commands.
Manual and automatic Local/Legacy tidy share the same operation owner. Compaction retains its existing lease and retry
semantics. Closing the UI does not stop work; reconnect reloads durable facts. Disabled Monitor withdraws details.

Normal cache excludes exactly `source='utility' AND label IN ('tidy','compact')`. Other existing auxiliary producers,
including Legacy pre-summary flush, retain their prior treatment. Normal Run counts and latest-primary input attribution
retain their original sources. A successful primary summary still resets the normal cache window.

## Persistence and tradeoffs

- Migration068 adds optional operation association and cache baseline population metadata. Original usage, memory and
  operation rows remain intact. Old provable baseline windows are reconstructed; ambiguous regular-call ties or unknown
  timestamps stay unavailable until a new natural summary captures an exact boundary.
- Utility task IDs remain per-dispatch. Only explicit operation links contribute to an operation's usage; no timestamp
  guessing and no use of the process-wide tidy outcome usage counter. Old unlinked histories remain unknown.
- Legacy does not measure checked-memory counts. Those fields remain unknown instead of zero. Partial known token sums
  carry known-count coverage. No measured compression ratio is available, so none is invented from character counts.
- Browsing uses 25 operation rows and 100 call rows per page. Compaction order uses its first immutable event so retries
  cannot move a record across pages. Read subscriptions are separate from ordinary Run/cache subscriptions; no polling.
- Existing independent migration069 appeared during validation. It was preserved; this task owns migration068. A stale
  exact migration-receipt count was advanced to the current 68 applied versions (version59 remains reserved).

## Verification

Environment: Windows, `H:/TakiAgent-worktrees/t4`, Node24.18.0, pnpm10.22.0, current t4 branch. All runtime data below is
synthetic and isolated. No real provider calls or live database mutation were needed for this monitoring follow-up.

| Check | Evidence |
| --- | --- |
| All-package typecheck | Passed; `target/maintenance-monitor-typecheck.log` |
| Core full regression | 4675 passed / 6 skipped; `target/maintenance-monitor-core-final.log` |
| Shared / CLI full suites | 727 / 50 passed |
| Desktop full suite | 1375 passed; final affected Monitor rerun 25 passed |
| Root source lint | Passed; established archived-artifact exclusion, `target/maintenance-monitor-lint.log` |
| Rust Clippy | Passed with `-D warnings` |
| Actual Core main + real WS + production MonitorPage | 7 browser cases passed, including narrow layout and reconnection |
| Independent final review | `maintenance-monitor-final-review.md`; both verified findings fixed |

Commands:

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm --workspace-concurrency=1 -r test --maxWorkers=4
pnpm --filter @taki/core exec vitest run --maxWorkers=4
pnpm lint --ignore-pattern 'artifacts/**'
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
node .trellis/tasks/11-06-memory-tidy-reliability/research/verify-maintenance-monitor.mjs
```

The established lint command excludes archived source snapshots under `artifacts/`, not production code. An initial
unbounded parallel run produced resource-related timeouts and a file-open failure. The first bounded run also loaded
mixed source generations while migration069 and the final Legacy fix were being edited. Those results were not used
as final acceptance; the stable Core rerun and affected tests above are authoritative. No timeout expectation was relaxed.

Browser artifacts: `target/maintenance-monitor-1793945960283/` contains Core logs, isolated SQLite, seven screenshots
and `evidence.json`: normal metric50%, tidy partial progress/call usage, narrow tidy, compaction failure, reconnect,
disabled withdrawal and restored normal metric50%. The fixture seeds an exaggerated process-wide tidy counter and
checks that the UI instead displays its proved20,000-token associated call. Both normal and background UI use actual
production components/hooks/client/server methods. Earlier fixture-driver attempts failed before React mounted because
the driver used an incorrect config subscription method; correcting the driver to `subscribeConfig` resolved it.

## Operational limits

Restart Core and Desktop from this t4 checkout to use the new source. Existing packaged binaries are unchanged.
Older operations can show status while their per-operation model usage remains unknown. Human acceptance is pending;
browser automation is not user acceptance. No commit, push, archive or deployment was performed.
