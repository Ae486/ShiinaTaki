# Naming and approval implementation plan

## Execution boundary

Owner authorization: the UI/UX sequence was approved on 2026-09-05; creation of this child was separately
approved. A1/A2 implementation, combined checking and actual-engine QA are complete. The owner then
delegated completion and commits without further confirmations on 2026-09-06. Main selects D64
policy A and proceeds after its current adapter/compatibility design review. Commit coherent checked
changes; retain no push, Hindsight/memory-runtime change or D63 execution expansion. Record actual
engineering acceptance without claiming unobserved owner manual acceptance.

Read `prd.md`, `design.md`, curated manifests and both research files before dispatch. Preserve the
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

1. Record the owner's selected policy in the proposal and finalize the compatible Host presentation
   design. Resolve whole-command capacity, unsupported forms and old-Host behavior before code.
2. Implement the Host projection/masking/visible escaping with no command execution for formatting.
   Preserve exact raw input and seal the final display before challenge digest creation.
3. Settle disclosure failures immediately and safely; keep once-only resume, original command audit,
   deadline, reconnect and final Host-floor enforcement. D63 remains unchanged.
4. Implement readable full-command Desktop display without truncation or a raw-metadata panel.
5. Run the dedicated Rust/Shared/protocol tests, real-process approval paths and independent review.

## Required gates and handoff

- Focused tests during each slice, then Shared/Core/Desktop full relevant suites, `pnpm typecheck`,
  `pnpm lint`, `pnpm --filter @taki/desktop build` and scoped `git diff --check`.
- D64 also requires `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` and the project
  clippy gate, scoped first and widened as required by the changed Rust contract.
- `python .trellis/scripts/task.py validate 09-05-uiux-readable-operations` and document/link checks.
- Protect unrelated dirty files and the deferred-registry prefix; write concise source-backed evidence.
- Actual window acceptance covers readable labels, long/unknown names, details, keyboard focus,
  revocation and command approval. Leave manual criteria open until confirmed by the owner.
- The next main delivery is D68/G5 Monitor, followed by Chat and Pet slices in the live-feedback child.
