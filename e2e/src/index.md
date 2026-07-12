# e2e/src/

Headless end-to-end scenarios (PRD 07-11-e2e-test-harness layer B). Run with `pnpm --filter @taki/e2e test:e2e`
(requires a debug `taki-node` build: `cargo build --bin taki-node --manifest-path apps/desktop/src-tauri/Cargo.toml`).

- fixture/ — the reusable withStack harness (see fixture/index.md)
- reconnect.e2e.test.ts — node pairs once, reconnects by persisted token (no second pairing code)
- screenshot-l2.e2e.test.ts — L2 agent drive: real LLM asked to screenshot (key-gated; the H2 diagnosis)
- trigger-gating.e2e.test.ts — the dev capability.trigger is absent without TAKI_DEV_TRIGGER=1 (METHOD_NOT_FOUND), present with it
- screenshot-always-restart.e2e.test.ts — #5 allow-always persists across a node restart (second shot auto-allowed, no ask)
- deny-degrades.e2e.test.ts — #6/#23 scripted deny on screenshot/exec → structured DENIED, no crash/file
- shell-open-schemes.e2e.test.ts — #11 dangerous url schemes classify as shell-open:blocked → DENIED at the gate, no dialog
- shell-open-target-class.e2e.test.ts — 07-12 A1 fix: per (capability,targetClass); persisted url-safe memory answers via gate decision (deny polarity, never launches a real browser); url-safe Always never authorizes local-exec/local-file; local classes ask every time
- clipboard-roundtrip.e2e.test.ts — #12 clipboard write→read returns the exact value (real arboard)
- process-list.e2e.test.ts — #13 process-list has pid/name/memory and no argv/cmd leak
- workspace-files.e2e.test.ts — #14/#15 Workspace write+read round-trip; ../../.. escape rejected with no path leak
- exec-allowlist-autorun.e2e.test.ts — #16 allowlisted hostname auto-runs (audited auto-allowed) despite exec=deny
- exec-chained-escalates.e2e.test.ts — #18 `git status && del x` escalates past the allowlist → denied
- exec-catastrophic.e2e.test.ts — #19 `format c:` auto-denied without a dialog despite an allow approver
- exec-timeout.e2e.test.ts — #20 (slow) a long command is killed at the 30s deadline → timedOut, exitCode null
- exec-cwd.e2e.test.ts — #21 `git init` lands .git under the node exec-cwd (exec runs in the Workspace)
- exec-audit-command.e2e.test.ts — #22 audit records `command` for exec, absent for non-exec
- hallucination-l2.e2e.test.ts — D1 multi-turn hallucination reproduction: seeded verbal-success pollution; the next turn must really invoke the tool AND persist tool rows (red pre-fix, green post agent-harness-improve)

L2 dual-track (real-LLM, key-gated via it.skipIf; MAY red until agent-tool-timeline — the red catches the H2/tool-call
hallucination, do not weaken). Each asserts the agent really invoked the tool (core log) AND the end-to-end result is
correct (exit / OS-clipboard / on-disk file):
- exec-l2.e2e.test.ts — real agent asked to run `hostname` invokes exec and it exits 0
- clipboard-l2.e2e.test.ts — real agent asked to copy a token; the OS clipboard holds it (verified via an L1 read)
- workspace-l2.e2e.test.ts — real agent asked to write+read a file; the token lands on disk in the Workspace

Manual-only (recorded in the PRD, deliberately not automated): #10/#17/#18 dialog text renders verbatim (visual);
#10 a browser actually opens (test pollution); #7 Windows Credential Manager entry (the headless node uses a file store).
