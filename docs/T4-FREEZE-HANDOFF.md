# T4 freeze and later integration

The owner froze `H:/TakiAgent-worktrees/t4` on 2026-11-10. Preserve this branch while
main finishes its current stage, then integrate in an isolated worktree. This is a
stage checkpoint, not product acceptance. Do not resume T4 feature work, start its
ordinary entry against real data, or infer permission to merge, push, archive tasks
or migrate real data from this record.

## Source and ownership

- T4 branch: `task/t4-skills-mcp-productization`; pre-freeze HEAD: `8bfb5f5`.
- Main HEAD observed before freezing: `ba5be72`. Main has independent uncommitted
  work, including Hindsight migrations 061/062; recheck its final state at integration.
- Existing stage commits: `2c761fb` (maintenance/migration prerequisites) and
  `8bfb5f5` (local startup, live configuration and packaged-avatar corrections).
- Freeze commits `0e73484` and `d301db0` preserve remaining delegation summary
  repair/tests and exec guidance/research conclusions. The documentation commit
  preserves previously local task records. Its final branch tip and the complete
  commit list are recorded in the external freeze receipt.
- Hindsight implementation remains owned by main's effort. This freeze changes no
  production governance contract and no main-worktree source.

The four affected tasks remain `in_progress`, with frozen execution in their metadata:
delegation conversations, context/token efficiency, memory tidy reliability, and
installation/user experience. Their original requirements and unfinished ACs remain.

## Runtime and real data

The ordinary T4 Core watcher and Desktop launcher exited before intervention. The
remaining isolated Core PID 37512 was stopped after exact start-time/worktree checks
and proof of zero active Runs, Memory operations or scheduled work. The retained
Vite had already stopped. No service is intentionally retained by this freeze.

Real data was backed up without migrations or setting changes. The following are
separate version domains:

| Read-only observation | Value |
| --- | --- |
| Core profile | `C:/Users/55473/.takiagent` |
| SQLite maximum migration receipt | 72 |
| Stored governance registry | 3 |
| Stored Approval registry / durable decisions | 1 / 7 |
| T4 / main code governance registry | 1 / 3 |

T4's `database governance registry 3 is newer than code 1` refusal is retained.
Do not decrement the stored revision or remove the guard. A TS-only revision bump
also leaves native Host projection validation and historical Approval resolution
incompatible; integration must reconcile all three owners.

## Verified local backup

Backup root: `G:/taki-t4-freeze-20261110`.

| Artifact | Contents |
| --- | --- |
| `data/core-profile/` | SQLite backup API snapshot plus the complete profile, Workspace, character assets, attachments and prior backups |
| `data/desktop-local/` | Actual Local AppData WebView profile |
| `data/desktop-roaming/` | Shell data from `G:/Roaming/cc.shiinataki.app`; APPDATA is redirected on this machine |
| `data/configuration/` | Both worktrees' local environment files; never stage these copies |
| `working-state-before-freeze.zip` | All 4,333 initially dirty/untracked files, including bytes before the test-fixture correction |
| `ignored-target.zip` | 9,585 ignored validation, prior-source and acceptance files |
| `native-flow-evidence.zip` | 15,921 native-flow/commit-preparation evidence files; dependency links are inventoried instead of recursively archived |
| `local-artifacts/` | Original relative paths of artifacts excluded from Git |
| `t4-freeze.bundle` | Portable final T4 branch history; compare its tip with the final receipt |
| `control/` | SHA-256 manifests, backup/relocation/process receipts, check logs and final commit receipt |

Data backup: 23,217 files / 1,493,188,260 bytes, individually checksum-verified.
SQLite integrity is `ok`, foreign-key violations are zero, and source data version
stayed stable during backup. The original profile was not rewritten. Windows
Credential Manager remains in place and was not exported; its same-machine keys
remain a separate dependency of restoring these files.

Excluded evidence: 4,208 files moved to the archive, 48 copied through three existing
junctions, all hashes matched. Only those workspace aliases were removed; original
G-drive targets remain intact. Resolve old evidence references beneath
`local-artifacts/<original repository-relative path>` or in the original-state ZIP.
Ignored `target/` evidence remains in its original location as well as its ZIP.
Build cache remains at `G:/takiagent-dev-cache/t4/cargo-debug`, through the existing
`apps/desktop/src-tauri/target/debug` junction; it is regenerable, not restore data.

Restore evidence into a separate review directory. Restore an application snapshot
into an isolated profile for validation first; never overwrite a newer live profile
with this dated copy. Take a fresh consistent backup immediately before any eventual
approved real-data migration.

## Verification and open acceptance

- Freeze checks: 70 Core tests in five files; six scripted E2E tests in two files;
  Core/E2E typechecks; scoped ESLint. No paid provider was called.
- One stale upgrade fixture was reproduced: deleting receipts 069+ retained tables
  070+. It now genuinely seeds through 068 before the production upgrade and exact
  Stop/Continue/new-child delivery. Ordinary fixtures retain the full registry.
  This correction changes only test code and its documentation.
- Independent review found no remaining blocker in the selected patches. Earlier
  full-workspace/native results remain dated task evidence, not merged-branch checks.
- Real-provider long-work completion, owner UI acceptance and sustained resource
  acceptance remain open. The Avatar observation pilot is deferred, not production
  replay behavior, and has no demonstrated quality/cost advantage.
- The retained Hindsight runtime function-size lint finding remains a known stage
  limitation under the separate owner's boundary. The final root lint reproduced
  only that finding (53 lines versus 50). No lint rule was weakened.
- All four task context manifests validate. The context/token-efficiency manifest
  warns that `agent-runtime.md` exceeds its injection size limit; read that spec
  directly when resuming instead of assuming the injected excerpt is complete.

## Integration after main completes its stage

1. Freeze main's intended stage and integrate both branch histories in a new
   worktree, retaining both feature sets/tests. Do not copy directories or resolve
   whole migration/governance registries by selecting ours/theirs.
2. Reconcile migrations by actual schema. Histories diverge after 048; overlapping
   numbers, including 061/062, have different meanings. The max-version runner will
   skip lower versions in a database already at 072. Follow the existing
   [lineage contract](../.trellis/spec/backend/sqlite-migration-lineage.md): preserve
   recorded history and append guarded convergence beyond both final tails.
3. Establish a canonical governance registry, matching native Host validation and
   frozen historical Approval resolution. Preserve the seven decisions and binding
   checks. Select the final revision from both branches' final states; do not reuse
   a revision for incompatible definitions or silently discard authorizations.
4. Validate fresh installation, both historical lineages, and an isolated copy of
   the actual profile: data/receipt preservation, exact schemas, integrity, startup,
   native authorization and required user paths. Control background/paid operations.
5. Complete integrated checks and acceptance, obtain live rollout authorization,
   take a fresh backup, then migrate real data. Old binaries must not keep opening
   an upgraded shared profile.

No integration or live-data rollout is performed by this freeze.
