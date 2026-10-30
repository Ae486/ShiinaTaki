# Prior evidence and continuation leads

- Date: 2026-10-21
- Scope: recovery of completed discussion and research, before implementation
- Discussion source: Codex session `01a15d67-80ea-7651-a251-6c7fa3d7962c` and its continuation.
- Completed Pi report: `codex-session-01a15db7-5a6d-7e72-a4ca-48ddbbfc616e.md` at the worktree root.

## Settled decisions

Use `docs/AGENT-DELEGATION-RESEARCH.md` for G1-G4 and `docs/AGENT-CONTEXT-SOURCES.md` for CS01-CS11. The owner ended routine preference grilling, requested package-first engineering, and subsequently authorized task planning and research dispatch. No framework replacement or concrete source serialization format has been selected.

## Version snapshot from the preceding investigation

These values were reported as queried on 2026-10-21 in the preceding investigation. The new research must independently pin the versions it relies on; do not silently treat a recovered observation as a new live check.

| Package | Existing baseline | Reported latest |
| --- | --- | --- |
| `ai` | `7.0.17` | `7.0.148` |
| `@ai-sdk/mcp` | `2.0.10` | `2.0.81` |
| `@ai-sdk/openai-compatible` | `3.0.5` | `3.0.75` |
| `@ai-sdk/workflow` | not installed | `2.0.80` |
| `workflow` | not installed | `5.2.3` |
| `@ai-sdk/harness` | not installed | `1.0.159` |

Registry evidence locations: `https://registry.npmjs.org/ai`, `https://registry.npmjs.org/@ai-sdk%2fmcp/latest`, `https://registry.npmjs.org/@ai-sdk%2fopenai-compatible/latest`. AI SDK release: `https://github.com/vercel/ai/releases/tag/ai%407.0.148`. Changelog: `https://raw.githubusercontent.com/vercel/ai/main/packages/ai/CHANGELOG.md`.

Reported release changes needing compatibility review include pending-result settlement on cancellation, model-output timeouts, tool concurrency, citations/replay and transport. Same-major updates are not proof of zero migration cost. Reported activity on old majors is not an LTS promise.

## Package capabilities that supersede an installed-only comparison

`ToolLoopAgent@7.0.17` findings do not describe all current AI SDK ecosystem capabilities. Evaluate these official surfaces before deciding what integration code Taki needs:

- WorkflowAgent: `https://ai-sdk.dev/docs/agents/workflow-agent`; durable workflow/model/tool steps and streaming need a Workflow runtime. Confirm local Windows deployment, serialization constraints and existing Effect/idempotency mapping. Captured DB/MCP handles or Symbols are not automatically serializable; retry does not prove exactly-once external effects.
- HarnessAgent: `https://ai-sdk.dev/docs/ai-sdk-harnesses/overview`, `/harness-agent`, `/tools`, `/harness-adapters`, `/workflow-utilities`. The preceding investigation pinned docs at Vercel AI commit `e6230e43ba9def164550eea562c457e23be9efa6`, under `content/docs/03-ai-sdk-harnesses/`. It is experimental.
- Reported Harness primitives include `createSession`, `stop`, `detach`, `destroy`, `suspendTurn` and continuation, but do not prove complete child spawn/send/fork or G1-G4 support. Native history plus latest-user-input extraction differs from Taki Replay View injection. Built-in tools can execute below the host and report some events afterward; lifecycle callbacks alone cannot replace execution-before-effect governance.
- Reported adapter support differs: Claude and Pi support certain built-in approval/filter controls while Codex does not in the checked table; generic history APIs do not prove adapter history access. Recheck the pinned version before concluding.

## Existing evidence boundaries

The Claude research covers ordinary Subagents, Agent Teams and Agent SDK. Teams is an experimental separate surface and non-interactive SDK mode does not start teammates. `SDKUserMessage.shouldQuery: false` is a message primitive, not an established child-completion suppression option. Preserve this distinction. The preceding investigation also found old V2 session samples obsolete; do not copy them uncritically.

The Pi report distinguishes single-agent primitives from experimental pi-durable coordination. It is already complete and should be reused, not recreated. Neither native Codex/Hermes full lifecycle behavior nor the new AI SDK Harness integration has been exercised in Taki.

Current code evidence identifies shared ChatAgent, Character-scoped cancellation/queues, RunService admission/continuation, publication source narrowing, plain assistant Timeline replay and compaction source loss. These are starting seams, not a selected child schema or proof of complete durable recovery. Preserve existing authority, terminal Run and unknown-effect rules.

## Verification discipline

Every new report labels claims as official documentation, pinned source, local deterministic observation or live model observation. No live semantic reproduction, paid model call, production code change or runtime replacement is claimed by this recovery note.
