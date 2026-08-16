# e2e/src/

Headless end-to-end scenarios (PRD 07-11-e2e-test-harness layer B). Run with `pnpm --filter @taki/e2e test:e2e`
(requires a debug `taki-node` build: `cargo build --bin taki-node --manifest-path apps/desktop/src-tauri/Cargo.toml`).

- fixture/ — the reusable withStack harness (see fixture/index.md)
- reconnect.e2e.test.ts — node pairs once, reconnects by persisted token (no second pairing code)
- governance-authority.e2e.test.ts — real Core + external taki-node: compatible catalog, relaxed auto, Core deny, Host stricter deny, and higher-generation projection replacement
- governance-stale-projection.e2e.test.ts — test-only loopback relay proves stale N-1 and same-N valid-digest projection tampering are rejected without execution/replay, then settles Core through bounded Host-generation retirement and verifies cleanup
- screenshot-l2.e2e.test.ts — L2 agent drive: real LLM asked to screenshot (key-gated; the H2 diagnosis)
- trigger-gating.e2e.test.ts — the dev capability.trigger is absent without TAKI_DEV_TRIGGER=1 (METHOD_NOT_FOUND), present with it
- screenshot-always-restart.e2e.test.ts — Slice-3 compatibility: legacy Always stays inert before/after restart; ask remains APPROVAL_REQUIRED
- deny-degrades.e2e.test.ts — Slice-3 ask path returns structured APPROVAL_REQUIRED with no execution and no local prompt
- shell-open-schemes.e2e.test.ts — #11 dangerous url schemes classify as shell-open:blocked → DENIED at the gate, no dialog
- shell-open-target-class.e2e.test.ts — per-class legacy deny-only compatibility; legacy Always cannot authorize local classes; asks fail closed without local prompts
- clipboard-roundtrip.e2e.test.ts — relaxed Core policy permits the real clipboard write→read round-trip (real arboard)
- process-list.e2e.test.ts — relaxed Core policy permits process-list; output has pid/name/memory and no argv/cmd leak
- workspace-files.e2e.test.ts — #14/#15 Workspace write+read round-trip; ../../.. escape rejected with no path leak
- exec-allowlist-autorun.e2e.test.ts — #16 allowlisted hostname auto-runs (audited auto-allowed) despite exec=deny
- exec-chained-escalates.e2e.test.ts — #18 `git status && del x` escalates past the allowlist → denied
- exec-catastrophic.e2e.test.ts — #19 `format c:` auto-denied without a dialog despite an allow approver
- exec-timeout.e2e.test.ts — #20 (slow) a long command is killed at the 30s deadline → timedOut, exitCode null
- exec-cwd.e2e.test.ts — #21 `git init` lands .git under the node exec-cwd (exec runs in the Workspace)
- exec-audit-command.e2e.test.ts — #22 audit records `command` for exec, absent for non-exec
- hallucination-l2.e2e.test.ts — D1 multi-turn hallucination reproduction: seeded verbal-success pollution; the next turn must really invoke the tool AND persist tool rows (red pre-fix, green post agent-harness-improve)
- name-recall-l2.e2e.test.ts — T5 batch 5 flagship: the user's name exists ONLY in the seeded memory store (never in the timeline); the agent must memory_search and answer it (retention proof — green pre- AND post-5b overhaul, guards the post-R6 recall path)

L2 dual-track (real-LLM, key-gated via it.skipIf; MAY red until agent-tool-timeline — the red catches the H2/tool-call
hallucination, do not weaken). Each asserts the agent really invoked the tool (core log) AND the end-to-end result is
correct (exit / OS-clipboard / on-disk file):
- approval-challenge-resume.e2e.test.ts — real-process Slice-4 vertical: ask challenge → operator allow/deny/unattended → resume or fail-closed settle, with the raw-input sentinel absent from audit/logs
- exec-l2.e2e.test.ts — real agent asked to run `hostname` invokes exec and it exits 0
- clipboard-l2.e2e.test.ts — real agent asked to copy a token; the OS clipboard holds it (verified via an L1 read)
- workspace-l2.e2e.test.ts — real agent asked to write+read a file; the token lands on disk in the Workspace
- secret-catalog.e2e.test.ts — real-process secret catalog: set → core restart → presence survives with no re-provisioning; a removed key source locks the store (mutations fail closed, file never rewritten, nothing queues); boot-time plaintext env/headers migration rewrites mcp-servers.json to opaque refs after verified copy; sentinel absent from frames/logs/disk

Manual-only (recorded in the PRD, deliberately not automated): #10/#17/#18 dialog text renders verbatim (visual);
#10 a browser actually opens (test pollution); #7 Windows Credential Manager entry (the headless node uses a file store).
