# Research: Independent initiative design review

- Query: Do the consolidated requirements and technical plan preserve the owner's confirmed initiative scope and define a safe implementation path through the existing Taki runtime and Monitor?
- Scope: Internal artifact and targeted source review; external reference claims were not independently refreshed.
- Date: 2026-09-11
- Assigned task: `.trellis/tasks/09-11-companion-initiative-implementation`.
- Method: Read the parent PRD/design/implementation plan and effective decision register, compare the earlier Heartbeat PRD/grill and current executable specs, then inspect exact code only for concrete integration risks. No tests, services, Git operations, production edits or spec edits were performed.
- Review stages: Initial parent-contract/source review while child scaffolding was being completed, followed by a final artifact-only review of all four children's PRD/design/implementation files on the same date.

## Findings

**No blocking design findings and no new owner product question were identified.** The parent artifacts preserve the complete first-delivery scope and assign the missing infrastructure to the existing owners. The final child artifacts inherit those contracts and preserve the required dependency and acceptance boundaries. Implementation and its evidence remain pending; the parent owns separate planning validation of links, encoding and manifests.

This conclusion is about the design, not implementation readiness of the current binary. In particular, the current queue, autonomous context, delivery and recovery behavior do require the adaptations listed in child 1; those are explicitly planned work rather than grounds for a second runtime.

### Confirmed scope remains intact

| Reviewed topic | Effective evidence | Review result |
| --- | --- | --- |
| Complete conversational authoring | Earlier `09-08-t4-heartbeat/research/grill-decisions-2026-09-08.md:5-9`; new PRD R03-R05/AC04-AC06; design sections 4 and 10; implementation child 3 | Natural-language request, clarification, useful concrete candidate review, confirmation, actual activation, revision, pause/resume, history and rollback remain one required product loop. The normal runtime Skill and panel are clients of the same Core authority. |
| Automatic finite Intentions | Earlier grill lines 42-69; PRD R06-R07/AC07-AC08; design section 9; implementation child 4 | Automatic creation does not require individual review cards. Expired trigger identity stays closed; a new independently eligible interaction can recall the underlying matter before a user message. No archive product, false factual resolution or automatic copying of plans into factual Memory is introduced. |
| Presence and backoff | Earlier grill lines 73-112; PRD R13-R14/AC15-AC16; design section 8 | Connectivity, activity evidence, actual presentation and response opportunity stay distinct. Unknown/absent evidence cannot become ignored-message counts. The later Character-specific D79 behavior remains deferred. |
| Existing execution and Monitor | PRD R01/R15; design sections 2, 6, 7 and 11; `.trellis/spec/backend/observability-projection.md`, sections 1/3 | The new initiative module supplies domain policy and input. Existing Run/Attempt/Effect/Event, ChatAgent, Timeline and observability owners retain authority. No alternate model loop, execution ledger, permission store or Heartbeat monitor is required. |

### Critical engineering boundaries are covered

