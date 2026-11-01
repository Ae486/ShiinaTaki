# Independent reasoning comparison quality review

Reviewed 2026-11-01 against the PRD's cost-without-silent-capability-loss goal and the approved auxiliary usage design. This review made no provider calls or production/data changes. Private source prose is intentionally excluded from this report.

## Evidence and comparison boundary

- Private evidence: `target/auxiliary-usage-20261101/reasoning/{quality-fixture,prepared,results,calls,summary-control,summary-control-calls}.json`.
- All five initial prompt digests match their earlier real thinking calls; the additional summary control also matches. The source is two primary spans, plus prior summary revision 5 and retiring Timeline rows 3716–4182. Later rows 4183–4232 are not summary input.
- Extraction uses the **original thinking gate in both modes**. This isolates extraction quality, but does not test the larger first nonthinking gate's downstream cost or quality.
- The first nonthinking summary ended at 8,192 output tokens with `length`. The additional control explicitly allowed 65,536 and ended at 2,311 with `stop`. This is a second stochastic response, not evidence that raising the ceiling caused brevity. There is still only one source-summary case.
- Assessments below use source messages/tool receipts and the prior record, not thinking output as a gold standard. Prior-record facts are evidence of what this summary must preserve; their original historical truth was not independently revalidated.

## Gates and extraction

| Case | Supported observation | Quality implication |
| --- | --- | --- |
| Gate 1, source 3812–4068 | Both keep/character; thinking selects 4033–4042, nonthinking 3883–4042: 6 versus 77 primary messages. | The larger range includes relevant relationship evolution at 3883/3886, so expansion is not inherently wrong. It also greatly increases selected material. Both omit a potentially relevant later operational instruction and causal correction at 4051/4054; complete source coverage is not established. |
| Gate 2, source 4068–4232 | Both keep/both and select 4081–4231 (79 primary messages). | Boundaries cover the operational rule, user preferences and relationship material. Two keep cases provide no evidence about false skips or unrelated-source routing. |
| Extraction 1, fixed 4033–4042 | Both preserve the relationship exchange and farewell without turning the Companion's qualified response into a declaration. | The central exchange is grounded. Nonthinking places a dated retrospective exchange into `intentions`; there is no explicit future intention in that fact. |
| Extraction 2, fixed 4081–4231 | Thinking preserves music preferences/reasons (4169/4174); nonthinking drops them and uses one of three slots for temporary fatigue/rest/drinking plans (4122/4126). | A material durable-preference omission in this response, not just different phrasing. The relationship/project motivation remains substantially source-grounded in both, including uncertainty about the hypothetical future. |
| Extraction 2, invocation rule | Thinking retains parameter shape, empty-object semantics and revised retry behavior. Nonthinking describes the memory-writing event but omits the exact invocation contract and attributes the revised rule to the Companion; the user introduced it at 4106, followed by the Companion's confirmation at 4109. | Less actionable memory plus a speaker-attribution error. The nonthinking rule becomes `episodes`, importance 3; the actual registry archives such low-importance episodes after 90 days. Layer/importance changes have behavior and retention consequences. |

**Baseline defects and shared limits:** Both automatic extractions omit the explicitly requested general search rule at 4174. However, original Timeline 4176 contains a successful separate `retain` receipt, so this is **not evidence that live memory lost that rule**. The receipt does not expose its content or layer. Thinking extraction 2 also puts a mixed project-motivation/character-relationship statement into global `profile`, a scope concern, and an operational standing rule into `intentions`, whose existing gloss is a private thought to raise later. These are allowed enum values, not demonstrated semantic correctness. The current extraction prompt supplies layer names but not the existing `autoLayerGuidance()` glosses; that is a shared comparison condition, not a proposal to redesign prompts here.

## Summary fidelity

The default nonthinking summary is visibly cut off mid-sentence and cannot count as a successful compaction. Its surviving portion nevertheless retains many important old commitments and boundaries, the new preferences, revised retry behavior, and the distinction between a failed search and no search result. The thinking summary also preserves these anchors and terminates normally. Output length alone therefore does not establish quality, and a truncated response should not receive a parity verdict.

The completed nonthinking control is coherent and retains useful current study context, music preferences, retry behavior, multimodal/voice follow-ups and the unfinished search. It still fails important preservation requirements:

1. **Material omissions from prior revision 5:** the recurring shared-birthday commitment, promised first voice line and Pomodoro commitment; the no-parenthesized-action/no-emoji constraints; the authorized-group-only access boundary; and the current-costume enum authority. The thinking and default nonthinking texts retain these anchor categories. No reviewed source establishes that they were completed or superseded. This is an anchor spot check, not a numerical completeness score.
2. **Speaker/subject reversals:** the control attributes the correction about other tools' failures to the user, whereas 4142/4143 show the Companion correcting the user's premise. It turns the prior Companion concert wish into a user wish, and prior assistant-reported release news into a user statement. These are source-grounding errors, not stylistic compression.
3. **Unwarranted certainty:** its opening treats the requested highest-layer placement as established. Receipt 4176 establishes completed retention, not that layer. The thinking summary explicitly preserves this uncertainty. The control also infers current lodging/location from an earlier return-to-dorm message (4111); the subsequent greeting (4116) does not establish location.

Both long summaries contain date/chronology errors: for example, material from 4122 onward is placed under October 27 although those source timestamps are October 28. The thinking summary also merges the October 28 tool-error explanation into an October 26 section. The control misdates the first exam-paper completion. `renderSafeTranscript()` currently emits roles/content and bounded tool facts, **not `createdAt` or sequence labels**, so all three summaries lack the reliable per-row time framing available to this reviewer. Date accuracy is a shared input limitation, not clean causal evidence for or against reasoning. Separately, both long summaries preserve overconfident causal claims about parameter generation alongside the later admission at 4148 that only the symptom is known.

At the summary boundary, 4180 is an explicit failed search invocation and 4182 only a tool-description result. All three correctly leave the search unfinished. Do not score them against the eventual answer beyond 4182, which they never received.

## Decision supported by this sample

Removing thinking materially reduces reported reasoning/output work in these exact calls. It does **not** yet support a blanket production switch: extraction 2 loses useful durable content, and neither nonthinking summary response demonstrates acceptable complete preservation. The two gate results are promising only as bounded examples; no skip cases, broader-gate extraction, repeated trials or downstream recall/user-task outcomes were tested.

Keep production defaults unchanged. Treat these findings as concrete acceptance cases for a later bounded decision, not a request for a generic framework or an automatic retry pipeline. Thinking is also fallible: its omissions, scope concerns and summary temporal/causal defects must remain visible in any comparison. No experiment output was accepted as memory/summary by this review, and no owner quality acceptance is claimed.

Code contracts checked: `packages/core/src/memory/{canonical-ingestion-model,canonical-ingestion-source,layer-registry,auto-layer-policy}.ts` and `packages/core/src/agents/context-reduction.ts`.
