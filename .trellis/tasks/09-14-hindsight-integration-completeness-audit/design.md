# Completeness Audit - Research Design

## Boundary

This design defines a source/evidence audit, not new memory architecture or implementation authorization. Read the
current main worktree at H:/TakiAgent and the referenced Hindsight checkout where native evidence is needed. Other
worktrees, original user databases, services and real model endpoints are outside this audit's execution boundary.

The parent PRD/ADR and later owner decisions define required behavior. Current files and production call paths define
implemented behavior. Existing validation reports define only the cases and source/runtime conditions they recorded.
Old task statuses, semantic-index snapshots and isolated test fixtures must not override current source evidence.

## Evidence model

Each matrix entry has a stable audit ID, requirement source, use case, original batch/owner, implementation state,
reachability, source references, validation references/limits, concrete remaining work, impact and dependencies.

- Implementation: implemented, partial, missing, or deliberately not provided by this scope.
- Reachability: production-wired, operator-wired, internal/harness-only, or absent.
- Verification: recorded automated/integration evidence with its date/scope; current source inspection; outstanding
  integration, manual or original-environment acceptance. Do not infer one axis from another.
- Impact: basic-use blocker, specific-workflow blocker, accepted limitation/deferred behavior, or out of scope.

Negative findings name the searched production boundaries and the positive substrate found instead. Optional and
deferred capabilities are not silently promoted into release prerequisites. A demonstrated limitation such as D81
must remain explicit even when it does not block the owner's chosen B7 sequencing.

## Workstreams

1. Parent requirements and transition/operator closure: root owns requirement coverage, current-source/epoch switching,
   B7 operations, integration matrix and dependency ordering, reusing the grounded B7 audit.
2. Native/setup/administration: inspect exact compatibility/build/authentication, Bank setup/lifecycle, deployment-helper
   reachability, backup/restore/upgrade and transfer capabilities. Persist one bounded source report.
3. Multi-client and remote Core: trace actual endpoint selection, authenticated clients, reconnect, secret/config/data
   ownership and memory-related operations; distinguish one-Core clients from independent Core instances.
4. Runtime and capability parity: trace Local/Hindsight ingestion, recall/tools, policy/Blocks, maintenance/retention,
   recovery and existing acceptance, including explicit D79-D83 limits and optional vector behavior.

Independent research may run in parallel with exclusive report ownership. All writes stay inside this task's research
directory except root-owned task/parent/B7 planning records. No researcher changes production code or task pointers.

## Required journeys

- J1: a new or migrated workspace reaches independently usable Canonical Local memory.
- J2: an empty or populated Local workspace configures an existing or managed Hindsight service and activates it only
  after every accepted gate; new Character Banks remain usable after setup.
- J3: ordinary chat, explicit memory tools, Write Gate and maintenance use the selected authority with truthful policy.
- J4: Hindsight outage and Core restart preserve Pending/replica state; recovery confirms factual effects correctly.
- J5: healthy Hindsight -> Local, subsequent Local changes, and re-entry resume from verified common state without loss.
- J6: explicit emergency takeover retains the uncertainty boundary and never auto-merges the recovered old authority.
- J7: two clients use one local/remote Core, reconnect and observe durable memory operations without changing ownership.
- J8: backup, restore and staged upgrade are executable with the required compatible build, secrets and integrity checks.

Each journey names its first unresolved prerequisite and the evidence required to make it usable. A final cross-check
also covers accepted functions not naturally visible in these journeys, including diagnostics, export and configuration.

## Delivery

Publish topic evidence under research/, a complete requirement/journey matrix, and an ordered closure plan. Link the
result from the parent and B7. Keep research completion distinct from product implementation and owner/manual acceptance.
