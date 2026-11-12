# Research: Coordinated upgrade of the existing AI SDK packages

- Query: Which exact AI SDK package set can replace the installed baseline, what behavior changes affect Taki's existing execution/governance/serialization seams, and how can a dirty-tree baseline and rollback be established without losing work?
- Scope: mixed — registry/release/pinned upstream source and local static inspection; no installation, baseline test execution, production edits, Git operations by this researcher, or live model calls.
- Date: 2026-10-21
- Workspace: `H:/TakiAgent-worktrees/t4` only.
- Task: `.trellis/tasks/10-21-agent-delegation-source-context`, supplied by the coordinator's verified session-scoped task lookup. `.trellis/.current-task` still contains `.trellis/tasks/09-03-avatar-presentation-lab`; it is a stale legacy global pointer and was not used as write authority.
- Execution status: **planning only**. The owner explicitly requires a further instruction before formal task start. All commands below that install packages or run tests are proposed future checks, not completed work.

## Findings

### Recommendation

Select `ai@7.0.148`, `@ai-sdk/mcp@2.0.81`, and `@ai-sdk/openai-compatible@3.0.75` as one coordinated upgrade candidate. All three current stable tags were independently read from npm during this research, and all three GitHub package tags resolve to the **same commit**, `e6230e43ba9def164550eea562c457e23be9efa6`. Their exact internal dependencies converge on `@ai-sdk/provider@4.0.31` and `@ai-sdk/provider-utils@5.0.65`. Do not update one package alone, force a transitive version through overrides, or interpret patch numbering as proof of unchanged behavior.

Prefer exact direct manifest pins for this compatibility slice, plus the reviewed lockfile. Existing caret ranges already allow these versions, but an unconstrained refresh can also move unrelated dependencies in this very dirty workspace. If existing manifest range style is retained instead, explicitly record the selected lock resolutions and use frozen installs; do not accept floating `latest` as the release identity.

The candidate is **metadata/source-compatible with the current Node 24 baseline**, not yet runtime-accepted. Required package upgrades and optional adoption of `@ai-sdk/harness`, `@ai-sdk/workflow`, or a Workflow runtime are separate decisions. Upgrading existing packages neither creates retained child conversations nor implements G1–G4, and their adoption is not required for this dependency slice.

### Evidence levels and reproducibility

| Evidence class | Obtained here | What it establishes |
| --- | --- | --- |
| Registry metadata | Fresh stable tags, old/target metadata, transitive metadata and publication timestamps | Package versions, dependency/peer/engine constraints and integrity |
| Release/pinned source | GitHub tag refs, AI release metadata, npm tarball sources and official docs; extra provider-utils source pinned to the same commit | Actual implementation and documented changes at the selected release |
| Local deterministic observation | Node/pnpm version commands; Node `createRequire` resolution and package metadata reads; local manifests/lock/source/test inspection | What this worktree currently resolves and the available verification seams |
| Local test execution | **None** | No passing baseline or target compatibility result is claimed |
| Live model/MCP service behavior | **None** | No provider quality, billing, attribution accuracy, production-server compatibility or real-model success is claimed |

Evidence is retained under `research/sdk-upgrade/`: three bounded registry JSON files (old/target entries only), three downloaded npm tarballs and their unpacked package source/docs, GitHub release/tag JSON, transitive metadata JSON, and pinned provider/provider-utils changelogs plus the shared streaming-tool-call tracker. Total extracted evidence was approximately 11.6 MB / 795 files before the additional small metadata/source files. Archives were **downloaded and inspected, never installed**. Every target tarball's computed SHA-512 matched its npm `dist.integrity`.

| Package | Publication UTC | Exact archive URL | Verified SHA-512 integrity |
| --- | --- | --- | --- |
| `ai@7.0.148` | 2026-10-21T02:22:48.836Z | `https://registry.npmjs.org/ai/-/ai-7.0.148.tgz` | `sha512-FPgfIAhz/FrlzcvqTN7pGGibahR5rD19NXZWX9WQ1tskTic+CN+jxvubpreyq8uN1maIEHPwvZmil/3IYN8FIw==` |
| `@ai-sdk/mcp@2.0.81` | 2026-10-21T02:29:17.693Z | `https://registry.npmjs.org/@ai-sdk/mcp/-/mcp-2.0.81.tgz` | `sha512-2ZqfHLu1K93uPse+QWbcNjkznCtM6UHMoNWjUDpmM9kCr+y9bWcf5VWfNAWi4ziQoncZPJo2qUWeDIXgrqLsKg==` |
| `@ai-sdk/openai-compatible@3.0.75` | 2026-10-21T02:20:15.248Z | `https://registry.npmjs.org/@ai-sdk/openai-compatible/-/openai-compatible-3.0.75.tgz` | `sha512-Zs+EWsK1XprpCR6+VIva50W2YuD3TNSymd5DKFh8XSrroK0copxm2BlSDRKWVdx3SZEh1XqD+1cgYzGR7huL4A==` |

