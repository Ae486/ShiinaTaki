# Research: Callable LLM paths and usage coverage

- Query: Which currently wired Core LLM paths produce canonical `run_usage` records, separate diagnostic accounting, or no durable request-level token evidence?
- Scope: internal; current dirty worktree composition and direct callers only.
- Date: 2026-11-01
- Authorization: read-only source investigation; this file is the sole new owned artifact. No configuration, credentials, raw conversation, database mutation, model call or Git operation.

## Findings

### Boundary and evidence qualification

`run_usage` is a Run/Attempt model-effect ledger, not automatically an account-wide API ledger. `createRunObservabilityModel` returns the original unwrapped model unless **all** of lifecycle, Run ID and Attempt ID are supplied (`packages/core/src/agents/run-observability-telemetry.ts:35`). The tracked branch installs model middleware and telemetry (`run-observability-telemetry.ts:39`, `:66`). Model completion supplies normalized usage to `lifecycle.settle` (`packages/core/src/agents/model-observability.ts:106`, `:121`); the effect repository is the authoritative SQLite usage writer (`packages/core/src/db/effect-repo.ts:4`). Main's window-calibration `onUsage` hook is a separate purpose, not the ledger writer (`packages/core/src/main.ts:546`).

The parent measured that all 288 historical usage rows map to model effects. That confirms the sampled ledger's internal mapping; it cannot prove there were no calls outside this boundary. The current source is dirty/newer than the October 28 sample and must not be treated as an exact deployment snapshot.

### Structural coverage matrix

| Currently callable path | Actual composition/call proof | Canonical Run usage | Other evidence and reconstruction limit |
| --- | --- | --- | --- |
| Primary chat, image chat, initiated/scheduled/delegated ChatAgent work | Main injects `model`, `effectLifecycle`, optional `visionModel` into the shared ChatAgent (`main.ts:475`), and reuses that agent with `runs`/`effects` for initiative and subagents (`main.ts:613`, `:618`). Attempt creation calls `createRunObservabilityModel` and installs telemetry (`agents/agent-attempt.ts:69`, `:119`). | Covered when the caller supplies its Run/Attempt identities; image routing alone does not bypass the observer. | Per-request model effects and settled usage are durable. Runtime/persistence failures or missing provider usage remain separate conditions. Source alone does not certify every historical request's coverage. |
| Compaction summary | `memory/runtime-composition.ts:164` composes the coordinator with shared Utility Slot and no Run/effect observer. `agents/compaction-coordinator.ts:156` flushes first; only after success does `:166` run `generateText` directly on `slot.model`. | Bypasses this observer. | Utility's process-lifetime counters read returned usage; compaction operations/checkpoints record workflow/summary state, not a request-level tariff/cache ledger. A failed pre-summary flush never reaches this summary call. |
| Canonical-local write gate and extraction | `memory/canonical-local-subsystem.ts:31` injects the Utility Slot. `memory/canonical-ingestion-model.ts:40` runs the write gate directly on `slot.model`; `:57` runs extraction after a keep decision. | Bypasses this observer. | The slot receives the complete SDK result before parsing the decision/facts, so successful returned input/output can be included in transient totals. Durable ingestion spans prove stages/coverage, not complete request/cache costs. Empty source skips the gate; keep/skip and failures change how many calls occur. The measured provenance blocker occurs before these calls. |
| Private worker context summary | `harness/subagent-execution.ts:144` supplies existing Effects/Run/Attempt identity. `agents/private-task-summarizer.ts:24` wraps the Utility model with `createModelEffectMiddleware`, then calls `generateText` at `:31` with `maxRetries: 0`. | Already covered by direct middleware settlement; do not add a second usage record. | `model-effect-middleware.ts:43` and `:175` settle direct generation with usage when no SDK observer is attached. Utility also sees the returned result, so its totals must not be added to canonical usage without deduplication. Current source coverage does not imply this feature existed in the old sample. |
| Legacy pre-retirement memory flush | `memory/bootstrap.ts` composes the legacy flush writer; `memory/flush-writer.ts:50` creates a direct ToolLoopAgent on the provided model, optionally via the Utility Slot. | Bypasses this observer. | May make multiple provider requests per silent tool loop. Successful writes and operation logs are not provider request counts; Utility task count is not sufficient to reconstruct them. |
| Legacy episodic extraction | `memory/episodic-writer.ts:66` creates a direct ToolLoopAgent, parses/writes extracted facts, then returns only `{ entryIds }`. | Bypasses this observer. | The returned value no longer contains SDK usage; any enclosing Utility accounting marks usage unknown. Written-entry counts do not count provider requests or paid empty/failed extractions. Applicable only while the legacy runtime is selected. |
| Tidy maintenance/manual tidy | `memory/canonical-local-subsystem.ts:32` injects shared Utility Slot. `memory/tidy-pass.ts:135` submits a task; `:155` uses `slot.model` directly with tool-loop steps, and `:165` returns the SDK result. | Bypasses this observer. | Separate memory events/logs contain edit/step/duration evidence (`tidy-pass.ts:145`). Returned Utility usage is cumulative since boot, not a durable per-request record. A clean report returns before constructing an agent (`:129`). |
| Detached image-description memory writer | Main constructs it only with a configured vision model (`main.ts:258`); ChatAgent fires the image hook detached (`agents/chat-agent.ts:324`). `memory/image-description-writer.ts:57` creates a direct ToolLoopAgent and reads only text, then writes one episodic entry. | Bypasses this observer and the Utility Slot for the VLM call. | Persistent description entries establish successful storage, not request counts/tokens; missing bytes/empty text/failures may leave no stored description. A later memory ingestion triggered by the write is a separate operation. |
| On-demand screenshot description | Main shares one describer (`main.ts:328`). `capabilities/screenshot-describe.ts:51` supports optional execution, but the actual tool invocation at `capabilities/screenshot-tool.ts:68` passes only image/media/prompt input. | Current caller does not forward execution, so this VLM request is untracked by the Run observer. | The description helper's available observer seam is not proof of connected accounting. The outer screenshot tool Effect does not itself count the inner VLM request. |
| Ambient screenshot description | Perception's declared description callback takes only image/focus input (`perception/perception-layer.ts:45`), using the same shared bridge. | No Run/Attempt observer supplied by this callback type. | Ambient screenshot/presence records can establish samples, not all model attempts or their tokens. Additional caller tracing is needed for exact successful-call/skip/failure counts. |