| Boundary | Artifact location | Source check and assessment |
| --- | --- | --- |
| Primary admission race | Design section 5, especially steps 5-7; implementation child 1 | `packages/core/src/server/methods/chat-send.ts:67` admits before the deferred pump acquires the queue at `:108`. `agents/turn-queue.ts:12` exposes only `acquire`. Registering primary intent before asynchronous admission, extending the same coordinator and revalidating before background dispatch directly covers this existing race. A timeout never authorizes interrupting an active chain. |
| Immutable thin request and restrictive tools | Design sections 6.1-6.2; PRD AC09/AC14 | The new explicit autonomous profile must fail closed rather than fall back to normal history. Captured source/policy/authority references, in-process retry reuse, provider-neutral bounded recall, schema plus dispatch filtering and no primary-memory/pressure side effects are explicit. Primary authoring tools do not widen unattended Heartbeat tools. |
| Structural terminal acceptance | Design section 6.3 | A valid accepted decision, not merely a tool name, stops the loop. Authoritative model/tool settlement and cancellation checks precede commitment. Missing/invalid decisions cannot become silent success, and private intermediate deltas cannot become public speech. Existing primary presentation stopping remains separate. |
| Pure text versus executable presentation | Design sections 7.1-7.2; PRD AC10-AC11 | Pure text may complete execution and later use ordinary Timeline projection. An expression retains the original nonterminal Attempt, holds/releases the Character slot, and resumes by guarded CAS on that same Run/Attempt without another model call. The plan does not weaken the dispatch guard or start a second delivery Run. |
| Crash and exact binding recovery | Design section 7.3; implementation child 1 | `harness/recovery-coordinator.ts:70-76` currently repairs a Run from its last terminal Effect. The design explicitly puts committed decision/continuation classification before that heuristic. Missing original bindings do not authorize recapture on a new Host or Memory authority; uncertain effects are not replayed. |
| Quota versus sent/presented truth | Design section 7.2; PRD R09-R10/R14 | `agents/conversation-store.ts:118-121` calls the append hook immediately after repository append. The proposed transaction-aware Timeline/link/quota/event commit and post-commit fan-out address that seam. Reservation/charge, transport acceptance, uncertain fan-out and actual presentation remain separate facts; a conservative charge is not labelled delivered. |
| Source generation and nullable idle | Design section 8.1; PRD AC14-AC15 | The plan preserves unknown idle before the legacy lossy projection, fences foreground/VLM results after awaits, retires evidence on pause and requires fresh evidence on resume. Lease renewal cannot manufacture recent input; a Perception invalidation cursor is not treated as a consent generation. |
| Operator, Node and window association | Design section 8.2; PRD AC15-AC16 | The separate authenticated identities are not joined by name, IP or arrival order. Independent Home/Chat/Pet leases aggregate without one disconnect removing another source's evidence. Negative feedback requires actual message exposure and fresh input on the attributable presenting device; unproved cross-source association stays unknown. |
| Single target and aggregate limits | Design section 3.1; decision register engineering decisions | One explicit target matches the current single-Character surface. Imported assets do not automatically become unsolicited speakers. Character ownership is retained; Core/user caps cannot be reset by changing target. This is a disclosed first-delivery safety bound, not an unannounced simultaneous-speaker feature or a new per-Character runtime. |
| User Timezone integration | Design section 3.3; implementation children 1-2 | The existing UTC-initialized authority is extended rather than duplicated. Fixed/follow-designated-device settings, authenticated reports, last-confirmed offline behavior, visible bootstrap state and future schedule/Pattern recomputation are assigned explicitly. VPS process time is not a fallback. |
| Intention source expiry and factual Memory | Design section 9; PRD R06-R08 | Source withdrawal/expiry is checked at eligibility and output, independently of cleanup. Minimal terminal keys prevent source reread renewal. Normal Memory correction/deletion/retention and provider authority remain effective; a reply resets feedback but does not resolve the real-world matter. |
| V1/V2 events and old Monitor clients | Design section 11; implementation child 1 | `shared/src/run-event-schema.ts:201-205` has a literal version and closed kinds/sources; `shared/src/observability-schema.ts:104-128` also has closed projection fields. The reader-first mixed-event contract, semantic projection reuse and actual old-decoder test requirement cover both boundaries. Optional correlation omission alone is not claimed to solve an incompatible category/response shape. |
| Migration and rollback | Design section 13; implementation section 2; PRD AC18 | The plan requires integration of the existing main convergence changes before assigning migration numbers, populated tests of fresh/T4/main histories and atomic refusal of unsupported state. Safe rollback disables writers/admission while retaining readers and history; it does not rewrite applied 035 or downgrade an incompatible database. |

### Verified active-window clarification

The original review snapshot identified a parent-owned clarification to the Intention bound. The final artifact check confirmed that the correction is now present in the parent's `design.md:276`, section 12, **Automatic Intention active window**, and inherited explicitly by child 4's `design.md`, **Required contracts**, item 2:

- Seven days is the initial maximum **active follow-up window**, for example `expiresAt - notBefore`, with tighter source/user validity taking precedence.
- It is not a universal seven-day horizon measured from creation. A source-reported future matter must not silently be rejected or converted to a Scheduled Task merely because its event is further away.
- An automatic Companion follow-up and an explicit user-expected Scheduled Task keep their distinct commitments. Creating the former never implicitly creates the latter.

