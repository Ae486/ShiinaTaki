# Hindsight Connection, Secrets, and Setup

## Goal

Provide a safe, provider-neutral connection and setup foundation for the exact Hindsight `0.9.0` compatibility
target. The foundation must let an operator validate an existing Hindsight instance, configure credentials and
non-sensitive model settings, initialize the Global and Character Banks from a versioned Taki template, and obtain
actionable diagnostics without importing existing memory or changing the active Memory Authority.

## Dependencies

- `08-09-hindsight-compatibility-extensions` is accepted and remains the Hindsight wire-contract baseline.
- `08-09-memory-provider-foundation` is accepted and supplies the provider-neutral canonical memory contracts.
- Current Memory Authority remains `canonical-local` throughout this task.

## Requirements

### Connection and compatibility

- Support an authenticated REST/OpenAPI client for Hindsight `0.9.0`.
- Send `Authorization: Bearer <key>` on every Hindsight request, including loopback deployments.
- Reject an absent or unusable API key before treating any endpoint as connected. A healthy anonymous deployment is
  not an acceptable success state.
- Validate, in order, endpoint policy, authentication, `/health`, `/version`, `/ext/taki-memory/version`, and the
  required PostgreSQL capability before setup can continue.
- Accept only base API version `0.9.0`, compatibility version `1.0.0`, compatibility build
  `taki-memory-hindsight-0.9.0-batch0-v2`, and the declared PostgreSQL capability set.
- Treat missing, malformed, incomplete, or unsupported compatibility data as a fail-closed result.
- Use bounded deadlines, cancellation, no implicit redirects, and sanitized structured errors.

### Secrets and configuration

- Store the Core-to-Hindsight API key through the Secret Catalog or an explicitly documented headless secret backend.
- Hindsight's own LLM, embedding, reranker, and database credentials belong to the Hindsight deployment environment or
  its secret manager. When the Managed Helper accepts them from Taki, it consumes Secret Catalog references at its
  privileged boundary; Core setup never resolves or sends those credentials over Hindsight REST.
- Define stable provider-neutral secret references for Hindsight API access and optional Managed Helper model slots;
  never return their values to WS clients.
- Keep endpoint, deployment mode, model identifiers, template revision, health policy, and timeout values in the sparse
  Config Store using `env > stored > default` precedence.
- Never write secrets to config rows, ordinary protocol payloads, logs, memory records, exports, replicas, or UI cache.
- Preserve an existing-instance path when Shell or a managed deployment helper is unavailable.

### Setup and Banks

- Persist connection/setup state in Core-owned SQLite without storing secret values.
- Expose an explicit setup state machine with retryable failure and disabled states; validation failures never mutate
  Memory Authority or begin import.
- Initialize deterministic Global and Character Bank identities through idempotent create/update operations.
- Use a versioned Taki Bank Template envelope. Validate the envelope locally, run Hindsight template import with
  `dry_run=true` before applying it, and make repeated application of the same revision converge without duplication.
- Preserve Hindsight-owned fields and do not delete operator-owned template content merely because it is absent from a
  later Taki template revision.
- Record the applied template digest/revision and external bank identifiers so retries can be audited and resumed.

### Models and diagnostics

- Keep provider/model identifiers and behavior-affecting bank configuration separate from secret references. Existing
  instances treat deployment-level model settings as externally managed; Managed Helper may consume the desired
  identifiers when creating/updating a deployment.
- Provide an explicit Bank LLM health action using `POST /v1/default/banks/{bank_id}/health/llm`. It is deliberate,
  never polling, and returns status-only diagnostics; automated tests must mock it.
- Classify authentication, endpoint, version, extension, database, model, template, timeout, cancellation, and
  deployment-helper failures with stable retry guidance and no secret/raw-provider leakage.

### Deployment boundary

- Existing self-hosted Hindsight is a first-class setup path.
- Managed local deployment is an operator-driven Shell or dedicated deployment-helper contract that returns connection
  metadata; it is not Core-owned Docker, process, service, filesystem, or OS credential execution.
