# Reviewed research brief for implementation context

- Date: 2026-10-21
- Current authorization: the owner subsequently permitted development after global-rule optimization and preparation. Global validation and independent readiness review have passed for the SDK child; earlier planning-only wording in full historical research reports is not an active stop gate. Later child contracts/dependencies still apply. Paid/live-model calls, destructive operations and publication remain outside scope.
- Purpose: bounded context injection. Full reports exceed the current 32 KiB per-file injection limit; read their relevant sections directly before editing the corresponding boundary. This brief does not replace the parent/child PRD, design or execution plan.

## Decision and evidence index

| Topic | Reviewed recommendation | Full evidence |
| --- | --- | --- |
| Upgrade | Exact direct candidates `ai@7.0.148`, `@ai-sdk/mcp@2.0.81`, `@ai-sdk/openai-compatible@3.0.75`; one narrow reviewed lock change | [SDK report](sdk-upgrade.md), especially compatibility matrix, concrete gates and rollback |
| Delegation | Keep shared ToolLoopAgent and existing Core owners; add only demonstrated retained-child/input/cancel/completion integration | [Runtime report](delegation-runtime.md), especially requirement matrix, adapter differences, HA hazards and delivery slices |
| Source/prompt | Keep native role/tool framing; supply minimal known material information and preserve it through relevant projections; choose final rendering from actual requests and semantic evidence | [Source report](source-context-prompts.md), especially consumer matrix, shared prompt candidate and evaluation cases |

The three SDK package tags and pinned AI SDK documentation use Vercel AI commit `e6230e43ba9def164550eea562c457e23be9efa6`. The reports preserve official URLs, package versions and local source references. Registry and published source were checked; a few isolated source-based deterministic lifecycle probes ran. No repository baseline/target tests, package install, real model call, native adapter deployment or owner acceptance occurred. Source inspection and a fake adapter cannot establish live model quality, process shutdown or exactly-once external effects.

## Upgrade: preserve existing behavior and working state

Actual local resolutions are `ai@7.0.17`, MCP `2.0.10`, compatible provider `3.0.5`, zod `4.4.3`. Node is `24.18.0`, pnpm `10.22.0`. Proposed packages require Node >=22 and accept the current zod peer. All selected packages converge on provider `4.0.31` / provider-utils `5.0.65`; AI gateway becomes `4.0.121`. Provider-utils adds `undici:^7.29.0`. Exact future transitive resolutions await authorized narrow lock generation; no overrides or unrelated refresh are needed based on current evidence.

The root/Core manifests were unchanged relative to HEAD at planning time; the lock was already modified. Parent verified branch `task/t4-skills-mcp-productization`, HEAD `06a8090`, and 901 existing working changes before planning. Recheck before execution. Save current touched-file preimages/hashes and preserve installed dependencies through the baseline run. The authority is current source/current lock/current installed graph, not HEAD or the other worktree.

High-value upgrade checks:

- Abort before provider setup, during stalled stream or pending tool execution must settle selected aggregate promises and preserve Core Effect classification. Keep per-step capture; `onEnd` need not run after abort.
- Changed streamed tool argument tracking, unusual IDs and unsafe finish reasons must not cause early/duplicate effects. New concurrent-tool controls do not replace Core governance/order or automatically change the default-unlimited concurrency.
- Inspect both normalized SDK prompts and final OpenAI-compatible request bodies. Only supported provider metadata is serialized; arbitrary source fields are not automatically model-visible. Preserve missing usage as unknown and existing structured-output validation; schema/multipart support remains endpoint-dependent.
- Keep Core `listTools()` pagination, schema filtering and generation leases. Upstream pagination is in `client.tools()`, while `listTools()` is still one page.
- Keep Node/Tauri hidden-process relay. Upstream cross-spawn and Electron-conditional `windowsHide` are not equivalent to current desktop behavior.
- Modern MCP HTTP discovery, structured-only results and initialization cancellation need targeted checks. New init abort/timeout options are not automatically wired through Taki's current factory; retain outer deadlines and late cleanup.

After start authorization, the proposed narrow lock command is `pnpm --filter @taki/core add --save-exact ai@7.0.148 @ai-sdk/mcp@2.0.81 @ai-sdk/openai-compatible@3.0.75 --lockfile-only`. Review against the saved working lock, then use `pnpm install --frozen-lockfile`. See the full report's exact existing Vitest command groups for cancellation/Effects, provider/replay/disclosure, MCP, governance/recovery and compaction/memory/Co-Watching. Required general gates include `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` and applicable backend/platform checks. `pnpm -r lint` is not equivalent. Avoid the network-acquiring `npx --yes` fixture when claiming an offline gate.

Rollback restores only this slice's reviewed manifest/lock/source changes to the captured working state, reconciling concurrent edits. Reinstall that saved lock and recheck resolutions. Never reset/clean the worktree or replace a dirty lock with HEAD. Do not infer rollback of external effects from rollback of code.

## Delegation: package gaps and settled semantics

- G1: retain child outcome regardless of whether completion requests parent inference. Record-only completion produces zero completion-triggered parent calls; requested continuation is deduplicated and separately admitted. A parent's ordinary processing of a spawn acknowledgment is not the later completion policy. Inference does not authorize publication.
- G2: parent decides new versus reused child; child continuity is distinct from a terminal Run and does not retain expired authority/tool leases forever.
- G3: selected inherited context is a snapshot; later input is addressed and selected by the parent. Preserve sender, material/direction and relevant origins, without automatic full-history mirroring.
- G4a/G4b: stopping the parent cancels no child and does not change any child's completion intent. Valid completion may request a new parent execution after the earlier parent is terminal.
- G4c: retain a user-stopped child's context; parent messages cannot restart it. Explicit user continuation may admit new work. Parent interruption can be resumed by the parent. Existing budgets, governance, shutdown and uncertain-effect rules still hold.

