# Explicit single-video Co-Watching

## Scope

The operator explicitly accepts one current browser source, through Home's existing-analysis control or an ordinary
chat invitation. Core reuses an exact completed native analysis or submits/reconciles one original BiliNote request
through the already selected MCP tools. Independent URL analysis and detected-viewing invitations reuse these owners
under the entry contracts below. Selected recommendation pre-analysis has its own
[native recommendation contract](./media-recommendations.md). Full process-restart/Continue and natural-completion
synthesis remain outside this slice. There is no second Agent, execution queue or execution ledger.

## Contracts

- `coWatching.start` accepts exact Character, request/source/analysis UUIDs and a visible 5–720 minute lifetime.
  Repeating the same request returns the same session; changing its payload conflicts. One active session per Character.
- Read/control/catalog routes require the actual live operator connection. A Node, copied identity or retired socket
  cannot accept work. Catalog references are bounded to 64 entries and atomically persisted before publication.
- Ordinary-chat `manage_co_watching(start)` accepts the sole observed source even when the user is in chat. Before
  acceptance, a captured source may renew only within the same Host/tab/document and exact BV/CID/page. Ambiguity or
  changed media is refused. An already accepted session never follows a replacement source automatically.
- Persist original native request UUID/media/server references before dispatch. Captured governed submit/lookup/status/
  result tools share the existing MCP generation and Run/Effect owner; BiliNote owns acquisition and analysis lifecycle.
  Poll every three seconds, with at most five transient failures and bounded backoff; waiting releases the Character
  lane and invokes no model. An uncertain submission requires original-key lookup. Only definitive absence within the
  original acceptance/current generation permits resubmitting that same key. New acceptances/restarts cannot infer
  an old unknown request is absent on a new endpoint and never automatically submit it again.
- `reanalyze` requires an explicit user request, the retained session's confirmed `analysis_failed` outcome and the
  same media/server. It creates a new reference while retaining the failed original; unknown outcomes, Stop, active
  work or changed media cannot enter this path. Ordinary `start` never automatically retries whole-video generation.
  After a Core restart, original-job reconciliation must establish the failed outcome before explicit reanalysis.
  Tool descriptions and closed-task context must explain this distinction: Core retains the request IDs; ordinary
  chat must not ask the user to recover them or search the Workspace/execute commands for them.
- A catalog reference does not prove analysis success. Read `bilinote_read_result` through the accepted Run's captured
  governed closure, preserving Approval, Effect, original tool identity and MCP generation lease. Compare original
  native service/request/job, BV/CID/page and the bridge-verified hash before exposing source content to the Agent.
- Native v1 permits `end_seconds: null`. Preserve those original moments and their material for ordinary chat, while
  advertising only non-null-ended `boundedMomentIds` as automatic publication anchors. Never coerce null to zero or
  synthesize an end. With no bounded anchors, retain the analysis and settle preparation to an empty plan without a
  model call; a proposal targeting an unbounded moment is refused. Failed native results remain failed.
- Require the actual observed browser Host connection/catalog generations in the captured Run snapshot. Retired
  sources, privacy/observation loss, changed catalog/Skill/MCP or execution authority close the accepted session.
- Use normal `ChatAgent`, installed `taki-co-watching` Skill and existing Workspace tools. Inputs and current-plan
  projections live under protected `co-watching-inputs`; proposals use a distinct revision UUID filename under
  `co-watching`. A late file cannot overwrite the current revision or establish publication authority.
- Preparation owns the existing Character background lane and accepted root/Attempt. Publication reuses the one
  existing `DeliveryCoordinator` and delivery repository. Browser changes never trigger a new model call by themselves.
- Pause, seeking, buffering and hidden non-PiP playback hold output. Missing an anchor's end expires its timing
  opportunity. Retain the greatest actual observed media position during acceptance, including during preparation;
  rewind and a later revision cannot reopen an elapsed window. This is not effective viewing-time accounting.
- Committed output includes unknown/no-target dispatch outcomes and cannot be renamed to replay its original moment.
  `sentCount` counts confirmed transport acceptance only. It does not mean the owner read or liked the response.
- `manage_co_watching` belongs to the `taki-co-watching` Skill bundle and is initially hidden from model schemas.
  A successful captured Skill load reveals it on the next step through the generic Agent disclosure facility.
  `list_analyses` with `instruction: null` reads Core-registered analysis result references, even without a playback source.
  It neither accepts watching nor submits/reconciles native jobs, reads full results or prepares responses. Empty
  inventory does not mean BiliNote has no historical jobs. Registration alone does not prove native success or current
  availability; listing does not revalidate these. Consumption keeps the existing native result check. Package guidance
  lives in `references/tools.md`.
