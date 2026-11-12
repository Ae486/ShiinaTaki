# Naming and approval implementation plan

## Execution boundary

Owner authorization: the UI/UX sequence was approved on 2026-09-05; creation of this child was separately
approved. A1/A2 implementation, combined checking and actual-engine QA are complete. The owner then
delegated completion and commits without further confirmations on 2026-09-06. Main selects D64
policy A and proceeds after its current adapter/compatibility design review. Commit coherent checked
changes; retain no push, Hindsight/memory-runtime change or D63 execution expansion. Record actual
engineering acceptance without claiming unobserved owner manual acceptance.

Read `prd.md`, `design.md`, curated manifests and their research sources before dispatch. Preserve the
checked G4 frontend edits and all unrelated work. Verify the T4 worktree, branch and session pointer
before every slice/agent; semantic discovery uses jbcontext only, never YCE. Main owns documents,
cross-slice contracts and integration. Implement is gpt-6-astra/high; check is gpt-6-astra/xhigh;
subagents never recursively dispatch.

Owner process refinement (2026-09-05): main may omit a separate check agent for simple, low-risk
changes or combine related checks. Retain meaningful focused verification; do not repeatedly run
full gates after cosmetic edits. A1 and A2 use one combined independent check after main reviews the
A1 checkpoint. D64 keeps a separate independent review because it changes a security boundary.

## A1 — Chinese governance names and approval content

1. Curate the completed source map and review design sections 1–3. Activate this child only after
   G4 automated closeout and document review; retain the frontend task's pending manual acceptance.
2. Implement Shared/Core ownership: pure display tables/helpers and package exports; Core/MCP
   approval templates; exact-match current MCP safe-label resolver; optional list-label injection and
   the minimal existing composition-root wiring. Preserve canonical governance and stored bindings.
   Correct the verified non-MCP classifier hardcoding in approval construction using service-owned
   metadata; regress configurable `write_file` ask/approval/once-execution without changing policy.
3. Implement Desktop ownership in parallel against design section 2's fixed exports: permission
   group/cell/posture/mode descriptions, accessible control names, readable durable decisions, useful
   time/usability/fallbacks and removal of displayed acknowledgement revision. Keep generation values,
   revoke targets, confirmation, allowed choices and response payloads unchanged.
4. Review maximum name bounds and missing/historical targets. Run focused Shared/Core/permission/
   approval tests. Wait for the Shared exports before the Desktop final typecheck if work is parallel.
5. Main reviews the A1 diff and focused evidence before extending ownership to A2. Record the checkpoint
   and pending real-window acceptance. The independent check and full gates are combined with A2.

## A2 — truthful captured tool names

1. Re-read `extension-sources.ts`, `extension-run-context.ts`, `run-snapshot-capture.ts`, ChatAgent
   tool assembly/persistTurn, `turn-mapping.ts`, ConversationStore and TimelineRepo sanitization.
2. Add a frozen presentation-name sidecar at the same capture boundary as the MCP tool closures;
   carry it in process-local Run context. Do not add names to authority digests or reconstruct them
   from hashes/current catalogs when persisting.
3. Add optional bounded `displayName` to Shared timeline tool parts; preserve it through safe DB
   writes/reads. Keep raw input scrubbed and canonical model replay unchanged. Historical rows remain
   compatible without a migration.
4. Integrate the small name-enrichment helper at turn persistence and use the same field/fallback in
   Desktop ToolCard. Do not mix in live tool state, event ordering or structured-error fixes here.
5. Verify full capture-to-history flow, including replacement during a Run, long names, legacy rows,
   raw-input omission and canonical replay equality. Independently check the combined A1+A2 diff once,
   including shared label contracts and both producer/consumer paths.

## B — D64 actual command disclosure

1. Completed: main adopted policy A and reviewed the
   [source-backed executable contract](research/d64-executable-contract-2026-09-06.md). Design section 5
   fixes the optional typed command marker, operator support echo and Host-v3 correlated ACK path.
   G4/A1/A2 checkpoint: `a771496`. No further owner-choice gate remains.
2. Implement the Host projection/masking/visible escaping with no command execution for formatting.
   Preserve exact raw input and seal the final display before challenge digest creation.
3. Settle disclosure failures immediately and safely; keep once-only resume, original command audit,
   deadline, reconnect and final Host-floor enforcement. D63 remains unchanged.
4. Implement the narrow operator offer/echo across all Core authentication branches and maintained
   Desktop/CLI clients, then their exact full-command display without truncation or metadata panels.
   Explicit legacy refusal must settle before any prompt/intent/resume and preserve existing tokens.
5. Run focused Rust/Shared/protocol/lifecycle tests during implementation. Independently review the
   coherent slice once, including the actual isolated process approval/deny/refusal paths and legacy
   digest fixtures. Then run final relevant package/typecheck/lint/build/Rust gates once.

## Required gates and handoff

- Focused tests during each slice, then Shared/Core/Desktop full relevant suites, `pnpm typecheck`,
  `pnpm lint`, `pnpm --filter @taki/desktop build` and scoped `git diff --check`.
- D64 also requires `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` and the project
  clippy gate, scoped first and widened as required by the changed Rust contract.
- `python .trellis/scripts/task.py validate 09-05-uiux-readable-operations` and document/link checks.
- Protect unrelated dirty files and the deferred-registry prefix; write concise source-backed evidence.
- Actual window engineering acceptance covers readable labels, long/unknown names, details, keyboard
  focus, revocation and command approval. Record observed checks under the execution delegation;
  never describe engineering QA as personal owner inspection.
- The next main delivery is D68/G5 Monitor, followed by Chat and Pet slices in the live-feedback child.

## D64 final checkpoint — 2026-09-06

B is implemented and independently checked with all findings fixed. Shared/Core/Desktop/CLI,
workspace typecheck/lint, Rust/Clippy, real Core/Host L1 and the frozen actual WebView2 gates passed.
The continuation coordinator verified 9/9 reviewer file hashes, 260/260 frontend source/config hashes
and 23/23 frozen assets, then passed 32 Core and 50 CLI regressions against the current worktree.
The source-backed [final evidence](implementation-evidence-d64-2026-09-06.md) records exact counts,
fixes, scope and residuals. This satisfies B's implementation/review/engineering gates without
claiming personal owner inspection. D68-B can now follow the reviewed execution plan.
