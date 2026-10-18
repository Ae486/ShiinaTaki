# Research: Stage 5 configuration observation producer and authorization contract

- Query: Can the first B7/Stage 5 slice truthfully inspect an existing Native instance's model configuration without bypassing Native's intentional configuration confidentiality?
- Scope: internal; current Taki source and read-only local Native dependency source. Narrow follow-up to `stage5-readiness-2026-10-07.md`, not a repeated inventory.
- Date: 2026-10-07
- Task: `.trellis/tasks/09-29-hindsight-transitions-emergency`, supplied by the parent. No lifecycle change.

## Findings

### 1. Recommendation and real approval boundary

**Recommend a new, optional, default-denied Native configuration-observation capability, authorized by the Native deployment administrator for exact namespace/Bank pairs.** Core uses the existing tenant credential only after that explicit disclosure grant; it never interprets a tenant key as an administrator credential. The endpoint describes the already constructed API runtime's bounded model profiles. Core compares that evidence with desired Taki settings and Home presents evidence coverage, mismatch and unknown separately from connectivity health and activation readiness.

This is implementable without managed provisioning, a new secret type, a general admin API, a process-inspection helper, model calls, or changing ordinary Bank configuration/health responses. It is nevertheless a **new disclosure audience/policy**: holders of an authorized Native tenant key gain access to the approved model identity projection for the granted Banks; Taki operators behind that Core can then view it. R9 requests model setup, but the existing source intentionally withholds model identity. The parent should obtain final owner review of this concrete opt-in disclosure boundary before dispatching Native changes. This report does not authorize those edits.

The proposal is deliberately an **API-runtime configuration observation**, not a certificate for every process in a deployment. Standalone workers construct separate engines (`worker/main.py:237-267`); load-balanced API processes may also differ. Worker/fleet configuration coverage must remain `unknown` in 5A. Single-profile LLM identity is supported; multi-provider/router identity, arbitrary custom providers, and embedding/reranker model identity remain explicitly unknown in this bounded slice. This is a C02/C12 subset and cannot close complete Native model configuration or full setup readiness.

If this disclosure is declined, start the already accepted versioned-template lifecycle slice after its own narrow semantics research and artifact review. Do not substitute tenant GET/config, health, an operator-entered assertion, or a settings fingerprint for actual model evidence. Template work can proceed without choosing a new model-disclosure policy.

### 2. What current authentication actually proves