Primary URLs (time-sensitive endpoints were downloaded; rely on the pinned entries):

- `https://registry.npmjs.org/ai`
- `https://registry.npmjs.org/%40ai-sdk%2Fmcp`
- `https://registry.npmjs.org/%40ai-sdk%2Fopenai-compatible`
- `https://registry.npmjs.org/ai/7.0.148`
- `https://registry.npmjs.org/@ai-sdk%2Fmcp/2.0.81`
- `https://registry.npmjs.org/@ai-sdk%2Fopenai-compatible/3.0.75`
- `https://api.github.com/repos/vercel/ai/git/ref/tags/ai%407.0.148`
- `https://api.github.com/repos/vercel/ai/git/ref/tags/%40ai-sdk%2Fmcp%402.0.81`
- `https://api.github.com/repos/vercel/ai/git/ref/tags/%40ai-sdk%2Fopenai-compatible%403.0.75`
- `https://github.com/vercel/ai/releases/tag/ai%407.0.148`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/ai/CHANGELOG.md`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/mcp/CHANGELOG.md`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai-compatible/CHANGELOG.md`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/provider-utils/CHANGELOG.md`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/provider/CHANGELOG.md`
- `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/provider-utils/src/streaming-tool-call-tracker.ts`

### Installed baseline and compatibility matrix

Local `node --version` returned `v24.18.0`; `pnpm --version` returned `10.22.0`. Root `package.json:6` declares `pnpm@10.22.0`; `package.json:7` requires Node `>=24` and pnpm `>=10`.

Node `createRequire` rooted at `packages/core/package.json` resolved the three actual packages into **this worktree's** `node_modules/.pnpm/`, with versions exactly matching the current lock importer. This is more reliable than a caret manifest alone. Direct resolution of transitive `@ai-sdk/provider` from Core fails under pnpm's isolation because Core does not declare it; its version was read from the selected parents and lock snapshots, not assumed to be a Core import.

| Package | Core manifest | Current lock / actual installed | Proposed target | Node / peer constraints |
| --- | --- | --- | --- | --- |
| `ai` | `^7.0.17` | `7.0.17(zod@4.4.3)` | `7.0.148` | Node `>=22`; zod `^3.25.76 || ^4.1.8` |
| `@ai-sdk/mcp` | `^2.0.10` | `2.0.10(zod@4.4.3)` | `2.0.81` | Same Node/zod constraints |
| `@ai-sdk/openai-compatible` | `^3.0.5` | `3.0.5(zod@4.4.3)` | `3.0.75` | Same Node/zod constraints |
| `zod` | `^4.4.0` | `4.4.3` | Retain `4.4.3` | Already satisfies every selected peer |
| `@ai-sdk/provider` | Transitive | `4.0.2` for AI/compat; `4.0.3` for MCP | All three exactly `4.0.31` | Node `>=22`; dependency `json-schema@^0.4.0` |
| `@ai-sdk/provider-utils` | Transitive | `5.0.5` for AI/compat; `5.0.7` for MCP | All three exactly `5.0.65` | Node `>=22`; same zod peer |
| `@ai-sdk/gateway` | AI transitive | `4.0.13` | AI exactly `4.0.121` | Node `>=22`; same zod peer; provider/utils exact target set |
| `cross-spawn` | Core exactly `7.0.6` | `7.0.6` | Retain current direct pin; MCP now requires `^7.0.6` | New upstream stdio implementation uses it |
| `pkce-challenge` | MCP transitive | Required `^5.0.1` | MCP still `^5.0.1` | Review final lock resolution, no standalone refresh needed |

`provider-utils@5.0.65` additionally requires `undici@^7.29.0`, `@workflow/serde@4.1.0`, `eventsource-parser@^3.0.8`, and `@standard-schema/spec@^1.1.0`. Current lock already contains serde `4.1.0`, schema spec `1.1.0`, parser `3.1.0`, but no `undici` package (only `undici-types`). `undici@7.29.0` declares Node `>=20.18.1`, satisfied by Node 24.18.0. Gateway requires `@vercel/oidc@3.2.0`, which declares Node `>=20`. Serde/oidc have no dependencies in the queried metadata. These pinned metadata checks establish the minimum compatible transitive set; the actual newly generated lock must record whatever allowed `undici`, PKCE, parser and cross-spawn versions pnpm chooses. No install/resolver dry run was performed, so the **complete future lock graph is not claimed**.

Important: presence of `@workflow/serde` transitively does not install or activate the separate Workflow runtime, and it is not approval to introduce that runtime.

### Local files and existing code patterns

| File / location | Verified responsibility and relevance |
| --- | --- |
| `packages/core/package.json:14`; `pnpm-lock.yaml:131`, `:2013`, `:2558` | Three direct ranges, importer resolutions and old provider/utils dependency duplication |
| `packages/core/src/agents/chat-agent.ts:319` | Real `ToolLoopAgent` settings: stable tool order, disclosure via `prepareStep`, telemetry integrations and per-completed-step recording |
| `packages/core/src/agents/chat-agent.ts:358` | Per-call abort signal; stream consumer observes every part; non-primary settled text and deferred usage reads are after consumption |
| `packages/core/src/agents/chat-agent.ts:332` | Completed-step callback records provider response messages before a later request can fail; crucial to no effect replay |
| `packages/core/src/agents/model-effect-middleware.ts:39`, `:76`, `:100`, `:159` | `v4` middleware prepares Effect before provider dispatch; stream failure/cancel settles unknown outcome; successful normalized usage settles separately |
| `packages/core/src/agents/run-observability-telemetry.ts:43`, `:64` | Wraps the model and binds model/tool callbacks to one immutable invocation bridge |
| `packages/core/src/config/provider-factory.ts:23` | OpenAI-compatible text/vision construction; main streaming usage is explicit opt-in; vision is separately uncalibrated |
| `packages/core/src/mcp/mcp-connect.ts:7`, `:22` | Sanctioned SDK MCP import and stdio/HTTP factory; currently does not forward an initialization abort/timeout option |
| `packages/core/src/mcp/mcp-candidate.ts:59`, `:86`, `:214` | Bounded local list pagination with repeated-cursor guard; one candidate deadline; nullable preparation/filtering before `toolsFromDefinitions` |
| `packages/core/src/mcp/mcp-stdio-launch.ts:32`; `mcp-stdio-relay.mjs:15` | Existing Windows shim relay and hidden child spawning; do not delete it just because newer MCP uses cross-spawn |
| `packages/core/src/memory/canonical-ingestion-model.ts:43`, `:67` | Ordinary ToolLoopAgent text output is parsed by local strict schemas; no automatic migration to SDK `Output.object` |
| `packages/core/src/memory/hindsight/hindsight-policy-curator-model.ts:22` | Existing bounded utility ToolLoopAgent with `maxRetries: 0`, proposal tools, per-step guards and abort |
| `packages/core/src/agents/compaction-coordinator.ts:166` | Compaction uses `generateText` under the Utility Slot, with separate cancellation |
| `packages/core/src/co-watching/runtime-model.ts:87` | Co-Watching private preparation runs the shared non-primary ChatAgent and validates completed JSON task files; not SDK structured-output enforcement |

The known seams were read directly; no speculative remapping of Core was performed. Prior design evidence was reused from `docs/AGENT-DELEGATION-RESEARCH.md` (especially lines 89–106, 132–137, 172 and 219) and parent `research/prior-evidence.md`.

### Meaningful changes: cancellation, tool execution and Effects

Source paths below refer to retained npm package source unless explicitly labelled local. They can also be inspected under `packages/<package>/src/` at the pinned GitHub commit.

| Release change | Pinned implementation / release reference | Consequence and required verification |
| --- | --- | --- |
| Pending stream/result promises settle on abort (`ai@7.0.130`, `6f6b9c0`) | AI `src/generate-text/stream-text.ts:1933`: abort listener rejects result promises **before** callbacks and cancels the reader without awaiting a potentially stuck provider cancellation | Test abort before provider setup, during a stalled body, after partial text, and while tool execution is pending. Await result text/usage/steps as well as iterator close under a bounded deadline; no unhandled rejection or indefinitely pending promise. Core owns Effect/Run classification, not a resolved SDK callback. |
| No `onEnd` after abort of a multistep stream (`7.0.106`, `2d53a5d`); telemetry stream failure closure (`9c1ea74`) | `stream-text.ts:1821` checks abort before final end notification | Retain per-step capture and middleware failure settlement; do not move durable commit or Effect settlement exclusively into `onEnd`. Verify one terminal effect/usage record per actual request, including retry and stale duplicate callbacks. |
| Abort reasons survive tool cancellation (`7.0.32`, `a4eb3f3`) | Stream abort callback carries original reason; serialized abort part uses a message representation | Existing graceful/string-reason/partial paths may finish differently. Tests must preserve original thrown reasons where appropriate and keep stopped partial text/retract semantics. |
| Tool concurrency option (`7.0.140`, `9523eb0`) | `src/generate-text/tool-call-concurrency.ts:6`, `:38`; `agent/tool-loop-agent-settings.ts:130` | `toolCallConcurrency` is omitted/unlimited by default; positive integer only, 1 sequential. Capped workers preserve input result order and stop taking queued work after abort/rejection. Unlimited path uses `Promise.all`; it does not serialize external actions or make cancellation undo an already started tool. Keep existing default for the dependency slice. Separately configuring a cap is a behavior decision. |
| Unsafe finish reason suppresses automatic execution (`7.0.70`, `a828527`) | `execute-tools-from-stream.ts:228`; `is-tool-execution-allowed-finish-reason.ts:3` permits only `stop` / `tool-calls` | Add length/content-filter/error/other finish cases that include tool-call chunks: no tool Effect/execution should occur. Preserve display/history facts without asserting a tool ran. |
| Model output timeouts exclude local tool duration (`7.0.136`, `7b5497c`); agent configured timeouts work (`7.0.58`, `72ad23f`) | `stream-text.ts:2353` onward handles first/chunk/step timers; `tool-loop-agent.ts:222`, `:287` forwards settings timeouts | Output timeouts stop with model response and reset per retry; step timeout still includes tools. Current ChatAgent does not set SDK timeout, so do not add one silently or override existing Run/candidate deadlines. New tests should distinguish provider silence from slow governed tools. |
| Parseable partial JSON no longer finalizes a streamed compatible tool (`compat@3.0.6`, `ac306ed`) | Shared tracker `provider-utils-src-streaming-tool-call-tracker.ts:429` finalizes only at flush | Particularly relevant: the current installed compat `3.0.5` predates this fix. Use a fake provider SSE sequence whose intermediate arguments are valid JSON but incomplete; execution must receive only the full final input once. This is a reason to upgrade, not proof the current real provider triggered the bug. |
| Missing/blank/repeated tool IDs and unusual indexes are repaired (`compat@3.0.58`, `e3605f6`; `3.0.23`, `1bec07d`) | Shared streaming tracker; adapter uses it | Verify distinct invocation/Effect IDs, exact once execution, complete arguments and tool-call-order results when wire IDs/indexes are absent, repeated or non-contiguous. Current parallel Effect test covers the ordinary case only. |

The current Middleware remains `specificationVersion: "v4"`; target compatible chat model remains `v4` (`src/chat/openai-compatible-chat-language-model.ts:115`). No major provider-version adapter rewrite is implied. Additive provider types still can affect exhaustive code: `compat@3.0.64` notes portable reasoning `max` widens the reasoning union; no project reasoning-level exhaustive map was found in the bounded exact search. The full future typecheck is the authority.

### Provider serialization and structured outputs

Target serializer: `https://raw.githubusercontent.com/vercel/ai/e6230e43ba9def164550eea562c457e23be9efa6/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts`.

