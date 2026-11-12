# Research: Companion initiative presence contracts

- Query: Define evidence-backed User Presence, per-message presentation, non-engagement feedback, Character targeting, quota scope, and implementation validation.
- Scope: Internal source and existing planning records; no new external survey.
- Date: 2026-09-11
- Status: Development-design input. Product decisions are ratified only where attributed to the parent PRD/grill; schema names and timing values marked recommendations are engineering proposals.
- Work boundary: `H:/TakiAgent-worktrees/t4`; this report is one of the three owned research files listed in [the index](domain-and-presence.md). No production files or task pointers were changed.
- Companion part: [Domain contracts](domain-contracts.md) contains sections 1-7, the full source map, Pattern/Intention contracts, Signal vocabulary and privacy-generation rules. Load both parts for implementation.

## Findings

### 8. User Presence and per-message presentation

#### Orthogonal facts and authentication

Maintain separately: authenticated connectivity; source activity evidence; application/surface visibility; application focus; aggregate User Presence; message presentation; Host Availability; readiness for a particular step. Explicit input can establish a bounded presence observation. Visibility/focus alone only describes a surface. Neither proves reading or permission.

Recommended Shared report shape is a closed source kind with bounded fields, not a generic telemetry bag. Core derives identity from the authenticated connection, never a payload-supplied device ID. Give each report source/surface a connection-bound instance and monotonically increasing sequence; Core adds receipt time and an expiring lease. Reject wrong role, old connection, stale sequence, implausible ages, future timestamps and oversized payloads. A source can report its own state only.

For direct client interaction, send only interaction kind and elapsed age, without text, keys, pointer coordinates or content. In Desktop, use actual trusted input events; synthetic dispatch, programmatic focus/opening, render updates and connection restoration are not user activity. Continue to distinguish `isTrusted`/client input evidence from proof of physical hardware input or human reading.

Use Core observation time and bounded reported age to avoid client wall-clock authority. Never accept offline-buffered reports as fresh presence. Reconnect creates a new source instance; historical input must not be re-emitted with age zero. Lease renewal may refresh source reachability but must continue aging the actual last interaction.

Authenticated operator device IDs are shared across same-origin Home/Chat/Pet, but each has its own connection generation. Key live source state by connection/source, then aggregate by operator device and user. Retiring Home must not erase fresh Chat/Pet or a future phone report. On disconnect/revocation, retire only that source; recompute the aggregate. Unknown or expired sources do not mean absence. Report `present` when at least one valid source supports it; report confirmed inactivity only within the stated coverage of a current source; preserve unknown for the user's overall state when coverage is insufficient.

#### Native activity and device association

The existing foreground capability can provide a minimized idle observation without acquiring another sensor, but only after the full existing permitted/sensitive/scrubbed publication path accepts it. Preserve nullable idle before `ActivityState` turns it into a boolean. Do not collect idle independently while Privacy Pause or sensitive-source refusal has closed the sampled source.

Retain the actual Host/source generation at routing time. Current `RouteResult` discards that identity even though the router knows it. Never select “the currently connected Host” after an await or combine one Host's sample with another Host's lifecycle.

The Rust Node identity is distinct from the frontend operator identity. No inspected source establishes a trusted same-device association between them. Therefore do not join them by device name, IP, connection order, or assumed local deployment. Direct client input can already support same-operator-device feedback in the first delivery. A sampled Host's activity can inform the qualified global presence view, but using it to prove a response opportunity on a particular operator surface requires an explicit trusted association. Until that exists, retain unknown for that cross-source association rather than count a negative.

This is deliberately conservative: active phone input plus a message displayed only on an unattended desktop does not establish a chance to read that desktop message. Phone presence also does not make the desktop Host available. A phone frontend can later use the same operator/source protocol without claiming Node capabilities.

#### Per-message presentation producer

Reuse the existing committed Timeline utterance identity and Character binding; if one utterance uses several rows/parts, bind its complete existing presentation group. Do not create a separate proactive message protocol or report private stream deltas as displayed speech.