- `read_analysis` is another action on the same Skill-disclosed tool, not a new Run or Co-Watching session. It selects
  an exact registered analysisId, then searches only the current turn's captured extension directory for the existing
  `stableSubjectId(serverId, "bilinote_read_result")` and Core Host owner. One exact available binding is required.
  Dispatch uses captured `extension_call`; no new MCP snapshot, client, status poll, submission or Workspace export.
  Verify the original identity/media/hash with `verifyCoWatchingNative`. Cancelled reads and catalog replacement/removal
  during the read return no content. Existing MCP generation leases/governance remain authoritative.
- `read_analysis` defaults to `view: analysis`, `offset: 0`. The complete view preserves the entire original JSON.
  Responses page the pretty-printed JSON at 16,384 UTF-16 code units before the existing untrusted-content fence, backing
  off surrogate boundaries. Use the exact returned nextOffset for that analysis/view; offsets do not include the fence.
  `truncated` reports partial content, and null nextOffset means that view ended. Failed reads never authorize reanalysis.
- `manage_co_watching` is a governed primary user-turn tool for list_analyses/start/reanalyze/revise/stop. Revision closes publication before
  acknowledgement and waits for foreground release. Stop cancels only the owned work; late admission/preparation
  settles without reopening output. Runtime exceptions become bounded tool failures.
  Both start and reanalyze honor the supplied bounded `lifetimeMinutes`; omitted/null selects 120 minutes. Return
  that accepted duration explicitly so the Agent acknowledges the actual tool result instead of a requested value
  it omitted from the call. The Skill and per-field tool descriptions must present the same rule.
- The same Skill must distinguish its two callers. Ordinary chat sends control through the provided tool and can
  read exact Core-supplied analysis/current-plan references for questions. These files are evidence/private drafts,
  not spoken dialogue. Chat never searches for task files or invents paths/revisions. Closed-task context marks the
  acceptance as cancelled/failed and does not imply permission to resume. Private preparation follows exact supplied
  paths only; Skill discovery alone must not redirect ordinary chat into that workflow.
- Primary reservations cooperatively interrupt only this task's redoable preparation, preserve pending semantic edits
  and wait for normal lane release. Queue ownership is never stolen; unrelated tasks and foreground turns are not cancelled.

## Read model and observability

`coWatching.changed` is a data-free Character hint with a positive monotonic producer revision. A physical replacement
client resets observation. Home binds a handler, waits for subscription acknowledgement, then reads; hidden pages do
not poll or render updates. Command ownership is independent of page visibility. An interrupted command remains
uncertain until an explicit covering read; transport replacement never replays it.

The existing Run, Effect, usage and Timeline/delivery records remain the execution evidence. Original native byte
verification and real desktop observations must be recorded separately from synthetic-port regression tests.

## Required regression cases

| Boundary | Cases |
| --- | --- |
| Catalog/native | CAS, defensive reads, corrupt/duplicate config, exact media/identity/hash, invalid/duplicate timings; ordinary registered reads, captured exact service/owner, cancellation, late replacement, bounded complete pages and surrogate-safe cursors |
| Invitation/recovery | Sole hidden source, same-document renewal, one native submission, uncertain original lookup, same-key definitive absence, new-acceptance/restart refusal, explicit failed-only reanalysis |
| Runtime | Duplicate start, paused hold, two anchors, rewind, missed window across revision, source/authority loss |
| Shared permission pipeline | Accepted runtime through production Run capture and MCP manager: pending blocks native reads and model preparation; deny, disconnect and Stop prevent dispatch; late Allow cannot revive work; policy changes are rechecked; matching durable grants reuse while changed configuration revisions ask again |
| Editing | Ordinary ChatAgent advertises/executes the primary control tool, publication closes before ack, foreground lane release, committed moment rename refusal, late proposal |
| Cancellation | Stop during generation/admission, quiescent root settlement, no unrelated-turn cancellation |
| Operator | Node/copied/retired socket refusal, subscription cleanup and monotonic hints |
| Desktop | Pre-ACK hints, hidden reads/renders, stale responses, mutation hide/show, unknown outcome, no automatic replay |

Permission regressions must retain the actual shared Governance/Approval services and captured MCP wrappers.
An inert native transport and model producer can count dispatches; replacing the governed tool with a mock that
returns a permission error does not prove the execution gate. Use `runtime-permissions.test.ts` for the accepted
result-read boundary, and retain the generic unattended/approval tests for shared behavior. Test automation that
clicks Allow is positive-path evidence only, never proof of pending or denial enforcement.

