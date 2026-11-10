# e2e/src/

- agent-interface-native.e2e.test.ts — no-model accepted native exec Host, real allowlisted hostname despite exec=deny, zero model requests and retained native cleanup/source evidence
- agent-interface-inbox.e2e.test.ts — local scripted SDK/Core/SQLite atomic flat inbox answers and legitimate later direct answers after ask_user; historical dispositions remain immutable
- agent-interface-real.e2e.test.ts — separately opted-in natural real-model campaign with fixed 18/20/32 caps: native foreground work during delayed reports, ordinary guidance/exact question, small factual check-in/user Stop with fresh foreground publication authority; strict behavior failures retain evidence
- agent-interface-checkin.e2e.test.ts — scripted SDK/Core/SQLite N3/K1 regressions: user Continue resets at step6; step9 supports either parent approval or one additional actually asked user decision, with final accounting after the latest user input

Headless end-to-end scenarios (PRD 07-11-e2e-test-harness layer B). Run with `pnpm --filter @taki/e2e test:e2e`
(requires a debug `taki-node` build: `cargo build --bin taki-node --manifest-path apps/desktop/src-tauri/Cargo.toml`).

- fixture/ — the reusable withStack harness (see fixture/index.md)
- prompt-tool-optimization-real.e2e.test.ts — explicit paid opt-in on isolated production Core; bounded Memory/delegation/scheduler and scripted Avatar outcomes, plus separately opted-in delayed-worker foreground/idle delivery
- agent-delegation-checkin.e2e.test.ts — deterministic production-Core/SDK N50/K3 defaults: below-threshold and N-th-step final completion, same-Attempt compaction, exact user check-in continuation to a new Run, complete usage and preserved private/public boundaries
- agent-delegation-goals-real.e2e.test.ts — separately opted-in real route: natural delegation/follow-up and clarification, serial-upstream eight-event and long compaction/check-in acceptance, plus a scoped real Co-Watching plan-child observation
- co-watching-context-fixture.e2e.test.ts — actual SDK/SQLite Co-Watching preparation through repeated 8000-token pressure boundaries with the production main-model Utility fallback, preserved task steps and private output
- initiative-runtime.e2e.test.ts — scripted local provider and real Core composition exercise thin requests, structural decisions, same-Attempt held delivery, persisted model budgets, output/busy expiry, operator timezone invalidation, primary priority and Monitor replay
- initiative-pattern.e2e.test.ts — unmodified Core startup, real primary proposal/confirmation, automatic finite wake conditions, explicit Skill setup, no-replay and zero-call policy refusals
- initiative-pattern-real.e2e.test.ts — explicit paid opt-in over isolated production Core: real natural-language authoring/lifecycle, unsupported-source clarification, exact UTC reminder routing, and heartbeat Memory/history boundary probes with semantic-review artifacts
- agent-context-real.e2e.test.ts — explicit real-model opt-in for selected private child context, addressed input, retained reuse and record-only completion; production RPC/SQLite/request evidence remains separate from owner acceptance
- agent-context-runtime.e2e.test.ts — production Core with a loopback scripted provider verifies selected child work, actual addressed-input receipts, separate terminal Runs and record-only versus deduplicated internal parent continuation
- agent-context-r2.e2e.test.ts — controlled HTTP timing and separately opted-in real inference verify independent parent/child controls, user-only continuation, original stopped-request reply and internal-only synthesis
- agent-context-restart.e2e.test.ts — two actual production Core kills/restarts over one isolated Local database preserve user-stop/pending input, settle an interrupted model Effect as unknown, create new Runs only after public Continue and never automatically replay terminal work
- initiative-recovery.e2e.test.ts — unmodified Core with scripted model: finite source-bound plans, consumption/restart, offline expiry, independent recalled follow-up, withdrawn Memory exclusion and actual admission-driven backoff invalidation
- initiative-intention-real.e2e.test.ts — explicit paid opt-in over isolated production Core: natural finite planning, canonical delivery disposition, bounded actual Memory recall, new follow-up and per-request history exclusion
- core-shutdown.e2e.test.ts — isolated real Core and local HTTP rejection prove natural graceful exit after SDK fetch, including Windows native async-handle cleanup
- avatar-command-outcome.e2e.test.ts — real Core + scripted local provider: a subscribed fake Pet operator answers avatar.outcome{rejected,motion_busy} for the Core commandId and the persisted tool result / Chat activity terminal reflect it; no subscriber settles not_rendered before the deadline (D80)
- perception-refresh.e2e.test.ts — real Core with separate operator sockets proves opt-in pause/absolute-expiry invalidation, duplicate subscription behavior and content-free frames without a sensing Host
- extension-refresh.e2e.test.ts — real Core and synthetic local MCP/Skill sources prove targeted cross-operator commit/publication invalidation and quiet read paths
- reconnect.e2e.test.ts — node pairs once, reconnects by persisted token (no second pairing code)
- governance-authority.e2e.test.ts — real Core + external taki-node: compatible catalog, relaxed auto, Core deny, Host stricter deny, and higher-generation projection replacement
- governance-stale-projection.e2e.test.ts — test-only loopback relay proves stale N-1 and same-N valid-digest projection tampering are rejected without execution/replay, then settles Core through bounded Host-generation retirement and verifies cleanup
- extension-discovery.e2e.test.ts — simultaneous real Core + two isolated Nodes: ambiguous direct process-list refusal, sealed host-qualified Extension calls, stable Host A identity with higher reconnect generation, and Host B disconnect isolation
- canonical-memory-production.e2e.test.ts — real Core boot with a persisted canonical-local marker, canonical Memory tool composition, one settled Memory Effect, and retired Markdown surface proof
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
- approval-challenge-resume.e2e.test.ts — isolated D64 L1 allow/deny/unattended, disclosure-failure and legacy-peer refusal; full masked display with original approved-exec audit and no diagnostic leakage
- hallucination-l2.e2e.test.ts — D1 multi-turn hallucination reproduction: seeded verbal-success pollution; the next turn must really invoke the tool AND persist tool rows (red pre-fix, green post agent-harness-improve)
- name-recall-l2.e2e.test.ts — T5 batch 5 flagship: the user's name exists ONLY in the seeded memory store (never in the timeline); the agent must memory_search and answer it (retention proof — green pre- AND post-5b overhaul, guards the post-R6 recall path)
- prompt-prefix-cache.e2e.test.ts — key-gated isolated real-provider acceptance over stable long history; proves one names-only Core tool path, per-request normalized usage arithmetic, positive post-cold cache reads, and the >=50% follow-up prefix-reuse gate without logging content or ids

