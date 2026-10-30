# C4 integrated implementation and verification

## Disposition and boundaries

This report records the final child of the unified Companion initiative implementation in
`H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. The owner approved C4 and requested recovery
after interruption. The existing task and native session `codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167` were retained;
the stale global Avatar Lab task pointer was not changed.

The C1-C3 prerequisite source manifest was verified before C4. Their reports remain historical evidence; this
report refreshes the combined engineering gate. Owner/manual acceptance remains pending, so neither the child nor
the parent is archived or marked complete. No commit, push, rebase, reset, dependency installation or deployment
to the normal user profile was performed.

The integrated engineering gate passed after the three test-only migration expectation corrections described
below. Completed logs distinguish the initial failures from their final targeted rerun. The remaining work is
the explicitly pending owner/native production trial, not an unreported automated test failure.

## Delivered behavior

| Area | Result |
| --- | --- |
| Finite plans | Primary-only governed `plan_follow_up` captures the actual user Timeline source, purpose and original finite window. One source key survives retries/rewording and cannot renew terminal work. Due standalone plans use the existing Wake/Run/Attempt pipeline without a stored Pattern or Scheduled Task. |
| Expiry and recovery | Admission and output enforce exact original deadlines and source authority. Proven source withdrawal retires work; temporary unavailability preserves only its finite opportunity. Claim/link/crash repair uses the canonical Run key; silence, failure and uncertain dispatch never replay. |
| Related Memory | A fresh independently eligible opportunity may explicitly read selected Global/current-Character Memory. One captured query/attempt per Bank, four records and the final 512-token estimator budget apply; original Source/unit/policy/authority and selected assembly remain fenced through held delivery. No automatic recall or primary-history replay is added. |
| Backoff | Only C2 qualified weak evidence drives normal/2x/4x/daily stages. Real same-Character input and deliberate reset clear the feedback fence, preserving hard quotas and canonical daily admissions. Original timezone metadata is immutable; unknown/DST/zone-change accounting is conservative. |
| Existing Monitor and Chat | Separate strict backoff read/reset/changed methods feed readable Chinese state and intentional reset. Unknown stays unknown; reset success and read failure remain distinct; reconnect never replays a mutation. Plan tool results expose semantic bounds/status without internal source bindings. |
| Integration | Additive migrations 054/055, bounded new-window config, immutable standard Skill update, primary tools, main lifecycle, actual admission/feedback/source notifications and shutdown/recovery are wired through existing owners. |

Details: [domain](intention-domain-implementation.md), [Memory](memory-integration-implementation.md),
[backoff](feedback-backoff-implementation.md), [Desktop](backoff-ui-implementation.md),
[formal review](formal-review-2026-09-28.md), [scripted production process](process-acceptance-2026-09-28.md),
and [actual model trials](real-model-acceptance-2026-09-28.md).

## Demonstrated defects fixed

- Completed expression left a claimed Intention because it has no speech publication. Reconciliation now uses the
  completed executable continuation and Run without inventing a sent speech row.
- New backoff reasons broke the old strict policy decoder. The existing RPC now maps detail to its original
  vocabulary while preserving rows/cursors and merging counts; the separate backoff RPC retains full detail.
- Actual new admission did not invalidate the open backoff view. The committed Heartbeat/Class B producer now
  publishes its bounded Character invalidation; the process regression isolates this from earlier user resets.
- Real-provider trials exposed `dispatch_committed` being mistaken for final transport uncertainty. The live path
  now waits for actual `sent`/`unknown`, while restart retains non-replay uncertainty. Failed first-batch artifacts
  and deterministic before/after regression are preserved.
- Native WebView2 exposed a reset notification/read/echo race suppressing a failed refresh. The owning controller
  retires the earlier read generation and performs current reconciliation. A deterministic regression and final
  native scenario both cover the actual ordering.
- Final Core regression found historical migration-tail expectations ending at 053. Three existing tests now
  explicitly include additive 054/055 while retaining their populated-history/reopen assertions; production
  migrations and historical receipts were not rewritten.

## Verification results

| Check | Result / evidence |
| --- | --- |
| Shared full | 67 files / 637 tests passed; `validation/shared-final.log`. |
| Core full and final affected tests | Full single-worker run: 454 files, 3,732 passed / 2 failed / 1 existing skip, 665.36 s. Both failures were stale 053-tail expectations. Three corrected related files then passed 36/36 in 8.30 s. Logs: `validation/core-final.log`, `core-migration-recheck.log`. The combined coverage is 3,734 passing cases and one existing skip; no second all-green full invocation is claimed. |
| Desktop full | 196 files / 1,187 tests passed with two workers, 84.63 s; `validation/desktop-final.log`. |
| CLI full | Eight files / 50 tests passed, 4.74 s; `validation/cli-final.log`. |
| C1-C4 process and local observer | Four files / 32 tests passed in 287.88 s: 23 production-process cases and nine local HTTP observer cases; `validation/process-final.log`. This includes the final admission-specific backoff notification assertions. |
| Five-package typecheck, root lint, Desktop build | All passed; `validation/typecheck-final.log`, `root-lint-final.log`, `desktop-build-final.log`. Vite retains the existing advisory for chunks above 500 kB; this is a frontend build, not a new signed/package installer. |
| C4 real model | Repaired 4/4 passed after initial 2/4 failure; finite terminal disposition and actual Memory recall verified. |
| C3 real compatibility | 8/8 passed with the new plan tool; full authoring/clarification/reminder/heartbeat routing retained. |
| Native C4 | Eight WebView2 groups passed; `validation/backoff-native-2026-09-28T14-37-32-684Z/`. Real Home/Monitor/Chat/WsClient with scripted validated data; six screenshots and selected text retained. Root visually read failure/reset and plan-disclosure screenshots. |
| Rust / C2-C3 prior native | No Rust source/Cargo/capability change in C4. Source-hash reconciliation preserves prior 205 Rust tests/Clippy and existing C2/C3 native evidence; no new packaged binary or full native-C2 rerun is claimed. |
| Task contexts | 12 implementation and 13 check entries validated. |
| Whitespace, credentials and final source | `git diff --check` passed; 160 changed source/policy/document files passed UTF-8/no-BOM/trailing-whitespace checks. Literal configured provider-key scan found no occurrence in retained C4 research artifacts. Final manifest inventories 2,254 source/config files, with 128 changed/new since C3, unchanged HEAD/index and no production change during the final gates. |

The final process command includes `initiative-runtime.e2e.test.ts`, `initiative-pattern.e2e.test.ts`,
`initiative-recovery.e2e.test.ts` and local `fixture/real-provider-observer.e2e.test.ts`. Their provider is local and
scripted except the explicitly separate opt-in real suites. No full unrelated OS-effect E2E campaign is claimed.

The first native attempts found selector/fixture readiness issues, the real controller race, and one Windows-assigned
HTTP port rejected by WebView2. The final fixture uses an explicitly selected high port. These earlier attempts are
not recounted as passes, and no production listener/default or assertion was weakened to obtain the final pass.

## Parent AC01-AC19 evidence map

These mappings distinguish executable evidence from owner judgment. All parent owner boxes remain unchecked.
The complete Core/Desktop suites refresh the named owning-service regressions where applicable; native references
below retain their explicit historical/source boundaries.

| AC | Engineering evidence | Acceptance boundary |
| --- | --- | --- |
| 01 | Existing InitiativeRuntime and real process trajectory show canonical Run/Attempt/Effect/class/context and Monitor identity. | One runtime and ledger; protocol facts do not prove reading. |
| 02 | Wake matcher/engine, C1 runtime, C3 process and finite availability timer cover stale/quiet/busy/disabled/unknown/budget refusal before model work. | No fabricated source or source-backlog replay. |
| 03 | Wake engine's deterministic bounded Pattern/Intention coalescing and shared source claims. | No second loop or per-behavior executor. |
| 04 | Pattern service/source and standard Skill tests; real authoring lifecycle and C3 native confirmation/CAS. | User changes and immutable package collision rules retained. |
| 05 | C3 production and real eight-case suites: proposal, exact confirmation, revision, pause/resume/history/rollback and unsupported-source clarification. | Model prose has recorded imperfections; owner authoring experience pending. |
| 06 | Desktop privacy/semantic display regressions; prior C3 native cards and current C4 disclosure/Monitor screenshots and text selection. | Native fixture data is scripted; Chinese IME/usability requires owner trial. |
| 07 | Intention source/service, Wake integration, live delivery-event/crash tests; three actual process recovery scenarios and two repaired real finite cases. | Expired or uncertain source cannot catch up/rearm. |
| 08 | Production offline-expiry then new Pattern + actual canonical recall; withdrawal variant excludes the old record; real recalled questions leave outcome unknown. | Expiry does not resolve/delete the underlying matter. |
| 09 | Selected assembly/recall/provider lifetime tests and actual model request probes exclude primary-history markers. | Live remote Hindsight outage changes are not observable until confirmed synchronization. |
| 10 | C1 decision/delivery regressions, completed-expression repair and real silent/speech outcomes. | Protocol Avatar ACK does not certify actual appearance or human reading. |
| 11 | Existing held-output/recovery/priority tests, original-source retention and captured recall/assembly checks. | Same Run/Attempt resumes; no extra model call or terminal executable effect. |
| 12 | Canonical quotas plus real C2 backoff service tests, DST/zone carry, reset/reopen and independent Class A reminder routing. | Reset never refunds hard budgets or converts an SDK step to another judgment. |
| 13 | Canonical claim/link/crash cuts, deferred actual transport callbacks, primary concurrency and source/authority-generation regressions. | Live dispatch uncertainty remains non-replayable on restart. |
| 14 | Existing post-await Perception/privacy and Runtime/presentation authority regressions plus zero-call policy cases. | No new sensor/permission grant; unattended denial cannot widen authority. |
| 15 | Core Presence and Desktop source/exposure/lifecycle suites; prior C2 native Home/Chat/Pet reports. | Visible window, unknown idle, uptime or background connection alone does not prove presence. |
| 16 | C2 same-device opportunity/phone-shaped contract tests and C4 qualified-backoff, reset, deduplication/reopen cases. | No phone implementation or real remote device acceptance is claimed. |
| 17 | Existing mixed-version live/replay trajectory regressions, strict old-policy compatibility and actual admission-driven backoff notification. | Pre-admission diagnostics are not Runs; observers cannot change durable truth. |
| 18 | Fresh/current/recorded-lineage migration matrix, populated 053-to-054 and 054-to-055 rollback/reopen tests, updated older-tail preservation assertions. | No normal user database upgrade or downgrade performed. |
| 19 | Separate package, process, real-provider, native-fixture and source evidence linked above. | [Four owner flows](owner-manual-acceptance.md) remain pending. |

## Source, isolation and known limitations

`source-baseline-2026-09-28.json` preserves the C3 predecessor. `source-at-final-gates-2026-09-28.json` captures C4
before the full gate; `verified-source-2026-09-28.json` records final reconciliation, including the three
test-only migration expectation fixes and documentation updates during verification. Production/source stability
is assessed explicitly rather than claiming an unchanged whole tree. HEAD/index remain at their original values.

The only three inventoried files changed during the final gate were the corrected migration tests. The named
runtime spec was updated to reflect the completed consumer integration. No Rust source, Cargo manifest/lock or
capability declaration changed relative to C3. Final native component/fixture hashes also match the live files.

The repository and installed QQMM lockfiles were already different at the prerequisite gate. C4 changed neither,
introduced no dependency and did not perform a clean frozen-lock reinstall. Current-environment tests/build are
not a claim of fresh-environment dependency reproducibility.

Two preexisting Memory test fixtures temporarily created their owned data under
`H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911` before the boundary violation was discovered. Their existing
guarded teardown completed. Both T4 fixtures now use guarded system-temp children and passed the isolated rerun.
No main source/Git change or broad cleanup was made; this report deliberately does not claim every earlier test
wrote only within T4. The exact commands and path correction are in the Memory report.

Hindsight remote changes during complete disconnection remain unknown until verified synchronization. Historical
receipts lacking original source/policy proof remain unavailable. Provider-wide opaque derived-source closure
(D81) and exact model-tokenizer equivalence to the existing 512-token estimator remain outside this change.

Real-model text still sometimes repeats an already-known question, contains literal newline escapes, or loosely
describes sensing availability. The saved semantic review documents these limitations; Persona/noise quality and
actual human reading are not inferred from passing structural assertions. Known model usage for this C4 campaign
and C3 compatibility totals 937,490 tokens, with three additional requests lacking canonical attribution.

## Rollout and rollback

This task does not launch or modify the owner's normal installed profile. The isolated process fixture imports
the real Core; the native fixture uses scripted state. The production Shell's actual data-directory, port and
Keyring boundaries must be satisfied before a safe full native owner trial; the manual guide records why merely
setting `TAKI_DATA_DIR` or a WebView2 profile variable is insufficient.

For an authorized deployment of this source: back up the intended Core database/profile, start the matching Core
TypeScript source and build Desktop, allow the additive 054/055 migrations, inspect target/model/timezone/source readiness, explicitly handle
the standard Skill's immutable old-version collision, and enable only the selected initiative policies/confirmed
Patterns. The new maximum-window setting defaults to seven days and affects newly formed plans only.

Rollback means disabling new initiative admission using the existing master/source controls while retaining
compatible readers, canonical history, uncertain-effect tombstones and captured charges. Do not downgrade a
database past its written migrations, erase Memory/Timeline, renew expired plans or replay unknown effects.

The next acceptance work is the owner's isolated native/IME/Persona/noise trial. It requires a real staging boundary
or explicit authorization to use a chosen profile; this report does not invent a currently unsupported launch flag.