See [production validation record](../../../docs/MEDIA-CO-WATCHING-PRODUCTION-2026-10-16.md) and
[invitation validation record](../../../docs/MEDIA-CO-WATCHING-INVITATION-2026-10-16.md) for current live evidence
and remaining acceptance; package checks alone do not establish end-to-end desktop delivery.

## Ordinary analysis read contract

### 1. Scope / Trigger

Use when a normal conversation asks about a registered video's contents without accepting Co-Watching. Keep this in
the existing Skill-disclosed control tool and captured extension/native owners; no private preparation task is needed.

### 2. Signatures

```ts
manage_co_watching({ action: "read_analysis", instruction: null, analysisId, view: "analysis", offset: 0 });
// Shared CoWatchingAnalysisReadResult:
{ ok: true, status: "analysis_read", analysis, view, content, offset, totalChars, nextOffset, truncated }
// Closed failures: not_found, unavailable, cancelled, reference_changed, invalid_selection,
// invalid_offset, identity_mismatch. Failure has no content.
{ ok: false, reason, message }
```

`analysisId` is required for reads. Null/omitted view means analysis, null/omitted offset means zero. Non-null read
selection fields on a control/list action are refused. No new RPC, database column, env key or Governance cell is added.

### 3. Contracts

The production registration supplies the Core-owned catalog and Host identity. The current turn supplies captured
extension tools. Search by exact stable subject and owner, use the sealed extension call, then reuse native verification.
MCP connection/generation leases and approval are not replaced by the result reader. JSON pages follow the bounds and
offset/fence rules above; a final page can still have truncated=true when its offset is nonzero.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No reference | not_found; no native dispatch |
| Missing, wrong-owner, stale-before-dispatch or unavailable binding | unavailable; no fallback service |
| Native service returns a permission/read failure | unavailable; original governed outcome remains recorded |
| Cancellation during read | cancelled; no content returned |
| Reference removed/replaced during read | reference_changed; refresh before selecting again |
| Media, native identity, hash or timing mismatch | identity_mismatch; never expose that result |
| Offset outside data or inside a surrogate pair | invalid_offset; use zero or exact nextOffset |
| Successful read | Existing data only; no acceptance, status polling, submission, preparation or export |

### 5. Good / Base / Bad Cases

- Good: load Skill, select a registered ID, read original analysis, answer in the ordinary conversation.
- Base: list remains a cheap reference-only query and does not verify native availability.
- Bad: start Co-Watching just to access old data, derive a server from its display name, or regenerate on a failed read.

### 6. Tests Required

Exercise the real extension registry with wrong service/owner, unknown references, stale bindings, native denial,
identity mismatch, late reference changes, cancellation and intact Unicode continuation. Exercise the ordinary
ChatAgent action and assert no acceptance/submission/generation. Validate Shared input/defaults/closed failures.
Real Skill-to-read acceptance remains distinct from a test that installs the tool directly in primaryTools.

### 7. Wrong vs Correct

```ts
// Wrong: a fresh manager lookup can select a replacement behind an admitted Run.
const result = await currentMcpManager.tools()[guessedName].execute(args);

// Correct: existing captured extension identity selects its original governed closure.
const result = await capturedExtensionCall({ extensionId: matched.identity.extensionId, input: args });
verifyCoWatchingNative(result.output, registeredReference);
```

## Independent URL analysis and detected-viewing entries

### 1. Scope / Trigger

An explicit supported Bilibili URL can be analyzed without playback or Co-Watching. Fresh effective viewing can
produce an unsolicited invitation through the existing Wake and InitiativeRuntime, never implicit consent.

### 2. Signatures

The same progressively disclosed `manage_co_watching` tool exposes `analyze_url`, `analysis_status` and
`analysis_cancel`. Shared `MediaAnalysisStart` carries Character, request UUID, URL, accepted instruction and
5–720 minute lifetime. Runtime owns the accepted Run and native request UUIDs; the model cannot mint them.

`coWatching.invitation.read({ characterId })` returns a nullable committed invitation. The operator-only
`coWatching.invitation.respond({ characterId, invitationId, expectedVersion, commandId, action })` accepts
`accept | defer`. An applied accept must return the actual session; an applied defer returns `session: null`.

`bilinote_probe_media(video_url)` calls the selected service's instance-bound `/api/media/v1/probe`. The strict
`bilinote.media-access.v1` result carries exact BV/CID/page, title, nullable duration and actual bounded video-byte
evidence, with UTC epoch-millisecond `checked_at`. It neither creates a native job nor calls a model.

### 3. Contracts

