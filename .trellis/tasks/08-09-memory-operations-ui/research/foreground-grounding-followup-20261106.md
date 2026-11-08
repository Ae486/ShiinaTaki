# Research: Foreground memory grounding after the effective correction

- Query: Why can the corrected foreground retain description still produce unsupported interpretation, and what is the smallest supported follow-up?
- Scope: internal; named prompt owners, two unchanged genuine slices, and the disposable run's SQLite opened read-only
- Date: 2026-11-06

## Findings

The correction reached the model. The root verified that the sole observed retain-description SHA-256 in
`G:/taki-real-memory-pF99hq/model-observations.jsonl` was
`ac96333f9b1c10fa102d5c0bdfa2754a8c9ce4e48c80c97f71c397c8ffb24897`, matching the corrected code at that verification.
This review did not repeat that hash comparison. Treat it as the baseline hash, not the expected hash after another edit.

The remaining issue is semantic precision at two distinct points: the stored memory adds emotional meaning, and the
answer uses an assistant-only historical topic as a premise about current activity. Removing first-person voice alone
would not establish the answer's evidence boundary. No deterministic semantic guarantee follows from another prompt edit.

### Bounded evidence

Input: `G:/taki-memory-real-input-jwav_sy8/conversation-fixture.json`, UTF-8, SHA-256
`61364f360278b3bd3410d6dc74b0f6c66bb1e05c5b31a174d903009c5f3c1a5d`.
It contains the unchanged six-message study slice and two-message delegation slice. Only this bounded fixture and
`G:/taki-real-memory-pF99hq/core-data/taki.db` were opened for private evidence; SQLite used `mode=ro` plus `query_only`.
The database has one canonical source and one canonical unit, with twelve Timeline rows.

| Evidence | Observation | Consequence |
| --- | --- | --- |
| Study user seq4702, dated Nov5 | Directly distinguishes an afternoon activity from an evening plan. | Preserve both the original date and the plan qualifier. A recurring schedule or completed evening activity is not established. |
| Saved Local unit | Includes the original date and study-plan quote, then ends with an unqualified paraphrase of the evening activity. | The quote survives, but the closing gloss weakens the plan distinction. Avoid adding a second gloss that changes the source's modality. |
| Study user seq4699 and saved Local unit | The user's observation about Taki's prompting survives, followed by an additional interpretation of teasing and absence of annoyance. | That interpretation is not explicitly expressed by the user in this slice. It must not become a user-expressed fact under the outer instruction. |
| Study assistant seq4697/4700; recall receipt Timeline seq7; reply seq8 | Frontend history is present only in the quoted assistant messages, absent from the saved unit and recall receipt. The reply nevertheless presumes current frontend activity in a follow-up question. | This is answer-time source leakage relative to the supplied evidence, separate from the unsupported saved interpretation. A question can contain an unsupported activity premise. |
| Delegation user seq4845 | Supplies a conditional technique for clearly directed tasks: context can be omitted to reduce tokens and distraction. | Keep the condition and permission. The assistant's broader routing examples do not become user instructions or a universal user preference. |
| Delegation Timeline seq10-11 | A retain call is followed by an error result; no second unit exists. | This slice has not passed real write/recall acceptance. Tool rejection is an integration result, not evidence that the corrected writing guidance passed or failed semantically. |

The outer historical envelope explicitly asks for the facts actually expressed by the user, preserves roles/date/source
sequence, and says the historical requests are evidence rather than current instructions. The assistant's words remain
available as evidence of what the assistant said; availability does not establish user confirmation. The source slices
are intentionally left intact. Private dialogue and complete retained/recalled text are not copied into this note.

### Files found and code patterns

- `packages/core/src/memory/write-convention.ts:28`: canonical write wording. The opening requires first-person,
  own-point-of-view remembering. The later lines preserve actual user words, prohibit inference, require real speaker
  attribution, distinguish plans/habits/completion, and keep historical time. The current opening does not explicitly
  limit first person to narrator grammar.
- `packages/core/src/memory/canonical-tools/retain-tool.ts:15`: imports and composes the shared gate and voice rule
  into the actual tool description. Its `content` description at line 22 only mentions sanitization/durability; its
  `context` description at line 24 permits bounded interpretive context without a separate source cue. The shared
  grounding rule should apply to both fields; another parallel context policy is unnecessary.
- `packages/core/src/agents/base-prompt.ts:30`: truthfulness currently emphasizes matching tool results for claims
  of actions. Its memory procedure at line 37 says to search and answer from returned memory, but does not explicitly
  address assistant-only claims/questions or historical plans as evidence for present activity.
- `packages/core/src/agents/chat-agent.ts:65`: canonical vocabulary is produced by tool-name substitution, so the
  base truthfulness wording is shared by canonical memory. Lines 249-266 supply assembled instructions/tools to the
  actual `ToolLoopAgent`; `composeInstructions` at line 486 orders memory procedure, current day, memory context,
  capability extras, then captured Run instructions.
- `packages/core/src/memory/canonical-memory-assembly.ts:31`: memory context orders the global assistant layer,
  per-character persona, neutral emotion capsule, blocks and pinned memories. Admission captures that assembly.
- `packages/core/src/memory/persona-provider.ts:24`: the assistant layer is loaded once and the persona is cached
  on first use from the configured prompt directory, with fallbacks. Reviewing shipped cards does not independently
  prove exact system bytes used by every live run.