The parent now states the configurable seven-day default maximum for `expiresAt - notBefore`, allows a later finite window for a source-backed future event, and forbids silent conversion to a Scheduled Task. Child 4 repeats that the active-window bound is not a universal scheduling horizon and requires actual user reminder/task intent for Scheduled semantics. The earlier pending-clarification caveat is resolved; no product grill is needed for this wording.

### Child ordering and acceptance coverage

The parent's `implement.md` sections 1 and 3-7 provide a coherent dependency order:

1. Foundation owns shared context/admission/decision/delivery/recovery/Monitor and the timezone authority, first proving an injected eligible opportunity while autonomous sources remain disabled.
2. Presence owns real Desktop evidence, message exposure, device reports and response-opportunity facts against those identities.
3. Patterns own actual supported sources, wake selection, setup, complete authoring and common policy.
4. Intentions complete automatic follow-up, related-memory use, feedback consumption and the whole first-delivery acceptance.

Every parent AC01-AC19 has an explicit evidence owner in implementation section 7. Later consumers must retest earlier seams on real producer paths; a foundation fixture does not substitute for final authoring, actual presence or Intention acceptance. Parent closure requires all four children, so this ordering does not silently reduce the promised scope.

During the initial review the parent agent was still completing child scaffolding/manifests. That temporary state was not a design finding. The final artifact-only review below supersedes the earlier limitation on child-content coverage.

### Final child-artifact check - 2026-09-11

All twelve final child `prd.md`, `design.md` and `implement.md` files were read directly. No additional production-code exploration or runtime testing was performed in this follow-up.

| Child artifact set | Verified inheritance, ordering and acceptance |
| --- | --- |
| `09-11-initiative-runtime-foundation/{prd,design,implement}.md` | PRD **Parent and dependency** inherits the parent authority/scope and places the Memory/schema gate before new writers. Design **Required contracts** items 1-8 preserve primary reservation, immutable thin input, restrictive tools, accepted structural stop, same-Attempt presentation, transaction/fan-out separation, old Monitor compatibility and existing timezone authority. Implementation **Ordered work** explicitly includes Scheduled output, real isolated runtime proof and evidence before child 2. C1-01-C1-08 cover the assigned foundation risks. |
| `09-11-initiative-presence-feedback/{prd,design,implement}.md` | All three artifacts require the passed child-1 delivery/report/timezone/Monitor contracts. Source epoch/null idle, source-local leases, actual presentation, same-device opportunity evidence, unknown gaps and fixed/designated-device timezone reporting remain explicit. C2-01-C2-07 include phone-shaped evidence without a phone product, actual native visibility and expiry of the feedback observation. Child 3 cannot consume this evidence before the scoped gate. |
| `09-11-initiative-pattern-authoring/{prd,design,implement}.md` | All three artifacts require children 1-2. One Core Pattern authority, typed supported conditions, no bare-tick wake, bounded coalescing, global caps, exact-revision confirmation and user-package preservation remain explicit. Design **Required contracts** item 6 preserves conversation/panel revision, pause/resume, history and rollback; C3-01 requires the complete authoring loop and C3-05 the same-adapter/data-only second behavior. Child 4's Intention scope is not silently dropped. |
| `09-11-initiative-intentions-acceptance/{prd,design,implement}.md` | All three artifacts require children 1-3 and verified Memory authority. Automatic trusted-source formation, immutable finite windows, consumed/expired-source non-renewal, fresh independent Memory follow-up and qualified backoff remain explicit. Design **Required contracts** item 2 contains the corrected active-window/Scheduled distinction. C4-06 owns final evidence for parent AC01-AC19 and separates owner results from automated/native checks. Reporting parent readiness remains separate from automatic commit/push/finish/archive. |

Every child says the parent owns shared contracts and that its design narrows ownership rather than defining a different architecture. The listed evidence contributions overlap intentionally at integration seams; no child introduces a competing runtime, source authority, delivery promise or Monitor. Exclusions consistently preserve D79, separate D78 work, the phone application, autonomous long-term Pattern evolution and unrelated tasks.

The final check found no contradictory scope, reversed dependency, missing first-delivery acceptance owner or new owner-facing question. The parent's reported five successful `task.py validate` results are separate planning evidence; this reviewer did not rerun those commands or validate manifests/links on the parent's behalf.

## Limited residual engineering checks

These are implementation checks already implied by the plan, not new owner decisions or additional product scope:

1. Exercise the actual primary admission-to-pump interval and failed/closed admission cleanup. Ensure a reservation transfers exactly once, a background candidate cannot pass a queued primary, and cancellation does not leave a queue holder behind.
2. Test invalid/duplicate structural responses and the model-settled/decision-uncommitted crash cut. Cover waiting presentation, original-binding loss, concurrent primary arrival and every attempted post-terminal dispatch on the real RunRepo/RunService path.
3. Cut execution around the Timeline/link/quota/event transaction and fan-out. Demonstrate one ordinary assistant row, at most one charge and truthful uncertainty; old Monitor decoders must process the compatibility projection while mixed canonical events retain cursor progress.
4. Verify actual WebView2 Chat/Pet rendering, hide/minimize, reading position, multiple windows and connection replacement. Native own-surface visibility has stated occlusion limits; a browser fixture or client report cannot certify human reading.
5. Run populated migration lineage and current Memory authority checks on the integrated implementation, followed by real isolated Core and owner-only acceptance as separately labelled evidence. A source review of the convergence code is not a passed migration test.

## Files found and related specifications

- `.trellis/tasks/09-11-companion-initiative-implementation/prd.md` — consolidated R01-R16 and AC01-AC19.
- `.trellis/tasks/09-11-companion-initiative-implementation/design.md` — responsibility boundaries, lifecycle, privacy/presence and compatibility contracts reviewed here.
- `.trellis/tasks/09-11-companion-initiative-implementation/implement.md` — child ordering, owners, entry/migration gates and verification scope.
- `.trellis/tasks/09-11-companion-initiative-implementation/research/decision-register.md` — effective owner decisions, superseded premises and engineering choices.
- `.trellis/tasks/09-08-t4-heartbeat/prd.md` and `research/grill-decisions-2026-09-08.md` — original confirmed authoring, Intention, presence/backoff and D79 boundaries.
- `CONTEXT.md:30-76` and `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md` — domain distinctions and separate execution versus relationship history.
- `docs/T4-HANDOFF.md`, section 5 — frozen shared execution, Class A/B, privacy, delivery and calibration decisions.
- `.trellis/spec/backend/observability-projection.md` — producer-first facts, old projection shape, privacy and observer-isolation requirements.
- `.trellis/spec/backend/host-operation-lifecycle.md` — exact Host/generation identity, non-replay and current authority rules.
- `.trellis/spec/backend/database-guidelines.md` — single Core writer, synchronous transactions, immutable migration history and post-commit events. Historical Memory/runner descriptions in this file must be reconciled against the explicitly selected incoming baseline as required by the plan.
- `packages/core/src/agents/turn-queue.ts`, `server/methods/chat-send.ts`, `scheduler/scheduled-run-adapter.ts` — existing shared queue/admission and non-primary execution; Scheduled currently discards text at adapter line 34.
- `packages/core/src/harness/recovery-coordinator.ts` and `agents/conversation-store.ts` — concrete recovery and publication seams requiring the planned extensions.
- `packages/shared/src/run-event-schema.ts` and `observability-schema.ts` — current closed event and public projection validators.
- `.trellis/tasks/09-11-initiative-{runtime-foundation,presence-feedback,pattern-authoring,intentions-acceptance}/{prd,design,implement}.md` — twelve final child artifacts read during the bounded follow-up; complete paths and reviewed sections are identified in the final-check table above.

## External references

No new external lookup was needed to resolve this review. The sibling reference register's Hermes/OpenClaw comparisons are design evidence, not proof of Taki implementation, accepted product constants or externally run tests. The no-blocker conclusion here rests on the local owner decisions, design and targeted source checks.

## Caveats / Not Found

- No implementation, migration, UI, native runtime or owner acceptance was executed or passed by this review.
- The assigned task scope came from the parent's explicit dispatch. The legacy global pointer still named Avatar Lab and the child environment had no native pointer; the parent confirmed it owns and verified the correct native session binding. No pointer was modified.
- The active-window clarification and all twelve final child artifacts were verified in the artifact-only follow-up. They are no longer pending review items.
- Manifest/link/encoding validation remains separately owned by the parent. This artifact review does not claim to have rerun the parent's five successful task validators or any implementation quality gate.
