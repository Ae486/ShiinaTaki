# Source implementation: machine-observable acceptance supplement

Status: Source implementation and the authorized bounded machine-observable trials are complete, 2026-10-23. Stop before human acceptance. The coordinator owns final repository-wide integration gates and parent AC disposition. No human acceptance box, task archive, commit, push, main migration or deployment was performed.

This report supersedes the paused/live-unstarted status in the historical [S5/S6 handoff](s5-s6-implementation.md). The prior 290-result scoped evidence remains valid historical evidence; it is not a whole-tree test run. Native Hindsight availability, extraction and reflection remain an external, unverified dependency. No provider repair or deployment was attempted.

## Delivered changes and ownership

The existing Source plumbing is documented in the S5/S6 report. This supplement adds three real-consumer acceptance fixtures, actual Skill/Workspace-tool fixture composition, and a test-only capped provider observer. It also adds one production clarification in `agents/compaction-pass.ts`: when similar relevant events concern different people, preserve each reported event/negation with its source/person, and do not infer correction history merely from the native assistant role. Renderer, persistence, Memory eligibility and the summary quality gate are unchanged by that clarification.

The [acceptance manifest](s5-s6-acceptance/changed-files.json) contains 11 code/test/index paths changed during this continuation. The [combined Source manifest](s5-s6-acceptance/source-manifest-current.json) contains 53 paths across the prior implementation and this continuation. Preimages, SHA-256 values, a working-state diff and the UTF-8/whitespace audit are adjacent. These are working-tree preimages, not a clean-HEAD rollback; shared directory indexes also contain other owners' entries.

The production change is `compaction-pass.ts`. The actual-compactor contract test is `source-compaction.test.ts`. The new opt-in tests are `source-context-real.test.ts`, `co-watching/source-preparation-real.test.ts` and `memory/source-local-memory-real.test.ts`. Test helpers are `co-watching-fixture.ts`, `co-watching-tool-fixture.ts`, `source-live-evidence.ts` and its tests. The two touched directory indexes describe these responsibilities.

## Evidence and interpretation

All native material, playback, user messages, retained primary rows and test Workspaces are isolated synthetic data. The tests exercise real SQLite, ChatAgent, Compaction, shared-child, publication and Local Memory owners. Exact outgoing request bodies and selected completed synthetic responses are saved separately from content-free relay observations. The observer never records credentials, headers, raw provider errors or reasoning text. Source hashes match within every live batch; every batch ended before its deadline and had no observation failure. All Source processes and relays have closed.

| Evidence | Actual observation | Claim boundary |
| --- | --- | --- |
| [Final A1/A2](s5-s6-acceptance/a1-a2-final-prompt-live-01/run.json) | Both scenarios completed real initial reply, real Compaction and real post-compaction reply on the final prompt. A1 consistently assigned layoff/project stopping to the video's narrator, 林述. A2 consistently retained the user's own layoff/project stopping. | Candidate-only observations, not a baseline improvement measurement or a statistical reliability claim. |
| [Final A3](s5-s6-acceptance/a3-compaction-fix-live-01/a3-mixed-unknown.json) | Summary and post-compaction response body preserve 林述's reported layoff and stopped project, the user's stopped project and explicit denial of layoff, and an unknown-origin moving quotation that is not assigned to either person. | Independent review accepted this sample's core source-attribution objective. The summary still says “the user corrected a mix-up” without sufficient evidence; not every sentence is grounded. The final short recap omits a detail already present in the response body, rather than expressly denying it. |
| Actual post-compaction requests | `*-actual-followup-input.json` records assertions at the outgoing HTTP body boundary: one summary supplies retired material, the original subject-bearing rows are absent outside that summary, and a recent complete user/assistant pair remains. | Persisted original Timeline rows remain available as canonical evidence; their continued existence is not proof they were replayed. |
| [Co-Watching](s5-s6-acceptance/co-watching-live-01/result.json) | Four real model steps loaded the shipped Skill, read the actual synthetic analysis with governed `read_file`, wrote a fresh proposal with governed `write_file`, and committed a validated private child result before original-root publication. No direct mocked artifact write occurred. Generation/material/moment sidecars survived publication. | Native analysis and browser playback were synthetic; transport acceptance is not human observation. The candidate phrase “语气还平得过分” is stronger than its stated textual basis. Independent review found this ambiguous between textual interpretation and an unsupported perceptual assertion, not a confirmed source-to-user misattribution. Preserve it for human wording/grounding review; no extra Skill change or paid rerun was made. |
| [Canonical Local](s5-s6-acceptance/local-memory-live-01/result.json) | Real primary persistence invoked `onPrimaryCommitted` for four exact rows. Sanitization admitted only the original user and final assistant text, excluding the tool result and textless tool-call row. Private child and publication rows were not added to primary eligibility. One real Write Gate selected Global scope, one real extraction produced three correctly attributed facts, and real Local sparse recall returned all three. | Primary reply, private preparation and tool/publication producers were scripted. Only Gate/extraction used the real model. Native Hindsight behavior was not exercised. |
| Local policy/source retention | The exact approved original text remains unchanged in `retained_text`; importance was clamped to 7 and visibility remained `retrieved`. The narrator's quoted event did not become user biography, and the explicit user self-report/denial remained retrievable. | This does not widen automatic Memory eligibility or test provider-owned native extraction prompts. |

