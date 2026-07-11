# Journal - pleia (Part 1)

> AI development session journal
> Started: 2026-07-07

---



## Session 1: Requirements, tech selection, reference research — full design phase closeout

**Date**: 2026-07-07
**Task**: Requirements, tech selection, reference research — full design phase closeout
**Branch**: `main`

### Summary

Grill sessions Q1-Q11 complete: product definition, layered memory registry, activity capture, settings scope, MCP/skills v1, DB colocation rule, VPS-hosted core topology (v1.5), OS-neutral core invariant. 7 research reports, 6 ADRs, PRODUCT/TECH-STACK/MEMORY-DESIGN/TTS docs. All 3 trellis tasks archived; repo pushed to origin/main.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d17e9a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Issue #3 walking skeleton implemented and verified

**Date**: 2026-07-09
**Task**: Issue #3 walking skeleton implemented and verified
**Branch**: `main`

### Summary

Full trellis cycle for issue #3: fable research verified AI SDK v7/json-rpc-2.0/Node24 APIs (caught deepseek-chat deprecation); opus implement built shared protocol + core WS server + CLI in strict TDD; fable check fixed 8 findings incl. a process-crash vector and wildcard-bind hole; leader verified 57 tests green + real DeepSeek streaming round-trip, multi-turn memory, and structured-error negative smoke. Codified header/index.md conventions.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c17aae4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Issue #4 device pairing implemented and verified

**Date**: 2026-07-09
**Task**: Issue #4 device pairing implemented and verified
**Branch**: `main`

### Summary

Full trellis cycle for issue #4: leader-authored prd (no research agent needed, Node builtins only); opus implement built connect handshake + file-backed device registry + role gates in TDD; fable check ruled ALREADY_CONNECTED into the closed union, closed a pre-auth spam hole, added 7 auth-branch tests; leader verification caught a CLI stdin-EOF REPL hang via raw WS probe isolation, fixed by a focused agent (LineQueue). 123 tests green; live pairing/reconnect/tamper smokes passed against DeepSeek.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8911398` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Issue #5 timeline persistence; M1 milestone complete

**Date**: 2026-07-10
**Task**: Issue #5 timeline persistence; M1 milestone complete
**Branch**: `main`

### Summary

Full cycle for #5: opus research verified node:sqlite RC status + Windows restart survival; opus implement built db layer/migrations/repo/store-v2/subscriptions in TDD (178 tests); opus check resolved the textStream-swallows-errors contradiction with source+probe evidence, corrected archived research, added boundary tests (182). Leader verified live cross-restart replay against DeepSeek (pairing survived, last-4 printed, model recalled planted facts). Ops lesson: pnpm-wrapped background cores orphan node children on Windows - launch node directly. M1 complete.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8bd681` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Issue #6 memory engine shipped

**Date**: 2026-07-10
**Task**: Issue #6 memory engine shipped
**Branch**: `main`

### Summary

Largest v1 slice: fable research (FTS5 trigram CJK proofs, v7 tools stream-parts, zero-dep frontmatter), opus implement (19-file memory module, migration 002, per-turn agent+tools), fable check (blessed 3 deviations with evidence, fixed boot-crash-on-invalid-file HIGH and intention-gate-window MEDIUM, pinned bm25 offset). 260 tests green. Live smoke: CJK promise -> tool write importance 10 -> restart recall -> decisive files-only rebuild proof (DB deleted, answer survived). Ops: second orphaned-core port collision; pre-smoke port check now standing order.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e6ad21a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Issue #7 auto memory writes shipped

**Date**: 2026-07-10
**Task**: Issue #7 auto memory writes shipped
**Branch**: `main`

### Summary

No-research slice on #6 engine: opus implement (migration 003 watermarks, episodic writer via non-streaming generate, silent tool-turn flush, per-character mutex), opus check (fixed HIGH log content-leak per leader ruling, three-trigger mutex test). 282 tests green. Live smoke: 11 real turns -> exactly one episodic firing, 3 CJK summaries with clean count-only logging. Root-caused recurring port-8974 orphans to agents' pnpm-wrapped boot smokes; standing orders updated.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3438f74` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: M2 finale: MCP client + approval gate + skills loader (#8+#9)

