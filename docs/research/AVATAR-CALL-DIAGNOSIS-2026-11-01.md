# Avatar call diagnosis: repeated missing arguments

Date: 2026-11-01. Status: evidence and diagnostic plan; no production repair authorized by this document.

## Question and scope

The owner reports repeated expression/motion tool failures within one ordinary primary conversation turn. The broader authorized work is global prompt and tool-interface optimization, including model-facing results. This investigation reads real primary history and checks the current implementation; it does not substitute a scripted-model test for the reported incident.

No production source, prompt, database row, provider setting, or dependency was changed. No external model replay was run. Personal conversation text and credentials are not copied into this report.

## Evidence location and limits

- Database: `C:/Users/55473/.takiagent/taki.db`, opened with SQLite `mode=ro` and query-only access. Include the existing WAL; do not use `immutable=1` and silently ignore it.
- The production resolver is `packages/core/src/config/server-config.ts:32,43-50` followed by `packages/core/src/boot/core-bootstrap.ts:49-63`: the environment-selected data root owns `taki.db`.
- The retained database contains 4,223 Timeline rows dated 2026-07-13 through 2026-10-28. No currently running Core process was identified during inspection. This is retained primary-history evidence, not proof of the configuration of a running November process.
- The example below is independently linked to `runs.initiator = primary` and its actual `run_events`, not a fixture or child transcript.
- Current checkout: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `6b36d0d` with substantial pre-existing changes. Current resolved/declaration versions: `ai@7.0.148`, `@ai-sdk/mcp@2.0.81`. Older research mentioning `ai@7.0.17` is historical.

## Matched real incident

Run `fe7c3dfe-32f4-44f1-ba41-13067d65618e`, Attempt `4e658a72-9d93-4909-b52d-c8d466a940ce`, started 2026-10-28 22:26:13.620 Asia/Shanghai. Configured model ID in the retained Attempt is `deepseek-v4-flash`; the provider response reports `deepseek-flash`. These are recorded labels, not a verified model snapshot.

| Stage | Evidence | Observation |
| --- | --- | --- |
| First model request | Run event 7 | A real request starts. |
| First tool call/result | Events 12-13; Timeline 4224-4225 | `avatar_set_expression`; `validation_failed`; SDK error reports `Value: {}` and field `name`. |
| Second model request | Event 15 | Another model generation actually occurs after the first failure. |
| Second tool call/result | Events 20-21; Timeline 4226-4227 | The same tool again fails validation with `Value: {}`. |
| Settlement | Events 22-23 | Attempt and Run complete after the second invalid call. |

Both failures occur before `set-expression-tool.ts`'s execute function. They are not evidence of a renderer failing to apply a valid expression. The stored validation error includes the current 30 allowed expression names.

The two request events establish that a correction opportunity occurred. They do not, on their own, establish the exact bytes sent to the upstream model. No full original request/response capture was located for this incident; `run_messages` has zero rows for this primary Run. The output error proves what SDK validation received, not whether an upstream service or adapter altered an earlier wire representation.

## Retained sample counts

Window: Timeline rows with `created_at > 2026-10-01`, through the database's latest retained row on October 28. These are counts from the retained corpus, not a controlled model reliability estimate.

| Tool / outcome | Count |
| --- | ---: |
| Expression applied | 70 |
| Expression schema-validation failure | 55 |
| Expression rejected because `already_active` | 18 |
| Motion applied | 4 |

All 55 recorded validation errors report the invalid value `{}`. A separate join of `run_events` to primary `runs` finds 17 primary Runs with more than one Avatar validation failure; each has two such failures. The sample does not establish an equivalent motion-tool failure pattern. `already_active` is a distinct presentation outcome and must not be counted as missing-argument failure.

## Current implementation checks

