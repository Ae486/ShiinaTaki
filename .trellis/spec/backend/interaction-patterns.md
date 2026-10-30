# Interaction Patterns and finite wake composition

## Authority and review

- `initiative/patterns/` is the single Pattern authority. Migrations 052/053 add identities, immutable revisions, exact reviews, command/source bindings, occurrence claims and bounded policy projections. They do not add a second Run queue, execution ledger or permission store.
- An active accepted revision remains effective while a candidate is edited. Operator confirmation binds the exact candidate revision and current aggregate version; stale or unseen revisions fail CAS. Rollback creates a new candidate and never restores a grant or rewinds a consumed occurrence. Paused state survives accepted rollback.
- `manage_interaction_pattern` is a primary-only Core tool. Its trusted actor comes from the actual appended user Timeline row and active Run/Attempt/tool call. Never discover authoring authority by querying the latest arbitrary message. Operator RPC derives the actor from the live authenticated connection. The tool cannot confirm a candidate.
- List/history responses remain bounded with explicit pagination. All model input fields are required, with nullable unused fields; operation-specific validation rejects irrelevant arguments. Internal IDs and cursors are transport bindings, not readable UI content.
- When the user requests creation with sufficient supported fields, authoring must execute `propose`. Listing,
  reading, history and prose do not save a candidate. Claim a review card only after `applied`/`duplicate` returns
  that candidate; a refusal is not success. Describe revision order without inventing dates absent from evidence.

## Sources and eligibility

- `pattern-composition.ts` combines existing ConfigSource, UserTimezoneService, queue version, Perception evidence, Presence and actual terminal background Runs. The explicit target is never selected from asset order, avatar reports or the latest chat. The built-in `taki` runtime is valid; another explicit target needs a valid imported Character marker.
- Conditions are a finite data union. Clock windows use the User Timezone; application/dwell/idle conditions use accepted current native observations. Presence alone needs a genuine known return occurrence to create a reason; an open connection or visible window does not manufacture a return.
- Completion source reads canonical completed `scheduled`/`subagent`/`webhook` Runs, excludes primary/heartbeat/maintenance cascades, and marks existing Class A publication so it cannot be delivered twice. Model prose never becomes deterministic completion facts. The Intention owner supplies actual finite due plans; standalone plans need no synthetic Pattern. `intention_due` Patterns and standalone candidates share the same source claim.
- Timer ticks, reconnects, releases and imported examples do not create a candidate. Source occurrence/revision controls deterministic chance and coalescing. At most four compatible candidates enter one judgment. Global model/utterance budgets remain owned by C1 canonical accounting.
- Pattern minimum gap is measured between admitted judgments, including silence. Global utterance gap and model cadence are separate. Source occurrence tombstones survive restart and target changes. Expired busy work does not become a catch-up queue.
- Turning both periodic and event sources off prevents new admission through policy changes or queue release as well; revocation still retires old work.

## Lifecycle and context

- Wake startup is explicit after recovery and WS boot. Before `start()`, notifications remain inert. Periodic checks and events use the same gates and C1 adapter; no second model loop is allowed.
- Local Config, Perception, Presence, queue-release and committed-Run observers carry data-free invalidations or committed fact references. They do not impersonate an authenticated operator to subscribe internally. Observer exceptions cannot undo durable writes or consent withdrawal.
- Configuration/target/timezone revision invalidates dependent preparation and held output. Primary arrival changes the queue-owned primary version. Cancellation targets a known heartbeat Run ID; Character-wide cancellation could abort unrelated primary/scheduled work.
- Context builder captures provider-neutral Memory, full Persona and only selected bounded global/Character blocks/index. It does not call automatic recall, scan primary history or run maintenance. Local, Legacy and Hindsight captures keep their original authority/lifetime fence.
- Capture freezes already accepted optional observations before asynchronous Memory preparation. Manifest contains only actual included sources, trust/revisions and the earliest validity deadline. Missing source is omitted. Time is rendered through `core/time`.
- Cancellation, deadline expiry and shutdown abort asynchronous preparation. Output collection enforces each selected candidate's allowed outcomes; `silent` remains mandatory. Tool advertisement alone is insufficient enforcement.

## Setup and monitoring

- Setup reads the existing config registry, User Timezone and actual source state. It creates reviewable example proposals only; installation, imports and seeds never auto-activate behavior.
- Bundled `resources/skills/companion-pattern-authoring/SKILL.md` bytes enter the standard immutable Skill lifecycle with a named directory wrapper. User content, disabled packages and unavailable exact content remain distinguishable; installation never silently overwrites or re-enables them.
- The existing Monitor reads bounded policy diagnostics even when no Run was admitted. Refusals do not fabricate Runs or model effects. Counters count transitions, not sampling ticks. Identical successive reasons coalesce, including across restart.
- Operator invalidations carry only Character scope; clients re-read current state. Candidate editing preserves drafts/focus/selection and invalidates stale confirmation; reconnect never replays mutations. Tool/Monitor presentation omits internal bindings in expanded, accessibility and copy surfaces.
- The existing strict C3 wake-policy RPC maps durable `backoff-spacing`/`backoff-daily` diagnostics to compatible `model-cadence`/`model-budget` reasons. Retain every recent row/cursor and sum counters when reasons map together; never rewrite durable reasons. The separate backoff RPC exposes detailed current stage, evidence and reset status.

## Regression anchors

- Pattern service/migration tests cover source authority, CAS, idempotency, rollback, seed preservation and unchanged permission state.
- `initiative-context-builder.test.ts` and Memory runtime tests exercise actual scope selection, authority, cancellation and unchanged primary behavior.
- `initiative/wake/*.test.ts` cover clocks/DST, currentness, chance, global policy, pending expiry, duplicate/restart, startup and outcome restrictions.
- `e2e/src/initiative-pattern.e2e.test.ts` uses unmodified production Core entry, actual primary tool proposal, RPC confirmation, automatic timer/source path, ordinary Timeline/Monitor, restart no-replay and zero model calls for prohibited conditions. Local scripted transport does not establish real-model or owner acceptance.
- `e2e/src/initiative-pattern-real.e2e.test.ts` is separately opt-in and uses the actual configured provider with
  isolated synthetic data. Check persisted authoring/lifecycle state, exact scheduled UTC instants and structural
  heartbeat outcomes; inspect recorded clarification replies for semantics. Unique Memory-only/history-only request
  probes verify the selected context boundary. A few passing samples do not guarantee universal model reliability.
- C3 task research retains native WebView2 evidence, exact commands and source inventory. Manual acceptance stays unchecked until owner confirmation.
