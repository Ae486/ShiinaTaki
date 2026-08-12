# Unified Approval Lifecycle and Operator Surfaces

## Goal

Replace the MCP-specific and Shell-local prompt split with one Core-mediated Approval lifecycle over canonical
capability identity, exact input binding, versioned decisions, and truthful operator surfaces.

## Dependencies

- `08-12-governance-authority` complete and checked.

## Scope

- Common Approval request/respond/challenge/resume schemas and revisions.
- One operator dialog; no Host/Shell second prompt.
- Once/session/always/deny, approving-session ownership, timeout/disconnect cleanup, list/revoke.
- Explicit future-background disclosure and legacy durable-allow reconfirmation.
- CLI and Home parity, with pending input memory-only and never cached/logged.

## Acceptance Criteria

- [ ] One action renders at most one Approval dialog.
- [ ] Session decisions die with the approving operator session and never authorize unattended work.
- [ ] Revoke/policy generation changes invalidate future use immediately.
- [ ] Host challenge resumes only the exact sealed request and cannot be replayed/widened.
- [ ] Pending inputs and secrets never enter logs, storage, cache, or run history.

## Out of Scope

- Credential storage and extension CRUD.
- Scheduled/Heartbeat receipt/resume implementation.

