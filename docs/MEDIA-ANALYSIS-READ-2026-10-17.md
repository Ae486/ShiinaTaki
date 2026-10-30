# Read registered video analysis in ordinary conversation

Date: 2026-10-17. T4 worktree, `task/t4-skills-mcp-productization`, base HEAD `06a8090` with existing unrelated edits.
Owner direction: continue functional development; ordinary phrasing/tool-choice tuning does not block an already proven
Skill/tool mechanism. No new Trellis task/binding, dependency, schema migration, commit, push or archive.

## Result and existing owners

`manage_co_watching(read_analysis)` lets Taki read a listed result after loading the Co-Watching Skill, without entering
an accepted Co-Watching session. The normal conversation then answers from that data. There is no extra conversation,
preparation Agent, analysis request or background task.

| Step | Existing owner |
| --- | --- |
| Find a registered result | Existing catalog and list_analyses action |
| Expose the tool | Current-generation Skill bundle and SDK activeTools |
| Select native reader | Captured extension_discover, exact stableSubjectId(serverId, bilinote_read_result) and Core Host |
| Execute read | Captured extension_call with original request/job and existing MCP Governance/lease/Effect |
| Verify content | Existing verifyCoWatchingNative checks original service/request/job/media/hash and moments |
| Supply useful context | Bounded original JSON page using the existing untrusted-content fence |
| Answer | Same ordinary Taki Agent and Timeline; no Co-Watching acceptance/publication |

There is no fresh MCP manager lookup or connection validation. The small in-process directory search uses the captured
identity rather than a display label. Reading no longer requires a current playback source or a remembered task path.

## Input, data and failure behavior

Call with an exact listed analysisId, `instruction: null`, `view: analysis`, `offset: 0`. Analysis view contains original
prose/moments; complete view contains the full original native JSON, including supporting data. Both views are serialized
consistently and remain pageable. A page is at most **16,384 UTF-16 code units** before the safety fence, with surrogate
pairs preserved. This is a deliberate small per-response budget under the existing tool-design result-budget rule;
it does not discard original data or introduce a global configuration knob.

Use the exact nextOffset for the same analysis and view when more is needed. Offsets exclude the safety fence. No next
page is implied by a null nextOffset. A partial final page still reports truncated=true. A failed read has no content,
never claims an empty analysis, and never starts/retries analysis. Cancellation, reference replacement/removal and
identity mismatch discard the result. Existing MCP draining/lease semantics remain in force for in-flight reads.

The catalog still contains registered references rather than freshly verified status. `list_analyses` remains cheap;
only the requested content read contacts the already connected native service. No automatic Workspace export is added.

## Changes and validation

- New `packages/core/src/co-watching/read-analysis.ts` composes existing readers and verification.
- Existing control tool and main.ts Skill registration add the read action. Shared owns read result/view/failure types.
- Skill SKILL.md and references/tools.md document ordinary read versus accepted private preparation.
- Core focused suite: **19 files / 106 tests passed**, one existing opt-in skip. Covers Co-Watching, extensions,
  disclosure/name handling and operator methods. Final dedicated reader/control cases pass, including Unicode boundaries.
- Shared read/Co-Watching schema tests: **4 passed**. Core/Shared typecheck, scoped ESLint and tracked whitespace checks pass.
- Astra source review found no confirmed new defect. Its noted coverage boundary was that the deterministic conversation
  test installs the control through primaryTools; live validation below separately exercises the actual Skill registration.

No repeat full-video analysis is needed to validate a read. Previous full-suite counts remain in the earlier disclosure
record and are not represented as a fresh full-suite run for this change.

## Live verification

The new Core was started after confirming no active Runs or owner draft. Existing Shell/browser/native processes and
isolated profiles were reused; Skill configuration revision **9** includes SKILL.md and references/tools.md.
The authorized real query asks the installed Skill to read registered BV1BTP5euE75, identify the website and one
interaction detail, without watching or reanalysis. Actual ACK, tool results, native inventory and accepted-root counts
are captured by `.runtime/co-watching-invitation-20261016/disclosure-evidence.py`.

The first phrasing reused the previously read answer from conversation history and did not invoke the new reader. It
is not counted as reader acceptance, and no prompt-tuning cycle was opened. The next probe explicitly requested the
load/read actions so it could exercise the function. That real path passed:

- Actual Home ACK: Run `5efd6873-4012-452d-92f2-3a4eb730a798`, message `82efe570-5fab-46e4-b9bf-ee94e273ae3f`.
- Model calls: `load_skill` -> `manage_co_watching(read_analysis)` -> avatar expression -> ordinary final answer.
- Tool result: `analysis_read`, registered analysis `7d4d7b8a-5b5f-4580-ae43-f5415f894185`, analysis view, 2,680 original
  JSON characters, offset 0, no next page, truncated=false. It retains request `96ed6f75-9afe-4b93-a678-56c4defe46a7`
  and job `0e4517ad-4891-4945-aedc-939fdbe2609f`, with the original service/media/hash reference.
- Taki answered **AW PORTFOLIO**, Antoine Wodniack's portfolio, and described the foreground image expansion/animated
  text detail using this result. No private preparation was inserted into conversation.
- Native inventory stayed **4 rows**, accepted Co-Watching roots **13**, no child Runs, no shell workaround, no active
  session. All seven recorded model/tool Effects in the accepted test turn completed successfully.
- Four actual provider requests reported **118,038 tokens**. The history-only first probe reported 52,027 tokens;
  combined read-validation usage is **170,065 reported tokens**, with no new native analysis request. Cost was unavailable.
- Evidence: `.runtime/co-watching-invitation-20261016/disclosure-after-20261017-132832.json` plus its linked actual
  `chat-analysis_read_explicit-*.json` ACK and baseline. The history-only probe remains separately preserved in
  `disclosure-after-20261017-132720.json`.

Complete-view pagination and cancellation/error cases have deterministic coverage; this live query used analysis view.
The explicit call probe validates the new capability, not general reliability of automatic Skill selection.

## Operation and remaining scope

Core PID **19692**, normal startup logs `.runtime/co-watching-invitation-20261016/core-20261017-132604.*.log`.
No new environment variable, dependency, published-file mutation or database migration is required. Deployment is an
idle Core reload plus the existing immutable Skill import of both files. Rollback uses the previous reviewed code and
Skill package through the same owners; no data rewrite or dirty-worktree reset.

This completes ordinary access to already registered result content. It does not enumerate all native historical jobs,
analyze a new standalone URL, add recommendations/invitations, or implement full Core-restart Continue. Those broader
media-plan slices and overall M49 architectural acceptance remain separate. Prompt/tool-choice reliability stays a
non-blocking tuning item per the owner's direction.
