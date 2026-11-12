# Readable operations A1/A2 — implementation evidence

Date: 2026-09-06 (Asia/Shanghai). Worktree: `H:/TakiAgent-worktrees/t4`; branch:
`task/t4-skills-mcp-productization`; base HEAD: `3c67fd5`.

Status: implementation, the single combined independent A1/A2 review, full package gates and the
final-build isolated WebView2 check passed. Owner manual observation is not claimed. The subsequent
execution delegation authorizes local checkpoint commits and selects D64 policy A; B's adapter
review follows separately. No commit, push, finish or archive was performed during these gates.

## Delivered implementation

| Area | Behavior |
|---|---|
| Shared vocabulary | Chinese presentation for all 19 capabilities and 31 cells, with 26 precise fixed-tool names. Factory/effective posture and override mode remain distinct. Unknown values have honest generic wording. |
| Core/MCP approval | Chinese live approval templates retain actual operation/target names within their field bounds. One current MCP snapshot resolves a durable list by exact Host/subject/revision and current-generation evidence. Missing, ambiguous, historical or failed sources fall back without altering usability or authority. |
| Desktop permissions and decisions | Capability/cell/posture/override copy and accessible names use Shared vocabulary. Decision rows show readable labels, creation time and usability while revocation retains the exact decision identity. The acknowledgement hides the disclosure revision but submits the original revision-bearing response. |
| Actual write-file approval | Fixed the preexisting non-MCP `fixed-risk` assumption by reading classifier identity/revision from the service registry. `write_file` uses `workspace-path`; ask performs zero writes before approval and one after a single-use approval. No policy/path-scope changes. |
| Captured tool names | The same MCP snapshot iteration captures actual tool closures and server/tool labels. A frozen own-key sidecar passes through Extension/Run/ChatAgent and turn persistence, including compatibility contexts and retry paths. Registry `ext_mcp_*` discovery keys are not used as direct-tool keys. |
| Timeline and replay | Optional tool-call/result `displayName` survives safe persistence; raw call input is still removed. Invalid/overlong labels are omitted, provider-supplied labels are ignored, and canonical content/output/order/model replay remain unchanged. No migration or history rewrite. |
| Chat presentation | Captured label -> fixed-tool Chinese label -> generic Chinese tool fallback. No guessed MCP target or visible routing-key fallback. Live tool pairing/status and Pet bubble behavior remain in the separate live-feedback child. |

## Focused implementation verification

These are scoped run totals, not additive whole-project counts; some cases appear in multiple stages.

| Stage | Result |
|---|---|
| A1 Shared | 2 files / 42 tests passed |
| A1 Core | 10 files / 102 tests passed; Shared/Core typechecks and scoped ESLint passed |
| A1 Desktop | 8 focused file groups / 70 tests passed across the scoped runs; final Desktop typecheck and scoped ESLint passed |
| A1 Core startup | Isolated Node startup reached `ws server listening`; only the test process and temporary data were cleaned up |
| A1 small MCP/Skills copy follow-up | Scoped ESLint, existing Skills 7/7 tests and diff check passed; no separate cosmetic check agent |
| A2 Shared | 2 files / 64 tests passed |
| A2 Core | 9 unique files / 94 tests passed across the focused runs |
| A2 Desktop | 1 file / 8 tests passed |
| A2 local gates | Shared/Core/Desktop typechecks, scoped ESLint, scoped diff checks and 28-file UTF-8/no-BOM checks passed |

A2 typechecking caught a missing `RunExecutionContext` pass-through; the implementer corrected it
and reran the affected Core checks. Captured-name tests cover replacement, retry, own/inherited keys,
legacy history, restart/DB round-trip, invalid labels, provider-name rejection, raw-input removal and
byte-equivalent model replay. The A1 Desktop test harness's initial ESM spy issue was corrected with a
module mock; the affected tests passed before the combined gate.

## Combined review and resulting corrections

One `gpt-6-astra/xhigh` check covers A1 and A2 together. The implementer used `gpt-6-astra/high`.
Main handles small documentation/copy reviews under the owner's resource-saving instruction.

Findings fixed and checked:

- A valid long, unbroken MCP tool name could overflow the ToolCard flex row and displace status.
  Names now shrink/wrap and status remains nonshrinking. Approval target fields received the same
  wrapping correction after their plain paragraphs were found to lack an inherited/global rule.
  Final CSS contains those rules; the combined WebView2 run verifies actual narrow layout instead
  of adding a cosmetic snapshot test.
- Compaction's existing canonical-source hash included all Timeline parts, allowing new display
  metadata to affect `sourceDigest`/`operationId`. The fix excludes only top-level tool `displayName`,
  preserving unlabeled v1 hash bytes, every other source field and nested business output. Four new
  regressions ran red before the fix and green afterwards; the file passed 34/34, including final
  revalidation after a label-only change and `SOURCE_STALE` for real content/output changes. This is
  an A2 compatibility correction, not a reopened Compaction task.
- Two older Settings/Home spec sentences still required displaying generation. Main corrected them
  to retain generations/revisions only as internal CAS/freshness inputs, consistent with G4.

The independent reviewer changed seven files: `compaction-coordinator.ts`, `compaction-pass.test.ts`,
the agents index, `tool-card.tsx`, the Chat index, `approval-dialog.tsx` and the approval index. It
reported no remaining scoped review findings and stopped editing before the QA snapshot.