Attach the producer after actual text rendering in Chat/Pet, with the current generation, selected Character, active route/bubble, native-window/document visibility and viewport exposure. A lazy Markdown skeleton, hidden/collapsed surface, offscreen history item, store mutation or successful push is not presentation. Use bounded visibility/exposure intervals and existing stable DOM keys; do not change scroll/focus behavior to manufacture a receipt.

Recommended event contract: `timeline.presentation.report` (name illustrative) accepts an existing message reference and a connection-bound surface exposure report. Core verifies the referenced ordinary committed content and eligible Character scope. The projection says “presented” or unknown, never “read.” Disconnection, close, hide, minimize, Character change, DOM removal or generation retirement end the active exposure. A late callback cannot reopen it.

For WebView2, `document.visibilityState` alone may not prove native window visibility/occlusion. Reuse truthful native self-window state where available; if the implementation cannot observe full occlusion, document that limit. Presence plus exposure remains opportunity evidence, not proof of attention. No new ambient screen capture is needed to measure the app's own surface.

### 9. Non-engagement feedback and bounded timing recommendations

Create feedback only for an actual delivered Class B utterance whose interaction contract permits evaluating engagement. A useful optional outcome field can distinguish an invitation to respond from information explicitly requiring no reply; do not infer this by parsing punctuation. Silence, expression-only outcomes, held/expired delivery, and Class A work do not generate ignored-message counts.

Accumulate a response opportunity only during the union of valid intervals in which that message is actually presented and the same attributable device has fresh presence evidence. Unknown, expired, hidden, disconnected or unassociated intervals contribute zero. Union overlapping windows/devices so one minute on two windows is one minute, not two. Do not fill time gaps from a later report.

One Character/message can settle at most once as engaged, weak non-engagement, or unknown/insufficient opportunity. A real subsequent user turn to that Character can conservatively close pending non-engagement observation as engaged, without claiming it answered every topic or resolved any Intention. Explicit reply association can be additive later. At the deadline, insufficient evidence is unknown; timeout alone is never a negative. Historical valid intervals/dispositions may survive restart, but live source leases do not; never synthesize outage exposure.

Repeated weak non-engagement may tighten Class B spacing under the existing maximums. It cannot increase hard budgets, affect Class A, reduce foreground responsiveness, express an emotion, activate a new Pattern, or override an explicit user preference. Expose the policy change and its real evidence through ordinary observability producers.

Preserve the established engineering sequence `1x -> 2x -> 4x -> daily ceiling`, with a full reset to `1x` after a real user reply or an explicit operator reset (`.trellis/workspace/pleia/t4-second-grill-prep.md:565-571`). Resetting backoff does not reset the independent hard delivery counters. New evidence thresholds and observation windows below remain calibration recommendations rather than replacements for that sequence.

The following are **engineering starting points**, subject to config/calibration and real native acceptance. They are not owner-ratified feature-enablement defaults.

| Parameter | Conservative starting recommendation | Purpose / caveat |
| --- | --- | --- |
| Accepted foreground freshness | 60 seconds, matching two existing 30-second polls | No reuse after generation retirement; null idle still unknown. |
| Known native idle cutoff | Existing 180 seconds | Qualified session activity only; no hardware-only guarantee. |
| Direct client input freshness | 60 seconds | Focus/visibility reports cannot reset this age. |
| Client source/exposure lease | 30 seconds | Event-driven updates plus at most one source-owned renewal every 15 seconds while relevant; no per-page state polling or model call. |
| Input report coalescing | At most one routine report per second, with immediate retirement | Avoid one network event per key or pointer movement. |
| Meaningful return gap | At least 10 minutes since known activity, plus real fresh input | Unknown reconnect gaps alone do not become return Signals. |
| Initial visual exposure | At least 50% of the relevant text region for two continuous seconds | Configuration can be tightened; cannot prove reading or complete visibility of long content. |
| Qualified response opportunity | At least 120 seconds of accumulated valid overlap | Deliberately weak evidence; hidden/unknown periods never accrue. |
| Feedback deadline | 60 minutes after actual delivery | A later history view does not reopen a settled observation. |
| Backoff calibration | Preserve `1x -> 2x -> 4x -> daily ceiling`; provisional transition thresholds are three, six and nine qualified weak instances within seven days | A real user reply or explicit operator reset restores `1x` fully. Thresholds/windows remain engineering calibration; explicit user preference wins, and hard hourly/daily limits remain independent. |
| Recall budget | Up to four records / 512 tokens per applicable Bank for a candidate-derived topic | Use current provider-neutral contract; unavailable stays unknown. |
| Default automatic Intention active-window bound | Seven days for `expiresAt - notBefore`, unless a tighter valid source/user window applies | Engineering calibration, not a creation-to-expiry horizon or new product cap. A source-backed future event may have a later finite window. Never extend an expired plan from replayed source text or silently convert it to a Scheduled Task; Scheduled requires explicit reminder/task intent. |

