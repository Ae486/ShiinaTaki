# Main/T4 Integration Design

## Baseline and Isolation

The integration repository is `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`, cloned with `--no-hardlinks` from main. Its frozen inputs are main `9b98794a673efb561682b9fd451fe1da2db95086` and T4 `63faf8119be1747b685aacf43529d754626ab35c`; their common ancestor is `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`. Original branches remain clean and frozen until final alignment. Modern `git merge-tree --write-tree --name-only` reports 267 conflicting paths; this preview changes neither index, worktree nor refs and is not a successful integration result.

An independent clone provides reversible work and retained original histories. A G-only companion junction to verified `H:/QQMessageMonitor` can satisfy T4's existing local package/crate dependencies without committing G-specific absolute paths. Dependency resolution must also be verified from both H worktree layouts. Install the reconciled lockfile; do not share mutable `node_modules` across differing graphs.

## Product and Responsibility Boundaries

Shared remains the schema and governance truth, Core the only SQLite writer and durable runtime owner, Rust Host the OS/permission boundary, and Home/Pet disposable clients. Resolve conflicts by function and invariant, preserving both original tests and accepted behavior. Main owns Hindsight authority, custody, deployment, operations, transition and policy-review mechanisms. T4 owns the accepted optional-model boot, live configuration, agent delegation and associated Tidy/QQ/Avatar behavior. These are integration authorities, not permission to choose an entire conflicting directory from one side.

Configuration flows from env/stored settings through Core's application tracker and runtime admissions to Shared observations and Home. T4's actual `config-source.ts` gives stored settings precedence over environment fallback, despite the stale bootstrap header. T4's `core-bootstrap.ts` uses provider `safeParse`, an optional model, independent feature validation and explicit unavailable observations. Preserve this boundary: missing or invalid feature inputs must not make the recoverable basic plane fail; dispatch must still validate readiness rather than use construction defaults as fabricated success. Preserve T4's revision-fenced live application and immutable admitted model bindings, documented per-setting live versus restart semantics, and main's Hindsight context/configuration observers. Hindsight endpoint/timeouts marked restart-required do not authorize replacing main's dedicated connection/transition owners.

Durable operation flows remain producer -> Core-owned evidence/settlement -> Shared status -> Home display. Preserve waiting, cancellation, restart reconciliation and factual native-result checks; no unknown metrics are represented as zero.

## Persistence Compatibility

Main's migration tail is 063; T4's is 072, with conflicting meanings beginning at 049. Current same-named production definitions through 048 are byte-equivalent after newline normalization; this does not eliminate supported older schema shapes. Both runners skip versions at or below recorded max. Keep main's canonical fresh 001-063 sequence and both historical exports/receipts immutable. Append feature-group guarded convergence at 073+, leaving 064-072 unmanufactured on fresh/main installs. Create missing final schemas and recognize current schemas, rather than blindly replaying T4's rebuilding/backfill chain against already-current tables. Dependency groups and exact hazards are documented in `research/persistence-lineages.md`; the final tail is assigned when concrete grouped DDL is reviewed.

Recognize complete known schemas and constraints before any rebuild. Preserve meaningful rows, values, identity fields, receipts, indexes/triggers and external dependencies; do not manufacture native/custody/approval evidence. Existing exact-schema branch machinery is preferred. Unknown or unmappable historical shapes refuse atomically. SQL, receipt and actual COMMIT failure must preserve the pre-upgrade state. Fresh, pure-main, pure-T4 and the recognized mixed frozen profile are separate validation cases; max receipt alone cannot identify lineage.

Retain T4's trigger schema-object recognition in the runner alongside main's transaction isolation. Checked deployment-mode/Timezone/cache columns do not fit the unconstrained nullable-TEXT helper. Preserve current marker/native receipts, parent/quarantine references, private sequencing and existing clock stamps through exact declared branches. Missing clocks may be initialized, existing clocks may not be reset.

