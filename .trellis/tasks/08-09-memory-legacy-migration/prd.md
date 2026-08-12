# Legacy Memory Normalization and Migration

## Goal

Convert the shipped Markdown memory corpus into canonical structured records without silent loss, duplicate imports, or partial authority mutation.

## Dependencies

- `08-09-memory-provider-foundation`.

## Scope

- Compatibility normalizers for every supported Markdown/frontmatter variant.
- Deterministic source, bank-specific document, content-hash, and operation identities.
- Full dry-run validation and exact exceptional-source reporting.
- Durable Migration Ledger with resumable phase and one-to-many result mapping fields.
- Local structured-authority conversion and Hindsight-ready retain payload generation.
- Read-only preservation of the original Markdown snapshot for audit/export.

## Acceptance Criteria

- [ ] Re-running any completed or interrupted migration phase is idempotent.
- [ ] Every supported well-formed source reaches a terminal success result or exposes an implementation defect.
- [ ] Corrupt/unsupported sources retain raw evidence and require explicit exclusion before cutover.
- [ ] Zero-, one-, and many-fact outcomes can be represented without source/fact count assumptions.
- [ ] No dry-run or failed conversion changes Memory Authority.

## Out of Scope

- Creating Hindsight banks or activating Hindsight authority.
- Replica cursor consumption and outage recovery.
- Deleting the original Markdown snapshot.
