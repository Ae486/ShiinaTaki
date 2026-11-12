# Pattern authority

- pattern-service.ts — shared entry for bounded queries, authenticated commands, idempotency and committed invalidation.
- pattern-mutations.ts — proposal, exact review CAS, pause/resume/retire and reviewable rollback transitions.
- pattern-store.ts — Character-scoped SQLite read projections and transaction-local revision writes.
- pattern-source.ts — Core actor validation and immutable primary Run/user Timeline source binding, including optional descriptive source evidence.
