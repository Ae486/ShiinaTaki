# Phase F - T4 Compatibility Review

> Scope: define what downstream T4 providers may consume from the Harness and what remains provider/product policy.

## 1. Shared Trigger Request

Scheduled Task, Heartbeat, Webhook, system events, and future commitment/activity providers all submit the same typed
`TriggerRequest`/admission envelope. It carries provider kind, provenance, `characterId` when applicable, requested
context/delivery mode, idempotency key, deadline/budget hints, and optional `taskId`/`parentRunId`. The request alone does
not imply execution or a model call.

## 2. Reusable Compatibility Contracts

Downstream T4 may rely on:

- Core-owned `runId` and subordinate `attemptId` identity;
- trigger provenance and initiator classification;
- immutable effective snapshot and redaction-safe Context Manifest;
- Run Receipt/query link and terminal outcome vocabulary;
- non-primary turn semantics that do not create fake relationship rows;
- `parentRunId` Child Run lineage and bounded structured result return;
- one Admission/Runtime/Event path for every trigger kind.

## 3. Explicitly T4-Owned Policy

The following are not decided or implemented by this parent architecture task:

- Scheduled Task `at`/`every`/`cron`, timezone/DST, catch-up, pause/resume, and single-flight schedule policy;
- Heartbeat eligibility, checklist/commitment sources, Class B budgets, quiet hours, minimum gaps, ignore-backoff,
  structural silence, context thinness, Signal normalization/Wake Policy, Interaction Pattern lifecycle, and
  Companion-evolution policy;
- proactive delivery, Home/Pet UI behavior, and D59/D61 client restoration policy;
- Procedural Knowledge and Experience Review behavior;
- generic task DAG/mailbox coordination beyond reserving Child Run lineage and future work-item boundaries.

These providers may choose whether and when to submit a request, but Core owns execution, effects, settlement, evidence,
and recovery after admission.

Heartbeat cadence and event sources must converge on one provider-owned Wake Policy before admission. Raw activity,
background completion, privacy, or future integration events may arm evaluation but cannot call the model, grant
permission, or create a private loop. Typed Character-scoped Interaction Patterns may guide eligibility and purpose,
but they remain data over the common Harness path. Agent pattern authoring uses a Skill plus a validated Core API;
stable Persona/Soul and Runtime safety policy are not self-modifiable.

## 4. Child Runs

A subagent is a delegated Child Run on the same Harness. It receives an explicit bounded context seed/fork, resource
scope, deadline, and cancellation relationship. It returns a bounded structured result and linked evidence to the parent;
the parent decides whether to present it. The child does not append private transcript rows directly to the relationship
Timeline and does not spawn recursive children unless a later reviewed contract explicitly changes that rule.

## 5. Phase F Exit Criteria

Phase F is complete when each future trigger can be described as a provider that submits the common request, all product
policies are listed outside Core, and Child Run lineage/result requirements are reserved without introducing a second
runtime or session authority.