- `:20` only maps adapter metadata from the `openaiCompatible` namespace. Unknown generic provenance fields are not automatically sent to the model.
- `:210` optimizes a single user text part to a string and spreads the **part's** adapter metadata; multipart user messages use the message/part conversion path. Inspect actual request bodies for source metadata, not only `ModelMessage` objects.
- `:287` keeps tool-only assistant `content: null`, ordinary assistant text, optional `reasoning_content`, and native tool calls. Changelog entries before `3.0.5` describing this mapping are **existing baseline**, not new upgrade features.
- `:315` JSON/stringifies JSON tool output; `:318` enables multipart tool result mapping only when configured with `supportsMultiPartToolContent`. The new `3.0.62` support (`04be48f`) is optional and provider-dependent. Defaults still stringify the SDK content array. Do not turn the flag on without the chosen provider's evidence.
- Target chat model `:156`, `:246`, `:294` defaults `supportsStructuredOutputs` to false, and chooses `json_schema` only when structured output is explicitly supported; otherwise JSON-mode requests use `json_object`. `strictJsonSchema` is a schema-mode option, not proof arbitrary OpenAI-compatible endpoints honor a strict schema. Main `includeUsage` still writes `stream_options.include_usage` (`:465`).
- Normalized usage clamps negative text token share (`3.0.28`, `83e6510`) and preserves nested raw usage extras (`3.0.31`, `86892f3`). Validate absent counters as unknown; changed raw metadata must not be mistaken for new exact billing completeness.
- AI `7.0.106` fixes structured stream output from the final tool-loop step (`2a5ed55`); `7.0.94` includes parsed output in end callbacks (`6669d69`); `7.0.80/79` improve length/missing-finish-reason parsing. These are available surfaces, not a requested rewrite of Taki's current text/schema/tool/file validation paths.
- Provider-utils `5.0.65` blocks `.internal` download hostnames (`b089ce8`) and adds safe encoding for credentialed follow-up IDs (`39a776b`). Add local URL-download contract cases if provider file downloads are exercised; a legitimate previously permitted internal attachment URL can now be refused. Do not loosen the upstream download guard as routine compatibility glue.

