# Phase D - Observability Plane Design

> Scope: DSH-inspired execution monitoring projections attached to the PI-shaped Harness lifecycle. This is not a
> second runtime, session model, or logging authority.

## 1. One Event Source, Multiple Projections

Framework lifecycle boundaries emit versioned, redaction-safe Run Events. The same facts feed:

- Run Receipt and status summary;
- developer trajectory and event inspection;
- operator metrics and health counters;
- optional telemetry/export adapters;
- live WS updates with cursor/backfill support.

Pino remains process diagnostics: startup, transport, unexpected errors, and operational breadcrumbs. Pino lines do
not define Run ordering, completion, replay, or recovery state.

## 2. Event Vocabulary and Producer Boundaries

The initial taxonomy is closed at the framework boundary and extensible by versioned additions:

| Category | Examples | Producer |
|---|---|---|
| trigger/admission | request accepted, deduplicated, queued, deferred, skipped | Trigger adapter / Core Admission |
| run/attempt | Run created, Attempt started, retry scheduled, terminal settlement | Run transition service |
| context | manifest captured, source selected, compaction decision, context rejected | Context/Replay adapter |
| model | request intent, stream started, usage settled, provider error | Runtime/model adapter |
| tool/effect | tool prepared, intent committed, effect started, result settled, unknown | Tool/Host/MCP effect boundary |
| governance | approval requested, granted, denied, policy generation mismatch | Core Approval/Governance |
| persistence/recovery | transition committed, orphan classified, reconciliation completed | Core persistence/recovery |
| delivery | receipt projected, Timeline message committed, live notification sent/dropped | Delivery/projection boundary |
| system | shutdown, restart, observer lag, schema/version warning | Core infrastructure |

Agent tools never emit arbitrary monitoring events and event production never consumes model tokens or context. Producers
must emit bounded structured fields with stable references, not raw prompt or secret content.

## 3. Durable and Live Planes

The durable plane is the append-only Run Event Ledger. The live plane is a best-effort stream of post-commit events to
WS/UI or developer subscribers. Live consumers receive a snapshot/cursor and then events; missed events are recovered
from the durable plane. A slow or failed observer is isolated, bounded, and never blocks the Run transition.

The implementation must define:

- cursor/sequence semantics and reconnect backfill;
- bounded queue and drop/lag counters for live observers;
- projection rebuild from durable facts;
- disabled monitoring behavior (execution remains correct; storage/stream policy is explicit);
- retention and export authorization.

## 4. Trajectory, Receipt, and Query Views

The readable trajectory is a projection that groups Run Events by Run, Attempt, category, and effect. It may include
controlled developer detail such as normalized tool names, bounded summaries, retry reason, Context Manifest reference,
and Host/Extension generation ids. It must not expose secrets, credential values, unbounded prompt/completion text, raw
tool bodies, or sensitive sensor bytes by default.

The Run Receipt is a compact durable projection of provenance, start/end/deadline, outcome, retry count, usage summary,
delivery state, and links to authorized detail. It is evidence, not a synthetic relationship message.

Queries must filter by authorized Character/Run lineage and support stable fields first: time, provider, outcome,
category, Attempt, task/trigger provenance, and text only where a separately authorized redacted projection exists.
Query failure or projection lag must not change Run correctness.

## 5. Privacy, Retention, and Export

Redaction happens before an event leaves its producer boundary. The default event envelope excludes prompts, completions,
credential values, authorization material, raw Host/MCP payloads, and sensor/media bytes. Content-bearing developer
detail requires an explicit role, bounded field, retention policy, and audit trail. Export is disabled unless explicitly
enabled and authorized; an export adapter cannot bypass the canonical redaction matrix.

Retention is projection-aware: terminal Run summaries and minimal lineage may outlive verbose trajectory details, while
deletion requests remove or tombstone all authorized projections consistently. Pino retention is managed separately and
does not substitute for Run evidence retention.

## 6. DSH Extensibility, Carefully Applied

DSH's plugin-oriented producer/consumer boundaries are useful for replaceable projections and optional telemetry sinks.
TakiAgent retains a privileged Core for identity, governance, persistence, security, and Character isolation. A plugin
may register a projection or observer only through a typed contract, bounded payload, explicit lifecycle, and failure
isolation. It may not define new Run truth, bypass redaction, or invoke a private model loop.

## 7. Phase D Exit Criteria

Phase D is complete when a later implementation task has:

1. a versioned event taxonomy and one producer owner per lifecycle boundary;
2. durable/live plane and cursor/backfill semantics;
3. Receipt, trajectory, metrics, and optional telemetry projection contracts;
4. redaction, retention, query authorization, disabled mode, and export rules;
5. projection failure isolation and rebuild tests;
6. explicit proof that Pino is diagnostic only and monitoring cannot alter execution.
