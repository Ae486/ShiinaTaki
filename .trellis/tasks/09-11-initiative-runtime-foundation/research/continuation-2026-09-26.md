# September 26 runtime foundation continuation

## Recovered state and authority

- Resumed session: `01a0d13a-8e1d-7510-821c-491fbdbc72be`, which itself resumed
  `01a0be82-6979-79c3-8aa1-1dc8ed8712f9` and stopped during implementation recovery.
- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`;
  HEAD: `06a8090118a45a8c4f06472be4917108f93aea44`.
- The pinned-main `516e151` working-tree integration passed its baseline gate on September 20.
  There is no new merge commit. Do not re-import the snapshot or mutable main.
- This existing child is `in_progress`; the current native session is bound to it. The global
  Avatar Lab breadcrumb is stale and was preserved. No replacement task was created.
- Existing development approval covers the current repairs and verification. Commit, push,
  finish/archive, actual user-data migration and external-provider trials remain separate.

## Repairs and added evidence

The interrupted implementation called `initiative_model_opportunities` without creating that
table. Additive migration 050 now supplies the durable reservation/first-model-charge storage;
the previously written 049 migration is preserved. Configuration constants already had dynamic
registry entries and ConfigWriter validation, so duplicate wiring was unnecessary.

The resumed E2E fixture omitted the now-required `timezoneRevision`. It now reads the actual
operator User Timezone authority when capturing a selected opportunity. Added process scenarios
exercise independent model/speech accounting across restart, Class B output/busy expiry, real
operator timezone invalidation and abrupt process death while holding an executable continuation.
The process fixture still modifies only the test loader, uses a local scripted provider and
isolated temporary databases, and exposes no production testing RPC.

Additional bounded repairs normalize reservation expiry before SQLite comparisons and retire
the busy-wait timer when a held continuation starts executing. Formal review owns remaining
cross-layer findings and executable specification updates.

Root also fixed lint-only issues in the pre-existing `apps/desktop/test/qqmm-home-native-smoke.mjs`
helper: explicit Node/global imports, equivalent response branching and an explained retry catch.
ESLint and `node --check` passed; that native smoke was not executed.

## Verification and formal review

The child-scoped automated gate passed. The [formal review](formal-review-2026-09-26.md)
records seven additional finding groups and the complete C1 evidence matrix: held Memory
connection/Bank validity, terminal text recovery, final-step Scheduled text, DST quota carry,
truthful cancellation/storage outcomes, permission presentation and quality/specification fixes.
The strict completed-expression replay assertion caught and verified the final recovery-filter correction.

| Check | Result and record |
| --- | --- |
| Serial complete workspace tests | Shared 597, CLI 50, Desktop 1067, Core 3401 passed; one existing Core skip; `workspace-tests-final-2026-09-26.json` |
| Five TypeScript projects | Passed; `typecheck-final-2026-09-26.json` |
| Complete process suite after recovery correction | 15 passed; `e2e-runtime-verified-2026-09-26.json` |
| Recovery after correction | 7 passed; `recovery-verified-2026-09-26.json` |
| Core typecheck after correction | Passed; `core-typecheck-verified-2026-09-26.json` |
| Root lint | Passed; `lint-verified-2026-09-26.json` |
| Desktop refresh after observed dependency drift | 1067 passed, typecheck/build passed; `desktop-current-lock-{tests,typecheck,build}-2026-09-26.json` |

The full-suite run is supplemented by the post-fix recovery, process and type checks; it is
not presented as an unchanged-source run. Earlier failed E2E, Shared/Core and lint records
remain available as diagnostic evidence. The Vite build retains its existing large-chunk notice.

## Source boundary and independent QQMM work

`verified-source-2026-09-26.json` records final source hashes, unchanged HEAD/index and the
exact drift from the full-gate starting fingerprint. In addition to the bounded recovery
fix and native-smoke quoting, another workflow changed the QQMM lock entry and later its
page/detail test sources. Those QQMM page edits occurred during the refreshed Desktop test run and after its build/typecheck had started; the refresh is not a frozen-source gate.

The repository lock, installed lock and mutable local QQMM tarball are not mutually
consistent. At the latest read the repository lock matches the tarball, while the installed lock differs. The root did not install, overwrite or reconcile this independent dependency.
Desktop checks demonstrate the observed installed environment at their recorded times;
they do not establish a frozen-lock rebuild or acceptance of subsequent QQMM changes.
That independent task must align and freeze its artifact, installed package and lock,
then rerun its affected Desktop/native gates. Do not repeatedly import or revert that work
as part of this initiative child.

## Next checkpoint and limitations

The initiative foundation has no remaining confirmed child-scope defect after formal review
and automated verification. Its task remains `in_progress`, and owner-controlled C1 acceptance
checkboxes remain unchanged. Child 2 is the next planned implementation scope; it was not
started by this testing/fix continuation.

Native WebView2/Avatar presentation, real external-provider behavior and subjective owner
acceptance remain unperformed. No commit, push, finish/archive, real user-data migration or
other-worktree edit was performed. Retain the independent QQMM reproducibility/late-source
limitation when describing the overall workspace; do not claim a final frozen whole-repository release.
