# Recommendation integration and deployment continuation

The owner authorized OpenBili recommendation/profile/native-feedback integration and bounded selected-video
pre-analysis, then requested recovery after reboot and Docker-first deployment. This continuation recovered
session `01a14a62-793f-74f2-8e60-8367dbeb5a75` without creating/binding a Trellis task or performing Git lifecycle work.

## Implemented boundaries

- Native OpenBili has a separate non-mutating existing-recommendation peek. Ordinary recommendation GET retains
  its native history/pool effects. Source changes live in the isolated `openbili-recommendations` worktree.
- The media bridge adds independently configured recommendation, bounded profile and native-feedback tools.
  The portable `taki-media-recommendations` Skill teaches composition; it grants no permission.
- Primary user chat can prepare 1..3 selected videos sequentially through existing analysis owners. Native results
  remain reusable without Co-Watching consent, commentary or an automatic completion reply.
- Independent review caught two real defects: confusing transport and Timeline IDs, and acknowledging a pending
  or refused duplicate admission. The repair reuses the existing primary-source ledger and shared admission result.
  The regression crosses the actual chat.send/ChatAgent/Skill/tool/runtime boundary with distinct IDs.

Executable contracts and required tests are in
[the recommendation spec](../.trellis/spec/backend/media-recommendations.md).
Independent explicit URL analysis retains its existing once-only ordinary answer.

## Docker deployment and disk evidence

The local Docker Engine was stopped after reboot and has been restarted. OpenBili is deployed at
`http://127.0.0.1:18420`, container `taki-openbili-backend`; native port 8420 falls inside a Windows reserved range.
The image pins native 0.3.205 and overlays the verified source containing peek. Deployment commands, image digests,
source hashes, authenticated checks and named volumes are in
[the deployment record](../integrations/openbili-deployment/README.md).

The live Docker settings and VHDX locate its data on G:, not H:. At inspection G: had 129.29 GiB available and H:
had 2.60 GiB. T4's Rust target used 9.228 GiB, including 2.595 GiB incremental cache; the main checkout's target
used another 2.533 GiB. T4 runtime evidence/data used 4.292 GiB. These are measured logical file sizes, not a claim
that every file is disposable. No project/cache deletion, migration, Docker prune or unrelated container change
was performed. Existing test data, completed video analyses and browser pairing were preserved.

Service liveness and business readiness are distinct. Initial deployment had no model registry/account/profile,
so authenticated business routes truthfully returned native 503 rather than fabricated empty data. Model setup,
account initialization and later real-profile acceptance are tracked separately from container health.

The subsequent supported native configuration update installed exact `deepseek-flash` text/evaluation routing
with background model work suppressed and scheduling disabled. After restart, authenticated peek returned an empty
existing view and profile returned `initialized=false`; anonymous access remained refused. The existing Taki secret
catalog now holds the deployment token, and only four OpenBili tools are selected in `media-recommendations`.
The `taki-media-recommendations` Skill is imported/enabled. Actual Taki MCP client -> Python stdio -> authenticated
Docker peek/profile reads passed without model generation (`openbili-live-read.json`). Native account initialization
was separately authorized by the owner after deployment; it is not inferred from installing these tools.

## Authorized account initialization

The owner completed official Bilibili QR login. The installed SDK 17.4.2 parsed credentials only from the JSON
redirect URL, while the observed successful official response carried all three required login fields in HTTP
cookies and none in that URL. The operator helper now captures that same response before the SDK discards its
envelope, merges nonempty cookies, and submits them to unchanged native official validation. A regression using
the real SDK reproduced the empty-URL-field case; the corrected live login was validated and saved by native code.
Rejected candidates are kept privately for diagnosis without consuming another QR; successful temporary HTTP,
cookie and QR recovery copies were removed after verification. Credentials and profile/history text are not
included in these records.

Native initialization ran once (`090d6360-3a6e-4216-bda8-647fafb15e61`), importing 200 history events with favorites
and follows disabled and only Bilibili enabled. The CLI exited successfully after 330 seconds with an initialized
profile and the initial readiness target of 15 available candidates reached. Remaining native initialization work
then completed five more candidates and one more model call. The stable final state is **20 available candidates,
20 content-cache rows, 200 history events and zero recommendation-history rows**. The initial readiness target is
not a hard inventory cap.