Native paths in this report are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/` unless prefixed otherwise.

| Source | Verified contract and consequence |
| --- | --- |
| `models.py:15-30` | `RequestContext` carries `api_key`, optional key/tenant IDs, internal/MCP flags, and `allowed_bank_ids`. It has no administrator role or model-configuration disclosure permission. |
| `api/dependencies.py:18-33` | Ordinary and compatibility dependencies extract credentials into a fresh request context. HTTP clients cannot set `internal`, tenant ID, or an administrator flag through the documented context dependency. |
| `extensions/tenant.py:24-34,72-95` | Authentication returns a schema name. `requires_authentication` defaults to false; it is a compatibility capability declaration, not administrator authorization. |
| `extensions/builtin/tenant.py:49-85` | Built-in `ApiKeyTenantExtension` compares one configured key and returns the configured schema. All holders have the same tenant identity; no distinct privileged key exists. The no-auth default at `:8-42` is unsuitable. |
| `engine/memory_engine.py:1764-1802` | `_authenticate_tenant` installs schema isolation using a context variable. Internal/MCP-authenticated requests bypass extension authentication; the new external route must use the fresh Bearer context and must not manufacture those bypass flags. |
| `extensions/tenant.py:134-157` | `get_allowed_config_fields` controls ordinary configurable-field access; `None` means all *configurable* fields. It does not grant access to model identity. |
| `engine/memory_engine.py:11673-11690`; `extensions/operation_validator.py:856-872` | Bank-config reads authenticate, then call `validate_bank_read(GET_BANK_CONFIG)` if a validator exists. The base validator accepts. Reuse that access check, but add independent positive disclosure authorization and explicit `allowed_bank_ids` enforcement. |
| `config.py:2572-2625`; `config_resolver.py:161-200` | Credentials, infrastructure and provider/model fields are intentionally excluded from ordinary configuration responses. Keep these contracts unchanged. |
| `config_resolver.py:89-105,203-223` | Tenant override and permission lookup exceptions currently fall back/log. That behavior must not be copied into the new disclosure grant: lookup failure must deny with bounded diagnostics. |

The existing authenticated compatibility router is the right transport seam: `extensions/builtin/taki_memory.py:63-79` delegates the version request to the same engine, and `engine/memory_engine.py:1804-1820` authenticates before probing. A compatibility manifest alone does not authorize extra confidential reads.

Core already provides the second, independent boundary: `packages/core/src/server/methods/hindsight-setup-methods.ts:29-50` registers operator-only methods, and `packages/core/src/server/method-registry.ts:88-99` rejects an authenticated wrong role. `.trellis/spec/backend/server-push-and-connection-auth.md` explicitly distinguishes connection identity, governance and Host enforcement. Being a Taki operator grants no Native administrator privilege.

### 3. Exact producer and the limits of its evidence

| Evidence | Real producer / proposed extraction | Meaning and limit |
| --- | --- | --- |
| Default/retain/reflect/consolidation LLM profiles | Engine objects `_llm_config`, `_retain_llm_config`, `_reflect_llm_config`, `_consolidation_llm_config`; construction at `engine/memory_engine.py:1333-1342,1442-1468,1472-1508,1511-1547,1550-1587` | Observe the objects already used by this engine. Constructor arguments can override environment values, so reparsing `HindsightConfig.from_env()` is not equivalent evidence. |
| Applicability to an authorized Bank | `engine/llm_wrapper.py:1313-1354` and `engine/multi_llm.py:169-192` | `with_config` applies Bank behavior such as Gemini safety settings without replacing the long-lived provider/model. Identity is therefore the authenticated Bank's profile in this API engine, not a claim that static fields are tenant-customizable. Do not serialize the resolved full Bank config. |
| Multi/provider routing | `engine/multi_llm.py:82-101,194-204` | `provider`/`model` attribute passthrough describes member zero, not the actual future route. Detect `MultiLLMProvider` before property access; return `unknown/routed_profile`, without enumerating members, strategy details or counting a primary as unique. Treat LiteLLM router and other unresolved gateway selection as configured aliases/unknown, not a proven upstream model. |
| Embedding and reranker | `engine/embeddings.py:85-111,1607-1638`; `engine/search/reranking.py:203-214`; `engine/cross_encoder.py:49-79,1831-1848` | Existing providers have `provider_name`, but no common safe model-description contract. ONNX may use a host path, TEI identity may require remote metadata, custom injected implementations differ, and rerankers may be chains. 5A returns typed `unknown/not_covered` for these model identities. Do not read paths or trigger initialization/metadata/model requests. |
| Source/build identity | `engine/taki_compatibility.py:32-38,71-83,415-446` | Existing manifest exposes maintained source/build plus database lineage. Reuse it and the lineage read in the authenticated schema. The source comments require a build identity bump for behavioral/patch changes. |
| Bank incarnation | `engine/replication.py:303-324,328-373` | Existing lineage and `replication_bank_state.bank_generation` are real identity material. Read them without mutation. `ensure_replication_bank_state` performs INSERT, so it must not be called by this read-only producer. Use a small SELECT joining the live Bank and its existing state; absent/deleted/mismatched rows yield unavailable. |
| Actual running process | New random immutable `runtimeSessionId` created once per engine initialization, emitted by the bound engine | This is an opaque process-session observation ID, not a durable installation ID. It distinguishes observations across restarts/API replicas, without exposing PID, host name, paths or deployment endpoints. |
| Workers/fleet | `worker/main.py:220-267`; `engine/memory_engine.py:1593-1602` | Standalone workers have a separate `MemoryEngine` and execute polled work. An API response cannot attest their config. Emit `executionCoverage: api_runtime_only`, `workerConfiguration: unknown`; no activation-wide success derives from it. |

`engine/memory_engine.py:13310-13352` deliberately probes connectivity and returns status only. It may make model calls. Reading configuration must not invoke it or reuse a previous healthy probe as model identity proof. Similarly, `packages/core/src/memory/hindsight/hindsight-compatibility-service.ts:112-127` hashes local connection settings/model hints/secret markers, not observed Native configuration.

### 4. Proposed Native permission contract

The following identifiers are proposed implementation contracts, not currently installed APIs.

1. Add `TenantExtension.authorize_taki_configuration_observation(context, *, schema_name, bank_id) -> bool`, **default false**. `schema_name` is the trusted return from `_authenticate_tenant`, never client input. Missing hook, false, unexpected return type or any exception denies. Keep `get_allowed_config_fields` unchanged.
2. For the built-in `ApiKeyTenantExtension`, add one deployment-owned optional JSON setting, `HINDSIGHT_API_TENANT_TAKI_CONFIGURATION_OBSERVATION_GRANTS`, mapping exact schema names to finite explicit Bank ID arrays. No wildcard, implicit all-Banks, or default schema expansion. Missing/empty means no disclosure. Invalid configuration must not enable the capability or echo its raw value. The existing loader collects prefixed extension configuration (`extensions/loader.py:24-37,89-98`). Custom tenant extensions remain denied until they explicitly implement the hook for their authenticated principal.
3. The built-in grant authorizes holders of its existing validated tenant key for those exact pairs. Document that audience candidly. It is **not** a new administrator credential, and Core cannot set grants through the tenant API. Grant changes are Native administrator deployment configuration with the usual restart/reload ownership. Removing a grant prevents future observations; it cannot retract already disclosed knowledge.
4. Proposed `GET /ext/taki-memory/banks/{bank_id}/configuration-observation?nonce=<uuid>` uses the actual compatibility mount (`api/http.py:3680-3685`) and `get_bearer_request_context`; authenticate; require authenticated compatibility support; check `allowed_bank_ids` if present; run the existing `GET_BANK_CONFIG` validator; require the new positive grant; only then read Bank existence/identity and construct the projection. Reject internal/MCP bypass contexts at the external producer boundary as defense in depth. Never enumerate grants or other namespaces in replies.
5. Keep ungranted/forbidden replies generic and value-free. Do not distinguish non-existent Banks before authorization. Explicitly route errors to fixed envelopes so extension exceptions, validation input or model objects cannot enter HTTP/Core/UI logs or responses. New permission checks fail closed even though legacy configurable-field filtering may fall back.
6. The grant is separate from capability discovery. Manifest `contracts.configuration_observation` announces implemented version/support, not universal permission for the requesting principal. An implementation can be available while a Bank read returns `not_authorized`.

This requires Native deployment-owner opt-in on an **existing** installation; it does not require Taki-managed installation or any Shell provisioner. Existing connection, health, Bank setup and already delivered operation paths retain their existing admission semantics when observation is unavailable. Home shows the missing evidence; 5A must not silently turn this optional capability into a new authority or activation gate.

### 5. Proposed strict wire and Core projection

Use a small new Pydantic model module in Native and a matching strict Shared schema. Do not add arbitrary dictionaries, a raw `config`, or serialize dataclasses/provider objects.

```text
NativeConfigurationObservationV1
  version: "1.0.0"
  nonce: UUID                         # exact Core challenge echo
  observedAt: UTC timestamp
  source: { upstreamCommit, compatibilityBuild }
  target: { providerLineage: UUID, bankId, bankGeneration: UUID }
  runtimeSessionId: UUID
  executionCoverage: "api_runtime_only"
  profiles: fixed four entries keyed by default | retain | reflect | consolidation
    identified: { kind: "single", provider, configuredModel }
    disabled:   { kind: "disabled" }  # actual provider none
    unknown:    { kind: "unknown", reason: routed_profile | unsupported_provider | unsafe_identifier | unavailable }
  embedding: { kind: "unknown", reason: "not_covered" }
  reranker:  { kind: "unknown", reason: "not_covered" }
  workerConfiguration: "unknown"