Existing `tool-disclosure.test.ts:200` captures **actual OpenAI-compatible request bodies** with a supplied fake `fetch`. `chat-agent-prefix-cache.test.ts:26` checks normalized provider calls via `MockLanguageModelV4`; it does not establish HTTP serialization or real provider cache hits. These evidence levels must remain distinct.

Official bundled docs are under `research/sdk-upgrade/ai-7.0.148/package/docs/`, notably `03-agents/06-subagents.mdx`, `03-ai-sdk-core/10-generating-structured-data.mdx`, `03-ai-sdk-core/40-middleware.mdx`, `07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`, and `09-troubleshooting/14-stream-abort-handling.mdx`. Corresponding public pages include `https://ai-sdk.dev/docs/agents/subagents`, `https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data`, `https://ai-sdk.dev/docs/ai-sdk-core/middleware`, and `https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent`. This research read packaged official docs/source and did not depend on a successful ai-sdk.dev HTTP fetch.

### MCP upgrade and Windows compatibility

| Change | Source / date-pinned release | Required boundary |
| --- | --- | --- |
| Native Windows shim spawning | MCP `2.0.36` (`b352a6a`); `src/tool/mcp-stdio/create-child-process.ts:2`, `:11`, `:19` | Uses `cross-spawn`; rejects Windows command/argument CR/LF; `shell` defaults false. Existing relay stays initially. Test .cmd/shim, spaces/metacharacters, explicit env/PATH and child shutdown with the actual target package. |
| Explicit env is preserved | `2.0.58` (`1ffd453`); `mcp-stdio/get-environment.ts:28` | Defaults are allow-listed, explicit custom keys win with case-insensitive key handling on Windows. Recheck secret-ref resolution, PATH casing and no inherited unwanted credentials. Do not log env contents. |
| `shell` can be opted in; SSE error exposes response body | `2.0.79` (`fce9210`) | Keep no shell opt-in. New HTTP error context can contain confidential server content; existing sanitized candidate diagnostics must remain sanitized. |
| Modern discovery behavior | `2.0.81` (`060d419`); `mcp-client.ts:675`, `:688` | HTTP waits for `server/discover` instead of the old one-second fallback; stdio/custom keeps probe limit. Test legacy servers, modern-only delayed discovery, discovery refusal and deadline cleanup. Current connect factory does not pass initializationOptions; do not remove outer candidate deadline or claim it aborts the underlying setup. |
| Request/initialization options | `2.0.20` (`97f0565`); `mcp-client.ts:263`, `:569`, `:852` | Package can bound/abort initialization and requests, but not automatically through the current Taki connect signature. Any adapter propagation is a separate small reviewed fix; preserve total candidate budget and late cleanup. |
| Automatic pagination for `client.tools()` | `2.0.37` (`1175434`); `mcp-client.ts:1222` | `listTools()` still issues one page (`:985`). Taki intentionally calls it under its own cursor/deadline/isolation/filter contract and then calls `toolsFromDefinitions`; do not delete the local pagination loop based on the new `tools()` behavior. |
| Structured-only tool results | `2.0.45` (`3da84fd`); `src/tool/types.ts:320` | A result with `structuredContent` and no `content` gains a JSON text content part. Test downstream native-result/schema projection and errors, not just SDK parsing. Automatic definitions still do not turn server outputSchema into mandatory Taki validation; explicitly supplied schemas take the typed path. |

