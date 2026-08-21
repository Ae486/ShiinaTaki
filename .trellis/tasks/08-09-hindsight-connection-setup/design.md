# Hindsight Connection, Secrets, and Setup - Technical Design

> Scope: Batch 3 planning only. This design adds authenticated Hindsight connection/setup contracts and services. It
> does not import Memory, change the active Memory Authority, add replica synchronization, or wire Hindsight into
> foreground Agent execution.

## 1. Context

Batch 0 froze the exact Hindsight compatibility surface and Batch 1/2 established and activated the Canonical Local
Provider. The active runtime is now `canonical-local`; Hindsight is not a provider candidate until connection,
authentication, compatibility, model, Bank, and template setup can be proven independently.

The integration has four constraints that shape this design:

1. Hindsight native `/health` and `/version` are not sufficient authentication evidence. The accepted
   `/ext/taki-memory/version` route is the fail-closed authenticated compatibility handshake.
2. Secrets already have a Core-owned Secret Catalog. Ordinary Config Store rows are sparse and explicitly reject
   secret writes.
3. Hindsight's template import route consumes a raw JSON body, but the `0.9.0` OpenAPI operation omits that body and
   the generated TypeScript type consequently says `body?: never`. B3 must wrap this known contract gap explicitly.
4. Core is OS-neutral and cannot become a Docker, process, service, filesystem, or credential-manager supervisor.

## 2. Goals and Non-goals

### Goals

- A focused, exact Hindsight `0.9.0` REST client with Bearer authentication, deadlines, cancellation, response bounds,
  strict projection, and sanitized errors.
- A compatibility gate that accepts only the frozen Taki compatibility build and PostgreSQL capability.
- Provider-neutral secret references and non-secret Config Store rows.
- Durable, resumable connection/setup state that contains no credential or raw provider error.
- Idempotent Global/Character Bank creation and versioned Taki Bank Template application.
- Existing-instance and managed-deployment-helper contracts with separate ownership.
- Explicit, status-only Bank LLM health checks that are never background polling.

### Non-goals

- Hindsight provider runtime calls for retain/recall/reflect/mutation.
- Memory import, cutover, authority epoch changes, local replica, journal/snapshot sync, or Pending Memory.
- Automatic Recall, Write Gate, maintenance routing, final Home UI, or production deployment automation.
- Broad Hindsight administration or deletion APIs.

## 3. Ownership Boundaries

| Concern | Owner | Boundary |
| --- | --- | --- |
| Operator request/response contracts | `@taki/shared` | Strict zod schemas; no secret values or provider-private payloads. |
| Endpoint/model/template knobs | Core Config Store | Non-secret sparse rows; `env > stored > default`. |
| Core-to-Hindsight API key | Core Secret Catalog / documented headless backend | Resolves only at the HTTP call seam and never crosses WS. |
| Hindsight model/database credentials | Hindsight deployment secret manager; optional Managed Helper input refs | Core REST setup never resolves or sends these values. |
| Hindsight HTTP calls | `HindsightClient` in Core memory integration | OS-neutral fetch only; no process or filesystem actions. |
| Compatibility decision | `HindsightCompatibilityService` | Exact build/capability comparison; fail closed. |
| Setup orchestration | `HindsightSetupService` | Connection validation, Bank/template setup, durable sanitized state. |
| Setup persistence | Core SQLite repositories | Single writer; no secret, template body, or raw HTTP body persistence. |
| Existing Hindsight service | Operator/external deployment | B3 connects to it but does not own its lifecycle. |
| Managed deployment host actions | Shell or dedicated deployment helper | Produces a receipt; Core never executes the host actions. |
| Memory Authority | Existing Canonical Local runtime | Unchanged for all B3 success and failure paths. |

## 4. Shared Contracts

Shared contracts should live in responsibility-split modules under `packages/shared/src/` and be exported explicitly.
All strings, arrays, maps, URLs, diagnostics, and timestamps are bounded.

### 4.1 Connection configuration

```ts
type HindsightDeploymentMode = "existing-instance" | "managed-helper";

interface HindsightConnectionProjection {
  enabled: boolean;
  deploymentMode: HindsightDeploymentMode;
  endpoint: string;
  apiKeySecretRef: string;
  requestTimeoutMs: number;
  setupTimeoutMs: number;
  desiredTemplateRevision: string;
  model: {
    defaultProvider: string | null;
    defaultModel: string | null;
    retainModel: string | null;
    reflectModel: string | null;
    consolidationModel: string | null;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    rerankerProvider: string | null;
    rerankerModel: string | null;
  };
}
```

