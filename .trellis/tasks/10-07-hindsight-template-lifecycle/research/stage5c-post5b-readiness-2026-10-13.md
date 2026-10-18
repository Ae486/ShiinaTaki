# Stage 5C / C1 post-5B readiness refresh

- Date: 2026-10-13.
- Scope: bounded read-only refresh for Root; sole write is this report.
- Checkout: `H:/TakiAgent`, `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
  Findings refer to directly inspected working-tree source, not HEAD alone.
- Active session task remains B; the empty global task pointer is expected. This review changes no task binding.

## Activation verdict

**C1a is ready for Root activation and one cohesive implementation dispatch.** No inspected source interface
invalidates the accepted C1 design. Accept the completed 5B gate and released ownership supplied by Root;
neither the six resolved design questions nor the 5B acceptance suite needs reopening.

The current C1 `prd.md`, `design.md`, `implement.md` and `research/design-review-resolution.md` SHA-256 values
exactly match the four values in the existing
[Final artifact confirmation — 2026-10-07](stage5c-c1-readiness-review.md). Keep that confirmation as the
pre-activation baseline. The references to B1 retaining ownership and final confirmation being pending are
stale status text; Root should synchronize them and the scheduling checklist during activation. This report
does not edit those artifacts or mark implementation acceptance complete.

## Current source baseline

| Boundary | Inspected current value / source |
| --- | --- |
| Core migration registry | `packages/core/src/db/migrations/index-list.ts` ends at `059-hindsight-template-execution`; version 59 is defined by that module. |
| Native migration graph | Static parsing of 107 revision files finds one head: `e62a3d0b9c54_add_template_label_provenance.py`, parent `e51c2f9a8b43`. No migration code or database was executed. |
| Native compatibility | `H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:33`: compatibility/contract `1.0.0`, build `taki-memory-hindsight-0.9.0-template-backup-v1`. These are source identities, not an installed image digest. |
| Host/governance | Shared Host protocol `3`, catalog schema `2`; `governance-registry.ts:13` still has registry revision `1`. Reuse the current protocol and deliberately version new descriptor registration. |
| Release construction | Node 24 requirement, locked TypeScript `6.0.3`, libsodium-wrappers/libsodium `0.8.4`; extension rewriting already enabled. Shared exports source TS; Core starts source TS; Tauri has no C1 resource closure yet. The planned codec and Host packages do not yet exist. |

No migration number is reserved by this review. Allocate any necessary new durable schema after the live
registry head; preserve existing migrations. C1a does not require reopening Native template/backup code.

## Minimum C1a ownership map

Assign the following coupled source and corresponding focused tests to one implementer. New module names may
follow local conventions; package placement and authority boundaries remain those in the accepted design.

| Responsibility | Files / API seams to own |
| --- | --- |
| Strict wire and registration | New dedicated C1 Shared schemas/fixtures; `packages/shared/src/governance-registry.ts`, required named exports and Rust protocol mirrors. Register descriptor, classifier/cells and Host catalog together; retain current generic Host negotiation. |
| Codec and owner snapshot | New `packages/secret-catalog-codec/`; `packages/core/src/secrets/secret-catalog-envelope.ts`, `secret-catalog-service.ts`, and their existing consumers/tests. Preserve TSC1 and the sole Core writer; add the frozen capture/validate API with owner-consistent load/publish/rotate/restore identity. `catalog-publication.ts` remains the rename-based publication seam. |
| Issued/accepted custody owner | `packages/core/src/capabilities/{capability-broker,capability-broker-state,capability-response,route-capability}.ts`, their challenge/effect integration and narrow Core composition/registration. Add per-pending observers and the explicit attempt map. Preserve authenticated provenance from `server/methods/capability-respond.ts`. |
| Windows final invocation | `apps/desktop/src-tauri/src/{capabilities_impl,ws_client,node,host_session,secrets}.rs`, relevant `gate/` registration and new installed-invoker modules; get-only integration with `bin/taki-secret-key.rs`. Keep installation verification and actual token-user binding at the trusted Host boundary. |
| Release Host and installation | New `apps/hindsight-host/`, package/build manifests, required compiled Shared closure, lockfile edges, Tauri resources/Cargo feature wiring and Ubuntu service/enrollment artifacts. Reuse locked dependencies and compiled ESM. Ubuntu must be an enrolled `role=node` Host; `bin/taki-node.rs:44` still refuses release execution. Own the release Host lifetime in C1a; fake bootstrap/observer follows in C1b. |
| Fresh setup admission | `packages/core/src/memory/hindsight/hindsight-setup-service.ts:213`, `memory/operations/memory-operation-kind-setup.ts:30`, and relevant Shared request/tests. Gate fresh caller-supplied `managedReceipt`; preserve existing-instance behavior and historical accepted owner records. A C1 custody result cannot produce a deployment-ready receipt. |

Two concrete insertion points matter when implementing the already accepted contracts:

1. `capability-broker-state.ts:86` calls `settleHostEffect` before final resolution and can downgrade a
   successful decoded response to `CANCELLED`. Successful `onAccepted` evidence must reflect that final outcome,
   as well as the frozen current-generation/deadline/snapshot checks; `responseOutcome` success alone is insufficient.
2. Rust has both `ws_client.rs:319`/`:330` (`dispatch_execute`) and `:404`/`:412` (`dispatch_resume`). Supply trusted
   invocation context after final enforcement on both paths while preserving ordinary capability compatibility.

The seven fixed refs remain in `hindsight-secret-refs.ts:9`; `hindsight-configuration-context.ts:60` already
consumes the private catalog revision. Preserve this observation behavior and the public secret projections.
Update touched directory indexes and the relevant secret-catalog/Host/governance specs with implemented contracts;
reuse existing regression suites rather than duplicate the completed design review in tests.

## Verification and handoff boundary

This refresh read all C1 curated context, checked the four confirmation hashes, inspected the named live seams
and statically read migration/manifest identities. **No lint, typecheck, test, build, generation, installation,
index rebuild, service/Docker action, credential/data access or model call was performed.** No production,
test, spec, task metadata or prior evidence was changed.

C1a still requires its independent custody/provenance/install gate. C1b separately proves the fake-secret
bootstrap/process and fake-observer contract. Actual Windows/Ubuntu installation checks remain explicit
platform evidence, and C2a still requires isolated Docker/daemon proof before real credential delivery or
trusted deployment receipts. Source authorization does not authorize those environment actions.

Root may now synchronize status/scheduling and activate C1a. Reviewer ownership ends with this report.
