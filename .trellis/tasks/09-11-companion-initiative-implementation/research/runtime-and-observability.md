# Research: Runtime and observability adaptation - index

- Query: Define concrete admission, autonomous-context, tool/outcome, held-delivery and Monitor adaptations on the existing framework, including lifecycle and compatibility hazards.
- Scope: internal; current T4 source, existing specs and the parent Heartbeat research. Signal/Pattern/Intention/Presence domain design and Memory integration inventory remain parent/peer responsibilities.
- Date: 2026-09-11
- Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`; new task metadata is `planning`.

## Findings

The assessment is split for Trellis context injection. Each part is below 30,000 UTF-8 bytes, within the 32,768-byte per-context-file cap. Load the relevant part files, not this index alone, for implementation.

| File | Content | UTF-8 bytes |
| --- | --- | ---: |
| [Runtime contracts](runtime-contracts.md) | Current source boundaries; admission/priority; thin context; tool restriction and terminal decisions; held delivery and budget accounting; runtime Skill installation; User Timezone gap and child responsibilities. | 24,902 |
| [Observability contracts](observability-contracts.md) | DSH business facts; pre-admission policy diagnostics; schema compatibility; complete file ownership and cross-layer tests; related specs and assessment caveats. | 15,393 |

### Key findings

- Reuse the existing Run/Attempt/Effect ledger and ChatAgent loop. Atomic background admission, thin captured context and run-specific tool/terminal contracts are required extensions within this task.
- Pure text may be a post-execution Timeline projection. Held expression work keeps the original Run/Attempt non-terminal while releasing the Character slot; guarded resume and continuation-aware recovery must ship together. No mid-tool-chain preemption or forced interruption at busyMaxWait.
- Delivery budget reservation/commit, confirmed transport send, frontend presentation and ignore-backoff are separate facts. Release unused capacity only before publication; uncertain fan-out is charged conservatively without creating duplicate utterances.
- Extend the existing Monitor with versioned business facts and reader-first compatibility. Persist bounded pre-admission policy diagnostics without dummy Runs or a second execution ledger.
- Install the Pattern-authoring runtime Skill through the standard byte-based Skill import lifecycle, preserving user packages. Extend the existing User Timezone singleton with fixed/follow authority, authenticated device reports and future schedule recomputation; VPS local time is not user authority.

## Sources and constraint retention

All 14 original assessment sections are retained verbatim exactly once across the two part files, including the Timezone addendum, Skill installation contract, source paths/line references, proposed implementation ownership, critical tests, related specs and dated verification limitations. This index is a navigation summary, not a duplicate body.

## Caveats / Not Found

This operation only repackaged research. It ran no tests/services, made no Git or task-state changes, and changed no parent artifacts, other research, production code or specs. Root remains responsible for curating the new part files into child context manifests.