The parent PRD's existing 60-second check, approximately 15-minute/jitter model opportunity, four Heartbeat model opportunities/beats per hour, two Class B utterances/hour, eight/day, ten-minute delivery gap, 23:00-08:00 User Timezone quiet hours, 90-second busy deferral and ten-minute utterance TTL are already ratified configurable calibration. A single ToolLoopAgent turn may contain several model Effects; the four-beat ceiling does not mean four individual model requests. The values in this table must not replace or silently loosen those constraints. Keep Heartbeat opportunity, model Effect, delivery, source, exposure and feedback accounting separate.

### 10. Character selection and quota scope

Current code has no Core-owned global selected-Character setting. Desktop's `ACTIVE_CHARACTER_ID = "taki"` is a compile-time frontend constant, used by Chat and Pet (`apps/desktop/src/lib/active-character.ts:8`). `character.list` enumerates imported assets and does not select a Companion (`packages/core/src/server/methods/character-list.ts:17-29`). `chat.send` captures the explicit request Character into Run admission (`packages/core/src/server/methods/chat-send.ts:61-76`). A list of loaded/imported Characters is not an autonomous subscription list.

The owner-ratified R9 calibration is conservative, configurable two Class B utterances/hour and eight/day (`.trellis/workspace/pleia/t4-decisions.md:74-81`). It does not specify simultaneous multi-Character routing. The older research's four Heartbeat model opportunities/beats per hour **per Character** is labelled `[D]`, an engineering recommendation, in `.trellis/workspace/pleia/t4-heartbeat-engine.md:524-529`; it is not evidence that every loaded Character should wake independently. The later evolution note reserves global limits (`:866-869`) without specifying a multi-Character product experience.

Conservative first-delivery recommendation:

1. Give initiative exactly one explicit Core configuration target, aligned with the current `taki` frontend. Preserve Character-scoped schemas and stored Patterns/Intentions, but do not enumerate all imported Characters on shared Perception/Presence changes. This setting is a trigger-provider target, not a second relationship or session authority.
2. Do not infer the target from the most recently connected socket, newest avatar report, last arbitrary `chat.send`, or asset order. An absent/invalid configured target is a truthful ineligible state. Keep enabling initiative and selecting seed behavior in explicit rollout settings.
3. Apply a Core/user-level Class B delivery counter and minimum gap across every Character, in addition to any stricter Character/Pattern policy. Reserve a matching total Heartbeat model-opportunity ceiling so shared source storms cannot multiply admitted beats by Character count. Individual model Effects remain separately measured and bounded by the existing Run policy. The current single-target configuration uses the ratified calibration as the total upper bound.
4. A target change does not reset total budgets, last-delivery time, or old feedback. Old Character-specific Signals and held speech cannot silently become the new Character's work. Capture target/version at admission and revalidate before delivery; reject stale-target output. Inactive Characters' Intentions still expire by absolute time, without later catch-up.
5. Feedback remains linked to the utterance's actual Character and source facts. A user's reply to another Character must not be relabelled as an answer to the old Character's topic; global hard delivery limits still apply regardless of feedback interpretation.

This is an engineering recommendation that preserves the current single-Character product surface, not an owner-ratified multi-Character feature decision. No extra grill is necessary to avoid multiplying speakers in the first delivery. If the owner wants several Characters to remain autonomously active at once, or an inactive Character to interrupt the currently selected one, that introduces a real product routing/fairness question and should be grilled before implementing that extension.

