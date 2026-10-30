# Accepted Work Quiescent Lifecycle

## 1. Scope / Trigger

Use this contract when a trusted adapter keeps an accepted purpose alive between bounded work executions.
Implemented primitives and the trusted prepared-publication composition use the existing Run/Attempt ledger
and captured context. They do not install public tools, an acceptance UI, Host/browser producers, startup wiring
or completed D85 restart/Continue support.

## 2. Signatures

Shared contracts: `run-work-schema.ts` and `prepared-publication-schema.ts`. Existing owners: `RunService`,
`RunRepo`, `RecoveryCoordinator`, `PreparedPublicationSourceOwner` and `PreparedPublicationOwner`.

```ts
holdWork(input: { runId: string; attemptId: string; expectedRunVersion: number; reasonRef: string }): RunWorkResult;
resumeWork(input: { runId: string; attemptId: string; expectedRunVersion: number }): RunWorkResult;
type RunWorkResult =
  | { changed: true; state: "waiting" | "running"; runVersion: number }
  | { changed: false; reason: RunWorkRefusal };
```

The immutable identity is `provenance.provider = "core.accepted-work"`, a nonempty `provenance.sourceRef`,
`deliveryClass = internal`, and admission `contextMode = autonomous`. These existing durable fields identify
one accepted purpose. `reasonRef` must equal that captured source, not change it. No new database migration,
mutable reason store or event-folded runtime authority is introduced.

Captured `RunExecutionContext.acceptedWork = { sourceRef, isCurrent() }` and `authorityCurrent()` are required
live bindings. A marker/source string does not create these bindings or prove consent.

## 3. Contracts

- A reserved-provider admission requires the matching trusted source binding and affirmative current authority.
  Ordinary scheduled/heartbeat contexts cannot gain accepted-work authority just by requesting a hold.
- Hold validates the exact running Run/Attempt/version, internal scope, original purpose and unexpired deadline.
  The Attempt must be executing; no unfinished Effect or existing delivery row may be present. It changes only
  existing Run state/phase/version and appends a required event in the same synchronous transaction.
- The caller owns the Character lane. Release it only after a successful hold; acquire it under normal primary
  precedence before resuming. `resumeWork` is not a queue-acquisition API and never grants a lane lease.
- Resume revalidates retained context, source, authority, exact waiting state/Attempt/version and deadline.
  It preserves the original Attempt and creates no Effect, provider request, Timeline row or delivery decision.
- Cancellation/terminal state cannot be resumed. A lost context cannot be reconstituted by ordinary duplicate
  admission: nonterminal accepted-work reuse after context loss throws `RUN_WORK_CONTINUE_REQUIRED`.
  The future explicit Continue owner must reconstruct only authorized original bindings under D85.
- Strict `run-event.v3` facts are `run.work_held`/`run.work_resumed` from `core.run-work`; payload contains only
  matching waiting/running state and Run version. Original v1/v2 decoders stay unchanged; mixed reads retain sequence.
  Source references and candidate content do not enter these events or the Monitor projection.
- Recovery recognizes accepted roots before Heartbeat missing-decision repair. After cancellation/expired-control
  handling, no unfinished Effects means `waiting_for_authority`, even if a model Effect completed. Unfinished Effects
  remain `reconciliation_required`; newly available recovery adapters cannot replay/reconcile them without the
  missing accepted-source authority. Recovery never infers whole-purpose success from one Effect.
- Exact pending publication retirement is provided by `DeliveryCoordinator.retireRun`; parent lineage alone does
  not propagate cancellation. `PreparedPublicationOwner` retains its own admitted child handles and retires them.

### Trusted prepared-publication composition

```ts
createPreparedPublicationAuthorization({ scope, isCurrent, originalRequestWitness? }): PreparedPublicationAuthorization;
createPreparedPublicationSource(producer, authorization): PreparedPublicationSourceOwner;
RunService.admitAcceptedWork(request, binding, admission?): Promise<RunAdmissionResult>;
RunService.admitPreparedPublication({ rootRunId, candidateRef, expectedRevision }): PreparedPublicationAdmission;
PreparedPublicationOwner.publish({ candidateRef, expectedRevision }): Promise<PreparedPublicationResult>;
PreparedPublicationOwner.beginEdit(expectedRevision): PreparedPublicationEdit | undefined;
PreparedPublicationOwner.confirmEdit(edit, revision): boolean;
PreparedPublicationOwner.stop(): void;
```

- Only a trusted Core producer supplies the original accepted source, acceptance reference, Character, validity and
  exact candidate text. The helper accepts only a candidate reference and expected revision; it cannot choose the
  root, class, text or authority. Shared validation is not proof of acceptance. The production acceptance producer
  remains external to this inert composition.
