# Hindsight Connection, Secrets, and Setup - Execution Plan

> Activation gate: this plan remains inert while the task status is `planning`. Do not write production code until
> the owner approves the planning package and `task.py start` changes the task to `in_progress`.

## Execution Protocol

- Use vertical RED -> GREEN tracer waves. Each wave ends with focused tests and `git diff --check`.
- Keep the active Memory Authority `canonical-local`; no wave may edit authority selection or create a Hindsight epoch.
- Use only the focused Hindsight endpoints defined in `design.md`; do not add the full generated client as a runtime
  dependency or modify `H:/hindsight`.
- Resolve secrets only at the call seam. Use sentinel assertions after every wave that touches secret handling.
- A real Bank LLM health call is never part of an automated gate. It requires a running accepted Hindsight service,
  configured external model credentials, and explicit approval because it makes real provider calls.
- Preserve the untracked `.backup-memory-legacy-migration-live-20260821-01/` directory and unrelated worktree changes.

## Wave 0 - Shared connection/setup contracts

### Ownership

- `packages/shared/src/hindsight-connection-schema.ts`
- `packages/shared/src/hindsight-setup-schema.ts`
- colocated tests and `packages/shared/src/index.ts` / `index.md`

### RED

- Reject endpoints with unsupported schemes, userinfo, query/fragment, or unbounded length.
- Reject setup snapshots with an invalid phase, stale/missing revision, `configured` plus incomplete Banks, or a
  secret/value-shaped field.
- Reject deployment receipts containing commands, arbitrary environment maps, filesystem paths, or unsupported
  storage kinds.
- Pin stable error codes, retryability, next actions, compatibility constants, Bank/template projections, and
  status-only LLM health projections.
- Pin operator method parameters/results with `expectedRevision` on mutations and no secret value in any result.

### GREEN

- Add strict bounded zod schemas and inferred types.
- Export named contracts through the package public entry.
- Keep connection, setup, compatibility, deployment receipt, and diagnostics split by responsibility if a file would
  approach the 300-line source cap.

### Gate

```powershell
pnpm --filter @taki/shared test
pnpm --filter @taki/shared typecheck
git diff --check
```

### Rollback point

Shared-only contract files can be removed without affecting current runtime behavior.

## Wave 1 - Config and Secret Catalog wiring

### Ownership

- Config knob registry rows and loader/projection module
- `packages/core/src/memory/hindsight/hindsight-secret-refs.ts`
- Secret/config focused tests and touched `index.md` files

### RED

- Config tests prove endpoint, deployment mode, request/setup timeouts, template revision, and non-secret provider/model
  identifiers follow `env > stored > default` and remain sparse.
- Secret-classified keys are refused by `config.set` and never appear with values in `config.list`.
- Stable Hindsight connection/helper-input secret refs are deterministic, bounded, and collision-safe for the fixed
  vocabulary.
- Missing, locked, cleared, and rotated secrets are visible only as safe presence/generation changes.
- Sentinel values are absent from serialized config, protocol results, logs, and test snapshots.

### GREEN

- Add one registry row per operator-visible non-secret knob and any secret presence row required by the existing
  Config Store conventions.
- Add the fixed Hindsight connection/model secret-ref vocabulary without weakening the existing MCP-specific marker
  parser.
- Build a trusted Core resolver adapter over `SecretCatalogService.resolve()` for the connection API key only. Model
  and database secret refs remain opaque helper inputs and must not be resolved by Core setup.
- Include safe Secret Catalog provenance/generation in the connection fingerprint; never hash or persist the value.

### Gate

```powershell
pnpm --filter @taki/core test -- config secrets hindsight
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared test
git diff --check
```

### Rollback point

Remove the new registry rows and Hindsight ref module. Existing Secret Catalog entries are opaque and are not deleted
by code rollback.

## Wave 2 - Focused REST client and endpoint policy

### Ownership

- `packages/core/src/memory/hindsight/hindsight-endpoint-policy.ts`
- `packages/core/src/memory/hindsight/hindsight-client.ts`
- `packages/core/src/memory/hindsight/hindsight-contracts.ts`
- injected transport/test server fixtures and touched `index.md`

### RED

- Bearer auth is present on `/health`, `/version`, compatibility, Bank, template, and LLM-health calls, including
  loopback endpoints.
- Missing secret fails before transport invocation.
- Endpoint policy accepts explicit localhost/private existing instances and rejects userinfo, redirects, metadata,
  unspecified, multicast, and unsupported-scheme targets.
- Deadline and caller cancellation produce different safe error codes and leave no pending work.
- Oversized body, non-JSON response, malformed JSON, invalid schema, 401/403, 404/409/422, 5xx, TLS/connect failure,
  and redirect responses map to bounded errors without response/body/header leakage.
- Template import sends the exact raw JSON body with `Content-Type: application/json` and `dry_run=true|false`, despite
  the generated `0.9.0` TypeScript type declaring `body?: never`.
