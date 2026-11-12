# Approved bounded tool/replay pilot

The owner approved the previous two recommendations and supplied the [Claude Code prompt catalog](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog) as an optional reference for exec guidance. The existing session task remains active; no new task is needed. Checkpoint baseline is `d1c7067`. Preserve unrelated delegation edits.

## Exec: truthful invocation guidance

Implement a small description change in the existing `exec` tool, retaining its opaque command schema, output and host execution/approval boundaries. Explain executable-plus-arguments invocation, absence of an implicit shell, quoted paths, explicit interpreter invocation when shell syntax is needed, and fresh-process rather than persistent shell state. Include only one or two useful examples verified against the actual host parser and execution path. Missing-program feedback must direct a corrected invocation rather than an identical retry. Preserve nonzero-exit, timeout and truncation interpretation.

The supplied third-party catalog's Bash section describes an actual stateful shell, persistent CWD/environment, a 120-second default and optional background work. Those are not this project's contracts and must not be copied. Reuse only the writing principles: clear scope, valid examples, relevant dedicated-tool preference and readable result semantics. Do not copy unrelated Git procedures, add a generic command repair framework, alter permissions, or create a second prompt paragraph in the system prompt.

Validation: current TS tool routing tests; actual host parsing/execution of harmless representative examples and the reported compound/no-shell failure; compare description size. Do not create tests that merely freeze prose. The parent controls final workspace gates.

## Avatar: representation experiment before adoption

The owner approved testing a faithful historical representation, not treating the prior correlation as proven causation. Develop the experiment under this task's research/ignored target areas first; leave production replay unchanged until the candidate demonstrates complete outcome/protocol fidelity and useful behavioral results.

Candidate: convert complete historical Avatar call/result pairs with unavailable arguments into explicitly labeled historical observations. Preserve exact observed outputs, call IDs, source/origin and original assistant speech; do not invent old names or store raw input. Existing native pairs for other tools, current-turn SDK messages, native images and durable records must remain intact. Carefully review mixed-call groups and where the observation is placed so it cannot strand a native tool result or masquerade as a new user instruction. If a minimal safe candidate covers only presentation-only groups, report that coverage explicitly rather than claiming all Avatar history is repaired.

Before implementation, an independent advisor reviews the concrete representation and scope against original goals and the privacy/anti-hallucination contracts. Source and snapshot are those in `cohort-analysis-20261104.md`. Reuse existing Avatar helpers and production preparation/serialization seams instead of building a new runtime.

Deterministic acceptance: matched complete groups, applied/normal-noop/error/unknown results, assistant speech, mixed informational pairs, call/result order, snapshot immutability, no execution of history, native image preservation, and correct size/source interpretation. A serializer pass proves structure only.

Bounded behavioral comparison may use the owner's existing real-data and paid-call authorization. Never execute model-proposed actions in this experiment. Keep model/endpoint/settings, vocabulary and task fixed between arms, disclose any synthetic reconstruction, and capture only sanitized counts/shape/outcomes in tracked reports. Private payloads remain local in ignored target files. Initial cap: 24 physical requests including correction responses, at most 1,024 output tokens each; do not expand after a clear failure or inconclusive pilot merely to obtain a favorable result. Verify endpoint/pricing and bound projected cost before dispatch. No user service restart or live database write.

Compare current replay and observation replay at early/late contexts. This paired operational comparison can select an implementation candidate but does not independently isolate length from historical-example count; any matched-length/padding control must be labeled synthetic. Count required-name validity, intended-name correctness, correction result, substantive output fidelity, input/cache/output, latency and conditional price. Retain unknowns and failed calls. Adopt/reject/defer based on evidence; do not present input reduction or a tiny successful sample as general proof of savings.

## Ownership and finish

- Exec implementer owns `packages/core/src/capabilities/exec-tool.ts`, its local index entry, necessary behavior tests/harmless example fixtures, and exec-specific research evidence.
- Avatar advisor/researcher owns only assigned `research/avatar-pilot*` / `research/replay-pilot*` artifacts and ignored target fixtures until explicit handoff.
- Parent owns task PRD/design/plan, manifest alignment, experiment orchestration, final integration review and scope decisions.
- No automatic commit, push or archive in this follow-up. Existing post-checkpoint research remains uncommitted.

## Outcome and validation

Exec guidance was implemented and independently checked; see `exec-guidance-delivery-20261104.md` and
`exec-guidance-check-20261104.md`. Its actual Host examples pass. The description adds 188 local estimator units;
natural-use first-call improvement and net savings remain unmeasured.

The Avatar observation candidate is **deferred, not enabled in production**. The eight paired trials used 12 real
requests. The baseline reproduced invalid empty arguments; all four observation trials made no Avatar call. Both
original user messages concern studying, with no explicit Avatar request, so no-call is neither an invalid call nor
evidence of improved call correctness. Actual first-request input increased by 2,798 tokens in the early case and
13,061 in the late case. Detailed controlled-toolset, optional-presentation and answer-quality limits are in
`avatar-pilot-report-20261104.md`; the experiment does not establish equivalent-task savings.

One additional late-baseline diagnostic used one request to compare upstream SSE argument shapes with the adapter.
It produced no tool call at either boundary, so the origin of the earlier empty arguments remains unresolved. No
further calls were made. Combined totals: 13 requests, 833,269 input (642,688 cached / 190,581 uncached), 3,092 output
including 2,121 reasoning; conditional off-peak direct-provider cost CNY 0.21580276. Original source hash is unchanged,
all tool execution was stubbed, and raw/private request/reply fixtures remain in ignored `target/avatar-pilot-20261104`.

The current prototype passed 13 deterministic checks plus eight offline streaming serializer trials. Workspace
typecheck, Clippy and all 211 Rust tests passed. The full concurrent TS run passed Shared 727, CLI 50, Desktop 1,369
and Core 4,554 tests but had 19 asynchronous/time-limit failures across 12 Core files; all 101 tests in those files
passed a subsequent `--maxWorkers 2` run without code/test changes. Root lint still fails only on the pre-existing
artifact backup's line limit; the changed production source passes lint. Logs: `target/tool-pilot-gates-20261104`.
The concurrent delegation task committed `cd3cd91` while these checks ran; this task's checkpoint remains `d1c7067`,
and the current exec/pilot changes remain uncommitted. No user service restart, production replay change or archive.

Next candidate for review is narrowly retaining validated Avatar argument fields for future native history. That
could preserve real valid examples with much less framing, but its privacy/storage/replay contract and effectiveness
still need assessment. Old omitted names cannot be guessed or recovered from outcome-only records. No such retention
change has been implemented, and no input-length causal conclusion follows from this experiment.
