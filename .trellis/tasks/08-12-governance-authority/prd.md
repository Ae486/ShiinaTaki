# Core Governance Authority and Permission Projection

## Goal

Make Core the single global Permission Level/common policy authority while preserving Host-local stricter floors and
final enforcement through one registry-driven effective-policy calculation.

## Dependencies

- `08-12-host-control-foundation` complete and checked.

## Scope

- Shared canonical capability/governance descriptors and revisions.
- Core persistence, operator methods, migration, and effective-policy evaluator.
- Host projection/attestation of the Core ceiling plus local/managed floors.
- Minimal Home global `strict | standard | relaxed` and advanced capability view.
- Migration of legacy Node level/decision state under stricter-safe rules.

## Acceptance Criteria

- [ ] Core is the only global writer; Host cannot widen the Core ceiling.
- [ ] Unknown identity/cell fails closed across shared/Core/Rust.
- [ ] One policy change has one predictable effect for Core, MCP, and Shell adapters.
- [ ] Legacy denials remain effective and legacy allows are not silently broadened.
- [ ] Cross-language policy matrix and Home operator flows pass.

## Out of Scope

- Approval dialog/list/revoke and background-consent migration.
- MCP/Skill lifecycle or secret storage.
