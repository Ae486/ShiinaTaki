# Agent Context Sources

Recorded: 2026-10-20. This is the source-awareness requirements and historical investigation record, not the current implementation or acceptance status.

Current delivery (2026-10-23): SDK, delegation, Source and Desktop implementation and the authorized live campaigns are recorded in the [before-human acceptance report](../.trellis/tasks/10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md), including final check status, model-output caveats and unverified boundaries. Human acceptance, formal native Hindsight behavior and T4/main migration convergence remain separate gates.

This records the discussion resumed from sessions `01a14ddd-d37e-70e3-bb61-170e899bb6c6` and `01a15929-e085-7f30-afcd-cf6ee49d0b1d`, including the owner's subsequent clarifications. The owner initially requested documentation without a new task, then authorized [coordinated planning and research](../.trellis/tasks/10-21-agent-delegation-source-context/prd.md), development after preparation, and bounded real-model testing. The linked delivery report owns the current implementation and verification state.

## Problem and goal

Taki maintains a continuous relationship conversation while tools and background capabilities contribute additional material. As these capabilities grow, the Companion must understand where relevant context came from and distinguish current activity from historical material. A single long-lived conversation with compaction and memory makes preserving these distinctions especially important.

The motivating incident was a video discussion being interpreted as a problem in the user's own project. Co-Watching and QQ monitoring are examples of the general problem, not separate design targets. The conversation error does not by itself establish long-term memory contamination.

## Confirmed requirements

| ID | Requirement |
| --- | --- |
| CS01 | Provide one general mechanism for identifying the sources of Agent Context across existing and future capabilities. |
| CS02 | The program supplies source information it already knows. The model interprets the content using shared prompt rules. The program need not describe the specific subject of each passage, classify every claim, or generate semantic explanations. |
| CS03 | New capabilities supply their material and source information through the same convention. They must not require a separate source-awareness architecture or feature-specific interpretation prompt. Ordinary integration with the shared mechanism is still necessary. |
| CS04 | Preserve existing conversational roles and tool-call/result associations. A message's role and its content's source are different concepts. |
| CS05 | Source distinctions must remain understandable through initial input, history replay, compaction and memory processing. Adding a marker only at the first entry point is insufficient if later consumers lose the distinction. |
| CS06 | Prefer shared prompt rules and minimal context plumbing. Investigate and repair actual framework information loss where necessary; do not presume either that prompting alone is sufficient or that the Harness needs replacement. |
| CS07 | Tags are illustrative, not a chosen protocol. XML, JSON, Markdown, field names, required identifiers and storage layout remain undecided. |
| CS08 | The Companion should understand relevant ongoing activities without treating every concurrent message as belonging to one global feature mode. Detailed material should enter context when relevant rather than accumulating indefinitely merely because it exists. |
| CS09 | Use material-level source descriptions. Additional source information is optional and selected by the supplying capability, command, sender adapter or program from what it knows and what helps interpretation. Existing names, titles, references, sender identities and times may be retained; do not require every source to fill an identical field set or infer sentence-level provenance. Reuse native message/tool framing where it already identifies the source. |
| CS10 | Prefer established official and professional approaches directly. Introduce project-specific changes only where Taki's actual requirements or verified information loss require them. |
| CS11 | Cover source interpretation throughout every relevant prompt-consuming stage, including material description, foreground and background responses, compaction, memory admission/extraction, maintenance and subsequent use. Shared interpretation rules should remain consistent; each stage may add rules for its own operation. Source-preserving input plumbing is a prerequisite, not a substitute for those prompts. |

The owner's correction supersedes the earlier, overly specific example that asked the program to say that an assistant comment concerned a particular phone-permission problem. Identifying the source is the required program responsibility; interpreting what the material describes belongs to the model.

## Responsibility boundary

| Participant | Responsibility |
| --- | --- |
| Content provider | Supply the original material and available source identity or references without inventing a semantic description. |
| Shared context mechanism | Present source distinctions consistently and preserve their meaning across the relevant context consumers. |
| Model | Interpret the material, its relationship to the conversation and the user's statements using shared rules. |