Atomicity remains per migration, not the whole multi-group upgrade. A failed group rolls itself back; previously successful groups retain their receipts. Every declared partial boundary must safely retry/reopen and complete before Core composes feature owners. Tests must distinguish that existing contract from a whole-upgrade rollback claim. An unrecognized shape blocks the isolated upgrade and is reported; real-data rollout remains separate.

The frozen profile's reported receipt 72 / governance 3 / Approval 1 demonstrates why migration and registry versions are separate domains. Validate an isolated stopped-copy snapshot and preserve the original backup. The original `C:/Users/55473/.takiagent` and Credential Manager are never test targets.

## Governance and Approval

Allocate canonical union governance revision **4**: main revision3 and T4 revision1 have distinct additive cells, so neither describes the complete union. Preserve current descriptor/classifier/disclosure semantics. Historical revision1 was extended several times without incrementing the registry revision; supplied snapshots differ only by added once-only immutable Core cells, while rememberable Approval semantics agree. Freeze that evidenced effective revision1 Approval definition, prove agreement across all supplied snapshots, and retain exact revision3 history. No revision2 module is evidenced; unknown nonempty historical revision2 remains an explicit refusal rather than an invented alias. Retain the guard against a stored revision newer than supported code.

Core historical Approval resolution must resolve the exact frozen definitions needed by stored decisions, preserve valid bindings and durable decisions, and explicitly refuse unsupported or mismatched history. Coordinate Shared descriptors, Core policy migration/decision validation and Rust Host's complete projection/classifier validation. A constant bump or removal of the guard is not a solution.

## Dependency and Execution Compatibility

Reconcile manifests and lockfile deliberately. T4 advances AI SDK/MCP/openai-compatible pins and adds QQ native/client edges; main adds secret-catalog codec, installed-Host build/custody requirements and Windows features. Preserve all actual edges and verify against the chosen installed interfaces. Keep T4's current development startup semantics while preserving main's installed-Host build path.

Use controlled child environments with explicit G data roots, ports, user/profile directories and Native/PG configuration. **Environment overrides alone do not neutralize stored settings under T4 precedence.** Schema/data preservation checks run before any runtime launch. A separately prepared runnable copy must explicitly reconcile persisted provider/endpoints, schedules, initiative, autonomous drivers and credentials with the isolated test scenario, preserving a receipt of intentional test-only changes and avoiding secret values in ordinary logs. Never let restored original endpoints, timers or credential bindings invoke live services merely because `TAKI_DATA_DIR` changed. Fail the launch preflight when isolation cannot be established.

Ordinary developer startup against default profiles is forbidden in this task. One heavyweight stack runs at a time; low-memory conditions defer heavy execution until adequate headroom exists. No paid model/provider or external message is implied by engineering verification.

## Rollout, Rollback and Alignment

Integration occurs entirely in G. Before irreversible downstream effects, preserve source/ref receipts and verify Git ancestry. Failures are repaired in the integration branch without resetting either original worktree. Database tests are isolated and reproducible from untouched backups.

After the complete engineering gate, recheck original branch identities, dirty state and all matching Core/Desktop watchers. A live watcher could restart the new source against original data, so it must be stopped or otherwise isolated before working-file updates under the alignment authorization. Import the tested integration history, fast-forward both original branches where ancestry permits, and record exact aligned SHAs. Never force-reset divergent user changes.

Real-data rollout requires its separate authority, a fresh consistent backup, supported-version checks and an explicit recovery plan. Frozen data validation does not authorize replacing the live profile or establish owner-manual UI/provider acceptance.

## Review and Evidence

Independent planning challenge precedes high-impact implementation. `implement.md` owns ordered gates and commands; `research/` holds inventories, test receipts and observations. Existing stage results guide coverage but do not certify the merged source. Final review must compare against the original PRD and disclose any unsupported historical shape, failing check, absent installed/provider coverage or unverified large-library scale.