The A1–A3 projection fixtures genuinely install no canonical witness callback. Their Memory flush is explicitly **unexercised** through a test-controlled seam. The separate Local test supplies the actual callback and existing `prepareRetirement` path; it does not retrofit fabricated eligibility into the projection fixture.

## Preserved failures and bounded corrections

1. The first A1–A3 batch made five real requests. A1 completed successfully; A2's initial response correctly recognized the user, but Compaction rejected its summary. A [zero-paid replay](s5-s6-acceptance/a1-a3-live-01/quality-replayed.json) of the actual source/output through production policy confirmed `non_shrinking`: 116 estimated source tokens versus 245 summary tokens. No summary was committed and no A2 follow-up/A3 request ran in that batch.
2. The fixture had forced pressure over four very short interlude messages. The corrected fixture supplies an ordinary, finished design discussion of realistic compressible length and keeps a complete recent pair. It does not repeat padding, impose a summary length cap, modify the production prompt for that failure, or disable the quality gate. Only the unfinished A2/A3 cases were rerun. The original campaign therefore used 11 logical/physical calls across the first and corrected attempts, under the explicitly revised combined 12-physical-request cap.
3. The corrected fixture exposed a separate genuine A3 semantic loss: the original summary omitted the narrator's stopped project and invented prior confusion. Actual compactor input still contained both subjects and source facts; the post-compaction request used only the resulting summary and unrelated retained tail. Independent review confirmed the generation boundary and the small compaction-only wording change. A separate three-generation/four-physical-request repair campaign observed restoration of the relevant subject/event distinctions. Unsupported correction narration remains explicitly reported rather than prompting an unbounded retry loop.
4. A separate final A1/A2 regression used the same final compaction prompt, six generations under a seven-request cap. This verifies the relevant external-only and ordinary self-report paths after the production prompt clarification.

Fixture-only failures are also retained: the first actual-tool dry run bypassed the mock model's call recorder when overriding `doStream`; supported mock construction fixed the assertion. Typecheck caught a static import across Core's `rootDir`, then a nonportable inferred provider type. Runtime loading of the existing E2E exports by file URL and the public `LanguageModel` annotation fixed those issues without changing compiler checks. Synthetic native tool schemas now explicitly accept object input rather than advertising an empty root schema to a real compatible provider.

The final independent review also found that the observer deadline flag did not make late cleanup fail. The helper now checks its absolute deadline after relay closure and rejects a completed-but-late trial. A real local relay/fake-clock lifecycle test proves this with zero upstream calls. Prior live evidence has `deadlineExceeded: false`; no paid trial was repeated for this helper correction.

## Usage