Target stdio `windowsHide` is enabled only when upstream detects Electron (`create-child-process.ts:24`), whereas Taki uses Node/Tauri and the existing relay explicitly hides its child. A Windows-capable dependency is therefore **not** proof of full Taki packaging/process UX parity. Keep the adapter until real Windows fixture and packaged-start checks justify a separate simplification.

No automatic `notifications/tools/list_changed` refresh handler was found in the target client's bounded source/API search. Experimental MCP events/apps/resource/prompt capabilities are separate new surfaces, not evidence that the host's generation publication/lease/permission logic can be replaced. In-flight MCP calls must retain the captured generation and exactly one governed Effect. A locally aborted transport cannot prove an external action did not execute; retain `outcome_unknown` and no automatic effect replay.

The in-flight-request abort/removal fix (`2.0.8`, `3e6e955`) **already precedes installed MCP 2.0.10**; it must not be advertised as newly acquired behavior.

### Related specs

Read this research against `.trellis/workflow.md`, parent `prd.md` R01/R11/R12 and AC01/AC10, and:

- `.trellis/spec/backend/index.md` and `quality-guidelines.md`: runtime Node 24, actual library API evidence, root lint, workspace gates, no type-suppression shortcuts.
- `.trellis/spec/backend/agent-runtime.md`: full completed-turn persistence, truthful tools, stable semantic request prefix and no fresh correlation IDs in prompts.
- `.trellis/spec/backend/permission-authorization.md`: Core policy authority, SDK/MCP closures remain governed, host may only tighten policy.
- `.trellis/spec/backend/mcp-lifecycle.md`: candidate validation, immutable generation publication, captured leases, late cleanup, secret boundaries and truthful unknown outcomes.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md`: definition-stage nullable normalization/tool isolation and actual provider-boundary regression.
- `.trellis/spec/backend/logging-guidelines.md`: preserve original provider responses/exceptions, non-interfering observation, unknown counters and no raw prompt/credential logging.
- `docs/adr/0003-ai-sdk-6-agent-engine.md`: historical title is SDK 6, but the July amendment adopts SDK 7 and August amendment keeps Core authorization above SDK approval primitives.

No spec was edited by this researcher.

### Establish a baseline in the dirty tree

Coordinator-provided read-only provenance, captured during this planning turn: branch `task/t4-skills-mcp-productization`, HEAD `06a8090`; `get_context.py` reported **901 uncommitted changes before new planning docs**. This researcher performed no Git operation. For dependency paths the coordinator reported that only `pnpm-lock.yaml` was already modified; neither root nor Core manifest was modified at that instant.

| File | Coordinator-provided pre-planning SHA-256 |
| --- | --- |
| `package.json` | `C750FA708EBF4A515EAE464529C1538A3B62EC23D484B2AF73796F1E5DD3F4DA` |
| `packages/core/package.json` | `43A88EA5AC7C0F5190D9B50251EFCADCE409C9351334C6AC6619CDEEBCBB6045` |
| `pnpm-lock.yaml` | `4B7EECEA2C08AC1B264D35381EDFA6218F12F9870EBBCF7649A6EDB8B0DC9ACE` |

The intended baseline is **current source + current lock + current installed graph**, not HEAD source/HEAD lock. Before an authorized implementer starts:

1. Recheck cwd, branch, HEAD, session task pointer and all affected path hashes. Ask other writers to finish/freeze SDK-affected source for the comparative run. Keep the main `H:/TakiAgent` worktree out of commands and evidence.
2. Save exact current bytes of Core/root manifests, lockfile, workspace configuration and any source files the compatibility slice may touch to that child task's bounded research backup directory. Record hashes and a source/test tree fingerprint; include untracked/staged source in the audit. This is a working-state checkpoint, not a checkout from HEAD. Do not copy `.env.local`, credentials or runtime DBs into research.
3. Inventory actual resolutions, engines and peer graph from Core. Preserve existing node_modules until the baseline checks finish. Do not run `pnpm install`, `pnpm update`, `pnpm dedupe`, formatters or fix modes as a purported read-only baseline.
4. Run the same bounded fixtures and type/lint/full relevant test checks below against current files, record command, exit status, test failures and source/dependency fingerprints. If tests create tool caches, run with explicitly task-local cache/output where supported and recheck production hashes afterward. A green result applies to the recorded current working tree; concurrent source changes invalidate direct before/after attribution.
5. Treat every existing failure as baseline worktree debt. A target-only failure is a regression only when source/config/test inputs match the baseline or the changed input is explicitly reviewed. Do not fix 901 unrelated changes to make the upgrade appear clean.

No baseline test ran during this research because execution must wait for the owner.

Final researcher readback re-computed the three SHA-256 values above and found them unchanged; this confirms the research did not modify manifests or lock. `research/sdk-upgrade/local-resolution.json` also retains the local package/nested-resolution inventory. Every test file path in the proposed commands was checked to exist; this does not establish that its tests pass.

### Concrete existing gates and missing high-value cases

Commands are designed for a PowerShell implementer after authorization. They deliberately contain no fix mode or live model invocation.

| Gate | Existing command / files | Existing coverage and limits |
| --- | --- | --- |
| Cancellation/persistence/Effects | `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-lifecycle.test.ts src/agents/chat-agent-tail.test.ts src/agents/chat-agent-baseline-integration.test.ts src/agents/chat-agent-overflow.test.ts src/agents/parallel-tool-effect.test.ts src/agents/model-observability.test.ts src/agents/run-observability-telemetry.test.ts` | Graceful and string-reason abort, partial commit/iterator close, completed-step no replay, independent parallel Effects, stale callbacks and failure settlement |
| Provider/disclosure/replay | `pnpm --filter @taki/core exec vitest run src/agents/tool-disclosure.test.ts src/agents/chat-agent-prefix-cache.test.ts src/agents/chat-agent-images.test.ts src/agents/chat-agent-non-primary.test.ts src/agents/turn-mapping.test.ts src/agents/replay-source-loader.test.ts src/config/provider-factory.test.ts` | Fake-fetch actual provider request bodies versus separate normalized mocks; schema disclosure, images, main-slot usage opt-in, non-primary and replay |
| MCP generation/schema transport | `pnpm --filter @taki/core exec vitest run src/mcp/mcp-manager.test.ts src/mcp/mcp-generations.test.ts src/mcp/mcp-manager-change.test.ts src/mcp/mcp-generation-close.test.ts src/mcp/mcp-http.test.ts src/mcp/mcp-schema-compat.test.ts src/mcp/mcp-turn-tools.test.ts src/mcp/mcp-stdio-launch.test.ts src/mcp/mcp-stdio-relay.test.ts` | Real local node:http/stdio fixture, pagination/deadline/late cleanup, selected-tool/schema isolation, raw names, ask denial and lease preservation |
| Governance and Run lifecycle | `pnpm --filter @taki/core exec vitest run src/governance/governed-tool.test.ts src/governance/governed-tool-unattended.test.ts src/governance/captured-tool-execution.test.ts src/harness/run-service.test.ts src/harness/recovery-coordinator.test.ts` | Admission/authority, captured tool invocation, interruption/unknown-effect recovery; no runtime authority bypass |
| Compaction/memory/co-watching | `pnpm --filter @taki/core exec vitest run src/agents/compaction-pass.test.ts src/agents/chat-agent-compaction-seam.test.ts src/memory/canonical-local-ingestion.test.ts src/memory/hindsight/hindsight-policy-curator.test.ts src/co-watching/runtime.test.ts` | Downstream existing ToolLoopAgent/generateText seams and validated structured content; local test evidence only |
| Type and lint | `pnpm -r typecheck`; `pnpm lint` | Whole workspace API/type integration and root lint. `pnpm -r lint` is not equivalent and can match zero packages |
| Full TS acceptance | `pnpm -r test` | Full existing suite, identical baseline/target failure comparison; check test selection for existing explicit live/owner gates |
| Backend handoff gate | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Required backend quality spec; run at overall handoff and classify unrelated baseline failures rather than expanding SDK scope |

`mcp-connect.test.ts:8` offers a real portable `npx` fixture, but includes `npx --yes -c`. It was not run here; review network/cache behavior before using it as an offline/no-install gate. An authorized implementation can prefer the existing process.execPath stdio fixture first and then use a prepared cached shim without package acquisition.

Missing/partial cases to add when implementing the upgrade (these catch upstream risk, rather than mirror version strings):

1. Stalled provider setup/body and stalled provider cancel promise; abort settles every selected aggregate result promise promptly, with one unknown Effect and no automatic re-execution.
2. Unsafe finish reasons plus proposed tool calls cause zero actual tool actions; capped/unlimited concurrent tools preserve result order, governance and independent effects, and no queued start after cancellation in the capped mode.
3. Real compatible adapter fake-fetch/SSE tests for parseable partial JSON, late tool names, repeated/blank IDs and indexes, reasoning plus tool-only assistants, multipart default/opt-in, normalized missing/overreported usage, and actual JSON/schema-mode request serialization.
4. MCP structured-only result, slow modern discovery/legacy fallback, abort/timeout cleanup, explicit Windows env/PATH casing, command CR/LF and metacharacter handling; preserve adapter hidden-child behavior.
5. Model output timeout versus long local tools and retry budgets, plus completed-step persistence before a later failed request. Test these only with bounded deterministic fixtures.

### Minimal upgrade and rollback sequence

**Future execution, pending owner instruction:**

1. Capture the working-state checkpoint and run baseline gates first. A clean HEAD or main worktree is not a substitute for this worktree's baseline.
2. Review the exact three-package target plan and keep optional framework/runtime adoption outside it. Prefer changing just the three Core direct specs to exact versions; preserve zod and every unrelated direct dependency.
3. Generate only the selected dependency lock change with the authorized implementer, e.g. `pnpm --filter @taki/core add --save-exact ai@7.0.148 @ai-sdk/mcp@2.0.81 @ai-sdk/openai-compatible@3.0.75 --lockfile-only`. This is **not executed here**. pnpm may still alter shared lock entries; review the complete diff against the saved working lock before proceeding. Do not use a full `pnpm update --latest` or `dedupe`.
4. Check importer pins, integrity, expected provider `4.0.31` / utils `5.0.65` / gateway `4.0.121`, zod retention and the allowed transitive changes. Resolve unexpected unrelated graph drift by regenerating narrowly, not by restoring the old HEAD lock. Keep the current tree as the authority.
5. Install the reviewed lock with `pnpm install --frozen-lockfile` only after baseline capture and lock review. Re-inventory actual Core resolutions, nested peers and engine warnings.
6. Run the same baseline checks and the meaningful new fixtures. Fix only necessary compatibility changes in governed seams, with exact source ownership. Update comments whose assertions are pinned to old installed versions only when the actual seam changed; do not remove Core pagination/relay/governance because upstream has similarly named features.
7. Run workspace type/lint/test and relevant full backend gates. Record baseline failures separately. After explicit separate authorization, perform limited chosen-provider/live MCP and Windows packaged-start trials, documenting usage, execution/cancellation/serialization and any missing provider features separately from fixtures. Owner/model-behavior acceptance remains pending if not run.

**Rollback:** preserve the pre-upgrade **working** Core manifest and lock, not their HEAD versions. Stop the isolated test/core processes, verify no other writer changed these paths since the checkpoint, and restore only this dependency slice's bytes or selectively remove its reviewed hunks. If concurrent modifications exist, re-merge them; do not copy an old backup over them wholesale. Restore only slice-owned source edits, preserving all other uncommitted work. Use `pnpm install --frozen-lockfile` from the restored current baseline lock and rerun the baseline resolution inventory/focused checks. Keep old package artifacts in the pnpm store so rollback does not depend on a newly changed registry. No stash/reset/checkout/clean, no node_modules recursive deletion, no other-worktree execution, and no restoring the whole source tree. If external actions were ever allowed in later acceptance, SDK rollback does not undo them or clear their unknown Effect records.

## Caveats / Not Found

- Recommended versions are freshly pinned candidates; **no old or new baseline tests, target installation or real-model acceptance occurred**. The owner requires a later instruction before formal execution.
- Complete future pnpm transitive resolutions require an authorized narrow lock generation; metadata compatibility alone is insufficient. Caret transitive undici/PKCE/parser/cross-spawn versions must be recorded from that reviewed lock.
- Current lockfile is already modified, and provenance hashes are a planning-time coordinator snapshot. Recheck at upgrade start; concurrent source edits otherwise confound before/after comparison.
- This researcher was restricted to research writes and used no Git operation. Git provenance/status/hash facts above are explicitly coordinator-provided, not independently rediscovered here.
- Cross-spawn/native Windows support does not establish Node/Tauri hidden-window, process-tree shutdown or packaged distribution parity. Current relay remains an intentionally preserved baseline until separately tested.
- New MCP initialization timeout options are not currently wired through Taki's connect signature. Outer candidate race/late cleanup remains necessary. SDK request cancellation does not establish remote non-execution or exactly-once external effects.
- MCP automatic pagination belongs to `client.tools()`, not `listTools()`; no automatic tool-list-change refresh was found. Neither feature replaces Core candidate schema isolation/filtering and immutable generation leases.
- `@ai-sdk/harness` / `@ai-sdk/workflow` adoption and runtime comparison are owned by a separate research topic. No optional dependency, platform/runtime installation or governance replacement is recommended by this slice.
- Provider JSON/schema/multipart support and actual attribution preservation remain endpoint-specific. Official docs and fake-fetch fixtures cannot establish successful real-model behavior.
- Changelog entries older than the installed baseline were explicitly separated; notably MCP `2.0.8` request abort and compatible `3.0.0` assistant serialization are already existing behavior.
- Memory was used only for prior worktree/governance/no-fake-acceptance guardrails; current version and compatibility claims were verified from live local/registry/pinned-source evidence. No memory file was updated.
