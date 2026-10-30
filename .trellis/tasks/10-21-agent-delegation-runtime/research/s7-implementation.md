# S7 private Subagent Conversation delivery

Date: 2026-10-23. Implementation and engineering verification complete for the Desktop slice; owner acceptance remains pending.

## Scope and source binding

- Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- Native session: `codex_01a16659-e931-7e41-84e6-f1e6b236bc94`, bound using `task.py start` / `task.py current --source` to this Runtime child. The stale global avatar pointer was not changed.
- Sources: parent and Runtime PRDs; Runtime design/implementation plan; joint contract sections 5, 7 and 13; current Shared subagent API/result/message schemas; actual Core query/control methods; frontend Home/read-model conventions.
- Runtime recovery explicitly released the public APIs. Its additive follow-ups provide nullable `expectedRunId` targeting and exported inferred parameter/result types. Source recovery released Co-Watching `paused_child` and exact child/work navigation fields. Desktop edits no Shared/Core/Source implementation files.
- Existing dirty file bytes were preserved before editing: [18 preimages and hashes](s7-recovery/preimages.json). Copies have `.preimage` suffixes to avoid test/source discovery. [Final changed-path hashes](s7-recovery/final-source-hashes.json) list the 40 Desktop/spec/test/index paths.

## Delivered behavior and files

- New `apps/desktop/src/features/subagents/`: controller/read assembly, exact target state, Home lifecycle hook, addressed navigation, list/detail/composer, input receipts, private text/tool projection and linked child/parent result display. Its `index.md` records each module.
- New `apps/desktop/src/windows/home/pages/subagents/`; `windows/home/pages.ts` and navigation tests register one Home page. Existing responsive Home primitives, colors, typography and action/error wording are reused. No dependency or visual-system change.
- New `lib/ws-client-subagents.ts` and boundary tests; narrow `ws-client.ts`, `ws-client-methods.ts`, `ws-client-routes.ts` wiring parses every inbound response/notification through Shared and retires observers with the physical client.
- Existing Chat and Perception Co-Watching cards/hooks expose `paused_child` and navigate to its exact child/work. Opening a private conversation issues no Continue. Explicit authenticated continuation remains on the child page.
- Existing frontend `home-window.md` now records the executable UI contract. Affected feature, lib, Home, page and test indexes were updated. New `apps/desktop/test/s7-subagent-*` files provide isolated data and native verification.

Selection commits child/title/payload/work coherently. Readiness and exact displayed child/work/control-version/Run identity guard actions; idle controls include `expectedRunId: null`. Commands serialize, and stop never uses parent `chatCancel`. Sending while user-stopped preserves input without clearing the latch. Input receipts distinguish accepted-but-pending from inclusion in model request intent; neither claims model understanding.

Private rows reuse the existing Chat text/tool presentation with Run/Attempt-scoped call identity, no canonical Timeline IDs and no relationship-presence reporting. Retained images use the existing media renderer with the Home client. Result cards separate child outcome, completion disposition, parent synthesis/decision, publication and canonical delivery. A saved publication is not labelled delivered.

Each fresh connection installs the parsed observer, awaits subscription acknowledgement and refetches. Old successes/failures cannot replace a newer view. Disconnect preserves draft and unknown command outcome without replay. A target conflict and a failed following read remain separate diagnostics. Hidden pages retire reads while a pending command retains its own lifetime. Known missing/forbidden selected detail is removed; ordinary refresh failure retains permitted prior content and a retry.

## Verification

Environment: Windows, Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`, Vite `8.1.3`, existing isolated Tauri/WebView2 fixture executable.

| Check | Command | Result |
| --- | --- | --- |
| Targeted controller/presentation/wire/navigation | `pnpm --filter @taki/desktop test src/features/subagents src/lib/ws-client-subagents.test.ts src/windows/home/home-navigation.test.ts src/windows/home/home-shell.test.tsx` | 5 files, 29 tests passed |
| Desktop full suite | `pnpm --filter @taki/desktop test` | 205 files, 1,231 tests passed |
| Narrow follow-up after paused-card mapping/presentation corrections | `pnpm --filter @taki/desktop test src/features/subagents src/features/co-watching src/windows/home/pages/perception/co-watching-controller.test.ts src/lib/ws-client-subagents.test.ts` | 6 files, 30 tests passed |
| Desktop typecheck | `pnpm --filter @taki/desktop typecheck` | Passed on final source |
| Desktop lint | `pnpm exec eslint apps/desktop/src apps/desktop/test/s7-subagent-*` | Passed; narrow changed paths also checked after subsequent edits |
| Production assets | `pnpm --filter @taki/desktop build` | Passed on final source; existing >500 kB chunk warning remains (Pet bundle 637.65 kB); Markdown retains its separate lazy chunk |
| Whitespace | scoped `git diff --check` | Passed; Git emitted existing CRLF-to-LF notices for two touched client files |
| Native rendered checks | `node apps/desktop/test/s7-subagent-native-smoke.mjs` | 6 scenarios passed on final source |

The full suite preceded the last narrow Co-Watching status/navigation and media-context wiring. Subsequent scoped checks, final typecheck/build and native run cover those changes; a second full-suite run is not claimed.

Native evidence: [final evidence JSON](s7-recovery/native/2026-10-23T01-50-08-307Z/evidence.json), [conversation/receipts](s7-recovery/native/2026-10-23T01-50-08-307Z/conversation-input-receipts.png), [reconnect and draft](s7-recovery/native/2026-10-23T01-50-08-307Z/reconnect-unknown-draft.png), [retained read failure](s7-recovery/native/2026-10-23T01-50-08-307Z/retained-read-error.png), [linked parent result](s7-recovery/native/2026-10-23T01-50-08-307Z/linked-parent-result.png).

Actual WebView2 inspected production Home components, client routes and controllers. Checks verify navigation, queued/included receipts, retained editor/transcript nodes and selection during held refresh, immediate action disabling, paused Co-Watching addressed navigation, exact stop/continue, no automatic continuation, lost-ack reconnect with zero send replay, retained draft/unknown outcome, retryable read failure and separate undelivered parent synthesis. Screenshot inspection corrected the page's responsive container wrapper; it now renders two columns at the fixture's normal width.

Earlier failed commands are not acceptance evidence: root Vitest without Desktop Vite aliases, a nonexistent project selector, initial test-only unsupported `Promise.withResolvers` types, and a scripted Co-Watching acknowledgement/ID mismatch. These were corrected. The intermediate typecheck caught the new `paused_child` status missing in the Perception mapping; both Chat and Perception mappings are now updated. Earlier screenshots/logs remain in the recovery directory for traceability.

## Evidence limits and handoff

- Native child RPC results are Shared-validated scripted state. This establishes actual Desktop rendering/control/transport behavior, not production SubagentService scheduling, model quality, delivery-provider behavior or Memory authority. Runtime/Source and parent integrated E2E own those proofs.
- Native evidence covers normal-width Home, real controls and retained nodes/draft selection. It does not claim comprehensive compact-window, screen-reader, arbitrary huge-transcript or packaged distribution acceptance. Image-byte retrieval was wired to the existing media owner but not independently exercised by this native scenario.
- No real-user data, model call, production release, commit, push, reset, cleanup or archive was performed by this slice. Isolated native test profile/SQLite/artifacts are retained.
- Owner UI/conversation acceptance remains unchecked. Parent may now consume this implementation and evidence for the joint quality gate. Desktop S7 ownership is released after this report.
