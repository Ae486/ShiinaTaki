# C2 implementation evidence — 2026-09-28

## Scope and authority

This report records the implemented Presence and presentation-feedback child, not the entire Heartbeat delivery.
The workspace is `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `06a8090`.
The effective task is `09-11-initiative-presence-feedback`, resumed from native session
`codex_01a0dd62-d788-7762-ba7d-c7baab4b5638` and bound to successor session
`codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167`; the stale global Avatar Lab pointer was preserved.

C1's automated prerequisite and the owner's formal C2 start authorization were already in place. Existing planning,
implementation and review work was resumed. C3 is not activated by this report. No commit, push, rebase, reset,
archive, real-user database migration or external model trial was performed.

Only the supplied `H:/TakiAgent-worktrees/T4-heartbeat-child1-findings-2026-09-25.md` was read from that other
Heartbeat worktree's reference material. No implementation there was inspected or copied. The
[continuation report](continuation-2026-09-28.md#external-reference-review) records its useful regression scenarios
and its superseded migration, recovery and test-scanner claims.

## Implemented responsibilities

| Area | Delivered behavior |
| --- | --- |
| Accepted Perception | Nullable native idle, actual routed Host/connection/catalog provenance and a separate observation/consent epoch. Foreground, screenshot and VLM continuations recheck authority after awaits. Successful pause/source retirement clears stale activity/screen evidence; failed durable pause does not advance the epoch. |
| Shared and authenticated Core sources | Strict bounded `presence.report`, `presence.read` and `timeline.presentation.report`; source identity derives from the live authenticated operator connection. Home, Chat and Pet remain independent. Reauthentication, disconnect and restart cannot inherit old input or exposures. |
| Feedback storage | Additive migration 051 creates `delivery_presentations` and `initiative_feedback`. Live sources remain process-local. Confirmed exposure and fresh same-device input form bounded interval unions; unknown, hidden, expired and offline gaps add nothing. Only published Class B invitations receive response-opportunity feedback. |
| Primary chat and recovery | Engagement requires a real later same-Character user Timeline row within the observation window. A failed feedback callback does not turn a durable user send into failure; the production 15-second maintenance pass recovers it from persisted rows. Historical viewing cannot reopen settled feedback. |
| Monitor | Existing Run/Event storage and projections carry v2 `delivery.presented` and `delivery.feedback_settled` facts. Required events commit atomically with their state; only committed fact objects reach live subscribers. Unproduced opportunity values are omitted. Presentation is explicitly distinct from reading. |
| Desktop | Client-owned, reference-counted source lifetimes survive development StrictMode and same-client remount. Trusted input retains its original age. Self-window visibility, document visibility and actual committed text govern exposure. Lazy Skeletons, closed Pet bubbles and offscreen text do not create presentation. |
| User Timezone | Home settings and the designated device reporter use C1's existing Core authority and revision fencing. Fixed/follow-device behavior does not imply user input, display association or Host availability. |

The detailed fixes and executable contracts are recorded in the [formal review](formal-review-2026-09-28.md),
[Core evidence](core-evidence-2026-09-28.md), [Perception evidence](perception-evidence-2026-09-28.md),
[Desktop/native evidence](desktop-evidence-2026-09-28.md),
[backend Presence spec](../../../spec/backend/user-presence.md) and
[frontend Presence spec](../../../spec/frontend/user-presence-feedback.md).

## Acceptance evidence matrix

These are engineering evidence mappings. The PRD's owner acceptance boxes remain unchecked.

| Criterion | Evidence | Boundary |
| --- | --- | --- |
| C2-01 | Accepted-evidence tests cover null/stale/refused input, pause at async stages, pinned capture Host, Host/catalog replacement, cache retirement and failed durable writes. The real WebSocket pause regression verifies one compound invalidation and a cleared card. | No atomic screen/capture or physical-HID guarantee; no new sensor was added. |
| C2-02 | Core source/RPC tests and real-process E2E cover independent lifetimes, strict bootstrap/sequence/age, authentication replacement and process restart. Native WebView2 covers three sources, StrictMode/remount and Home-only reconnect without replaying input. | Native fixtures are not a test of every window-manager or remote-client behavior. |
| C2-03 | Service tests use authenticated phone-shaped explicit input with unavailable Desktop capability evidence and verify no invented presenting-device association. | The phone frontend itself is excluded from C2. |
| C2-04 | Real SQLite/service/RPC tests verify committed nonblank assistant identity, unions, transport gaps, limits, required-event rollback and no hidden-gap accrual under rate exhaustion or SQLite failure. Native Chat/Pet rendered text satisfies the exposure threshold. | Global/native presence alone never implies an attended operator display. No human-reading ACK exists. |
| C2-05 | Service/reopen tests verify one-time settlement, actual later user sequence, exact deadline, retained historical intervals and no post-deadline reopening. Process E2E verifies reply/Monitor/restart through the public protocol. | Missed or insufficient opportunity settles as unknown, not fabricated non-engagement. |
| C2-06 | Eleven actual WebView2 fixture groups cover lazy rendering, visible unfocused text, minimize/restore, retained hidden Chat, bubble closure/native hide, input trust, renewal, reconnect and scroll/selection anchors. | Scripted server and explicit fixture Pet opener; no model renderer/full costume path, reliable arbitrary occlusion detection or subjective owner experience acceptance. |
| C2-07 | Core authority/schedule tests cover fixed/follow mode, designated source retirement, revisions and future-only recomputation. Desktop tests and native Home exercise settings and real local timezone reporting. | A native device report is not evidence of user presence. No real-user schedule was migrated. |

## Verification record

| Check | Observed result |
| --- | --- |
| `pnpm --filter @taki/shared test` | 610 tests in 63 files passed; `shared-full-2026-09-28.log`. |
| Core final gate | `pnpm --filter @taki/core exec vitest run --maxWorkers=1`: 428 files, 3460 passed and one existing skip; exit 0 in 638.50 seconds. `core-serial-final-2026-09-28.log`. |
| Desktop final gate | 1104 tests in 186 files passed; final typecheck and scoped ESLint passed. Resumed production build passed after the last source edits; `desktop-build-final-2026-09-28.log`. Exact earlier command records and source timing are retained in the Desktop evidence. |
| CLI suite | 50 tests in 8 files passed during this continuation. |
| Final combined typecheck | `pnpm -r typecheck`: Shared, Core, Desktop, CLI and E2E all passed; `typecheck-resumed-final-2026-09-28.log`. |
| Rust final gates | Locked `cargo test`: 198 library and 7 helper tests passed, no skips; `desktop-cargo-test-final-2026-09-28.log`. Locked Clippy with `-D warnings` passed; `desktop-cargo-clippy-final-2026-09-28.log`. |
| Real Core process E2E | 17 tests passed, including both C2 public-protocol/restart scenarios; `e2e-final-2026-09-28.log`. The provider and user data are isolated fixtures. |
| Final formal review | Core 46, Shared 13 and Desktop 8 targeted tests passed; no unresolved reviewed production finding after F1/F2/F4 corrections. |
| Root `pnpm lint` | C2's Shared barrel size issue was corrected. The resumed final root run still fails only on independent `apps/desktop/test/qqmm-home-native-smoke.mjs` (361 nonblank lines, limit 360); `lint-resumed-final-2026-09-28.log`. That script and its size guard were not altered by this C2 continuation. |
| Native WebView2 | 11 groups passed across three independent reporting sources in two actual windows. Raw JSON and four screenshots are preserved under `research/native-evidence/2026-09-28T02-35-50-358Z/`, byte-identical to the original build artifacts. See the Desktop report for fixture and timing limits. |
| Task validation / whitespace | Native binding and context validation passed; tracked `git diff --check` passed with line-ending notices. Final direct checks also cover newly added files. |

The first Core full run exposed a real duplicate pause invalidation, now fixed and covered by 64 affected tests.
A later integrated run overlapped a newly added hidden-report regression, now fixed. The earlier two-worker run
passed 3459 tests with one existing skip and one 5000 ms timeout in the Hindsight curator policy-knob test
(reported duration 5843 ms). It is not reported as an all-green full run.

The three files implicated in timeout-only failures were independently rerun together with one worker:
`hindsight-runtime-composition.test.ts`, `hindsight-memory-write-repo.test.ts`, and `privacy-pause-writer.test.ts`.
All 31 tests passed in 24.49 seconds; `core-timeout-recheck-2026-09-28.log`. Their file hashes match C1's recorded
checkpoint. This establishes an independent successful rerun, not proof of the exact cause of the earlier timeout.
No timeout limit or assertion was weakened and no new skip was introduced.

The final full serial run then passed all 3460 active tests on unchanged Core/Shared source. This resolves the
outstanding Core gate without claiming that the earlier timeout's exact cause has been proven. The serial run
finished before this session's Rust/build checks began; earlier failure logs remain available.

The first full Rust run exposed a C2 integration expectation in the QQMM ACL test: its exact Home permission array
omitted C2's three self-window state-read permissions. Only those three expected strings were added; Home-only
QQMM authorization, other-window denial and compiled-authority assertions remain intact. The final 205-test run
and Clippy pass cover that correction. The unrelated QQMM native-smoke size failure remains separate and unchanged.

## Source and dependency reproducibility

`source-before-final-2026-09-28.json` captures 2104 T4 source/configuration hashes, HEAD/index identity and
the repository/installed lock hashes before the final Core check. All entries matched at successor-session recovery.
`verified-source-2026-09-28.json` records the final state and the sole source change since that checkpoint:
the three C2 permission expectations in the Rust ACL test. Core/Shared/Desktop TS source is unchanged. These
checkpoints read no other worktree's source.

Independent QQMM work is still mutable. At that checkpoint, its repository-lock integrity and the installed-lock
integrity differ. The external QQMM artifact was not read or replaced. Desktop results apply to the installed
environment and source at their recorded times; they do not establish a frozen-lock rebuild of the entire workspace.
The final checkpoint distinguishes the narrow C2 test correction from the previously integrated dirty tree.

## Gate disposition and continuation

C2 implementation, scoped automated verification, independent integration review and native-fixture evidence are
complete. Its task remains `in_progress` with `meta.stage=automated_verified`; owner acceptance remains pending.
The full workspace is not declared green: root lint still fails on the independent QQMM script and its mutable
external package is not lock-reproducible. C2's Rust integration test correction does not resolve or absorb those issues.

The next implementation child is C3 `09-11-initiative-pattern-authoring`, still in planning and not activated by this
closeout. It can consume the documented C1/C2 contracts under the existing ordered task workflow. Parent acceptance,
full native/Live2D experience and real-provider trials remain separate. No commit, push or archive was performed.

## Rollout, rollback and remaining acceptance

- C2 adds no model call, initiative admission, new external dependency or sensor capability. It uses existing operator
  RPC registration and Home/Chat/Pet lifecycles; Tauri permissions are limited to self-window state reads.
- Normal startup applies additive migration 051. Fresh and populated historical SQLite upgrade/reopen and failure
  rollback paths were tested in isolated databases. A future real-user rollout must preserve a pre-upgrade backup.
- Roll back new reporting/consumption while keeping compatible schema/event readers and durable history. Do not
  downgrade through 051, erase feedback/Timeline history or undo already executed effects.
- Full costume/rendering experience, arbitrary-window occlusion, real provider trials and subjective owner acceptance
  remain outside the evidence collected here. C2 acceptance and parent completion are not claimed.
- C3 has not started. Its consumers must preserve these unknown/evidence boundaries and the independent initiative
  quotas; Presence does not grant additional execution authority.
