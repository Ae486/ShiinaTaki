# Authority and Credential Design Gate

## Goal

Freeze the cross-cutting authority, identity, credential, migration, and recovery contracts that every Skills/MCP
implementation child consumes, without changing production code.

## Scope

- Core Authority versus Execution Host ownership and stricter-wins enforcement.
- Stable `hostId` rules, including Node `deviceId` reuse and Core-host identity persistence.
- Canonical capability, Skill, MCP server/tool, secret reference, and Host-qualified resource identities.
- Host-control protocol/catalog version negotiation and generation/revision vocabulary.
- Host-local encrypted credential catalog abstraction, Windows/Linux bootstrap adapters, and the dedicated sensitive
  operator command boundary.
- Legacy policy/Approval/MCP plaintext/Skill state migration and rollback principles.
- ADR/spec drift inventory and the required superseding documentation plan.

## Acceptance Criteria

- [x] Owner-ratified authority and Host locality are expressed without a second global policy store or Approval dialog.
- [x] Ordinary Host-control/config/status payloads cannot contain secret values.
- [x] Stable identities and generation/revision meanings are unambiguous across Core and Nodes.
- [x] Legacy denials remain stricter, legacy allows require safe reconfirmation where scope changed, and plaintext secret
  migration never destroys the only source before verified encrypted use.
- [x] The implementation DAG and first production child consume one written engineering contract.

## Output

- Parent `info.md` sections 1-4 and 7.
- Child task decomposition under the parent task.
- No `task.py start`, production code, dependency installation, or formal `trellis-check`.

## Out of Scope

- Proving a concrete `libsodium-wrappers` version or Windows helper packaging.
- Writing migrations, schemas, adapters, or UI.
- Reopening already resolved product decisions.