The projection contains opaque secret references only. The Config Store owns endpoint, deployment mode, timeouts,
desired template revision, and non-secret provider/model identifiers. Environment variables remain the highest
precedence deployment override.

### 4.2 Stable secret references

Use stable, log-safe, provider-neutral references with a dedicated derivation module. The initial vocabulary is:

```text
memory.hindsight.connection.api-key
memory.hindsight.model.default.api-key
memory.hindsight.model.retain.api-key
memory.hindsight.model.reflect.api-key
memory.hindsight.model.consolidation.api-key
memory.hindsight.model.embedding.api-key
memory.hindsight.model.reranker.api-key
```

The connection API-key reference is resolved by Core immediately before an HTTP call. Model-slot references are
optional inputs for the privileged Managed Helper only; Core can report their safe presence but never resolves them or
sends them over Hindsight REST. References are persisted; resolved values are not. A missing or locked connection key
produces a typed setup error before any HTTP request.

### 4.3 Setup state

```ts
type HindsightSetupPhase =
  | "disabled"
  | "unconfigured"
  | "ready-to-validate"
  | "validating"
  | "compatible"
  | "validating-templates"
  | "initializing-banks"
  | "applying-templates"
  | "waiting-template-operations"
  | "configured"
  | "failed";

interface HindsightSetupSnapshot {
  revision: number;
  phase: HindsightSetupPhase;
  lastSuccessfulPhase: HindsightSetupPhase | null;
  configFingerprint: string | null;
  attemptId: string | null;
  compatibility: HindsightCompatibilityProjection | null;
  banks: HindsightBankSetupProjection[];
  modelHealth: "not-run" | "running" | "healthy" | "degraded" | "failed";
  latestError: HindsightSetupError | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
}
```

Changing endpoint, deployment mode, API-key presence generation, accepted version constants, model identifiers, or
template revision changes the fingerprint and makes prior compatibility/setup evidence stale. A secret value is never
part of the fingerprint; the Secret Catalog's safe generation/provenance marker is.

### 4.4 Operator actions

Initial operator-only request/response methods:

- `memory.hindsight.status`
- `memory.hindsight.validate`
- `memory.hindsight.setup`
- `memory.hindsight.llm-health`
- `memory.hindsight.disable`

Every mutating request carries `expectedRevision`; concurrent or stale setup actions fail without starting remote
work. This is an operator surface, not an Agent tool surface. The final UI belongs to the later operations task.

### 4.5 Deployment-helper receipt

```ts
interface HindsightManagedDeploymentReceipt {
  contractVersion: 1;
  helperId: string;
  deploymentId: string;
  endpoint: string;
  status: "ready";
  storage: {
    kind: "external-postgresql" | "embedded-pg0";
    persistent: boolean;
  };
  immutableHindsightIdentity: string;
  observedAt: string;
}
```

The receipt is non-secret and declarative. It has no command, process ID, filesystem path, Docker socket, or arbitrary
environment map. The helper writes credentials through the supported secret path separately. Core validates the
receipt and then runs the same connection path as an existing instance.

## 5. Focused `HindsightClient`

### 5.1 Decision

Use Node 24's HTTP/fetch surface behind an injected transport and implement only the endpoints B3 needs. Do not copy
the entire generated client into TakiAgent and do not depend on the sibling `H:/hindsight` checkout at runtime.
The frozen OpenAPI and generated TypeScript client are contract authorities for request/response tests.

```ts
interface HindsightClient {
  health(context: HindsightCallContext): Promise<HindsightHealthProjection>;
  version(context: HindsightCallContext): Promise<HindsightVersionProjection>;
  compatibility(context: HindsightCallContext): Promise<HindsightCompatibilityManifest>;
  createOrUpdateBank(bankId: string, context: HindsightCallContext): Promise<HindsightBankProjection>;
  importTemplate(
    bankId: string,
    template: HindsightBankTemplateManifest,
    options: { dryRun: boolean },
    context: HindsightCallContext,
  ): Promise<HindsightTemplateImportProjection>;
  exportTemplate(bankId: string, context: HindsightCallContext): Promise<HindsightBankTemplateManifest>;
  bankLlmHealth(bankId: string, context: HindsightCallContext): Promise<HindsightBankLlmHealthProjection>;
}
```

The client owns no retries. Setup orchestration decides whether a whole idempotent stage is retried. This prevents a
transport retry from repeating a call whose outcome is unknown.

### 5.2 Request policy

