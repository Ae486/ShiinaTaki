# Stage 4 local commit checkpoint

The owner explicitly requested local commits after the W8 automated delivery, followed by an implementation and
real-data/LLM test report. This checkpoints the reviewed files without rerunning corpus/model journeys or changing
the original/manual acceptance boundary. It does not authorize push, archive or Stage 5 execution.

## Commit batch

1. Native `H:/hindsight`, `main`: `eb6413a7f58c4f3f0adb88a33a99516f8707fef7` —
   `feat: add guarded authority transitions and paired recovery for Taki`.
   Includes 367 reviewed files: transition fence/proof/delta/retirement/restore, previously accepted application-state
   and backup prerequisites, generated contracts and the patch ledger. These prerequisites were still uncommitted
   at Native base `6a749ba3e7d8719e336d9d1d8735a8e09da4366b` and are required by the delivered Core protocol.
2. Taki `H:/TakiAgent`, `main`: the companion commit containing this document —
   `feat: complete repeated memory transitions and emergency takeover`.
   Includes Shared/Core/Desktop implementation, migrations 051-057, tests, specs, the task's preserved research/
   failure/success records, parent task linkage and current handoff. Its parent is
   `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; use Git history for this commit's identity.

## Source and evidence checks

- Both indexes were empty before staging. Exact paths were inventoried under an ignored owned commit workspace;
  no original databases, backups, runtime directories or secret configuration are part of the batch.
- All 362 Taki changed non-task sources and all 367 Native changed sources match the final W8 audit/ownership
  hashes. Acceptance/commit documentation is the only later edit; no production or test behavior changed.
- Parent already matched all 23 W8 source/helper entries and all 28 final evidence pins. See
  [W8 independent check](w8-independent-check.md) and [final evidence manifest](w8-final-evidence.json).
- Full passing suites are reused by exact source identity: Shared 555, Core 3784 plus one existing skip,
  Desktop 675, Rust 5, seven actual main.ts boots/recoveries, root lint/types/build and real WS/browser evidence.
- Native staging was checked against the exact 367-file inventory, every raw working-file hash remained equal,
  and both index whitespace checks and the remaining content diff passed. Pre-existing line-ending/stat-only
  status entries outside that inventory are not staged; Git's content diff is empty for those paths.
- The parent acceptance documents passed UTF-8/no-BOM, whitespace, local-link/JSON checks and Trellis validation
  (43 implementation / 52 check entries). Task status and session binding remain unchanged.
- First staging makes previously untracked raw evidence visible to `git diff --cached --check`: it reports 194
  whitespace findings in 98 historical logs, captured patch/diff artifacts and the pinned W7 report's final blank
  line. Preserve these bytes and their accepted hashes. The exact 98-path evidence exception leaves all executable
  code, schemas, specs and current acceptance documents under the normal whitespace gate, which passes. No lint
  rule, formatter or repository-wide whitespace setting is weakened for this archival evidence.

Historical reports retain the HEAD, failures and hashes that were true when each check ran. A later Git checkpoint
does not invalidate byte-identical source evidence and is not a reason to rewrite it. Manual WebView2/CSP,
original-user/DPAPI recovery and global D91 remain open. The 120-second RPC bound has verified unknown-result
reattachment, not a large-corpus ACK performance guarantee.