The complete initialization used **22 successful model calls, 209,532 prompt tokens and 54,854 completion tokens
(264,386 total)**. Native pricing reports an estimated CNY 0.33531 using its fallback rate; the exact model's
verified price and actual billed cost remain unknown. These totals include the work that completed after CLI exit
and are separate from the earlier UI campaign.

Only the OpenBili backend was restarted for persistence verification. The account, initialized profile and final
counts survived; the existing bridge token remained usable, anonymous peek returned 401, and auth, scheduler and
network configuration were unchanged. All automatic scheduling remains disabled. Docker data remains on G:;
the later disk check found H: at 2.32 GiB free and G: at 128.50 GiB free without project/cache cleanup.

The actual Taki `defaultConnect` client -> Python MCP stdio -> authenticated Docker read passed after restart.
The installed server remains connected with exactly four selected tools. The bounded profile projection reports
`initialized=true`, `availability=available`, `complete=false` and `truncated=true`, as expected for its size limit.
Native counts and model usage were identical before and after these reads. Existing-recommendation peek is still
empty because no ordinary browsing/serving call has populated recommendation history; the available candidate pool
is a different state. Verification did not call the serving endpoint or fabricate exposure, clicks or feedback.

Native evidence is in `integrations/openbili-deployment/initialization-completed.json` and
`initialized-after-restart.json`; the MCP read is recorded in
`.runtime/media-continuation-20261018/openbili-initialized-live-read.json`.

## Validation record

Evidence root: `.runtime/media-continuation-20261018/`.

| Gate | Current evidence |
| --- | --- |
| Native peek/auth/SQLite regressions | 42 passed; full Ruff and changed-file formatting passed |
| Native Windows MyPy | 15 POSIX-symbol errors in five unchanged files; no changed API file error |
| Bridge Python suite | 41 passed |
| Installed MCP/SDK disclosure | Initial OpenBili schemas hidden; exact describe exposes and executes only selected peek |
| Bridge lifecycle | Existing BiliNote interoperability and dual-client cooperative EOF/actual process exit passed |
| Recommendation runtime/Shared | Targeted tests passed, including actual chat identity and duplicate admission regressions |
| Whole workspace typecheck | All packages passed; Core passed after correcting the test-fixture context type |
| Root ESLint | Passed |
| Whole Core regression | 481 files passed, 1 skipped; 4003 tests passed, 2 skipped; exit 0 in 277.94 seconds with maxWorkers=4 |
| Authorized native initialization and restart | Initialized profile, 200 history events and 20 available candidates persisted; existing auth and disabled scheduling preserved |
| Post-initialization MCP read | Connected four-tool server; bounded profile and empty existing-history peek passed; native counts and usage unchanged |

The live initialization and reads establish current profile and candidate-pool readiness. Automated checks do not
establish owner acceptance of recommendation quality or user-facing browsing and pre-analysis behavior.
The current implementation supports primary chat preparation only. Scheduled/Heartbeat preparation, local-file
transport and full restart/Continue remain outside this slice; no new framework is implied by those follow-ups.

## Detected-viewing continuation

The rebooted Core/BiliNote/Shell/browser stack retained its existing data and pairing. Real background media probe,
foreground read, screenshot and vision Effects succeeded. An optional Bilibili login overlay paused playback around
one minute and could invalidate screened visual evidence. Normal UI dismissal was used; no privacy rule or page
authorization was bypassed. Subsequent retries were also subject to the unchanged model-cadence budget.

A real Class B invitation was published at Timeline 274, but expired before the initial manual automation attempt
clicked its controls. The subsequent dedicated watcher verified a real card and UI defer at Timeline 275, then a
new viewing occurrence, UI accept, exact existing-analysis reuse and UI Stop at Timeline 276. Native `video_tasks`
remained five. The accepted session prepared four responses and sent none before Stop, so this round does not
claim playback-timed commentary or its human quality was evaluated.