- Resolve the API key immediately before each logical call and set `Authorization: Bearer <value>` on every request.
- Allow only normalized `http:` or `https:` base URLs with no userinfo, query, or fragment.
- Permit operator-selected loopback/private addresses, but reject unspecified, multicast, and link-local metadata
  targets. Revalidate redirects by disabling automatic redirects entirely.
- Use caller cancellation plus a per-request deadline. Map caller cancellation separately from deadline expiry.
- Bound response bytes before JSON parsing and bound all projected strings/collections with zod.
- Accept only JSON for JSON endpoints. Never place response bodies or request headers in logs.
- Log only operation name, safe endpoint origin, attempt ID, HTTP class, duration bucket, and sanitized error code.

### 5.3 Known OpenAPI exception: template import

Hindsight `0.9.0` reads the template with `await request.json()`, but its OpenAPI operation has no request body and the
generated client emits `body?: never`. `HindsightClient.importTemplate` must therefore issue the raw JSON request
directly with `Content-Type: application/json`. Contract tests must pin both `dry_run=true` and the exact body. This
exception is isolated to one method and documented so a future Hindsight upgrade can retire it when OpenAPI is fixed.

### 5.4 Error normalization

HTTP status and operation context are mapped to stable setup errors. Raw FastAPI `detail`, provider errors, response
HTML, secrets, and model IDs are not propagated. Suggested codes:

| Error code | Meaning | Retry guidance |
| --- | --- | --- |
| `HINDSIGHT_SECRET_UNAVAILABLE` | Required secret absent or catalog locked | Set/unlock secret, then retry. |
| `HINDSIGHT_ENDPOINT_REJECTED` | URL violates endpoint policy | Fix configuration. |
| `HINDSIGHT_UNREACHABLE` | DNS/connect/TLS failure | Check service/network, then retry. |
| `HINDSIGHT_TIMEOUT` | Bounded deadline expired | Check service load or retry explicitly. |
| `HINDSIGHT_CANCELLED` | Operator/caller cancelled | Safe to retry explicitly. |
| `HINDSIGHT_AUTHENTICATION_FAILED` | Compatibility handshake returned 401/403 | Replace key; never retry automatically. |
| `HINDSIGHT_HEALTH_FAILED` | `/health` not healthy/database connected | Repair database/service. |
| `HINDSIGHT_VERSION_UNSUPPORTED` | Base API is not exact `0.9.0` | Use supported deployment. |
| `HINDSIGHT_EXTENSION_UNSUPPORTED` | Manifest missing/wrong/incomplete | Use accepted compatibility build. |
| `HINDSIGHT_DATABASE_UNSUPPORTED` | PostgreSQL capability not supported | Reconfigure deployment. |
| `HINDSIGHT_TEMPLATE_INVALID` | Local or remote dry-run rejected template | Fix/version template. |
| `HINDSIGHT_TEMPLATE_CONFLICT` | Bank changed during import | Refresh and retry stage. |
| `HINDSIGHT_LLM_HEALTH_UNAVAILABLE` | Probe disabled/not configured/unreachable | Fix deployment/model settings. |
| `HINDSIGHT_STATE_CONFLICT` | Expected setup revision is stale | Refresh status before retry. |

## 6. `HindsightCompatibilityService`

Validation is read-only and ordered:

1. Parse and classify endpoint policy.
2. Resolve required API-key presence through the Secret Catalog.
3. Call `/health`; require HTTP 200 and a bounded projection reporting healthy service and connected database.
4. Call `/version`; require `api_version === "0.9.0"`.
5. Call authenticated `/ext/taki-memory/version`; a missing/wrong key fails here even if native health/version were
   publicly readable.
6. Require compatibility version `1.0.0`, compatibility build
   `taki-memory-hindsight-0.9.0-batch0-v2`, supported PostgreSQL database capability, provider lineage, journal,
   snapshot, and every required contract marked supported.
7. Persist only the bounded compatibility projection and its digest.

No Bank, template, model, migration, or authority mutation occurs during validation. A prior valid snapshot is never
silently reused after the configuration fingerprint changes.

## 7. `HindsightSetupService`

### 7.1 Existing-instance flow

1. Operator stores the Hindsight API key and non-secret configuration.
2. `validate` obtains a compatible snapshot.
3. `setup` enumerates the current canonical Global/Character Bank scopes and derives stable external Bank IDs without
   exposing raw Character IDs.