1. `avatar/set-expression-tool.ts:18-27` requires `name` from the current expression schema; `play-motion-tool.ts:24-33` uses the separate motion vocabulary. Missing parameters fail in the SDK before execute.
2. `avatar/presentation-stop.ts:25-31` permits the first invalid presentation step and stops on the second when the last step is presentation-only. It counts steps, not individual calls. Mixed informational/presentation steps and repeated calls across turns are different cases; this is not a global per-tool circuit breaker.
3. `agents/chat-agent-presentation.test.ts:70-89` exercises the actual SDK with a scripted model and checks that the next model prompt contains `AI_InvalidToolInputError`; repeated invalid calls stop after two steps.
4. Executed in this session: `pnpm --filter @taki/core exec vitest run src/avatar/presentation-stop.test.ts src/agents/chat-agent-presentation.test.ts` — 2 files, 15 tests passed. These tests confirm the specified mechanics, not successful correction by a real provider.
5. `avatar/avatar-vocabulary.ts:45-46` still says the tools return nothing and that speaking plus expressing ends the task. `prompt/system/assistant-layer.md:57,60` contains related outdated wording. `avatar/avatar-tool-result.ts:8-12,29-33` already defines `applied`, `not_rendered`, `rejected`, `superseded`, and `unknown` with useful reaction guidance.
6. The valid presentation-only tail intentionally stops after speech. Do not infer that every execution rejection should start another model generation; this would reverse an existing no-filler policy without causal evidence.

### Additional no-network SDK probes on November 1

Executed in-memory with `pnpm --filter @taki/core exec node --input-type=module`, the installed `ToolLoopAgent`, project `scriptedModel`, `vocabNameSchema(['default', 'smile01'])`, and `presentationTailStop`. No files, service or real model were needed. Each first scripted step emitted text plus an Avatar call with `{}`; a third filler step was supplied so accidental continuation would be observable.

| Scripted second step | Actual model calls | Execute calls | Normal `toModelOutput` calls | Observed second request |
| --- | ---: | ---: | ---: | --- |
| Another `{}` | 2 | 0 | 0 | Includes `AI_InvalidToolInputError`, field `name`, and current alternative `smile01`. |
| `{"name":"default"}` | 2 | 1 | 1 | Same first-error feedback; corrected call is accepted and the third filler is not generated. |

This directly checks the missing-field case as distinct from the existing invalid-enum tests. It confirms the mechanism can deliver usable feedback and accept a correction; the scripted choice is not evidence that a real model will choose correctly.

A separate normal-result probe returned `{status:'done', result:42, internalDigest:'synthetic-only'}` from execute and projected only status/result. `onStepEnd.toolResults` retained the raw digest while the next model request retained `42` and omitted the internal field. All three boolean assertions passed. This verifies the installed SDK's basic raw-versus-model separation; each production tool's extra consumers/wrappers still require the planned contract checks.

## Historical replay: proven representation, unproven cause

`agents/turn-mapping.ts:48-49` persists tool names/call identity without original arguments. `toModelMessage` at line 110 reconstructs a historical tool call with `input: {}`. This is an intentional privacy boundary.

A read-only local probe passed the real successful call from Timeline 4219 through the current `toModelMessage`. Its result was:

```json
{"type":"tool-call","toolName":"avatar_set_expression","input":{}}
```

Timeline 4220 records the matching actual outcome as `applied`. Thus current replay can pair an empty historical argument placeholder with a successful outcome. This is a concrete source of potentially misleading examples; it is not proof that it caused the subsequent missing arguments.

Do not restore arbitrary raw arguments to Timeline to test this hypothesis. Compare explicitly identified omissions, eligible typed safe arguments, and current placeholders using a synthetic/reconstructed fixture first. Any new durable argument retention requires its own privacy/compatibility design and the owner's implementation review.

## Error-result size witness

Timeline 4225's error text is 1,151 characters / 1,151 UTF-8 bytes. Its 30 allowed values appear both as a structured `values` list and again in the rendered error message.

Illustrative missing-field teaching text, represented as a candidate JSON body:

```json
{"code":"INVALID_TOOL_INPUT","field":"name","message":"Missing required name. Pass one current expression name.","example":{"name":"default"}}
```

This candidate is 142 characters / UTF-8 bytes with compact JSON serialization. It illustrates redundant error scaffolding, not a measured token or task-success improvement. The code name is provisional, not an already implemented shared error code. The example must be derived from that call's captured vocabulary; `default` is valid for this witness but must not become a global fallback.

For an unknown value, preserve a usable set of current alternatives once. For a missing field, name the field and show the correct object shape. Keep the original diagnostic in its existing developer/evidence channel. Do not guess a requested emotion, execute a made-up correction, or reinterpret failure as success.

### SDK boundary that matters

Installed `ai@7.0.148/src/prompt/create-tool-model-output.ts:17-25` handles `errorMode: text/json` before consulting `tool.toModelOutput`. Therefore adding a normal result projector to an Avatar tool does **not** shorten schema-validation errors. `repairToolCall` exists, but it changes invalid-call handling; it is not a harmless formatting hook and must not be enabled merely to shorten error text.

First verify a supported SDK error-projection seam, or the existing model-input projection boundary, using the installed package and a no-network transport fixture. Preserve the invalid marker, call/result pairing, stop behavior, active schema, and developer diagnostics. If no suitably narrow seam exists, ship the evidenced prompt correction independently and keep error-format reduction explicitly pending; do not introduce blanket message rewriting.

## Ranked diagnostic questions

| Candidate | Distinguishing evidence / falsifier | Current status |
| --- | --- | --- |
| Historical empty placeholders and contradictory instructions bias argument generation | Compare equal synthetic tasks with the same model/settings and history, varying one representation or instruction at a time; inspect actual requests. No change in repeated `{}` weakens this explanation. | Representation/conflict verified; causal effect unknown. |
| Model/upstream emits empty arguments despite correct schema and feedback | Original provider stream already contains `{}` while request schema and correction result are intact. | SDK-side `{}` verified; original upstream stream unavailable. |
| Transport/adapter loses arguments or feedback | Raw stream contains `name` but SDK call becomes `{}`, or the second outgoing request lacks the error/schema. | No such discrepancy established. |
| Correction is never offered because presentation stop fires immediately | Only one model request follows the first invalid call. | Refuted for the matched two-request incident; current focused tests also cover feedback. |
| Renderer rejects a valid expression | Execute/outcome event exists for the failed call. | Refuted for the 55 missing-argument records; separately classify `already_active`. |

## Next diagnostic sequence

1. Keep this incident and the 17 repeated-failure Runs as the before baseline; do not mutate their history.
2. Use a no-network fixture with `{}` (not only an invented invalid enum member), correct dynamic schemas, realistic retained history, and the actual error-to-next-request path.
3. Capture only the exact request sections and tool-call deltas needed to distinguish the candidates. Avoid logging raw private history or authorization headers.
4. After the owner reviews the optimization design, run any separately authorized real-model comparison with fixed model/settings/inputs and clear limits. Measure first-call validity, effective correction, task completion, repeated calls, and preservation of conversation flow.
5. Patch the evidenced responsibility layer only. No unconditional strict-mode flip, provider-specific repair, infinite retry, forced tool choice, new Avatar invocation format, or replacement of dynamic enums is implied.

## Reproduction pointers

SQLite read-only selectors sufficient to locate the witness:

```sql
SELECT seq, role, parts, created_at FROM timeline_messages
WHERE seq BETWEEN 4224 AND 4227 ORDER BY seq;

SELECT seq, kind, occurred_at, payload_json FROM run_events
WHERE run_id = 'fe7c3dfe-32f4-44f1-ba41-13067d65618e' ORDER BY seq;

SELECT initiator, started_at, terminal_at, outcome FROM runs
WHERE run_id = 'fe7c3dfe-32f4-44f1-ba41-13067d65618e';
```

Keep these diagnostic identifiers in engineering evidence. They are not a proposed default tool-result payload for the Companion.