ToolLoopAgent supplies caller-controlled messages, per-step preparation/recording, governed host execute functions and per-call abort. The official nested example is one-shot, propagates parent abort and has approval restrictions within that nested pattern; do not copy it unchanged or bypass Core Approval.

Relevant current Taki seams are ChatAgent context/callbacks, RunService admission/recovery, Character-keyed TurnRegistry/TurnQueue, Core private history/result projection, Shared controls and Home views. The current non-primary finish path does not persist a full reusable child transcript; selectedContext is initiative-specific. Prepared-publication child Runs do not call a model. These facts require integration work, not a second model loop. Jointly specify child identity, message sequence, result/source shape, stop origin, deduplication and restart mapping before shared schema edits.

WorkflowAgent has real durable steps/streaming but introduces Workflow execution ownership and serializable context restrictions. HarnessAgent has native sessions and experimental active steering on several adapters. Neither was selected:

- HA drops a full message array to its latest user input; passing Taki's Replay View unchanged would lose earlier roles/material.
- Pinned adapter history access is unsupported; generic session methods do not prove parity. Current Codex source has app-server steering/filtering beyond older documentation, but settings changes can restart its thread.
- A deterministic published-class/fake-adapter probe found active HA `stop()` calls suspend, not native stop, with caller-owned sandbox. This is control-dispatch evidence, not a real billing/process test; stop/suspend/detach must not be conflated.
- Native tool lifecycle callbacks can arrive after effects; coarse permission modes are not Core authorization or pre-execution Effect intent.

Use the full runtime matrix when mapping fresh/inherited/reused work, at least two parallel children, targeted input/stop, completion after parent stop, crash between outcome and admission, and uncertain effects. UI must navigate/control the actual child without making its transcript another Character relationship Timeline.

## Source: actual consumers, not tags alone

Keep generation origin and material origin distinct. Native roles/call IDs describe conversation/execution structure; they do not prove who experienced first-person material. Upstream `toModelOutput` can deliberately narrow the child output, so attribution needed by the parent must survive that projection. Asynchronous completion in a new execution must not fabricate tool-call/result pairs.

Known loss points: Co-Watching candidate narrowing drops material/moment fields; delivery/Run/Timeline links retain execution identity, but ordinary assistant replay omits readable source meaning; compaction role/text rendering and later head/tail reductions can lose qualifiers. Preserve sufficient immutable description or verified durable reference using existing owners. A hash, mutable current-plan file or live session is not automatically recoverable source meaning. Legacy unknown attribution stays unknown.

Map these consumers before edits: material description; selected child input; addressed reuse/correction; retained child result; parent inference; candidate/publication; ordinary Replay View; reduction; compaction input/output; original-primary memory gate/Local extraction; native retain/extraction; maintenance/recall/reflection/use. Read the full report's boundary table for required assertions.

**Memory is parallel, not a new sequential ingestion chain.** Canonical ingestion reads exact eligible original primary sources and flushes before retirement. Do not admit raw material, private child rows, non-primary publication or compaction summaries. Source rules interpret eligible quoted/self-report content; they do not rewrite original source wording or add an eligibility shortcut. If an eligible primary reply already lost the subject, repair upstream generation or retain uncertainty. Hindsight wire metadata/storage does not prove native extraction/reflection uses it, and the policy curator cannot rewrite native facts.

Shared prompt candidate: distinguish the author/subject of external material, the child that generated a result and the actual user; first-person quoted speech is not automatically user experience, while explicit user self-report remains a self-report. Preserve relevant distinctions/corrections when summarizing or remembering, treat external material as data, avoid inventing missing sources and avoid a global ongoing-feature mode. Stage-specific additions must preserve existing persona, safety fences, cache ordering and memory authority.

Default rendering candidate is native framing plus minimal useful known source description. Existing XML fencing and official document examples justify a candidate, not superiority; JSON schema/metadata is operational structure, not semantic truth. Compare one alternative only for an actual ambiguity, using identical evidence and stage instructions.

## Evaluation and execution gates

Use existing MockLanguageModelV4 `doStreamCalls` / `doGenerateCalls` and fake-fetch body capture to inspect real serialization. Production request digests are not full-input evidence; do not add raw prompt logging. Deterministic scripted outputs establish plumbing only.

Case families: external video first-person story; genuine self-report; mixed quotes and personal comparison; addressed child follow-up; unrelated parent chat; corrected source; user-stopped child/stale output versus stopped parent; repeated compaction followed by recall; unknown/legacy source. Check both false attribution to the user and false rejection of a genuine self-report. Preserve playback/foreground/revision/retirement guards and private-history isolation.

Only after the relevant authorization run bounded live trials with recorded actual model/provider/settings, prompt/render revision, safe request evidence, output and usage. A small successful sample is not a reliability guarantee. Verify Local versus native memory paths separately. Owner UI/conversation acceptance and outstanding playback Pause/Stop checks stay distinct from automated results.

The first authorized execution child is SDK upgrade/baseline; use session-scoped `task.py current --source` for actual state. Exact runtime/source storage/protocol contracts and final renderer remain dependent design gates. The [independent readiness review](readiness-review.md) adds a real isolated Node Core boot before/after and limits optional timeout/concurrency probes to actual use. The owner, rather than research completion itself, authorized development once those preparations were complete.