4. Load the built-in Taki template revision, validate it locally, and compute its canonical SHA-256 digest.
5. Run remote `dry_run=true` for every target Bank before any remote mutation.
6. For each target, run idempotent `PUT /v1/default/banks/{bank_id}` with the minimal create/update body, then import
   the same template with `dry_run=false`.
7. Persist each Bank result and any returned mental-model operation IDs. Poll only returned operations with a bounded
   setup deadline; never poll Bank LLM health.
8. Export/read back the Bank template projection and compare the Taki-owned fields/digest expectations. Extra
   operator-owned fields are preserved and do not fail verification.
9. Mark `configured`. Memory Authority remains `canonical-local`.

### 7.2 Managed-helper flow

The helper completes host actions outside Core. At its privileged boundary it may resolve approved model/database
secret references and write them into the Hindsight deployment secret manager; it never returns values to Core. It
then emits a valid `HindsightManagedDeploymentReceipt`. Core verifies the receipt, stores only safe deployment
metadata, and executes the same validation/setup flow as an existing instance. There is no privileged shortcut.

### 7.3 Idempotency and partial failure

- Stable external Bank ID derivation is versioned and test-pinned from canonical Bank scope/identity.
- Hindsight `PUT` create/update converges on the same Bank.
- Template manifest schema version remains Hindsight `"1"`; the Taki template revision/digest is a separate wrapper.
- Mental models match by stable ID and directives by stable name, matching native import semantics.
- All Bank dry-runs finish before the first mutation, preventing avoidable partial setup.
- If an apply step fails after earlier Banks succeeded, persist per-Bank state and resume only incomplete/outdated
  targets. Do not delete a Bank as rollback; deletion could destroy operator data.
- Reapplying the same digest is a verification/no-op path unless remote drift is detected.
- A newer Taki template updates only Taki-owned objects/fields. Omitted remote objects are not deleted.

### 7.4 Disable and retry

- `disable` stops future setup/runtime eligibility but does not clear secrets or remote Banks implicitly.
- Secret clear is a separate explicit operation through `secret.clear` and invalidates connection evidence.
- Retry starts from the last safe completed stage only when the configuration fingerprint still matches.
- A changed fingerprint discards resumability evidence and requires fresh validation.
- No B3 failure triggers fallback, cutover, or authority change because Hindsight is not yet active.

## 8. Bank Template

The repository owns a versioned, immutable Taki wrapper around a Hindsight Bank Template manifest:

```ts
interface TakiHindsightBankTemplate {
  takiTemplateRevision: string;
  hindsightManifestVersion: "1";
  ownership: {
    configKeys: string[];
    mentalModelIds: string[];
    directiveNames: string[];
  };
  manifest: HindsightBankTemplateManifest;
}
```

The manifest contains no credentials, endpoint, database URL, filesystem path, or infrastructure identifier. Model
provider selection remains deployment-level unless the exact Hindsight safe-field policy permits a behavior field.
The template may contain Taki missions, controlled labels, safe Bank behavior, directives, and optional stable mental
models. Returned async operation IDs are job-control evidence only and never canonical Memory state.

## 9. Model Configuration and Health

Provider/model/base-URL identifiers are non-secret desired deployment configuration. For an existing instance they are
expectations/diagnostic metadata only: B3 does not rewrite static Hindsight server configuration through Bank APIs.
For a Managed Helper they are explicit deployment inputs. Hindsight model/database credentials stay in the deployment
secret manager; any Taki Secret Catalog references are resolved only by the helper, never by Core REST setup.

`memory.hindsight.llm-health` is an explicit operator action:

- it is never run on boot, on a timer, during ordinary status reads, or as hidden validation;
- the request clearly indicates that Hindsight will make real provider calls;
- it can target one Bank or every configured Bank sequentially under a total deadline;
- output contains only Bank ID, operation, `ok`, normalized status, and bounded latency;
- provider, model, endpoint, API key, and raw error are prohibited in protocol and persistence;
- offline tests mock the endpoint; a real call is a separate controlled acceptance gate.

## 10. Persistence

Additive Core SQLite ownership is split into two repositories:

### `hindsight_connection_state`

Singleton fields: revision, phase, last successful phase, config fingerprint, attempt ID, bounded compatibility JSON,
latest safe error code, attempt/success timestamps, and update timestamp.

### `hindsight_bank_setup`

One row per canonical Bank binding: canonical scope identity, external Bank ID, Taki template revision/digest, setup
status, bounded returned operation IDs, last verified timestamp, and last safe error code.

Constraints:

- no secret values, request headers, raw HTTP bodies, raw provider errors, or full template bodies;
- JSON columns have validity checks and are reparsed with shared schemas;
- writes use expected revision and transactions;
- connection state cannot say `configured` while any required Bank is incomplete;
- migrations are additive and do not alter canonical Memory Authority tables.

## 11. Security and Privacy

- All setup methods are operator-only and never exposed as Agent tools.
- Endpoint policy prevents userinfo leakage, redirects, unsupported schemes, and metadata/link-local targets while
  retaining explicit loopback/private-network support.
- Secret values exist only in the Secret Catalog and the immediate request construction scope.
- Tests use sentinel secrets and assert their absence from errors, logs, state rows, snapshots, exports, and cacheable
  protocol results.
- Template content is trusted repository configuration; imported/exported remote content is bounded and never injected
  into an Agent prompt by B3.
- Diagnostics disclose safe origin and error class, not query strings, credentials, provider responses, or memory.

## 12. Observability

Structured logs and status expose:

- setup attempt ID and phase;
- safe endpoint origin and deployment mode;
- compatibility version/build and support decision;
- per-Bank setup state and template revision/digest prefix;
- operation name, duration bucket, retryability, and stable error code.

They never expose secret refs when avoidable, secret values, raw template bodies, provider/model credentials, raw
response bodies, or Memory content.

## 13. Alternatives and Tradeoffs

### Import the full generated Hindsight client

Rejected for B3. It would add a broad generated surface and still fails to type the raw JSON template import body.
A focused client is smaller and can pin the known `0.9.0` exception explicitly.

### Treat `/health` as connection success

Rejected. Native health may be publicly readable and says nothing about the required extension contracts or API key.

### Let Core launch Docker or write OS credentials

Rejected by Core OS-neutrality and capability ownership. Managed provisioning remains an external operator/helper flow.

### Roll back partial setup by deleting Banks

Rejected because Bank deletion is destructive and could erase operator-owned data. Durable per-Bank resume is safer.

### Run LLM health automatically

Rejected because the endpoint makes real provider calls and may cost money. It remains a deliberate action.

## 14. Test Matrix

| Area | Automated evidence |
| --- | --- |
| Shared contracts | Strict schemas, bounds, expected revision, secret-free results, state invariants. |
| Endpoint policy | Scheme/userinfo/query/fragment/redirect/address classification and loopback acceptance. |
| Client | Bearer on every call, body/response bounds, JSON/content-type, timeout, cancellation, sanitized errors. |
| Compatibility | Exact success plus every version/build/contract/database/auth failure. |
| Template exception | Raw JSON body and `dry_run` query despite generated `body?: never`. |
| Persistence | Migration, CAS, reopen, stale fingerprint, no-secret-at-rest, configured-state constraints. |
| Setup | All dry-runs before mutation, deterministic IDs, repeat apply, partial resume, drift verification. |
| Secret handling | Missing/locked/rotated/cleared secret; sentinel absent from all outputs and logs. |
| Deployment | Existing path without helper; managed receipt validation; no Core OS-process imports. |
| LLM health | Explicit-only call, status projection, disabled/not-configured/unreachable cases, no polling. |
| Regression | Canonical Local Authority and Agent Memory tools remain unchanged and functional. |

Live acceptance is limited to state that mocks cannot prove: connecting to an actual accepted Hindsight build and,
only with explicit approval, making the real Bank LLM health call. Neither is required to prove offline correctness.

## 15. Expected File Map

Exact file splits may adjust to stay within project size limits, but responsibility should converge around:

```text
packages/shared/src/hindsight-connection-schema.ts
packages/shared/src/hindsight-setup-schema.ts
packages/core/src/memory/hindsight/hindsight-client.ts
packages/core/src/memory/hindsight/hindsight-contracts.ts
packages/core/src/memory/hindsight/hindsight-compatibility-service.ts
packages/core/src/memory/hindsight/hindsight-setup-service.ts
packages/core/src/memory/hindsight/hindsight-secret-refs.ts
packages/core/src/memory/hindsight/hindsight-endpoint-policy.ts
packages/core/src/memory/hindsight/taki-bank-template-v1.ts
packages/core/src/db/hindsight-connection-repo.ts
packages/core/src/db/hindsight-bank-setup-repo.ts
packages/core/src/db/migrations/<next>-hindsight-connection-setup.ts
packages/core/src/server/methods/hindsight-setup-methods.ts
```

Every touched production directory must update its `index.md`. No Hindsight runtime provider is registered in the
active Memory Coordinator during B3.