Both later invitation Runs contain `avatar_rejected` while their text deliveries were sent. This partial failure is
preserved rather than reporting those entire Runs successful. Same-view observations had no repeat invitation,
but other eligibility/budget gates also applied; deterministic suppression tests remain separate proof.
See [the UI evidence index](../.runtime/media-continuation-20261018/invitation-ui/RESULTS.md).

The UI worker's four temporary timing/utterance-limit settings were restored with exact unstored state. Root then
restored the baseline observation overrides, initiative settings and original durable decisions, revoked the exact
temporary probe grant, and restarted the current Core with its original no-screen launcher. `baseline-restored.json`
confirms all three comparisons, ambient/Initiative off, VLM unset and no active Co-Watching session. New recommendation
MCP/Skill configuration is an intentional installation, separate from the revoked test permissions.

The delegated UI campaign used eight model effects reporting 179,751 tokens; monetary cost is unavailable. This
subtotal excludes earlier root probe/vision/invitation calls and the later separately authorized OpenBili initialization.
No owner-observed acceptance is inferred from these automated checks.

The later permission review corrected a missing observation in the UI report: accepting Timeline 276 prompted for
`co-watching-native / bilinote_read_result`. Core records waiting, then a session-scoped approval, then dispatch
and preparation; the actor who granted that approval has not been established. The broader campaign also used
automatic MCP Allow clicks for a probe and temporary observation policy overrides. Therefore its successful paths
do not validate pending/denied permission behavior. The owner's report of apparent execution before confirmation
triggered the focused tests below. The original approval actor remains unconfirmed. See the corrected UI evidence
index above. The separate
request to show definite names for historical MCP grants is recorded in
[the deferred registry](deferred-decisions.md#mcp-durable-approval-target-names-owner-follow-up-2026-10-18).

## Focused permission regression — 2026-10-18

The owner approved checking existing integration points and reusing the shared permission pipeline. No permission
subsystem or production behavior was added. The active test environment had no remaining approval-click automation.
The new `packages/core/src/co-watching/runtime-permissions.test.ts` composes the existing accepted Co-Watching
fixture with production Run snapshot capture, the real MCP manager/SDK, canonical Governance/Approval and SQLite
Run/Effect owners. Browser, native response and model producers are inert fixtures, not live acceptance claims.

All six cases passed: pending approval leaves native/model dispatch counts at zero and records a waiting Effect;
allowing that exact request commits the same Effect and reads once; deny causes no hidden retry; Stop rejects a
late Allow; disconnect refuses pending work; policy changes after approval still prevent dispatch; a matching
long-term grant is reused, while a changed MCP configuration revision asks again. The first and last cases each
cover their paired before/after states.

The related 11-file regression run passed 97 tests, including generic captured/unattended governance, canonical
approval, MCP presentation, native analysis, invitation-source and operator entry tests. Core typecheck and the
changed test's ESLint passed. The initial typecheck found only a nullable SQLite value in the new test assertion;
an explicit runtime type guard corrected that fixture issue without production changes.

This focused boundary did not reproduce execution bypass. The owner subsequently accepted the permission item as
having no issue and explicitly stopped further permission-mechanism testing. The earlier approval actor remains an
unconfirmed historical fact, not an outstanding blocker or reason to repeat the audit. The historical-name display
follow-up remains deferred and separate from authorization correctness.

## Functional continuation — avatar outcome attribution

Both invitation presentation outcomes were traced to the actual launch log
`.runtime/media-entry-20261017/viewing-core-20261018-042022.stdout.log`. The commands requested `serious01`, and
the renderer returned `rejected / already_active` for each. Existing renderer behavior deliberately refuses
reselecting the currently active expression; the shared avatar tool guidance calls this normal and forbids retry
or apology. This is not a missing model resource, unknown expression, or a failed invitation delivery.

The historical Runs retain their original failed classification and sent text deliveries. No result is rewritten
to `applied`, no presentation outcome contract is changed, and no media-specific workaround is introduced. This
finding removes the unexplained avatar failure as a functional blocker. Actual proactive-session commentary
delivery, playback timing, pause and Stop are the next functional verification scope.