### 11. Meaningful validation matrix

Existing tests cited above were read, not executed. Implementation should add behavior tests at the actual owning seams, with injected clocks and file-backed lifecycle tests where state survives restart.

| Scenario | Required observation |
| --- | --- |
| User describes an unsupported stress/emotion condition | Agent explains the missing source and clarifies a supported option; no fabricated sensor/threshold and no active Pattern. |
| Candidate approved after another window revises it | CAS conflict; no activation of unseen content. Duplicate current confirmation is idempotent. |
| Active Pattern has a pending revision | Current accepted behavior remains as-is until concrete confirmation; draft is non-runnable. |
| Pause, resume, rollback, retire across Agent and panel | One authority; effective policy rechecked; no rewritten history, old occurrence replay, or permission grant. |
| Card readable/accessibility/copy paths | Business parameters and changes visible; internal IDs/digests/generation values absent everywhere user-facing. |
| `idleSeconds=null` with `ActivityState.idle=false` | Presence remains unknown; cannot satisfy active-user conditions or increment non-engagement. |
| Known idle value but sensitive/refused/paused source | No derived presence/signal from that sample; no bypass via a separate idle collector. |
| Foreground/VLM request completes after pause or source replacement | Generation check refuses publication/eligibility and stale result delivery. |
| Pause expires/resumes while old sample/dwell remains in memory | No sampling wake until a newly accepted current-generation sample; non-sampling sources retain independent policy. |
| Repeated window titles, report renewals, transport reconnect or empty cadence | No new meaningful candidate/model request; bounded skip reason only. |
| Two simultaneous Patterns / source duplicates | Shared selection and one relevant admission; no independent per-Pattern loops. |
| Shared Signal with several imported Characters | Only the explicit initiative target is evaluated; importing an asset cannot add a speaker. |
| Initiative target switches while old work is held | Old Character output is not reassigned/replayed; total Class B budgets/gap survive the switch and no Intention catches up. |
| Explicit multi-Character test fixtures exhaust the total cap | Per-Character allowances cannot exceed the user-level Heartbeat-opportunity/delivery upper bound; individual model Effects remain separate. |
| Same source/tool invocation forms an Intention twice | Same source opportunity, immutable deadline, no duplicate plan or future trigger. |
| Expiry exactly at admission, during model work or before delivery | No admission/stale speech at or past deadline, independent of sweeper timing. |
| Offline over Intention validity, then restart/reconnect | Old trigger remains expired, underlying user fact remains retained according to normal Memory policy. |
| Fresh later candidate recalls interview matter | New Run may ask without preceding user input; old plan/utterance remains closed; unknown outcome is preserved. |
| Canonical Local / Hindsight / permitted degraded Memory projection | Same source-scoped behavior; no legacy Markdown dependency, authority fallback, or pending-as-trigger shortcut. |
| Home socket retires while Chat/Pet or phone is fresh | Only that source retires; aggregate presence and other exposures remain correct. |
| Reconnect sends an old interaction with a fresh receive time | Old input is not treated as new/present; no replayed feedback interval or return Signal. |
| Phone active; desktop message shown; no trusted association | Global user presence may be present, desktop response opportunity remains unproven, desktop Host remains independently offline. |
| Same message shown on two windows/devices | Union valid intervals and settle at most one feedback disposition. |
| Message below fold, lazy skeleton, minimized/hidden Pet, closed bubble | No presentation evidence; no negative feedback. Existing scroll/selection and bubble-opening behavior preserved. |
| Message visibly presented with repeated fresh same-device input but no reply | Only after the configured evidence window/deadline can one weak non-engagement instance accrue. |
| Unknown/offline interval and process restart during feedback | No fabricated time accrual; historical evidence preserved, live leases retired. |
| Real later user reply / explicit operator reset / explicit preference | A real reply or explicit reset restores backoff fully to `1x` without resetting hard counters; stronger preferences take precedence, and no real-world matter is automatically marked resolved. |
| Current permission returns ask/deny or required Host is unavailable | Truthful bounded skip/wait semantics; no surprise dialog, new permission store or first-match Host substitution. |