```

`configuredModel` means the configured model identifier/alias in this runtime, **not** proof of the model an upstream gateway actually executed. Only direct, explicitly recognized standard LLMProvider objects may yield `identified`; unknown subclasses/routers must not be guessed by introspecting arbitrary attributes. Whitelist provider identifiers and bound model text (240 characters). Refuse control characters, URI forms, absolute paths and unsafe identifiers; show unknown rather than partially redacting a path or serializing an exception. Ordinary model aliases such as namespace/model remain valid. Never output credentials/presence, endpoints, headers, tenant secrets, failover-member structures, prompts, full Bank configuration or raw errors.

Core adds its own envelope, not sent back as Native truth:

- Captured connection fingerprint/secret revision, setup revision if present, authority epoch if present, Core observation ID, received time and local validity deadline.
- Native observation status: `not_observed | observed | unsupported | not_authorized | unavailable | stale | identity_mismatch`. All error reasons come from a bounded enum. `observed` does not mean every profile is identified.
- Desired-settings comparison per covered field: `match | mismatch | not_requested | unknown`. Null desired values mean no preference; they are not mismatches. Default-provider hints do not assert an operation-specific provider where the desired schema has none (`hindsight-connection-schema.ts:23-32`).
- Overall evidence coverage is partial whenever embedding/reranker/worker or routed profiles are unknown. Health remains the existing independent explicit model-health result. Setup/authority readiness stays producer-derived, not inferred from matches.

Suggested Core methods: `memory.hindsight.configuration.observe` with a Global/Character scope selector (Core derives the Native Bank ID), and `memory.hindsight.configuration.status` for the latest sanitized in-process observations. Both are operator-only. Do not expose this as an Agent tool or accept operator-authored evidence/model objects. One observation requests one Bank and has a bounded response/deadline. Home may refresh a bounded visible Bank selection; avoid implicit whole-deployment fan-out.

### 6. Freshness, identity, restart and failure rules

- A request captures the current Core connection fingerprint and selected scope; Core mints a nonce; Native returns that nonce with live engine and current read-only Bank identity. Capture/recheck connection/secret/scope and authority selection around the await. An obsolete response cannot overwrite a newer observation.
- Verify the response's exact supported build/capability, lineage and Bank identity against Core's available setup/active-Bank facts. Under active Hindsight authority, mismatched lineage/generation is `identity_mismatch`; under setup, no existing pin is truthfully unpinned first observation. Do not create setup readiness, repair mappings or adopt a new authority from this read.
- Native lineage is database lineage, not a unique installation ID: a restored candidate may share it. Bind the observation to the current configured connection and runtime session as well. A session change invalidates previous runtime observations; it is not proof of hostile replacement or permission to switch authority. No installation-wide guarantee is available from this evidence.
- Use a short explicit Core-local observation window (proposed 60 seconds), based on monotonic elapsed time, rather than trusting Native wall-clock equality. `observedAt` is display/evidence metadata. Expired evidence stays last-observed with `stale`; it never silently remains current. A fresh request is still only an observation, not a future configuration lock.
- Native must use `Cache-Control: no-store`; Core checks the exact nonce and rejects malformed/oversized responses. This is freshness/correlation over the existing authenticated transport, not remote hardware attestation. Keep TLS/endpoint trust at the existing connection boundary.
- Keep the first slice's read cache in Core memory, keyed by captured connection/scope. No migration or durable operation journal is required for a bounded no-side-effect read. Core restart makes it `not_observed`; Home reconnect/remount reads Core state and may issue an idempotent fresh observation. Two authenticated observers share Core truth; no browser-local evidence persistence. Core coalesces a concurrent same-target observation and publishes a dedicated invalidation only if a real producer is implemented; otherwise use one-shot reads, as the server-push spec requires.
- On a newer failed/denied read, old model strings must not continue as current evidence. Drop them from the normal current projection and retain only bounded diagnostic state. Permission revocation within a cache window cannot retract a previous disclosure; fresh reads enforce the current grant. No periodic model probe, deployment change or mutation retry is coupled to refresh.
- Distinguish optional-capability absence, permission refusal, transport/auth failure, unreadable Bank identity, malformed observation and partial model coverage. Existing-instance operations remain independently usable; none of these statuses is automatically a destructive remediation or provider switch.

### 7. Why an admin-owned attestation is not the smaller first implementation

`admin/cli.py:458-490,522-548` uses `HindsightConfig.from_env()` and direct database credentials for maintenance. It does not interrogate the running engine or expose an existing signed configuration-observation protocol. The Taki backup proof is about durable data identity, not the actual runtime's model objects. A command run under a different shell/container environment cannot establish those objects, and it must not start a second engine merely to inspect one (initialization can initialize models/perform health work).

An administrator-installed producer **could** preserve existing-instance independence, but it would need a genuine live-runtime observation channel, authenticated binding to the target, Core challenge, expiry and trust/key custody. A static JSON upload signed by a newly introduced admin key would still describe the signer assertion unless the collection mechanism proves the actual process. Unsigned operator JSON or an environment hash cannot be called verified Native configuration. A new local socket/helper plus signed remote import is a larger permission/deployment surface than the explicit Native grant above; defer it to managed deployment/worker attestation research if that product need is later selected.

### 8. Child task boundaries ready for parent artifacts

**Proposed PRD outcome:** An operator inspects a configured existing instance's selected Bank in Home and sees the API runtime's permitted single-LLM model identifiers, desired-versus-observed comparison, source time/coverage, and truthful unsupported/denied/stale/unknown states. Inspection does not invoke models or alter deployment, Bank configuration, setup readiness, authority, secret custody or operations. Connecting an existing instance still works without any managed helper.

**Ownership / affected files:**

| Serial owner | Expected files and responsibility |
| --- | --- |
| Native producer and privilege owner | New `engine/taki_configuration_observation.py` and strict model module; engine public delegate in `engine/memory_engine.py`; `extensions/tenant.py`, opt-in in `extensions/builtin/tenant.py`; route in the compatibility router; `engine/taki_compatibility.py` version declaration. No ordinary `get_bank_config` exposure change. New in-memory runtime session only; no DB migration. |
| Shared/Core owner | New `packages/shared/src/hindsight-configuration-observation-schema.ts`, exports/schema tests; optional capability in `hindsight-connection-schema.ts`; `hindsight-client.ts` bounded method; focused new service and operator method module; setup boot composition plus any Core config-change invalidation. Reuse `hindsight-secret-refs.ts` internally for tenant credentials. No OS/process code. |
| Home owner | Focused card/hook under `apps/desktop/src/windows/home/pages/operations/`, mounted by `operations-page.tsx`; existing connection-generation and request timeout conventions. Keep secrets and implementation identifiers out of normal user decisions. Detailed source identity may be diagnostic disclosure. |
| Compatibility/release owner | Native patch ledger/OpenAPI/generated artifacts where repository rules require them; coordinated exact accepted-build/capability predicates and tests, including `hindsight-compatibility-service.ts`, `hindsight-transition-capability.ts`, `hindsight-transition-source-capability.ts`. Preserve established fingerprints/historical receipts instead of blindly replacing constants embedded in their identity. |

Proposed execution order: (1) owner reviews the explicit disclosure audience and bounded coverage; (2) parent writes/activates the child with Native edit scope separately made explicit; (3) define strict schemas plus default-deny authorization/producer fixtures; (4) implement Native route and capability/version rollout; (5) implement Core and Home vertical path; (6) independent confidentiality/identity/no-side-effect review and focused verification. This is one serial cross-repository slice; do not concurrently edit the Shared exports, compatibility predicates or boot composition with another slice.

Capability rollout is optional and independently negotiated. Use `configuration_observation` version `1.0.0`, available only on a new tested Native patch build. Do not reuse the existing `taki-memory-hindsight-0.9.0-transitions-v1` identity for changed source (`engine/taki_compatibility.py:35-38`). Add the new build to existing capability gates only after its preserved transition/application contracts are verified; an old build remains a valid baseline without observation if its earlier gates still pass. Unsupported source/capability must never trigger a fallback to unfiltered config. Rollback removes/denies the optional capability and shows unavailable; it does not roll back authority or database content.

Preserve Stage 4's whole-manifest proof semantics: make the new manifest contract field optional with no synthetic default on old responses, and never mutate an admitted old manifest/preview or broaden its hash comparison. The baseline build, its manifest shape and all persisted hashes stay byte-for-byte authoritative. A changed candidate build or added contract changes its canonical manifest hash; an old preview must refuse and be explicitly recomputed through the existing proof path. Never normalize the new contract out of an existing whole-manifest hash to make an old proof pass. Do not replace the constants already embedded in the established local connection fingerprint just to add this separately negotiated feature. Deployment of a new Native artifact and renewed proofs is a later explicitly owned rollout action; adding the optional Core consumer does not require upgrading a working existing instance. Missing version/support or missing optional method yields unsupported only for observation and does not change existing setup/transition capability requirements. Contract tests must cover both the unchanged old manifest and the new one, old-preview refusal, and successful fresh proof under the admitted new candidate.

**Acceptance/tests to put into the child (not run by this research):**

1. No credentials/no-auth extension/wrong tenant key/ungranted pair/custom extension with no hook/hook exception all refuse before projection; explicit grant succeeds only for authenticated exact namespace/Bank; cross-namespace same Bank ID, `allowed_bank_ids` restriction and validator refusal fail closed. No grant may be self-issued through a tenant RPC.
2. Ordinary config GET/PATCH/schema and LLM-health output continue withholding provider/model and credentials. Reuse `hindsight-api-slim/tests/test_hierarchical_config.py:189-203` confidentiality coverage. Inject secret/endpoint/raw-error sentinels into all provider/member/error objects and assert none appear in route/Core/Home/error/log snapshots.
3. Constructor overrides versus environment disagreement yields the actual bound engine profile. Explicit operation fallback, provider-none, unknown subclass, multi-provider and router cases produce the specified evidence. Multi member zero must never be reported as the unique configured model. Embedding/reranker/worker coverage stays unknown with no generic readiness pass.
4. Instrument the observation with fail-on-call model/embedding/reranker/initializer methods and a read-only database fixture. Assert no provider calls, Bank create/config writes, replication ensure/lock writes, authority changes, secret mutations or filesystem/helper work occur; absent Bank state stays unavailable.
5. Reject wrong nonce, build, lineage, Bank generation, malformed/extra fields, unsafe model text and oversized response. Test changed connection/secret/epoch during await, newer-over-older response ordering, API runtime session change, expiry and Core restart. A restored same-lineage candidate is not conflated with prior endpoint/runtime evidence.
6. Core permits operator and denies node/unauthenticated access through actual server dispatch. Two authenticated observers/reconnect/remount observe Core truth. A failed refresh cannot leave a stale green badge or match. Existing setup/activation and active authority remain usable with observation unsupported/denied and managed helper absent.
7. Home visibly separates desired settings, observed API profiles, coverage/unknown, last observation, and explicit connectivity-health action. DOM tests cover loading, partial, mismatch, denied and stale states. Installed Tauri/real host/owner journeys remain Stage 6 acceptance, not inferred from DOM tests.
8. Contract/schema checks, affected Native/Core/Shared/Home tests and compatibility regression gates pass. Any isolated Native/API integration execution must use fixture-only data and its separately approved execution boundary; this research ran no services/tests/network/model calls.

### 9. Alternative and the one genuine owner decision

| Approach | Decision |
| --- | --- |
| Existing Bank GET/PATCH or status-only health | Reject: deliberately excludes model identity; changing that payload silently broadens ordinary tenant API confidentiality. |
| Reparse environment/config JSON or accept operator model strings | Reject as proof: desired/admin-shell values can disagree with constructed runtime. |
| New broad admin API/key/helper | Reject for 5A: no existing role/trust contract, larger secret and deployment surface, and still needs a real runtime collector. |
| Explicit exact-pair Native grant with narrow API-runtime observation | Recommend for review: genuine producer, default deny, reusable ordinary authentication plus new independent permission, no managed helper dependency. |
| Start versioned-template lifecycle first | Valid if disclosure is declined or pending: accepted R7/R9/C16 functionality uses ordinary permission-filtered Bank/template/model/directive mutation APIs. First resolve exact preview/CAS/ownership/removal semantics against `taki-bank-template-v1.ts`, `hindsight-bank-setup.ts`, Native template import/export, and existing durable operation ownership; do not dispatch blindly or reset whole Bank config. |

The owner decision is: **May a Native deployment administrator explicitly grant authenticated holders of its tenant credential the listed API-runtime model-identity observations for selected namespace/Bank pairs, subsequently visible to that Core's operators?** The default is no disclosure. Review must acknowledge API-only/partial coverage; complete worker/routed/embedding/reranker evidence is not delivered by 5A. Engineering mechanisms, error behavior, field limits, freshness and ownership are resolved above and need not be turned into additional owner choices. If the answer is no, retain the configuration-evidence gap and sequence template lifecycle first.

### Related specs and baseline artifacts

- B7 `.trellis/tasks/08-09-memory-operations-ui/{prd.md,design.md,implement.md}` current 2026-10-07 amendments: Stage 5 planning, delivered Stages 1-4 reuse, actual Native evidence, OS-neutral Core and independent existing-instance path. Parent reports W9 independently passed; this report does not re-audit W9.
- Parent `.trellis/tasks/08-09-hindsight-memory-provider/prd.md:129-142`: R9 setup/operations and R10 secret/deployment boundary.
- `.trellis/spec/backend/{index.md,memory-operations.md,memory-hindsight-activation.md,memory-hindsight-lifecycle.md}`: existing ownership/readiness/authority gates and active model changes outside connection revalidation.
- `.trellis/spec/backend/{server-push-and-connection-auth.md,secret-catalog.md}`: role enforcement versus Host permissions, real-producer push only, sanitized secret boundaries.
- `.trellis/spec/frontend/{operator-connection-recovery.md,memory-transitions.md}`: disposable Home, Core truth, connection-generation recovery and bounded reads.
- `CLAUDE.md`, `CONTEXT.md`, `docs/index.md`, `docs/TECH-STACK.md`, `docs/adr/0009-single-memory-authority-with-local-replica.md`: project language, protocol ownership, OS-neutral Core and single authority.

### External references and versions

No network or external tool/service queries were used. Local Native source is the dependency reference: Hindsight 0.9.0, compatibility 1.0.0, current build `taki-memory-hindsight-0.9.0-transitions-v1`. This report proposes a new optional contract; none of its proposed route/schema/grant/session identifiers is claimed to exist today. The supplied source/build history was not reverified through Git or installed-artifact inspection.

## Caveats / Not Found

- No existing Native administrator role, live-runtime configuration attestation API, or admin-signed observation importer was found in the targeted authentication/compatibility/admin/Core seams. The explicit new grant is a real product/security review gate.
- Provider/model configuration is not the upstream model's executed identity, connectivity proof, worker/fleet proof or a configuration lock. Exact exposure coverage and unknowns are part of acceptance, not hidden implementation limitations.
- No source, spec, task pointer, PRD/design/implementation file, service, data, Git state or installed dependency was changed. Only this report was written. No commands enumerating process arguments, environment secrets or real data were used.
- A lightweight memory registry search found historical acceptance/worktree notes, but none was needed as evidence; conclusions above use current source and parent-supplied task context.
