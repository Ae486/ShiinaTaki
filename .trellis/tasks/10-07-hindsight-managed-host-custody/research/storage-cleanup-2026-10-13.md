# Storage cleanup before C1 activation

The owner authorized a dedicated cleanup agent and prohibited disk-growing work until cleanup completed.
Development, tests, builds, installation and generation remained stopped throughout the cleanup. The agent
used `high` effort; no source, dependency, evidence or original-data cleanup was authorized.

## Removed compiler outputs

| Exact directory | Logical GiB |
| --- | ---: |
| `H:/TakiAgent/apps/desktop/src-tauri/target` | 5.670 |
| `H:/hindsight/hindsight-clients/rust/target` | 0.952 |
| `H:/TakiAgent-worktrees/t4/apps/desktop/src-tauri/target/debug` | 9.487 |
| `H:/TakiAgent/.claude/worktrees/agent-a0b3d2f31101f184a/apps/desktop/src-tauri/target` | 1.230 |

All four targets were untracked, ignored compiler output. The agent verified resolved repository boundaries,
absence of reparse points, target-specific process use and exclusive read access before native PowerShell
deletion. No broad Git clean, process termination, Docker operation, migration or package-cache cleanup was used.

H: free space increased from **960,815,104** to **17,065,312,256 bytes**: **16,104,497,152 bytes / 14.998 GiB**
actually reclaimed. Logical file sizes total 17.340 GiB and are not the allocated-space measurement.
Root independently confirmed the final free-space reading and absence of all four directories.

## Preservation and release

- The agent compared all four repository/worktree Git status digests before and after; every digest matched.
- The T4 `target` parents were retained. Four evidence directories, including `c2-native-evidence`,
  `c3-pattern-native-evidence`, `c2-webview-assets` and the root `target`, retained all 894 file-content hashes.
- Source, generated SDK source, dependencies, data, backups, task/worktree metadata, logs and screenshots were kept.
- Small remaining output such as `hindsight-docs/build` (0.305 GiB) was retained; cleanup stopped after enough
  space was recovered. No whole-disk attribution or deletion of unrelated projects is claimed.
- Both primary repository HEADs remain unchanged. C1 was still planning and the existing session remained bound
  to Stage 5B during cleanup. The cleaner released ownership before this report was written.

Development may resume. Rust outputs will be recreated by later verification; keep checks serial, reuse one
target directory per repository, and avoid duplicate builds. Monitor available space before a cold Rust build.
The owner has not authorized original services/data/credentials, real model calls, Docker startup or Git lifecycle.
