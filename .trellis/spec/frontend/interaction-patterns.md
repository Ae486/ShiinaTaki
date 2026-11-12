# Interaction Pattern Authoring and Review

## Scope and authority

`features/initiative-patterns/` serves the registered Home initiative page, proposal cards in actual Chat,
and pre-admission diagnostics in the existing Monitor. Core PatternService is the only writer. All wire
definitions, history, setup and refusal types come from Shared through WsClient. No localStorage,
polling, alternate permission authority, model call or automatic confirmation belongs to the UI.

## Review and editing contract

- Opening a candidate captures the displayed immutable PatternView. Background refresh may update the
  latest comparison, but cannot replace the reviewed definition. A changed version/candidate disables
  confirmation until the user explicitly chooses to read the new proposal.
- Confirmation sends that displayed candidate ID and expected version. Closing or cancelling is local
  only. Confirming a paused Pattern preserves pause and must say so. A duplicate result reports already
  processed, not a newly applied transition inferred from the original action.
- Render title, purpose, all simultaneous conditions, context, allowed outcomes, judgment cooldown
  including silent judgments, deterministic chance, validity, provenance and before/after differences.
  Disclose actual aggregate Core limits, User Timezone, periodic/event enabled states and check interval.
  Explain that disabling periodic checks leaves enabled event checks subject to the same gates and budgets;
  disabling both prevents new initiative admission. Missing values remain unknown; a source
  being selected never implies its permission or privacy switch is enabled.
- IDs, revision counters, command tokens, paging cursors and completion Run IDs remain callback/transport
  bindings. They never enter visible text, tooltips, accessibility fallbacks, copied text or DOM option
  values. Completion choices use Core-provided labels. The source-dependent Intention atom is not
  offered while C4 is unavailable; existing typed definitions can still be read.
- Editing owns a captured base separately from current server state. Reads, null/replacement clients,
  errors and unrelated updates do not reset focused/dirty text. A conflict retains the draft and requires
  an explicit latest-content acknowledgement before rebasing. Successful submission closes only its
  still-mounted, unchanged draft; newer typing is never silently cleared or automatically resubmitted.
- History shows immutable revisions and accepted/candidate status. Rollback submits a new proposal;
  it never activates historical content or restores permission/effects. Retirement needs a second
  explicit action and leaves history readable.

## Read and mutation ownership

- Register typed invalidations before the baseline. Pattern/setup invalidations need no separate
  subscription ACK; config changes retain the existing successful config subscription requirement.
- Reuse `createReadCoordinator`: one flight plus one trailing invalidation, retained last-good state,
  no stale response after client/selection retirement, and explicit failure/retry without retry loops.
- Commit selected identity together with its current/history payload. Preserve the prior coherent
  selection while a different target is loading. Keep editor and reading nodes mounted during refresh.
- Commands serialize per controller. A lost ACK/reconnect never replays a command or publishes a
  retired success; preserve the unknown-outcome message until a later deliberate operation supersedes it.
- Hidden kept-alive pages retain cheap dirty obligations but do not read. Re-entry/reconnect performs
  necessary current reads. No normal render, focus event or timer initiates data work.

## Integration and setup

- Chat cards live in TimelineView's adjunct slot inside the existing scroll container and resize
  observation. They do not rewrite Timeline, replace the primary socket or use approvalRespond.
- `manage_interaction_pattern` canonical tool payloads keep their complete source/CAS bindings for
  replay/model use. Its result renderer selects semantic fields instead of generic JSON; live status
  fallback must not leak an internal error or identifier while no output is available.
- Setup uses the standard Core Skill import facade. Same-name/user-disabled packages stay intact;
  the existing Skills page owns explicit replacement/enablement. Example setup only creates a proposal.
  The enabled switch is an explicit config action; installing/importing never flips it.
- The same Monitor exposes producer-backed bounded policy reasons/counters separately from real Runs.
  No synthetic Run, second monitor, raw source dump or fabricated zero is permitted. Old-Core errors
  are retryable and retain the last good projection.

## Verification

### C4 backoff controls and follow-up result presentation