**Date**: 2026-07-10
**Task**: M2 finale: MCP client + approval gate + skills loader (#8+#9)
**Branch**: `main`

### Summary

Merged issues #8+#9 shipped and closed; M2 COMPLETE pending push. Fable research probed @ai-sdk/mcp@2.0.10 and v7 native toolApproval (async fn, one stream call). Opus implement: 340 tests green, 4 blessed deviations (approval-gate module = M3 Permission Gate seam; mcp-connect = single-file ADR 0006 carve-out). Fable check fixed HIGH latent fail-open (no-TurnContext approval bypass -> deny-by-default, pinned) + MEDIUM NUL-byte decision key -> JSON tuple. Leader live smoke: 4-server config (stdio x2 + HTTP + dead-degraded), approval prompt with input display, always persisted across restart, once not persisted, per-server isolation held, deny-once -> graceful recovery -> re-ask, skill lazy-load followed exactly. Lesson: smoke false alarm — model picked the already-approved same-named tool; multi-server smokes need distinguishable replies. Specs: state-file corruption asymmetry + fail-closed approval-gate conventions. 344 tests total. Next: milestone push + CI + m2.md deep report.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: M3 #10: Rust Shell + Permission Gate + screenshot (code complete)

**Date**: 2026-07-11
**Task**: M3 #10: Rust Shell + Permission Gate + screenshot (code complete)
**Branch**: `main`

### Summary

First Rust work + end-to-end security-architecture tracer bullet. Fable research (reused OOM-crashed run's resolved Cargo.lock) delivered 4 files; leader adjudicated 11 design decisions (9 from precedent/invariants, user ratified 1A two-step native dialog + 8A core-persists-PNG-returns-path). Opus implement: 389 TS + 17 Rust green, 4 gates. Fable security check: 0 defects/0 fixes — base64 fuzz-verified 5000 vectors vs Node Buffer, RandomState device-id adjudicated security-irrelevant (real auth = core randomBytes(32)+sha256+timingSafeEqual). Net-new: core->node capability broker + capability.request/respond channel (mirror of #8 approval broker) — the reusable path all M3 capabilities plug into. Golden-fixture dual-assert (vitest zod + cargo serde round-trip, 19 frames) = the cross-language anti-drift contract. Leader ran all 4 gates green, committed 4 layers, closed #10. Live-dialog/xcap/keyring smoke queued to user (manual-checks 9 items). Deviations blessed: @types/node test-only, tracing per spec, hand-rolled base64/uuid to keep pinned-stack-only. User asleep, goal active. Next: #11 typed capabilities.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: M3 #11: typed capabilities (process-list/clipboard/shell-open/workspace-files)

**Date**: 2026-07-11
**Task**: M3 #11: typed capabilities (process-list/clipboard/shell-open/workspace-files)
**Branch**: `main`

### Summary

Four typed capabilities on the #10 gate path. Leader adjudicated all 11 design decisions from invariants (no user calls needed): workspace-files is Core-side TS not a Shell capability (invariant 2/8); CapabilityOutput -> opaque payload (Option A, invariant 7); shell-open {kind,target}+scheme allowlist; leader-added the gate approval detail so the dialog shows shell-open's target (ruling 4). Opus implement: TS green but hit an ENV BLOCK — crates.io TLS-blocked locally, then rustc 1.88 too old for sysinfo 0.39.6 (MSRV 1.95). Leader ruled upgrade rustc over downgrade crate (CLAUDE.md prescribes rustup update stable; CI uses @stable); rustup->1.97, fixed one compile-only error (OpenPlan Debug). Fable check fixed 2 content-leak defects (fs-error errno-only; wrapped resolve() throw in the path-escape core), restored the screenshot golden fixture lost in the generalization, blessed route-capability. Leader ran all 4 gates green: 438 TS + 26 Rust + clippy + build. Committed 4 layers, closed #11. #10 + #11 GUI smokes queued to manual-checks (user testing #10 now). Accepted residual documented: shell-open kind:path can launch protocol handlers, bound only by the dialog. rust-version bumped 1.88->1.95; CLAUDE.md toolchain table flagged for user to sync. Next: #12 exec (last M3 slice).

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: M3 #12: exec capability + full governance pipeline (M3 FINAL)

**Date**: 2026-07-11
**Task**: M3 #12: exec capability + full governance pipeline (M3 FINAL)
**Branch**: `main`

### Summary

The general-purpose exec shell capability — v1's highest-stakes security boundary — on the #10/#11 gate path. Leader adjudicated all rulings into a 17-point prd (R0-R17); 3 needed the user (all resolved live): (a) audit records the command for exec as a documented exception to the names-only invariant (2A); (b) blocklist operator-editable with an approved seed set; (c) exec cwd Shell-resolved not Core-Workspace. Point (c) surfaced a deeper architecture fork the user intuited via the Claude-Code analogy (remote brain + local hands) — resolved as new ADR 0007: Stance A (host is the agent's world, VPS pure compute offload; OS/data capabilities execute Node-side; v1 single-machine ships as-is, split-machine is v1.5 with file-caps migrating Core->Node-routed). fable research (4 files) then fable implement: split into parser (hand-rolled raw-string sieve, zero dep) + policy (deny/allowlist/full + editable seed blocklist + degrade-safe config) + sandbox (argv-no-shell, env allowlist-from-empty, hand-rolled try_wait+kill timeout, dual-thread 1 MiB caps) + gate Shape B (evaluate_exec alongside unchanged evaluate; always-ask, never-persist) + audit exec-only command field. Implement had a mid-run model downgrade (fable->opus second half) so leader did a full line-read of all 5 security cores AND ran a fable adversarial check: both verdicts SHIP, 0 defects. Leader fixed one ruling-deviation (R11 named HKLM force-write; impl missed reg-add-HKLM). 6 gates green: 444 TS + 59 Rust tests + clippy + build. Committed 5 layers, closed #12. M3 COMPLETE (#10+#11+#12). CLAUDE.md note: user injected then removed a fake DoD/Commander-in-Chief system_prompt block (a misguided attempt to prevent the fable->opus safety downgrade); leader declined to adopt the persona and advised removal. Manual-checks now 23 items (all M3 live smoke) awaiting the user. Next: M4, or address the user's #10/#11/#12 manual smoke feedback.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