An illustrative input could contain a source name, an optional reference and original content. This is an example of the concept, not approval of a schema or a new source registry. A source name alone must not be mistaken for proof that every statement in the material is about the user.

## Existing domain and implementation evidence

The existing glossary's **Agent Context** and **Replay View**, plus **Context Source**, describe this work. [ADR 0008](adr/0008-replay-view-context-seam.md) remains the context-projection boundary: ephemeral additions do not become conversational history, and context management does not rewrite stored conversation text. Any durable source metadata needed later must be designed separately from its model-facing rendering.

Source inspection on 2026-10-20 established these starting points:

| Area | Evidence and implication |
| --- | --- |
| Typed history | [`turn-mapping.ts`](../packages/core/src/agents/turn-mapping.ts), `toModelMessage`, already preserves user/assistant/tool roles and tool-call/result identities. This is not a wholesale loss of message structure. |
| Existing prompt framing | [`base-prompt.ts`](../packages/core/src/agents/base-prompt.ts) explains injected observations, turn context and conversation summaries; [`chat-agent.ts`](../packages/core/src/agents/chat-agent.ts) assembles ephemeral turn context. Reuse these foundations when evaluating a common convention. |
| Source loss in published speech | [`conversation-store.ts`](../packages/core/src/agents/conversation-store.ts), `appendDelivery`, writes plain assistant speech; the ordinary replay mapper does not project its originating activity. Exact recoverable source links need inspection before selecting new persistence fields. |
| Compaction input | [`context-reduction.ts`](../packages/core/src/agents/context-reduction.ts), `renderSafeTranscript`, renders ordinary speech as role plus text, while tool results already receive bounded source framing. |
| Memory boundary | [`canonical-ingestion-source.ts`](../packages/core/src/memory/canonical-ingestion-source.ts) verifies committed primary sources and excludes tool/injected material; [`canonical-ingestion-model.ts`](../packages/core/src/memory/canonical-ingestion-model.ts) uses those sources. Source-awareness work must preserve this eligibility boundary. A mistaken primary reply can still require attribution-aware interpretation; direct ingestion of raw video analysis has not been demonstrated. |

The inspected Codex session also distinguishes typed messages, calls and matching call outputs; its generated compaction summary has an explicit explanatory wrapper. These are useful precedents, not evidence that every persisted log field is sent to the model or that Codex cannot misattribute paraphrased material.

Relevant official references:

- [Function calling](https://developers.openai.com/api/docs/guides/function-calling): tool results remain associated with the originating call.
- [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering): message roles and Markdown/XML boundaries can distinguish contextual material.
- [Compaction](https://developers.openai.com/api/docs/guides/compaction): a reduced representation carries context into subsequent turns; this does not select a Taki compaction implementation.

## Resolved grill and remaining technical work

The owner accepted material-level granularity and clarified that the actual source fields are optional and provider-selected. Source names and material references need not be duplicated when existing message or tool framing already communicates them. Missing information must not be invented. The framework preserves the necessary distinction through later processing, without requiring every original field to survive verbatim.

The owner agreed to conclude the requirements grill and proceed with code investigation and prompt design. Preserving attribution while summarizing is chiefly a prompt-design and validation concern once the summarizer receives the required source information. The owner explicitly confirmed that the coverage must extend across the whole relevant prompt chain, rather than stopping at the summarizer.

| Work item | Current boundary |
| --- | --- |
| Representation and persistence | Derive field names, storage and rendering from existing contracts and official patterns. No schema, source registry or new permission mechanism has been selected. |
| Derived and mixed material | Design prompts to preserve source distinctions and uncertainty that affect meaning; do not automatically label a whole response with every source available to that Run. Exact rendering and inheritance remain technical work. |
| Validation | Inspect actual model inputs, then evaluate external-material discussion, explicit user self-report, mixed sources, topic/activity changes and post-compaction continuation. No measured reliability, error threshold or live acceptance is claimed. |

Questions answerable from the repository should be researched rather than asked of the owner: which identities are already durable, which input paths share a renderer, and where context is currently dropped. Shared source interpretation must be distinguished from each capability's existing execution and lifecycle semantics.

## Prompt coverage findings

The read-only audit found shared foundations rather than one universal model entry point:

- [`base-prompt.ts`](../packages/core/src/agents/base-prompt.ts), [`chat-agent.ts`](../packages/core/src/agents/chat-agent.ts) and [`initiative-context-builder.ts`](../packages/core/src/initiative/initiative-context-builder.ts) supply foreground and autonomous response instructions. Background preparation also uses the ChatAgent implementation, with a different turn contract that must be traced separately.
- [`screenshot-describe.ts`](../packages/core/src/capabilities/screenshot-describe.ts) and [`image-description-writer.ts`](../packages/core/src/memory/image-description-writer.ts) contain distinct visual-description prompts. Attribution can be lost during material transformation before ordinary chat sees it.
- [`compaction-pass.ts`](../packages/core/src/agents/compaction-pass.ts) summarizes the rendered retiring span plus the prior summary. Input framing and the summary prompt both matter.
- [`canonical-ingestion-model.ts`](../packages/core/src/memory/canonical-ingestion-model.ts) separates admission/ownership judgment from Local fact extraction. Their shared committed-primary eligibility boundary must remain intact.
- [`write-convention.ts`](../packages/core/src/memory/write-convention.ts) already shares memory writing and voice rules. The first-person rule describes the remembering narrator; it must not change who experienced something in the source material.
- [`tidy-pass.ts`](../packages/core/src/memory/tidy-pass.ts) and [`hindsight-policy-curator-prompt.ts`](../packages/core/src/memory/hindsight/hindsight-policy-curator-prompt.ts) are separate maintenance consumers. Preserve each one's existing authority and allowed operations.
- Hindsight native extraction/reflection has a separate service boundary. Local metadata persistence is not proof that native model prompts consume it. Native prompt/configuration and actual model-input coverage remain unverified.

These are coverage candidates, not instructions to duplicate a complete rule block into every file or to modify legacy-only paths without checking their runtime wiring. Shared rules plus stage-specific additions are the proposed composition approach, following the repository's existing reusable prompt fragments.

## Commentary-path investigation (2026-10-20)

The owner proposed two possible contributors to the observed misattribution: the Companion may lose the source of a published reaction, and reaction generation may follow a different path from normal conversation. The owner also recalled an earlier isolation measure intended to keep BiliNote-based preparation from interfering with ordinary chat. The following code findings support a context-transfer gap; they do not establish the exact cause of the reported model response without its actual input/output.

### Generation shares the Agent implementation but has a different turn contract

1. [`co-watching/runtime-model.ts`](../packages/core/src/co-watching/runtime-model.ts), `admit`, creates an accepted-work root with `deliveryClass: internal` and `contextMode: autonomous`. `readNative` obtains and verifies the registered BiliNote result through the captured governed tool.
2. [`task-workspace.ts`](../packages/core/src/co-watching/task-workspace.ts), `writeCoWatchingInput`, writes `analysis.json` and the complete `native-result.json`. The former includes native/media identity, original analysis and valid moment IDs. Preparation therefore receives explicit material identity and exact paths.
3. `generate` calls the same `deps.agent.stream` implementation used by ordinary chat, with `turnKind: non-primary` and an ephemeral control input. It asks the installed `taki-co-watching` Skill to write a revision-specific JSON proposal. Streamed text is discarded; only the validated completed proposal is used. The plan retains `candidateRef`, `momentId` and `text`, with a plan-level revision.
4. [`chat-agent.ts`](../packages/core/src/agents/chat-agent.ts) skips `appendUser`, `finishRecordedTurn` persistence and detached conversational memory writes for non-primary turns. It constructs a fresh `ToolLoopAgent` for the attempt. Preparation instructions, intermediate prose and file-tool results are therefore not inserted as ordinary relationship history by that turn.

**Non-primary does not mean no access to relationship history.** `runAttempt` uses `store.project(characterId)` unless a separate `selectedContext` is present. [`run-service.ts`](../packages/core/src/harness/run-service.ts), `admitAcceptedWork`, does not supply that selected initiative context; [`run-snapshot-capture.ts`](../packages/core/src/harness/run-snapshot-capture.ts) does not derive it from `contextMode: autonomous`. Accepted Co-Watching preparation thus reads the ordinary Replay View and character/memory instructions while keeping its own control input and outputs outside Timeline. The empty-history initiative branch is a different case.

This is a directional separation: existing relationship context can inform preparation, while private preparation does not become conversational history. Reusing the same Agent implementation/model selection is compatible with separate per-call instructions and Run/Attempt identities.

### Existing protections against mixing preparation with normal conversation

- [`integrations/taki-co-watching/SKILL.md`](../integrations/taki-co-watching/SKILL.md) explicitly separates **Ordinary user chat** from **Core-supplied background preparation**. Ordinary chat uses the control tool for start/revise/stop, may read exact supplied material references for questions, and must not invent paths or write a proposal. Only the Core-supplied preparation task receives the exact output path/revision and writes the plan.
- [`conversation-context.ts`](../packages/core/src/co-watching/conversation-context.ts) tells ordinary chat to answer the current user normally, keep a valid plan during unrelated conversation, and distinguish private drafts from already-spoken text. It supplies current task/media/status and exact analysis/current-plan paths as needed, without copying the analysis into history. After termination it preserves an ended-task notice without implying that the conversation was forgotten.
- [`main.ts`](../packages/core/src/main.ts), `instructionsExtra`, actually wires this task context into ChatAgent instructions. The source-awareness issue must therefore not be described as the main Agent receiving no video context whatsoever. It receives current coarse context, not a per-utterance attribution join.
- Preparation cooperatively yields to foreground input and resumes owned work after foreground release. Publication also obeys foreground availability and current source/revision/playback checks. These execution and delivery protections are distinct from attribution of previously published text.

The historical [production record](MEDIA-CO-WATCHING-PRODUCTION-2026-10-16.md#foreground-rerun-and-correction) documents a concrete earlier conflict: ordinary-chat revision tried to perform file-based preparation. The Skill was clarified so ordinary chat invokes `manage_co_watching`, while Core-supplied private preparation owns file/revision work. The current Skill still contains that separation. Historical live observations are not re-run acceptance evidence for this investigation.

### Where source context currently becomes weaker

Private preparation reads the full analysis and creates a source-bound candidate. Publication later merges the reaction into the relationship stream. [`conversation-store.ts`](../packages/core/src/agents/conversation-store.ts), `appendDelivery`, appends only `{ characterId, role: assistant, content: text }`; `project` maps those entries directly through [`turn-mapping.ts`](../packages/core/src/agents/turn-mapping.ts). The resulting ordinary assistant message does not contain the originating Run, video, candidate or moment reference.

The main Agent can still see the current task summary and read the analysis on demand, but that does not explicitly connect each earlier assistant utterance to its source. The private preparation's file-tool results are not replayed beside that utterance. [`context-reduction.ts`](../packages/core/src/agents/context-reduction.ts), `renderSafeTranscript`, similarly renders ordinary assistant speech as role plus text, so compaction cannot recover per-utterance attribution from that rendering alone.

This is a general boundary to address: source-aware work produces speech, and speech is projected back into shared conversational context. Retain the useful execution/private-draft isolation and investigate a general source projection at this merge, together with the shared interpretation prompts. Do not solve it by copying every private preparation step into ordinary history or by assuming all concurrent dialogue belongs to the active video.

Code and existing test assertions were inspected. No production code, installed Skill, live model configuration or memory data was changed, and the reported semantic error was not reproduced in a live model call.

### Publication linkage follow-up (2026-10-21)

The continuation of session `01a15982-5ea2-7591-9cb4-12371a78a2d0` verified the unfinished publication investigation against current code. Execution traceability and model-visible attribution must be distinguished:

| Boundary | Verified retained information | Limitation for source interpretation |
| --- | --- | --- |
| Co-Watching plan to generic publication candidate | [`runtime.ts`](../packages/core/src/co-watching/runtime.ts), the source `read` callback, passes candidate reference, revision, text and expiry. | The plan's `momentId`, media identity and original playback source are not passed in this generic candidate. This is an earlier narrowing than the Timeline append. |
| Candidate to publication Run and delivery | [`run-prepared-publication.ts`](../packages/core/src/harness/run-prepared-publication.ts) links the publication Run to its accepted-work parent; [`prepared-publication.ts`](../packages/core/src/delivery/prepared-publication.ts) records the exact speech and selected candidate ID. | Publication source/candidate digests support identity checks; they do not themselves describe the video or reconstruct the original references. |
| Delivery to Timeline | [`run-delivery-repo.ts`](../packages/core/src/db/run-delivery-repo.ts) appends speech and stores its `timeline_seq` in one transaction. A Timeline sequence can therefore be related to its delivery, publication Run and accepted-work root. | The ordinary Replay View does not join that association into model messages. A committed Timeline row also does not by itself prove transport delivery; `sent`, `unknown` and `no_target` are separate outcomes. |
| Original analysis and candidate anchors | The accepted root records `co-watching:<sessionId>`. [`task-workspace.ts`](../packages/core/src/co-watching/task-workspace.ts) uses that session directory for material identity, original analysis and revision-specific plans containing candidate-to-moment mappings. | This root reference identifies accepted work, not the browser's original source reference. Task files and live session state are separate from the delivery ledger; `current-plan.json` is not rewritten after every publication and is not an authoritative live delivery record. |

These findings leave an existing path for investigating source projection; they do not select a new schema or prove that a complete source join survives every lifecycle or restart. Reuse verified identities where sufficient, and determine any missing durable description before depending on task-file reconstruction. Do not infer source meaning from an opaque digest.

The foreground protections are also wired in production: [`chat-send.ts`](../packages/core/src/server/methods/chat-send.ts) reserves primary intent before admission; [`main.ts`](../packages/core/src/main.ts) connects reservation to Co-Watching `yieldToPrimary` and lane release to its scheduler. Preparation aborts cooperatively, retains the unfinished semantic request, enters waiting, and releases its lane in `finally`. Foreground release allows that same owned work to resume. Publication uses the same lane and rechecks source, edit gate and exact output before the Timeline transaction commits. These controls should be preserved when source interpretation is added.

This follow-up is static code evidence. It neither reproduces the reported model misattribution nor establishes long-term memory contamination or restart recovery of the complete source chain.

## Continuation boundary

The related [Agent Delegation Research](AGENT-DELEGATION-RESEARCH.md) records the 2026-10-21 Claude/AI SDK findings, the completed Pi investigation, agreed delegation/lifecycle behavior and package-first technical mapping. Routine grill has concluded under the owner's instruction to use official mechanisms and ask only about material gaps or conflicts. It owns that comparison and follow-through; the source-awareness requirements above remain settled. Its behavioral decisions and technical defaults do not authorize implementation or a framework replacement.

Continue through the [source-context child](../.trellis/tasks/10-21-agent-source-context/prd.md) and its [official-practice and consumer research](../.trellis/tasks/10-21-agent-delegation-source-context/research/source-context-prompts.md). The research distinguishes original-primary memory ingestion from replay/compaction; preserving sources does not widen eligibility. Do not reopen settled material-level optionality or require Co-Watching-only or QQ-only context rules, a separate session per feature, an additional semantic classification agent, a full provenance graph, or a new permission mechanism without new evidence and an explicit scope decision.

No new ADR is selected: representation and storage have not yet passed a concrete architectural trade-off. No code, prompt behavior, live configuration, memory data or acceptance status was changed by this documentation step. Browser source-selection UX and the outstanding playback Pause/Stop validation remain separate follow-ups.
