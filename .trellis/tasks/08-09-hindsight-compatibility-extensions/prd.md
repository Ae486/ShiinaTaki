# Hindsight Compatibility Extensions

## Goal

Add the smallest upstream-compatible extension set that makes Hindsight `0.9.0` a safe Taki Memory Authority without turning the local checkout into a feature-divergent fork.

## Dependencies

- Parent research and contracts in `08-09-hindsight-memory-provider`.
- No Taki implementation batch is required first; this task may proceed in parallel with the provider foundation.

## Scope

- Monotonic logical change journal/cursor with complete ordered upserts and tombstones.
- Per-record revisions, idempotent mutation identity, and `expected_revision` conditional mutation.
- Cursor-bound consistent logical snapshot pages plus integrity manifest and `end_cursor`.
- Additive observation instructions that preserve the native consolidation mission.
- Independent extension capability/version reporting for setup handshakes.
- Atomic re-derivation or mutation of `taki-layer:*` tags when controlled layer entities change.
- REST/OpenAPI and upgrade/compatibility tests against exact Hindsight `0.9.0`.

## Acceptance Criteria

- [ ] Every recall-relevant mutation source appears exactly once in cursor order or as an explicit tombstone.
- [ ] Snapshot-concurrent writes appear either in the snapshot or strictly after its `end_cursor`.
- [ ] Matching revisions apply; stale revisions return a typed precondition result without mutation.
- [ ] Entity reclassification and tag projection cannot diverge.
- [ ] Taki can reject a healthy server with a missing or unsupported extension version.
- [ ] The patch series remains isolated, documented, and rebaseable onto the pinned upstream release.

## Out of Scope

- Taki provider adapters, migration, replica storage, or UI.
- Replacing Hindsight's extraction, graph, observation, or mental-model implementation.
- A general redesign of Hindsight or a long-lived independent fork.
