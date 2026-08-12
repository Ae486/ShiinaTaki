# Memory Operations and Setup UI

## Goal

Make Hindsight setup and ongoing memory authority operations understandable, observable, and safely controllable without making the Home window authoritative.

## Dependencies

- `08-09-hindsight-connection-setup`.
- `08-09-hindsight-initial-cutover`.
- `08-09-memory-replica-sync-recovery`.
- `08-09-memory-runtime-integration`.

## Scope

- Guided managed-local or existing-instance setup with prerequisites, authentication, model, bank, template, and migration preview steps.
- Provider/authority/epoch, health, replica age, checkpoint, pending, failure, and next-sync presentation.
- Manual incremental sync, full reconciliation, retry, backup, and staged-upgrade workflows.
- Planned healthy switch-back to Local and separately guarded Emergency Local Takeover.
- Producer-backed shared/Core status and operation contracts with resumable progress after window closure.
- Secret presence/edit UX that never reads secret values back.

## Acceptance Criteria

- [ ] Setup cannot activate Hindsight before every compatibility, migration, and integrity gate succeeds.
- [ ] Sync remains asynchronous and the UI reports the last attempt and last successful synchronization separately.
- [ ] Closing/reopening Home restores authoritative operation state from Core rather than React cache.
- [ ] Degraded, recovering, stale-replica, superseded-write, and failed-upgrade states have actionable diagnostics.
- [ ] Planned switch-back requires final sync, full reconciliation, zero pending writes, a write fence, and a new epoch.
- [ ] Emergency takeover shows the potentially missing interval and requires explicit confirmation.

## Out of Scope

- Recreating Hindsight Control Plane administration wholesale.
- Storing authority state, migration progress, or secrets in frontend-local persistence.
- Automatic failover or active-active conflict resolution.
