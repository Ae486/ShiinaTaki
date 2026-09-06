# D64 command disclosure — final engineering evidence

The complete command-disclosure slice is implemented and independently checked against baseline
`a771496`. The incoming coordinator recovered session `01a070e4-3a27-7562-ab12-14cc42cbea98`
and the completed `d64_check` session `01a073ad-e8f8-7942-933c-ec1ef686c124`, then verified
their persisted evidence against the current T4 worktree. No new implementation was needed during
this continuation review. Engineering acceptance is complete under the recorded delegation;
personal owner visual inspection is not claimed.

## Delivered behavior

- Host exec asks project the complete permitted command, mask entire recognized credential values,
  and visibly escape controls before sealing the existing challenge digest. Raw execution input and
  the restricted original-command audit remain unchanged. Unclassified text remains visible under
  policy A; this is a finite recognizer, not universal secret detection.
- Shared strictly validates typed disclosure and reconstructs transport chunks without inserted
  whitespace. Desktop and CLI render the complete literal command and negotiate support on their
  own authenticated physical connection before successful restoration.
- Unsupported peers, ambiguous recognized credentials and over-capacity disclosure settle safely
  without execution or a partial prompt. Correlated Host-v3 challenge rejection retires the exact
  pending request once. Existing non-exec golden bytes, credentials and authority boundaries remain.

## Independent review and fixes

The direct `gpt-6-astra/xhigh` reviewer completed its turn and froze nine changed Rust/index files.
Its machine-readable report is `target/d64-check-20260906/review-results.json`; the raw logs and
final hashes are in the same ignored directory. The coordinator compared all nine final hashes:
9/9 match. The reviewer fixed:

1. A panic on multibyte text before a URI and credential-tail disclosure across adjacent quoted
   fragments. Source ranges now respect Unicode boundaries and mask whole recognized values.
2. Pending cancellation after a newer policy generation, while preserving a different control
   that reused the request ID. Cleanup checks the exact accepted binding; execution keeps its
   current-policy requirement.
3. Foreign resume tuples consuming another pending request, exact invalid authority leaving active
   state, and validation/consumption under separate locks. Matching and retirement are now atomic.
4. Equivalent scanner branches that failed Clippy. The final consolidation preserves recognition
   behavior and passed the disclosure regressions and strict Clippy afterward.

No unresolved code finding was reported. The invalid-resume socket regression proves exact
Host-local cleanup and a finite denial frame. It does not claim that Core accepts an invalid
authorization lineage; Core's existing strict response validation is unchanged.

## Verification

| Gate | Recorded result |
| --- | --- |
| Shared full suite | 42 files / 408 passed |
| Core full suite | 297 files / 1,896 passed / 1 conditional skip |
| Desktop full suite | 109 files / 617 passed |
| CLI full suite | 8 files / 50 passed |
| Workspace typecheck | All five projects passed |
| Root lint | Zero errors; one existing unused-disable warning in `run-repo.ts` |
| Rust full suite | 195 library and 7 helper tests passed |
| Rust Clippy | Passed with `-D warnings` |
| Final disclosure regression | 11/11 passed after the last equivalent scanner change |
| Locked `taki-node` build | Passed after substantive reviewer fixes |
| Real isolated Core/Host approval L1 | 6/6 passed; approval/deny/refusal and unchanged audit binding |
| Desktop production build | Passed; frozen assets verified below |
| Actual isolated WebView2 | 7/7 interaction groups passed |

The only post-full-suite source change was the equivalent scanner-branch consolidation described
above. The final disclosure and Clippy gates covered it; unaffected full suites were not repeated.
The conditional Core skip requires a real ZST sample absent from this worktree. Existing Vite bundle
size and MSVC linker informational notices do not establish runtime failures.

The incoming coordinator additionally ran the current Core capability-challenge/connect suites
(32/32), the CLI suite (50/50), Trellis context validation (19 entries in each manifest) and
`git diff --check`. These passed. Historical full-suite results above remain attributed to the
completed reviewer, rather than being described as fresh continuation runs.

## Window evidence and scope protection

[The WebView2 report](research/d64-webview2-qa-2026-09-06.md) records complete text/tail selection,
96-field reconstruction, Unicode/narrow layout, keyboard scrolling/focus, exact decisions, legacy
presentation and missing-echo feedback. The coordinator verified all 260 recorded source/config
hashes and all 23 frozen assets against disk. All match; Rust-only review fixes leave that frontend
evidence applicable. The owned fixture/debug ports 8974 and 3376 have no listeners.

The test window used synthetic canonical DTOs and exact production CSP. It does not replace the
separate Host masking, authorization or execution evidence. No paid provider, production database,
secret store or unrelated Avatar/OpenBiliClaw work was used for continuation verification.

## Remaining program work

D68-B's reviewed DSH Monitor adapter is next, followed by the live-feedback child's Chat and Pet
slices and integration. D63 execution expansion, D75 same-scope token-benefit measurement, D77
error taxonomy and actual T4 initiative/heartbeat remain outside this completed D64 slice. Keep
parent tasks and any personal owner-acceptance statements truthful.
