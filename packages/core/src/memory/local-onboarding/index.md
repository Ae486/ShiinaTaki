# core/memory/local-onboarding/
The durable Local onboarding service (Hindsight closure Stage 2a). It is the only caller of the B2 runner's mutations and owns
no timers, no second outcome ledger and no authority write of its own; the operation owner's local kinds drive it, and the
memory.onboarding.* server methods read it.
- local-onboarding-service.ts — B2 preview/preparation/activation, explicit full current-authority validation, custody and same-epoch recovery with durable invalidations
- local-onboarding-reads.ts — pure projections over B2 evidence: discovered/exact MemoryOnboardingRun (status, lease-aware progress phase, joined receipt), bounded exception pages with an exclusion hint, and the closed Local runtime availability derived from the binding snapshot
- local-onboarding-status.ts — readLocalOnboardingStatus: the strict memory.onboarding.status composite (authority, runtime, run, relevant operation, custody) with server-derived actions; LOCAL_ONBOARDING_FAMILY
- local-onboarding-fixture.ts — test support (not in the production path): the real service + runner over a temp workspace/SQLite with a programmable fake Local binding and fresh operation owners per boot id
