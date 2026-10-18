# C1 source research excerpt source-host-1

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md`. SHA-256: `e9cab382d8754a55516c31310aaaf0ccbf8fe45b368ea27ea028d63b7c6fc1dd`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

# Research: Stage 5C managed deployment, Host ownership, and model application

- Query: Identify the minimum reusable Host/Shell execution and secret-custody path for managed Hindsight deployment and real model apply/readback, without making Core platform-dependent.
- Scope: internal; source-only inspection of `H:/TakiAgent` and `H:/hindsight`. No tests, builds, model calls, service operations, credentials, original databases, Git commands, or production edits.
- Date: 2026-10-07.
- Active task: `.trellis/tasks/10-07-hindsight-configuration-observation`, explicitly supplied by the leader. The legacy `.trellis/.current-task` file was empty; workflow documents session-scoped routing. This report does not change task state.
- Coordination: 5A production implementation and 5B template research were active concurrently. Native line references are a source-reading snapshot and may move as 5A changes land.

## Findings

### 1. Decision summary

Stage 5C is a substantial cross-boundary deliverable, not a small extension of 5A. Reuse the existing Host broker, canonical governance, encrypted Secret Catalog, memory operation owner, and setup/activation services. Add a narrowly scoped deployment helper and trusted receipt admission; do not build provisioning by composing the generic `exec` tool in Core.

Recommended first managed topology: one explicitly selected Windows host, its existing Rust Shell, an operator-installed helper, an accepted immutable Hindsight container artifact, and a new owned persistent volume. Core and the provider-secret catalog should be co-located with that helper for the first slice; the existing store cannot transparently serve a remote Shell. Existing-instance setup remains independent of every helper step.

The Windows-first constraint does not make Ubuntu Core unsupported. Ubuntu/headless existing-instance setup already has the necessary platform-neutral Core and systemd credential seam. A production headless managed Host is additional work: the current `taki-node` binary is a debug-only test harness and explicitly exits in release. Do not label it a supported Ubuntu deployment agent.

Implement and check 5C in separate milestones: (1) helper identity/Host permission/secret custody, (2) isolated deployment and receipt recovery, (3) real model application/readback and minimal Home integration. Data-bearing model changes require a fourth explicit migration/recovery sub-slice if included in the promised model-management lifecycle. Combining all of 5A, 5B, and 5C into one final check would hide materially different trust and recovery boundaries.

### 2. Accepted requirements and existing foundation

The parent `.trellis/tasks/08-09-hindsight-memory-provider/prd.md`, R9/R10, requires progressive setup, secret-safe configuration, Windows and Ubuntu/headless backends, Shell/helper ownership of process/Docker/filesystem/service management, and an independently usable existing-instance path. The Stage 5 allocation and residual scope are in `.trellis/tasks/09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md`, sections 3.1/3.2 and 4. These are the requirements; historical statements that the secret backend is wholly absent are superseded by current code below.

| Current source | What exists | Consequence for 5C |
| --- | --- | --- |
| `packages/shared/src/hindsight-setup-schema.ts:58-70` | `HindsightManagedDeploymentReceiptSchema`: version, helper/deployment IDs, endpoint, `ready`, persistent `external-postgresql` or `embedded-pg0`, immutable identity, timestamp. | Reuse the setup seam, but the current receipt is only a supplied assertion. |
| `packages/core/src/memory/hindsight/hindsight-setup-service.ts:213-228` | Existing-instance mode rejects a receipt and proceeds independently. Managed mode checks schema, matching endpoint, bounded age and an identity string not containing `latest`. | No installed-helper lookup, Host provenance, image digest verification, request binding, or persistent storage inspection is established here. Add trusted producer admission before claiming managed readiness. |
| `packages/core/src/memory/operations/memory-operation-kind-setup.ts:30` | Passes the requested receipt to the setup producer. | A durable operation does not make caller-supplied receipt content trustworthy. |
| `packages/core/src/config/hindsight-config.ts:18-36` | Non-secret desired connection and model projection. | It is intention, not application. The current per-operation fields hold model names; they do not independently encode per-operation providers or endpoints. |
| `packages/core/src/memory/hindsight/hindsight-secret-refs.ts:9-27` | Seven stable refs: connection key plus default/retain/reflect/consolidation/embedding/reranker keys. Only the connection key has a production trusted resolver. | A model ref is not a deployed secret. Add a Host-owned consumer with exact custody, not a general `secret.get` method. |

Important current snippet:

```typescript
// hindsight-setup-service.ts:223-228
const receipt = HindsightManagedDeploymentReceiptSchema.parse(params.managedReceipt);
const age = Date.parse(observedAt) - Date.parse(receipt.observedAt);
// Endpoint, age, and non-latest identity checks; then return connection.
```

This is a source gap in proof strength, not evidence of an exploited vulnerability. Authenticated Native compatibility and setup checks still run separately. Preserve them.

### 3. Host execution, package, and permission ownership

#### 3.1 Reusable production path

- `packages/core/src/capabilities/route-capability.ts:48-93` resolves the explicit Host, checks governance descriptor/classifier revisions, and dispatches through the broker with connection/catalog/policy generations and operator context. `:119-133` refuses ambiguous routing; it never selects the first Host silently.
- `apps/desktop/src-tauri/src/node.rs:50` lists default capabilities; `:103-110` registers screenshot, process list, clipboard, shell-open, exec and foreground-window executors. Exact source search under `src-tauri/src` found no Hindsight/managed-deployment handler.
- `apps/desktop/src-tauri/src/ws_client.rs:704-727` publishes the supported read/effect descriptors and classifier identity. A new deployment capability needs both its handler and catalog/governance registration; adding one Rust module alone is insufficient.
- `apps/desktop/src-tauri/src/capabilities_impl.rs:34-44,78-103` provides the blocking `CapabilityExec` registry and bounded response seam. Long deployment work must expose durable helper observation/reconciliation; a blocking response cache cannot prove recovery after restart.
- `apps/desktop/src-tauri/src/capabilities_impl/exec.rs:38-43,57-60` accepts a raw command and returns captured output. The command has an audit/detail path. Never put provider keys or database URLs into this generic channel.
- `.trellis/spec/backend/host-operation-lifecycle.md` requires exact Host/run/attempt/input identity, generation-bound settlement, `outcome_unknown` after unknowable effects, and explicit revalidation/resume rather than reconnect replay.

#### 3.2 Concrete ownership recommendation

1. **Shared contract owner:** strict operator deployment intent, Host capability input/result, helper status/receipt, error categories and TS/Rust fixtures. Carry non-secret settings and opaque refs only. Distinguish inspect/prepare/start/reconcile; arbitrary commands, arbitrary environment maps and arbitrary filesystem paths are not a deployment API.
2. **Rust Shell owner:** canonical permission enforcement, explicit target Host, installed helper resolution, bounded invocation, sanitized errors, local input classification, final check before dispatch. A dedicated operator-only deployment capability should not be advertised as a new model tool. Register its governance descriptor and Host catalog entry together.
3. **Helper owner:** all Docker/process/storage work, deployment-local lock and journal, resource ownership checks, config generation/application, Native startup and exact result inspection. New helper code belongs outside `packages/core`; a separate package/entrypoint may reuse narrowly extracted platform-neutral secret codecs without importing Core boot or gaining Core DB write access.
4. **Core owner:** authenticated connection/compatibility, operation admission/status, original request and receipt binding, safe reconciliation, desired-versus-observed configuration, existing setup and authority activation. Do not add a third general spawn exception to Core. `docs/adr/0006-mcp-processes-vs-no-os-invariant.md:11-16` grants the existing key-bootstrap exception only, not deployment management.
5. **Home owner:** select the target/deployment input, display real prerequisite and operation states, submit sensitive values only through a write-only path, and render original operation results after reconnect. `apps/desktop/src-tauri/capabilities/home.json:5-6` currently grants only event access; any local helper/secret IPC must add its exact permission deliberately. Browser operator WS can remain the normal non-secret control path.

#### 3.3 Installed artifact identity is a required deliverable

`apps/desktop/src-tauri/Cargo.toml:17-27` declares `taki-node` and `taki-secret-key`; it declares no deployment helper. `apps/desktop/src-tauri/tauri.conf.json` has no `bundle.externalBin` or helper resource entry. `package.json:16` delegates `desktop:build` to Tauri. These source declarations do not prove a working installed key-helper path.

Publish one explicit helper installation manifest with helper protocol/version, executable or entrypoint identity/digest, required runtime if any, supported platform, and supported Native artifact identities. Resolve from the installed application/helper location, not a development checkout or mutable PATH. Validate the actual installed artifact before advertising the capability. If the helper uses the existing Node/libsodium codec, ship its runtime/dependencies and identity as part of that manifest; do not assume the user's development Node installation exists.

Keep separate identities for the helper, Native image digest, Native public compatibility build/contracts, deployment, physical Host, catalog store, and configuration generation. A self-reported build string or helper ID is not interchangeable with an installed-artifact digest. Reuse the accepted Hindsight `0.9.0` compatibility line, then pin the actual reviewed artifact after 5A changes settle; no new external version/digest is selected by this report.