- Logs and thrown errors do not contain sentinel API keys, Authorization headers, raw provider details, or model IDs.

### GREEN

- Implement an injected fetch transport with response-byte bounds, `redirect: "manual"`, composed cancellation, and
  operation-specific projections.
- Reuse accepted Hindsight OpenAPI/generated schema names as contract fixtures without adding a runtime dependency on
  the sibling checkout.
- Keep one request primitive and thin endpoint methods. The client performs no automatic retries.
- Isolate and comment the one template-import OpenAPI exception with the exact upstream version/build scope.

### Gate

```powershell
pnpm --filter @taki/core test -- hindsight-client hindsight-endpoint-policy
pnpm --filter @taki/core typecheck
pnpm lint
git diff --check
```

### Rollback point

The focused client is not composed into boot yet. Remove the Hindsight directory without changing active Memory.

## Wave 3 - Compatibility handshake

### Ownership

- `packages/core/src/memory/hindsight/hindsight-compatibility-service.ts`
- compatibility fixtures/tests and touched `index.md`

### RED

- Validation calls endpoint policy, secret resolution, health, native version, and authenticated compatibility in the
  specified order.
- Wrong/missing API key fails even when `/health` and `/version` return success.
- Reject wrong base API version, compatibility version, build identity, provider lineage, PostgreSQL capability,
  journal/snapshot capability, and each missing/unsupported versioned contract.
- Reject malformed or incomplete manifests before any Bank/template method is called.
- A changed fingerprint invalidates prior evidence; an unchanged compatible fingerprint may be reused only by an
  explicit status/read path, never as hidden fallback after a failed validation.
- Persisted projections contain only accepted bounded compatibility fields and no raw manifest extras.

### GREEN

- Implement the ordered read-only service and exact compatibility constants.
- Produce one normalized compatibility projection/digest and stable failure classification.
- Expose no Bank mutation and no Memory Authority dependency from this service.

### Gate

```powershell
pnpm --filter @taki/core test -- hindsight-compatibility
pnpm --filter @taki/core typecheck
git diff --check
```

### Rollback point

Remove the service. The client and inactive shared contracts remain independently testable.

## Wave 4 - Additive setup persistence and state machine

### Ownership

- next additive migration under `packages/core/src/db/migrations/`
- `packages/core/src/db/hindsight-connection-repo.ts`
- `packages/core/src/db/hindsight-bank-setup-repo.ts`
- migration/repository tests and `index.md`

### RED

- Fresh migration creates the setup tables without changing canonical Memory tables or authority selection.
- Upgrade from the current migration head preserves the active `canonical-local` epoch and all Memory rows.
- Repository compare-and-swap rejects stale revisions and serializes one active setup attempt.
- Reopen preserves phase, fingerprint, compatibility projection, per-Bank status, operation IDs, and safe error codes.
- Database constraints reject configured state with incomplete required Banks and reject invalid JSON/status values.
- Scanning table contents proves sentinel secrets, raw headers, template bodies, raw HTTP errors, and memory text are
  absent.
- Configuration fingerprint changes mark prior compatibility and Bank verification stale.

### GREEN

- Add the singleton connection-state and per-Bank setup tables described in `design.md`.
- Implement narrow repositories with explicit transactions and shared-schema read validation.
- Persist only safe projections/digests and bounded operation IDs.

### Gate

```powershell
pnpm --filter @taki/core test -- migrations hindsight-connection-repo hindsight-bank-setup-repo
pnpm --filter @taki/core typecheck
git diff --check
```

### Rollback point

Before release, remove the additive migration and repositories. After release, never rewrite a shipped migration;
disable the feature and add a forward migration instead.

## Wave 5 - Bank template and setup orchestration

### Ownership

- `packages/core/src/memory/hindsight/taki-bank-template-v1.ts`
- deterministic Bank identity/binding module
- `packages/core/src/memory/hindsight/hindsight-setup-service.ts`
- setup/template tests and touched `index.md`

### RED

- The built-in template has Hindsight manifest version `"1"`, a separate Taki revision, a stable canonical digest,
  bounded ownership lists, and no credentials/infrastructure fields.
- External Bank IDs are deterministic, versioned, opaque, and distinct for Global and Character scopes.
- Setup requires a current compatible fingerprint and runs every target's dry-run before the first remote mutation.
- Global and Character setup call minimal idempotent Bank create/update and then template apply.
- Reapplying the same template converges without duplicate mental models/directives; drift invokes read-back/repair only
  for Taki-owned fields.
- Extra operator-owned remote objects survive setup and template upgrades.
- Dry-run failure performs zero remote mutation and leaves prior durable Bank state unchanged.
- Partial apply failure persists completed Banks, marks the failed Bank retryable, and resumes without deleting or
  recreating successful Banks.
- Returned mental-model operation IDs are bounded and polled only under the setup deadline; unstable result metadata
  never becomes canonical state.
- Success marks setup configured but leaves `memory_authority_selection.mode = 'canonical-local'` and the same epoch.

