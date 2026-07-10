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