- The generic source contains no business-policy field. A trusted Core adapter must separately register an explicit
  Class A authorization with exact source/acceptance/Character/validity scope and a live synchronous authority check.
  The process-owned immutable handle cannot be reconstructed by copying/serializing it or passing JSON with an
  `accepted` or class field. Its identity registry retains only scope/currentness, not Run/candidate/execution state.
  Missing, mismatched, revoked, expired, throwing or non-boolean authorization refuses through final commitment.
- Accepted validity is explicit: `{ kind: "expires_at", expiresAt }` or `{ kind: "until_cancelled" }`. The latter
  requires a process-owned `PrimaryRequestWitness` captured from the actual live primary Run/Attempt, exact committed
  user row and unchanged newly accepted delegated input. A finite request, copied witness, historical reply acceptance
  or stale pre-acceptance input cannot mint an unlimited grant. Persisted JSON cannot restore a lost live handle.
  The original-request adapter omits a task deadline only for this verified until-cancelled acceptance. Exact original
  row identity, captured authority, root state and explicit cancellation still apply; primary-turn cancellation after
  independent acceptance does not itself cancel the delayed report.
- Candidate and delivery freshness always remain finite. A new until-cancelled original-request report selects its
  five-minute candidate deadline from the canonical parent terminal time or accepted inbox speech-action time. Late
  first staging does not create a new window. Foreground/held deferral
  and repeated staging never renew that deadline. Finite sources retain their captured source deadline and bound every
  candidate deadline. Final transaction checks refuse expired content even when the accepted source is unlimited.
  Candidate expiry does not change the delegated task's lifecycle or replay old effects. Silent/internal handling
  does not itself select a candidate or consume the one final-answer grant; the Runtime owns cancellation routing.
- Inbox speech reads the exact accepted event, actual delivered consumer and committed `speech_proposed` action
  through their canonical repository. Child/Character/work identity and the immutable event frontier must match the
  live report binding. A mutable producer execution token cannot establish an earlier event's freshness. `handled`
  remains separate from publication; speech outcomes are recorded by the publication owner against event/action
  identity. A lost process grant yields a durable publication refusal without undoing private event handling.
  User Stop revokes the report root through the committed child control path, retires queued output and marks an
  unadmitted deferred speech proposal refused. Copied event/action labels do not restore a grant.
- Business classification belongs to a separate adapter. `core/co-watching/publication-source.ts` alone consumes the
  M51 `accepted_co_watching` classification and derives the permitted Class A handle from its trusted producer.
  That producer still must establish real acceptance; schema validity is insufficient. A non-media trusted adapter
  may reuse the generic Class A output contract when its own existing classification permits it. No public grant
  endpoint or new automatic exemption is installed. Class B is unsupported in this entry; its existing Initiative
  admission and quota path remains separate.
- Admission attaches the trusted binding to the ordinary captured root and validates its original authority.
  Source/authority/currentness callbacks must be synchronous, side-effect-free reads returning exactly `true`.
  False, throwing, Promise or other truthy values cannot grant authority. Ordinary provenance markers cannot
  construct a source, and duplicate root admission after context loss still requires explicit Continue.
- A text-only child derives its immutable snapshot from the retained root without another capture or model Effect.
  Its stable admission key binds root, candidate reference and revision; the source digest also binds original
  Attempt and exact candidate text/expiry. The child class comes from the separate retained authorization and the
  staging row uses that admitted Run class. The root remains internal; Class B, Scheduled and foreground admission
  are not widened. Harness does not inspect media IDs, business-policy literals or playback state.
- Source acceptance, Character, root Attempt, authority, revision, exact text, expiry and publication gate remain
  current through the final synchronous SQLite publication transaction. Retained objects cannot replace approved
  content. Candidate text must already be canonical; trimming cannot silently change approved text.
- Publication uses the existing background lane and respects pending primary reservations. Held output uses the
  existing one-per-Character slot; another root's held text is never evicted to make room. Separate publications
  leave the accepted root alive, and ordinary foreground Agent work retains its own model Effects and Timeline.
- A `suppress` gate observed before dispatch retires the candidate through the existing `expired` path. Final
  transaction refusal can instead record `suppressed`. Do not conflate the two positions or change this contract
  merely to satisfy an E2E assertion. A retired same-identity candidate cannot revive when its gate later opens.
- `beginEdit` closes the source's publication gate before retiring all owned pending children and returning an
  edit ticket. External Host CAS starts only after that ticket returns. A retirement failure leaves the gate closed
  and permits an explicit retry. `confirmEdit` requires the exact retained edit and observed new revision; failed,
  unknown, mismatched or stale confirmation cannot reopen. No Host/file/network await belongs in these methods.