- The existing Monitor policy card reads backoff through a separate `observability.initiative-backoff` method;
  `initiative.backoff.reset` returns its actual status, and `observability.initiative-backoff-changed` carries only
  a strict Character scope. The legacy strict policy result is unchanged. WsClient parses both responses and
  the notification through Shared schemas; no page registers a second inbound route.
- `InitiativeBackoffController` owns one read plus a trailing invalidation and one explicit reset. Install the
  notification handler before the baseline, ignore other Characters/retired clients, and retain last-good content
  with a truthful stale marker on failure. Hidden/disabled Monitor pages do no reads or React publication.
- Reset requires active/current loaded state, no running read and no pending mutation. A hidden page retains the
  pending mutation lock and processes its outcome without publishing. Re-entry reads once. A null/replacement
  client retires the old reset outcome and preserves an unknown-outcome diagnostic; never resend the mutation.
- Apply a valid reset echo separately from the following reconciliation. An accepted reset plus a failed read
  keeps both the accepted result and the refresh failure visible; it cannot claim refreshed state. A successful
  read after an interrupted reset does not establish that earlier command's outcome or erase its warning.
  A reset's own invalidation may start a read before its response arrives. Retire that pre-echo read when accepting
  the echo and give the covering reconciliation its own read epoch; otherwise the superseded read's failure can
  consume the current refresh obligation and leave stale state without a failure explanation.
- Render only real stage, qualified weak count, current day usage and nullable next eligibility. Missing status
  is unknown, never normal/zero. A known null next time means no backoff wait, not that all other gates passed.
  Reset neither refunds global quotas nor implies that a real-world matter was answered or resolved.
- Current `plan_follow_up` output is already semantic at the Core producer. The existing tool result adapter
  renders Chinese outcome/state and the finite start/end window, without raw IDs, errors or an empty-output
  fallback to `status.message`. Copyable details, disclosure content and accessible text use this same projection;
  canonical tool parts remain unmodified. Unknown shapes are conservative; duplicate/expired output never
  promises a new plan, renewed deadline, utterance or resolved matter. This is not an Intention inbox.
- Backoff reads use the interactive read deadline; reset uses the interactive unknown-outcome mutation deadline.
  Notification fan-out remains observer-isolated and retires on both socket close and explicit client close.

Focused C4 tests cover unknown versus real zero, disabled actions, hidden/foreign invalidations, finite bursts,
old read/reset success and failure, failed post-reset refresh, reconnect without replay, and retained unknown
outcomes. Current follow-up producer-shaped fixtures verify complete disclosure/accessibility markup and the
selectable semantic text with extra forbidden identity fields. Static rendering is not actual native clipboard,
focus/selection or owner acceptance evidence; those checks stay with the integration gate.

`node apps/desktop/test/c4-backoff-native-smoke.mjs` reuses the existing C2 WebView2 shell and frozen production
Home components. Its eight native assertions cover status transitions, retained controls, error/unknown feedback,
hidden reads, lost-ACK recovery, actual selected result text/accessibility and the pre-echo reset race above.
Backoff/Monitor/Timeline data and transport responses are scripted and Shared-validated, not actual Core backoff
or C2 human-opportunity proof. No native clipboard write/read or owner-quality acceptance is claimed.

Focused controller/component tests cover exact revision confirmation, refusal/current state, old-client
results, invalidation bursts, hidden reads, coherent selection, rollback, unknown outcomes, package
collision/disablement and identifier omission from full markup/tool disclosures.

`node apps/desktop/test/c3-pattern-native-smoke.mjs` builds frozen production Home assets, uses the
existing isolated native shell and real PatternService/SQLite, and records screenshots plus checks.
Its transport, setup and Timeline producers are scripted. It proves native controls/DOM/focus/selection,
reader anchors and domain persistence, not the primary model/tool loop, real Skill installation,
permission policy, C4, real OS IME or owner visual acceptance. The separate Core/process and owner
gates remain required. Fixture HTML must mirror Home's height/overflow contract; selectors must exclude
kept-alive hidden pages and must wait for actual enabled actions.