### GREEN

- Implement the immutable template wrapper and local validation/digest.
- Build the explicit state-machine transitions and per-Bank resume logic.
- Read back the exported template projection and compare only declared Taki ownership.
- Make disable non-destructive: it changes eligibility/state but does not clear secrets or delete remote Banks.

### Gate

```powershell
pnpm --filter @taki/core test -- hindsight-setup taki-bank-template
pnpm --filter @taki/core typecheck
pnpm lint
git diff --check
```

### Rollback point

Disable B3 setup in configuration. Remote Banks are intentionally retained; they may contain operator-owned data.
Canonical Local remains active without a data rollback.

## Wave 6 - Deployment-helper and operator protocol

### Ownership

- shared deployment receipt and method schemas if not completed in Wave 0
- `packages/core/src/server/methods/hindsight-setup-methods.ts`
- method registry/bootstrap composition
- optional Shell/helper client boundary only if an existing host-control contract can represent the receipt safely
- protocol/authorization/composition tests and touched `index.md`

### RED

- Existing-instance validate/setup works with no helper registered.
- Existing-instance setup never attempts to rewrite deployment-level model/provider configuration through Bank APIs;
  it only validates external configuration through explicit LLM health.
- Managed mode refuses missing, malformed, stale, mutable-latest, non-persistent, or unsupported storage receipts.
- Core method code contains no `child_process`, Docker/service command, arbitrary filesystem action, or OS credential API.
- All methods are operator-only; Agent/non-operator connections are refused.
- `status` is read-only, `validate` is read-only remotely, and `setup`/`disable` require `expectedRevision`.
- Secret values are not accepted by these methods and never appear in results.
- Reconnection/status consumers can obtain the current snapshot without making setup state client-authoritative.

### GREEN

- Register thin operator controllers over compatibility/setup services.
- Validate managed deployment receipts and feed the safe endpoint into the same existing-instance path.
- Keep any helper-side secret resolution outside Core and require that the helper returns only safe presence/receipt
  evidence.
- If no approved helper transport exists yet, ship the strict receipt contract and explicit `helper-unavailable` state;
  do not invent a hidden process execution path in Core.

### Gate

```powershell
pnpm --filter @taki/shared test
pnpm --filter @taki/core test -- hindsight-setup-methods
pnpm --filter @taki/core typecheck
pnpm lint
git diff --check
```

### Rollback point

Unregister the new operator methods and disable setup. Persisted safe state remains inert and Canonical Local continues.

## Wave 7 - Explicit LLM health, privacy, and regression convergence

### Ownership

- Bank LLM health service/method path
- privacy/static architecture tests
- final indexes/docs directly required by changed behavior

### RED/GREEN checks

- `memory.hindsight.llm-health` is invoked only by the explicit operator method and never by boot, status, validation,
  timers, or setup polling.
- Mocked responses cover connected, not-configured, disabled, unreachable, timeout, and mixed per-operation status.
- Protocol/persistence/log snapshots exclude provider, model, endpoint, API key, raw error, and Authorization values.
- Secret rotation/clear invalidates connection evidence and the next request resolves the current value just in time.
- Static checks reject OS/process/Docker/service imports from the Core Hindsight module.
- Runtime selector still selects Canonical Local; canonical `retain`/`recall`/mutation tools and governance bindings are
  unchanged and focused regressions pass.
- Existing legacy migration evidence/tables remain readable and no migration reruns automatically.

### Focused convergence gate

```powershell
pnpm --filter @taki/shared test
pnpm --filter @taki/core test
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm lint
git diff --check
```

Run broader repository gates required by the current backend spec before handoff:

```powershell
pnpm -r typecheck
pnpm -r test
pnpm lint
```

No Rust change is expected. If a Shell/helper module is actually added, also run:

```powershell
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

### Live-service gate

Offline completion does not require a live Hindsight process. When a service is available, the controlled acceptance
sequence is:

1. Verify the deployment identity is the accepted `0.9.0` compatibility build and storage is PostgreSQL.
2. Prove missing and wrong API keys fail, then validate with the correct key.
3. Run Bank/template setup twice and verify stable external IDs and no duplicate Taki-owned objects.
4. Restart the service and verify status/read-back persistence if the owner includes restart acceptance.
5. Run real Bank LLM health only after explicit approval and disclose that it makes provider calls.

Do not start, modify, or clean `H:/hindsight` as part of this Taki implementation without separate authorization.

## Final Review Gate

- PRD acceptance criteria are mapped to tests or the explicit live-service gate.
- Hindsight API claims are rechecked against the accepted OpenAPI/generated client at implementation time.
- Secret sentinel search is clean across diffs, logs, test snapshots, DB fixtures, and protocol fixtures.
- Current Memory Authority and real Agent Memory tool regressions pass.
- `python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-hindsight-connection-setup` passes.
- `git diff --check` passes and the unrelated backup/Hindsight worktree changes remain untouched.
- Run `trellis-check` before requesting commit/finish authorization.