Native verification must use actual WebView2 focus, visibility/minimize, rendered message exposure, simultaneous windows, reconnect, and interaction events. Scripted protocol tests establish Core contracts but cannot certify human reading. Label actual client/native evidence, provider fixtures and owner-only acceptance separately.

### 12. Integration dependencies and future boundaries

- Root owns main Memory 036/040 lineage review and integration. This research relies on the parent readiness record's dated update only; it does not inspect or modify main, migrate a database, or certify incoming canonical runtime activation. Use the integrated provider/context contracts before implementing Intention-source and recall adapters.
- Runtime/observability research owns admission, queue behavior, Run snapshots, structural outcomes, delivery and event projection. Domain events here must feed those existing authorities; pre-admission diagnostics are bounded policy facts, not fabricated Runs.
- If a required accepted scenario depends on native Host activity being tied to a particular frontend device, implement and validate a trusted association or retain the explicitly unknown limitation. Do not silently bridge the current identity gap. The first complete path can use actual client-input and same-device presentation producers.
- D78's general permission UX/readiness redesign remains deferred. This task must report current ineligibility honestly and preserve permission enforcement without importing all D78 controls.
- D79's Persona-specific long non-response reactions, extra inspection, exec and foreground window activation remain deferred (`docs/deferred-decisions.md:122`). No emotional subsystem or hardcoded Character branches are required.
- Future phone code is out of scope. Shared/Core can be tested using authenticated phone-shaped operator fixtures; such tests do not prove a real phone app exists.
- Long-term feedback-derived Pattern discovery, automatic activation/evolution, and a full Companion State learner remain future slices. Reserve provenance, evidence, revision, rollback and feedback references without implementing autonomous permanent policy modification now.

## Related specs

- `.trellis/workflow.md`: planning artifacts, native session task binding, source-backed persistent research.
- `.trellis/spec/backend/agent-runtime.md:175-226`: sole Perception composition, sensitive-source refusal, scrub/fence, pause persistence and real source freshness.
- `.trellis/spec/backend/memory-replica-sync.md`: authority, checkpoint, provenance and pending/derived truth; reconcile with incoming main, never replace it with Heartbeat policy.
- `.trellis/spec/backend/operation-presentation.md`: readable labels are not authority; preserve internal identity and avoid user-facing bookkeeping.
- `.trellis/spec/frontend/foreground-chat-feedback.md`: actual Chat/Pet lifecycle, stable semantic identity, presentation gates, no autonomous bubble opening on observation/reconnect.
- `.trellis/spec/frontend/reactive-read-models.md`: typed shared route, generation retirement, stable editor/reading state, truthful failures and no mutation replay.
- Parent `.trellis/tasks/09-08-t4-heartbeat/research/current-readiness.md`: verified existing runtime/Memory gaps, dated root refresh and integration ownership.

## External references

No new network research was performed. Existing OpenClaw/Hermes reference conclusions remain in the parent discussion/research and are not a source of newly ratified Taki defaults. The recommendations above are grounded in current Taki files and the accepted parent PRD/grill.

## Caveats / Not Found

- No production cross-client User Presence service, per-message presentation acknowledgement, typed executable Pattern authority, or complete finite Intention lifecycle was found in the inspected seams. Existing terms/UI labels are not proof those producers exist.
- Unknown idle is explicitly lossy in existing ActivityState; native idle does not prove hardware-only activity; operator and Node device identities are separate. These must remain visible engineering constraints.
- Existing pause checks do not fence post-await source publication. This research identifies the necessary integration change without claiming to fix other historical sensor timing gaps.
- Automatic Memory recall/context behavior must be assessed after incoming main integration; legacy helpers and dormant provider interfaces cannot be presented as live guarantees.
- No tests, builds, Git operations, live databases, services, dependency changes, or production files were touched. Source-level test assertions are not runtime or owner acceptance.
- No mandatory product grill blocker emerged. Bring a question back only if implementation exposes a concrete conflict with a ratified behavior, such as requiring new sensing/authority or changing the accepted first-delivery scope. Protocol fields, CAS details and conservative timing calibration do not themselves require another product interview.
