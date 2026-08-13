# Host-Control Protocol and Generation-Safe Capability Routing

## Goal

Create the shared/Core/Rust foundation that makes Execution Host identity, catalog ownership, routing, disconnect, and
response settlement truthful before common governance or extension lifecycle work builds on it.

## Dependencies

- Parent PRD and `info.md` engineering contracts.
- Planning-only `08-12-authority-credential-design` gate.
- Existing D59/D61 work is a compatibility dependency, not a code dependency: browser generations remain separate.

## Scope

- Shared Host identity, availability, protocol negotiation, catalog snapshot, Host-bound operation, cancellation,
  response, and settlement schemas.
- Rust serde mirrors and shared golden fixtures for every Node-handled frame.
- Stable Core-host identity; Node `deviceId` is reused as `hostId`.
- Core-assigned authenticated connection generations and complete Host catalog publication.
- Explicit Host-qualified capability resolution, removing first-advertising-Node selection from the execution path.
- Pending request ownership by `(hostId, connectionGeneration)` with deadline, cancellation, stale-response rejection,
  duplicate-attempt protection, and `outcome_unknown` settlement.
- A narrow immutable Host snapshot/Host Context renderer seam for later Run assembly.
- Focused tests and proportional formal check after implementation.

## Required Contracts

- Follow parent `info.md` section 2 exactly. Agent/model input cannot set sealed runtime fields.
- Core-host identity is stored through strict atomic `<dataDir>/host-identity.json` semantics: create only when absent,
  and fail boot rather than silently replacing an unreadable, malformed, or invalid existing identity.
- Freeze the shared method names as `host.catalogPublish`, `capability.request`, reserved `capability.challenge`,
  reserved `capability.resume`, `capability.cancel`, and `capability.respond`.
- Every Node-to-Core method validates `MethodContext.connection`; payload identity is only cross-checked and cannot
  self-prove Host or connection provenance.
- Hosts publish only local readiness. Core derives connected/authenticated/revoked state and last-seen metadata.
- For legacy callers without an explicit target, resolve only when exactly one currently routable Host advertises the
  capability; zero Hosts is unavailable and multiple Hosts produce an explicit target-required/ambiguous failure. Never
  restore first-advertising-Node selection under another name.
- `connectionGeneration` is monotonic per stable `hostId` within the current Core process lineage and is neither
  client-supplied nor persisted across Core restart. The Rust terminal-attempt cache is in-memory, capped at 256 entries
  per live generation, and discarded on retirement/reconnect.
- In this child, `host.catalogPublish` and `capability.respond` are Node-to-Core RPCs with structured `{accepted,
  reason?}` results; `capability.request` and `capability.cancel` are Core-to-Host frames. Challenge/resume are schema
  reservations only. Core computes lowercase SHA-256 canonical-input digests and mints opaque UUID attempt/idempotency
  identifiers.
- The same exact identity tuple binds request, optional challenge/resume, cancel, and response.
- Disconnect of Host A cannot settle Host B work.
- A response with only a valid `requestId` but the wrong Host/generation is rejected.
- No reconnect, timeout, or cancellation path automatically replays a side effect.
- Invalid/unsupported catalogs leave the Host non-routable while retaining only sanitized display diagnostics.
- Existing single-node tools remain functional by resolving their current primary Host explicitly before routing.

## Acceptance Criteria

- [ ] Two connected Hosts can advertise the same capability and an operation executes only on its explicit target.
- [ ] Reconnect of one stable Host produces a new Core-assigned generation; old responses/cancels cannot settle new work.
- [ ] Disconnect settles only requests owned by that Host generation.
- [ ] Read-only cancellation and unknown side-effect outcome are represented distinctly and never auto-replayed.
- [ ] Catalog/protocol negotiation and full snapshot publication pass TypeScript/Rust fixture parity tests.
- [ ] Core-host identity survives restart, creates only when absent, and fails boot on corrupt/unreadable identity data.
- [ ] Host Context contains authenticated ownership/generation facts and rejects content-supplied control overrides.
- [ ] Focused shared/Core/Rust tests, workspace typecheck/lint, and `cargo clippy` pass.

## Expected Production Files

The implementer must confirm the live code before editing. Expected seams include:

- `packages/shared/src/host-control-schema.ts`, capability/connect schema integration, fixtures, and exports;
- `packages/core/src/hosts/{host-identity,host-catalog,host-context}.ts`;
- `packages/core/src/server/connection-registry.ts`, connect/capability methods, and
  `packages/core/src/server/methods/host-catalog-publish.ts`;
- `packages/core/src/capabilities/{route-capability,capability-broker}.ts` plus focused tests;
- `packages/core/src/main.ts` composition only where required;
- `apps/desktop/src-tauri/src/{protocol,ws_client,node}.rs` and focused tests/index docs; and
- one Core persistence seam for stable Core-host identity, with the live migration/file decision rechecked before code.

## Out of Scope

- Moving global permission/Approval persistence to Core.
- Desktop Approval dialog or permission settings UI.
- Credential encryption, secret values, or new dependencies.
- MCP CRUD/reload/generation leases and Skill import/reconciliation.
- Autonomous Run, Run Receipt, Scheduled Task, Heartbeat, or transport liveness probe.

## Verification Plan

1. Shared schema and cross-language fixture tests.
2. Core unit tests for strict Host identity persistence, routing, connection/catalog generations, settlement,
   deadlines, authenticated method provenance, and Host Context.
3. Rust unit tests for serde, binding, duplicate/cancel behavior.
4. Single-Node real-process reconnect and capability execution smoke in this child.
5. Workspace typecheck/lint, relevant TS tests, `cargo test`/`cargo clippy`, then one formal `trellis-check`.

## Deferred Convergence Evidence

The owner approved deferring the real simultaneous two-Node process harness to
`08-12-extension-discovery-integration`. That final integration child must exercise two Hosts advertising the same
capability, explicit target routing, same-Host reconnect to a new generation, cross-Host isolation, and interrupted
read/side-effect settlement before this child can receive final closeout. Unit and wire coverage in this child remains
binding and must not be represented as process-level two-Node evidence.