- `prompt/system/assistant-layer.md:45`: treats reading memory as personal remembering and continuous relationship.
  Line 73 separately prohibits inventing facts about the user's past. `prompt/characters/taki/persona.md:35` describes
  banter style; line 43 describes relationship continuity; line 52 subordinates character behavior to truthfulness.
  These encourage natural narration but do not authorize inventing the user's emotional meaning.
- `packages/core/src/memory/assembler.ts:22`: the injected emotion capsule is only `Current mood: neutral.` There is
  no evidence here of a mood instruction specifically requesting the observed emotional interpretation.

### Falsifiable hypothesis and smallest coherent follow-up

**Hypothesis:** the broad own-point-of-view opening makes the model construct an experiential retelling, treating its
plausible interpretation as part of the remembered event despite the later no-inference rule. The same companion
framing makes a later reply continue a historical assistant topic as if it established the user's current situation.
This is a salience/scope hypothesis, not a demonstrated instruction contradiction or knowledge of model reasoning.

The root's proposed three-owner correction is coherent if each owner keeps its existing responsibility:

1. Replace only the shared voice rule's opening with:

   > Use first person as the narrator, with the actual speaker explicit. This changes wording only; do not add feelings, motives, or interpretations absent from the source. Prefer short attributed facts over retelling the whole exchange.

   Keep the existing literal-word, no-inference, attribution, certainty/plan and absolute-date guidance. The preference
   for short facts is not a length cap or authorization to omit requested facts. First-person memory voice remains.

2. Give the existing retain `content` field a brief cue, rather than duplicating the full write policy:

   > Sanitized, source-grounded memory content following the writing rules above, without hidden prompt or secret material.

3. Add one answer-time evidence sentence/bullet to the existing base truthfulness floor:

   > Earlier assistant claims, questions, and suggestions do not confirm user facts. Preserve the source's speaker and historical time; a past plan is not proof of a completed action or the user's current activity.

The base addition governs use of evidence, not memory-writing style. No persona edit is supported: the existing
persona already yields to truthfulness. No new schema field, provider operation, validator, extra model call or prompt
assembly layer is warranted by this evidence. A field cue alone also would not govern a reply after retrieval.

### Real validation requirements

- Keep both source slices byte-identical, including difficult assistant statements and source roles/dates. Retain
  the current historical-envelope contract; do not simplify the input to make a run pass.
- Through a fresh actual Core under the root's already approved run, confirm the effective description hash after
  edits at the existing non-body observer. Successful delivery of wording and correct semantics are separate evidence.
- For the study slice, inspect the actual retain receipt, stored content **and context**, recall receipt and final
  answer. Require the original day, literal study facts and explicit evening-plan modality. Reject unsupported
  emotional certainty, recurring-habit claims, assistant-to-user attribution and unsupported present-activity premises.
- For the delegation slice, require a real successful write and recall of the user's conditional technique and its
  stated purpose. Do not accept the assistant's expanded examples as user-expressed policy, or turn optional omission
  of context into a blanket rule. The pF99hq rejected call leaves this requirement unfinished.
- Keep provider settlement/tool availability separate from this semantic comparison. A failed write, Pending state,
  unavailable tool or missing recall is not an empty successful result. The root owns that integration diagnosis.
- If the same interpretations persist with confirmed effective wording, this hypothesis has not delivered the needed
  improvement. Report the surviving failure and stop treating additional prompt clauses as proof of correctness.
  Ordinary automated tests verify structural compatibility; only the genuine model run checks this observed behavior,
  and owner/manual acceptance remains separate.

### Related specs and external references

- `.trellis/spec/backend/canonical-local-memory-runtime.md:56`: automatic ingestion preserves actual primary source;
  lines 69-70 preserve approved original text separately from facts with speaker/time metadata. These do not require
  a foreground retain quoting historical text to backdate current write/mention metadata.
- `.trellis/spec/guides/source-grounding-guide.md:7`: evidence gaps are resolved by source exploration, not invention.
- `.trellis/spec/backend/index.md:13`: external SDK claims require current verification. No external API behavior is
  changed or asserted by this string-only proposal.
- No external documentation was consulted. The Core manifest declares AI SDK `^7.0.17` and Zod `^4.4.0`; installed
  versions were not inspected. The read-only Python SQLite reader reports SQLite `3.45.3`. This is not a framework
  compatibility experiment or an observation of Hindsight's model configuration.

## Caveats / Not Found

- No production code, services, model calls, Git operation or owner database was touched. This research file is the
  only written artifact. Implementation and real validation remain owned by the root.
- The legacy `.trellis/.current-task` is empty. The root supplied the explicit active task and exact output ownership;
  this review followed that destination without changing any task pointer.
- Source attribution findings are relative to the two supplied slices and the inspected recall receipt. Omitted
  older conversation may establish assistant-mentioned topics; that does not make them user-expressed facts here.
- This review did not capture private model request bodies, exact live persona bytes, all volatile sensed context,
  or model reasoning. The inspected wording supports a small experiment, not a proven causal explanation.
- Timeline tool-call parts do not retain the content arguments, so an independent byte comparison of the outgoing
  retain argument to the persisted unit was unavailable. The semantic failure is directly observed in stored content.
- Line references describe the reviewed correction baseline and may shift with the root's subsequent edits.