| Combined gate (each full gate run once) | Result |
|---|---|
| `pnpm typecheck` | PASS, 5 projects |
| Root `pnpm lint` | PASS, 0 errors; 1 preexisting unused `eslint-disable max-lines` warning at `packages/core/src/db/run-repo.ts:6` |
| `pnpm --filter @taki/shared test` | PASS, 42 files / 402 tests |
| `pnpm --filter @taki/core test` | PASS, 297 files / 1,889 tests; 1 conditional real-ZST-sample test skipped |
| `pnpm --filter @taki/desktop test` | PASS, 109 files / 612 tests |
| `pnpm --filter @taki/desktop build` | PASS, Vite 8.1.3 / 1,354 modules; existing large-chunk advisory remains |
| Current task context validation | PASS, 16 implement / 16 check entries |
| Scoped tracked diff and new-file whitespace | PASS |
| Source/test/index encoding | PASS, 50 tracked + 13 new files, UTF-8 without BOM |

Review logs: `G:/Temp/taki-a1-a2-combined-01a072ad-*.log`. Final Desktop entry assets include
`home-D9-vxIgq.js` and `styles-9qJ0jqZT.css`. Rust was unchanged and its unrelated gates were not repeated.

## Actual-window evidence and acceptance boundary

The [earlier G4 WebView2 report](../08-30-frontend-uiux-optimization/research/g4-webview2-qa-2026-09-05.md)
passed 12/12 synthetic-data interaction groups, but its immutable build predates A1/A2. It is not
reused as proof of the new names. The combined A1/A2 run reused the isolated frontend-only harness
with the final checked build and passed 6/6 groups in the actual WebView2 engine
`Edg/152.0.4191.62`, capturing seven states and six screenshots:

1. Chinese permission copy, keyboard selection and exact second-confirm/CAS binding.
2. Readable durable decisions, creation time, independent usability and exact revocation target.
3. Core approval copy, focus trapping and revision-bearing acknowledgement without a visible revision.
4. The maximum 128-character unbroken MCP tool name wraps inside a narrow approval dialog.
5. The 195-unit captured MCP label, fixed-tool fallback and unknown-history fallback stay readable;
   long names and status labels remain inside the Chat cards at 1280/640 px widths.
6. Packaged origin, production CSP and observed traffic retain the isolated synthetic-fixture boundary.

The [final QA report](research/a1-a2-webview2-qa-2026-09-06.md) records scope, screenshots, resource
integrity, startup recovery and cleanup separately from owner acceptance.

The [automated result](../../.runtime/uiux-qa/readable-operations-20260906/qa-results.json) records
no page exception or console warning/error. The
[asset check](../../.runtime/uiux-qa/readable-operations-20260906/asset-integrity.json) confirms all
23 snapshot files (1,912,226 bytes), all six served entry/lazy assets and the exact production CSP.
Main also visually inspected the narrow Chat and MCP approval screenshots. The
[cleanup record](../../.runtime/uiux-qa/readable-operations-20260906/cleanup.json) confirms the owned
host/fixture were stopped and the fixture/CDP listeners released; no production process was stopped.

Two compound startup-tool calls did not return normally and were interrupted before a verified host
was available. No elevation/approval was requested or rejected. Main completed startup with the
ignored `launch-detached.py`: fixed owned paths, closed inherited handles, redirected streams and
hidden child windows, with each launch returning in under two seconds. This was harness setup;
the six actual scenarios had no failures, and no production code/build change was needed.

Owner visual/native-window acceptance remains open. Synthetic WebSocket UI evidence does not
constitute real Core/Host execution, normal Shell startup, Keyring or paid-provider acceptance.

## Documentation, protection and next boundary

The executable contract is [operation-presentation.md](../../spec/backend/operation-presentation.md),
linked from backend/frontend specs and both current task manifests. Compaction's spec records the
narrow presentation-metadata exclusion. Both manifests now contain 16 real context entries.

Main's post-review protection check found 36/37 protected files byte-identical to the G4 checkpoint;
the 77,280-byte deferred registry is unchanged. The existing unrelated
`apps/desktop/lab/scene/param-access.test.ts` differs from that older checkpoint, with last-write time
`2026-09-05T16:30:24Z`, before the combined package gates. Its current SHA-256 is
`19a65b992a8b10bc27baf42e59386b4805e264120b5a87e1f872bf6bcd2a1257`. It was left untouched and outside
this task's ownership; no blanket claim that all unrelated work stayed unchanged is made. The current
file was present during the successful Desktop/typecheck/lint gates, so no duplicate gate was needed.

Main also checked 17 task/spec/evidence/handoff documents: UTF-8 without BOM and 82 valid relative links.
D68's updated manifests validate at 15/15 and live-feedback's at 9/9; neither planning update changes
the main session's active task. The main-worktree Hindsight/memory effort, Avatar lab, OpenBiliClaw,
production configuration and the archived Compaction lifecycle remain outside this task.

The next D68 Monitor source preflight is recorded in
[the DSH adapter map](../08-28-dsh-observability-expansion/research/d68-b-ui-port-adapter-map-2026-09-06.md).
It identifies concrete projection/history/client gaps and proposes the reference virtualizer version;
the virtualizer is now adopted under the owner's execution delegation, with the final executable
D68-B contract to be reviewed before implementation. D64 policy A was likewise selected explicitly
by main under that delegation; these choices do not rely on the earlier unanswered questions.