- Stop retires the source before control writes, cancels the exact root and retires its own pending children,
  including held text on completed Runs. Quiescent roots settle cancelled without inventing an Effect; running work
  retains its actual settlement owner. Unrelated roots/foreground work and already committed outcomes remain intact.
- Same-identity retry returns existing delivery state. A committed output cannot be reissued under another revision;
  `sent`, `dispatch_committed`, `unknown` and `no_target` retain canonical outcomes. A source can be claimed by only
  one publication owner; loss of that process-local binding never grants reconstruction or automatic replay.
- Retained source/gate/cancellation handles are not another persistent execution ledger. There is no new table,
  migration, model tool, RPC or main/startup wiring. Actual acceptance, Host CAS, playback and Continue need separate
  integration evidence, and real Heartbeat remains unvalidated.

## 4. Validation & Error Matrix

| Condition | Refusal / result |
| --- | --- |
| Invalid bounded input | `invalid_input`; no writes |
| Missing row / different scope or purpose | `missing_run` / `wrong_scope` |
| Stale Attempt or Run version | `stale_attempt` / `stale_version` |
| Wrong, terminal or cancel-requested state | `invalid_state` |
| Deadline elapsed | `expired`; no resume |
| Unfinished Effect / existing delivery | `unfinished_effect` / `delivery_pending` |
| Missing or retired accepted source | `binding_lost` |
| Missing, false or throwing current-authority check | `authority_changed` |
| Sealed RunService | `closed` |
| Required event write fails | Transaction rolls back; original Run state/version remains |
| Post-restart duplicate admission with no original context | `RUN_WORK_CONTINUE_REQUIRED`; dispose new capture, do not replace authority |

## 5. Good/Base/Bad Cases

- Good: a trusted root finishes a bounded preparation Effect, holds and releases its lane, allows foreground work,
  then resumes the same Attempt through the original current source binding.
- Base: ordinary Runs retain existing lifecycle behavior; no consumer of this primitive is installed automatically.
- Bad: invent a delivery to keep work alive, mutate its purpose while waiting, infer permission from the marker,
  or let a generic boot recovery adapter execute accepted work without explicit continuation.

## 6. Tests Required

- Strict v3 schema/state/source/Attempt and protected-field rejection, preserving the v1 decoder.
- Real SQLite hold/resume, exact version/Attempt, no Effect/delivery fabrication, event failure rollback.
- Real Character queue ordering around release and resume; foreground reservations retain priority.
- Original purpose, source/authority retirement, cancellation, expiry and sealed-service refusal.
- Restart after completed preparation retains waiting; duplicate admission cannot restore lost authority.
- Heartbeat-origin accepted roots bypass ordinary missing-decision recovery; supplied safe replay/reconcile adapters
  are not invoked for unfinished accepted work. Repeated classification remains idempotent.
- Monitor keeps lifecycle rows and private source references hidden. Full browser/Host/Continue acceptance is separate.
- Prepared publication: two independent outputs around real foreground SDK work; strict reference-only requests,
  immutable content, wrong Character/Attempt/source, callback failures/non-booleans, staged/final gate changes,
  foreground precedence, held-slot isolation, exact edit/revision ordering, Stop/late callbacks, completed held text,
  unknown transport/no resend, owner replacement refusal and lost-context restart admission refusal.
- Authorization boundary: a non-media explicitly requested report works without a media label; missing/copied/JSON
  handles and mismatched source/acceptance/Character/expiry refuse; authorization loss before admission, while held,
  during editing and immediately before commit cannot publish. Business-adapter tests separately cover M51 output,
  invalid/invitation/forged classifications and current-source loss without creating a new Class B path.
- Original-request validity: source survival across days, exact witness identity, finite-source expiry, lost-handle
  and stale-input reconstruction refusal, silent handling followed by same-work final reply, once-only publication,
  explicit cancellation and final-transaction candidate expiry. Canonical SQLite fixtures and scripted SDK tests are
  distinct from production-main/inbox/UI acceptance; the integration coordinator owns those later gates.

## 7. Wrong vs Correct

```ts
// Wrong: a model-editable reference is neither acceptance nor a restored source binding.
await runs.admit({ ...request, provenance: { provider: "core.accepted-work", sourceRef: modelText } });

// Correct: a trusted adapter supplies the original captured source and current-authority checks.
// The caller already owns the Character lane, and retains it if the hold is refused.
const held = runs.holdWork({ runId, attemptId, expectedRunVersion, reasonRef: acceptedSourceRef });
if (held.changed) releaseLane();
```