### Utility accounting is partial and transient

The Utility Slot has no database dependency or effect lifecycle in its API (`memory/utility-slot.ts:20`, `:29`). It uses a process-local totals object (`:42`), increments `calls` once per queued **task** before that task executes (`:52`), and logs only label plus `UTILITY_TASK_FAILED` on exceptions (`:61`). This is not evidence that each task made exactly one provider request: tasks can fail before dispatch or use multi-step ToolLoopAgent generation.

`account` reads only a returned object's `.usage.inputTokens` / `.usage.outputTokens`; it does not read `.totalUsage`, cache-read/write, reasoning, endpoint, response ID, currency or rate version (`utility-slot.ts:96`, `:104`). Missing fields add no known tokens but increase `usageUnknown`; this means **unknown**, not zero spend. On task exceptions, previously returned/partial provider work is not recovered by this totals object. Process restart discards the counters, so current totals cannot reconstruct the October sample.

The installed AI SDK 7.0.148 `DefaultGenerateTextResult.usage` getter returns `this.totalUsage` (`packages/core/node_modules/ai/dist/index.js:3415`). Therefore a successfully returned complete SDK result, such as tidy or canonical gate/extraction, supplies aggregated multi-step input/output through `.usage`; it is incorrect to diagnose last-step-only counting from this field name. Actual gaps are task versus request counts, missing cache/reasoning/presence detail, process-lifetime storage and lost result usage. Legacy episodic extraction returns `{entryIds}` and legacy flush returns `{writes}` before slot accounting (`flush-writer.ts:61`), so those wrappers erase usage and produce unknown counters.

### Compaction failures are not summary calls

The coordinator explicitly awaits retirement flush before building the summary prompt or running its Utility task (`compaction-coordinator.ts:156-166`). The parent's 22 measured operations failed before this call. Do not count them as 22 failed summary generations or estimate a summary bill from their operation count. The pre-summary flush/extraction may itself call a model; that must be proven from the selected memory path and its operation state, not assumed from the compaction label.

### Files found / related specs

- `packages/core/src/main.ts`: actual process composition and model/Run/Utility/VLM dependencies.
- `packages/core/src/memory/runtime-composition.ts`: selected memory runtime, shared Utility Slot and detached compaction composition.
- `packages/core/src/agents/run-observability-telemetry.ts`, `model-observability.ts`, `model-effect-middleware.ts`: canonical per-request effect/usage boundary.
- `packages/core/src/memory/utility-slot.ts`: process-lifetime task accounting and unknown-use flags.
- `packages/core/src/agents/compaction-coordinator.ts`: flush-before-summary ordering and summary operation/checkpoint settlement.
- `packages/core/src/memory/{episodic-writer,flush-writer,tidy-pass,image-description-writer}.ts`: directly invoked background model paths.
- `packages/core/src/capabilities/screenshot-describe.ts`, `perception/perception-layer.ts`: tracked vs untracked shared screenshot bridge.
- `.trellis/spec/backend/agent-runtime.md:267-303`: provider-neutral runtime and normalized request-level usage expectations. Accounting additions should not introduce provider-private caching controls.
- External references: none added; this narrow investigation uses direct local source. Installed AI SDK 7.0.148 usage conventions were already verified in `reference-cache-practices.md`.

## Caveats / Not Found

- This is structural coverage, not a proved missing bill, historical call count or invoice reconciliation.
- Canonical ingestion and private-summary composition were directly verified by the parent investigator after the research agent hit a service rate limit. The matrix distinguishes the untracked canonical gate/extraction from the already tracked private summary. No historical count or token estimate is inferred from current wiring alone.
- Core records may cover operational success independently of token accounting. Persisted facts, screenshots, flush writes, compaction attempts and tidy steps do not reconstruct every provider request, retry, empty output or failed/cancelled call.
- No production telemetry instrumentation or paid reproduction was authorized/performed. The parent owns actual database evidence and the historical-version comparison.