Requested model: `deepseek-v4-flash`. Returned model in all reported real responses: `deepseek-flash`. These names are intentionally not conflated. [Machine-readable usage](s5-s6-acceptance/live-usage-summary.json) is derived from actual Run usage plus completed Utility responses; scripted generations are excluded.

| Batch | Actual upstream requests | Reported input tokens | Reported output tokens |
| --- | ---: | ---: | ---: |
| Initial A1–A3, including rejected A2 summary | 5 | 6,296 | 1,428 |
| Corrected fixture A2/A3 | 6 | 9,155 | 5,940 |
| Co-Watching Skill/file/publication | 4 | 22,351 | 1,508 |
| Local Write Gate/extraction | 2 | 1,346 | 496 |
| Separate A3 compaction repair | 3 | 4,817 | 3,554 |
| Final-prompt A1/A2 regression | 6 | 9,103 | 3,381 |
| Total, including failed and superseded attempts | **26** | **53,068** | **16,307** |

All 26 forwarded requests returned HTTP 200. HTTP success did not prevent the earlier quality rejection or semantic loss. There are zero unknown token samples in the recorded successful provider responses. The 69,375 reported tokens are usage evidence, not a monetary cost estimate.

## Verification and reproduction

[Final scoped tests](s5-s6-acceptance/tests-final-delivery.json): **65 passed**, zero failed, three live tests skipped, across 11 files. The live reports are separate and preserve the earlier failed attempt. [Final scoped lint](s5-s6-acceptance/lint-final-delivery.log) covers all nine changed TS files. Core typecheck after the production prompt change passed in `typecheck-a3-repair.log`; the coordinator's later whole-worktree typecheck covers the final helper-only changes. The coordinator owns final root lint/full-suite remediation and should not mistake this scoped handoff for whole-repository clearance.

```powershell
# Deterministic Source supplement, with isolated Workspace temp files.
$env:TEMP='H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-source-context/research/s5-s6-recovery/tmp'
$env:TMP=$env:TEMP
pnpm --filter @taki/core exec vitest run src/agents/source-context-real.test.ts src/co-watching/source-preparation-real.test.ts src/memory/source-local-memory-real.test.ts src/testing/source-live-evidence.test.ts src/agents/source-compaction.test.ts src/agents/compaction-pass.test.ts src/agents/compaction-coordinator.test.ts src/co-watching/child-adapter.test.ts src/co-watching/runtime-permissions.test.ts src/co-watching/native-analysis.test.ts src/co-watching/conversation-context.test.ts

# Historical final-prompt live invocation; rerunning incurs new provider usage and requires a fresh evidence directory.
$env:TAKI_E2E_REAL_ENV_FILE='H:/TakiAgent/.env.local'
$env:TAKI_E2E_REAL_SOURCE_CONTEXT='1'
$env:TAKI_E2E_SOURCE_CASES='a1-external,a2-self-report'
$env:TAKI_E2E_SOURCE_CAMPAIGN='final-prompt-regression'
$env:TAKI_E2E_SOURCE_EVIDENCE_DIR='<new directory under the Source task research folder>'
pnpm --filter @taki/core exec vitest run src/agents/source-context-real.test.ts -t 'observes three bounded'
```

The independent A3 campaign uses `TAKI_E2E_SOURCE_CASES=a3-mixed-unknown` and `TAKI_E2E_SOURCE_CAMPAIGN=a3-compaction-fix`. Co-Watching uses `TAKI_E2E_REAL_SOURCE_PREPARATION=1` with `source-preparation-real.test.ts`; Local uses `TAKI_E2E_REAL_SOURCE_MEMORY=1` with `source-local-memory-real.test.ts`. Run these in separate processes/directories, never with inherited live flags during general tests. The fixture does not automatically rerun a failed paid batch.

Remaining handoff items are human natural-conversation/playback and wording acceptance, the explicitly unverified native Hindsight dependencies, and coordinator-owned whole-repository delivery checks. No Source-owned technical implementation or authorized live batch remains in progress.