- agent-delegation-upgrade.e2e.test.ts — early applied 058/060 schema built through 068, then upgraded by production Core with zero-dispatch boot, exact Stop/Continue and new-child public delivery using a local scripted provider

L2 dual-track (real-LLM, key-gated via it.skipIf; MAY red until agent-tool-timeline — the red catches the H2/tool-call
hallucination, do not weaken). Each asserts the agent really invoked the tool (core log) AND the end-to-end result is
correct (exit / OS-clipboard / on-disk file):
- exec-l2.e2e.test.ts — real agent asked to run `hostname` invokes exec and it exits 0
- clipboard-l2.e2e.test.ts — real agent asked to copy a token; the OS clipboard holds it (verified via an L1 read)
- workspace-l2.e2e.test.ts — real agent asked to write+read a file; the token lands on disk in the Workspace
- mcp-lifecycle.e2e.test.ts — real-process Secure MCP Lifecycle: add/test(no publish)/edit(conflict+retry)/disable/enable all land with NO restart; a governed MCP tool call runs through readable, exactly targeted Approval (dev L1 drive); Core restart reconciles desired state into a fresh generation lineage; a cleared or locked catalog secret retires ONLY the referencing server; the legacy mcp-servers.json seeds desired state once and is inert afterwards
- skill-lifecycle.e2e.test.ts — real-process Standard Skill Lifecycle: operator WS import/inspect/disable/enable/replace/reconcile/remove work without manual filesystem edits, and durable disabled truth survives a Core restart
- secret-catalog.e2e.test.ts — real-process secret catalog: set → core restart → presence survives with no re-provisioning; a removed key source locks the store (mutations fail closed, file never rewritten, nothing queues); boot-time plaintext env/headers migration rewrites mcp-servers.json to opaque refs after verified copy; sentinel absent from frames/logs/disk

Manual-only (recorded in the PRD, deliberately not automated): #10/#17/#18 dialog text renders verbatim (visual);
#10 a browser actually opens (test pollution); #7 Windows Credential Manager entry (the headless node uses a file store).