- Canonical direct HTTPS Bilibili URLs are probed through captured extension tools. Native exact-part proof precedes
  reservation. URL analysis and Co-Watching use the same catalog and native progression; an uncertain old request is
  reconciled under its original UUID and never automatically replaced.
- Native waits hold the original accepted Run and release the Character queue. The final ordinary Agent execution
  retains its original `runContext` and selects only `read_file` and `get_current_time`. Work has a 240-second bound;
  a foreground reservation does not trigger automatic regeneration of the final answer.
- One generic prepared Class A child publishes the final text. Native failure is ordinary Agent input; cancellation
  closes only this accepted purpose, without claiming the upstream native job was cancelled. No restart continuation
  is inferred from a persisted catalog reference.
- Effective viewing uses observed wall time, excluding seeks, pause, buffering, hidden non-PiP playback and gaps.
  The live settings are `TAKI_INITIATIVE_VIEWING_EFFECTIVE_MS=60000`,
  `TAKI_INITIATIVE_VIEWING_REMAINING_SECONDS=120`, and `TAKI_INITIATIVE_VIEWING_INVITATION_TTL_MS=120000`.
  Unknown duration is ineligible. These settings do not replace normal quiet hours, presence, budgets or privacy.
- After deterministic eligibility and normal admission, captured native access and screened Host frame evidence feed
  the same Character judgment. Only committed Class B `speak` with `responseExpectation=invitation` exposes controls.
  The invitation's full TTL starts at publication. Opening Chat may hide/pause the video without revoking an otherwise
  current explicit acceptance. Exact source, remaining time and evidence authority are still checked at acceptance.
- Defer and explicit acceptance suppress further automatic invitations during that viewing. Root composition must
  supply `acceptedSource()` as well as `activeSession()`, including the retained source after Stop.
- An installed bridge must select the probe tool. Ambient capture needs the enabled privacy
  setting and actual Host capabilities. The screened frame enters the same main decision as native image input; no
  image-description request runs. Captured `extension_call` ambient results expose byte-free status and a trusted
  process-local native sidecar. Preparation reads `nativeToolImages(rawResult)` before schema parsing, validates
  the single native frame with the capture metadata, and retains the original sidecar currentness/release through
  its same-Attempt frame lifetime. Refusal, parsing failure, withdrawal and consumption release it without recapture
  or durable image references. Preparation retains only source text/currentness for later invitation acceptance,
  and releases its native carrier after this Attempt. Private-screen abstention occurs in that normal decision,
  replacing the removed translator's pre-main semantic sentinel. Unattended `ask` remains `APPROVAL_REQUIRED`; eligibility is not an approval
  and never changes policy. Required background grants come from the existing operator permission surface.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unsupported URL or conflicting request | Refused before native work |
| Probe denied, expired or wrong identity | No reservation; failed result through ordinary accepted-work completion |
| Matching registered result | Verified original read, no new native submission |
| Unknown submission / failed native analysis | Retain original reference; no new request or fabricated success |
| Ineligible viewing / privacy / budget / missing evidence | No invitation and no detailed analysis |
| Silent judgment | No invitation card and no repeated judgment for the same claim |
| Accept / defer / duplicate command | Exact idempotent result; changed payload conflicts |
| Expired, retired, wrong-version or late offer | Refused; never revive it from a late callback |

### 5. Good / Base / Bad Cases

- Good: explicit URL analysis returns one ordinary answer while the same analysis remains reusable for later watching.
- Base: an eligible viewing can remain silent, and no complete analysis exists until explicit acceptance.
- Bad: infer consent from playback/model prose, retry unknown jobs, or bypass background permissions to force a demo.

### 6. Tests Required

Cover no-browser URL use, reuse, exact-key reconciliation, native waits/foreground work, cancellation, failed output
and once-only publication. Cover wall-time accounting, no pre-eligibility work, Class B accounting, accept/defer,
explicit-acceptance suppression after Stop, source retirement, publication-based TTL and late callbacks. Exercise
operator identity/version gates and actual Desktop control state. Real native access, model results and browser
acceptance must be separately attributed from fixtures; see the entry implementation record.

### 7. Wrong vs Correct

```ts
// Wrong: a playing page is neither media-access evidence nor acceptance.
if (sample.state === "playing") submitDetailedAnalysis(sample);

// Correct: compose the existing source/admission/decision and explicit operator path.
const facts = viewing.facts(characterId); // deterministic eligibility only
// Wake -> admitted Run -> captured evidence -> ordinary decision -> committed invitation
// Exact operator accept -> existing coWatchingRuntime.invite(...)
```