- Core may validate the helper result and connect to the resulting service, but it must not invoke the helper's host
  actions directly from memory setup logic.

## Acceptance Criteria

- [ ] Missing, wrong, and rotated API keys fail closed, including for loopback; anonymous health never becomes connected.
- [ ] The compatibility gate rejects wrong base version, compatibility version/build, missing extension capability, and
  unsupported database capability before bank/template mutation.
- [ ] Secret Catalog set/clear/presence/list and just-in-time resolution are used without value echo or persistence in
  ordinary config, protocol responses, logs, memory, exports, or UI cache.
- [ ] Existing-instance setup works without managed provisioning, while the managed path is represented only by an
  operator/deployment-helper contract.
- [ ] Global and Character Bank initialization is deterministic, repeatable, digest-tracked, and does not duplicate
  directives or mental models.
- [ ] Template dry-run failures leave remote Banks and local setup state unchanged; apply failures are retryable and
  do not switch Memory Authority.
- [ ] Real Bank LLM health is an explicit operator action and its returned data excludes provider, model, endpoint,
  API key, and raw error details.
- [ ] Core performs no Docker, process, service, filesystem, or OS credential operations for this task.
- [ ] `task.py validate` and `git diff --check` pass for the planning artifacts before implementation activation.

## Definition of Done

- Shared contracts, client behavior, setup persistence, and diagnostics have focused unit/contract tests.
- REST/OpenAPI behavior is tested against generated types and mocked HTTP responses for success, refusal, timeout, and
  cancellation paths.
- A controlled live-service gate, including any real LLM health call, is separately identified and never implied by
  offline tests.
- `design.md`, `implement.md`, and both context manifests remain consistent with this PRD and the accepted research.
- No implementation starts until this planning package is reviewed and `task.py start` is explicitly authorized.

## Out of Scope

- Importing existing Memory, replica synchronization, Pending Memory, recovery, or degraded replay.
- Switching Hindsight to Memory Authority, planned switch-back, emergency takeover, or any authority epoch mutation.
- Automatic Recall, Write Gate rewiring, provider-native consolidation integration, or final setup/status UI.
- Core-owned Docker/process/service supervision or direct OS credential operations.
- Support for Hindsight versions other than the exact accepted `0.9.0` compatibility build.
- Oracle or non-PostgreSQL backends in the initial contract.

## Research References

- [`../08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md`](../08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md)
  - exact REST, authentication, Bank/template, model, health, and deployment findings.
- [`../08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md`](../08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md)
  - authority, secret, deployment, and failure-boundary decisions.
- [`../08-09-hindsight-memory-provider/research/taki-memory-integration-seams.md`](../08-09-hindsight-memory-provider/research/taki-memory-integration-seams.md)
  - live Core/Shell/Secret Catalog/Config Store seams and current gaps.
- [`../archive/2026-08/08-09-hindsight-compatibility-extensions/info.md`](../archive/2026-08/08-09-hindsight-compatibility-extensions/info.md)
  - accepted Batch 0 compatibility evidence and residual limits.

## Technical Notes

- Hindsight generated TypeScript operations used by the plan include `/health`, `/version`,
  `/ext/taki-memory/version`, `PUT /v1/default/banks/{bank_id}`, `POST /v1/default/banks/{bank_id}/import` with
  `dry_run`, bank config reads/updates, and `POST /v1/default/banks/{bank_id}/health/llm`.
- The generated Hindsight LLM-health response is status-only per operation (`retain`, `consolidation`, `reflect`);
  the endpoint makes real provider calls and is therefore never an implicit boot check.
- Current Secret Catalog contracts are write-only on the protocol surface; `resolve()` is an internal trusted-consumer
  seam. Current Config Store contracts reject secret writes and keep the table sparse.
- The Hindsight checkout has an unrelated user modification in `hindsight-control-plane/bin/cli.js`; B3 must not touch
  or clean it.
