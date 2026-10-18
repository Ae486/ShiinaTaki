# API-runtime configuration observation design

Status: approved for implementation on 2026-10-07 after the Stage 5 scope and bounded disclosure policy were
presented to the owner. Parent: existing B7. Real deployment and original-instance changes remain out of scope.
Read the [PRD](prd.md) and [verified source contract](../09-29-hindsight-transitions-emergency/research/stage5-configuration-contract-2026-10-07.md).

## 1. Responsibility and permission

Native owns authentication, the trusted schema/Bank identity, disclosure grant and actual engine observation.
Core owns operator-role enforcement, target mapping, strict transport validation and short-lived observation state.
Home renders Core evidence and explicit actions; it cannot grant Native permission or assert model evidence.

Add `TenantExtension.authorize_taki_configuration_observation(context, *, schema_name, bank_id) -> bool`, default
false. The schema is obtained from real Native authentication, never supplied by the caller. Missing/false/non-bool
results and exceptions deny. Existing `get_allowed_config_fields` semantics are unchanged.

Built-in `ApiKeyTenantExtension` reads deployment-owned
`HINDSIGHT_API_TENANT_TAKI_CONFIGURATION_OBSERVATION_GRANTS`: an optional JSON object mapping exact schemas to
finite Bank-ID arrays. No wildcard, implicit default schema or all-Bank grant. Absent/empty means denied; malformed
configuration cannot enable access or echo raw input. Custom extensions explicitly implement their own positive
grant; they are denied by default. Core has no grant-writing RPC. Revocation prevents new observations and does
not promise to retract information already disclosed. Administrator configuration changes follow Native's existing
deployment restart/reload ownership; this slice does not add a deployment manager.

The new route uses a fresh Bearer request context, actual authentication, the existing Bank-read operation validator,
`allowed_bank_ids` restriction and the separate positive grant. Reject internal/MCP bypass contexts at this external
producer boundary. Do not look up Bank existence or inspect profiles before authorization. Errors use fixed safe
envelopes without exposing a grant list, another namespace, model objects or exception strings.

## 2. Producer, protocol and evidence limits

Proposed route: `GET /ext/taki-memory/banks/{bank_id}/configuration-observation?nonce=<uuid>` in the existing
compatibility router. Set `Cache-Control: no-store`. Return a strict Pydantic model mirrored by a strict Shared schema:

```text
version: "1.0.0"
nonce: UUID
observedAt: UTC timestamp
source: { upstreamCommit, compatibilityBuild }
target: { providerLineage: UUID, bankId, bankGeneration: UUID }
runtimeSessionId: UUID
executionCoverage: "api_runtime_only"
profiles: fixed { default, retain, reflect, consolidation }
  each = { kind: "single", provider, configuredModel }
       | { kind: "disabled" }
       | { kind: "unknown", reason: bounded enum }
embedding: { kind: "unknown", reason: "not_covered" }
reranker: { kind: "unknown", reason: "not_covered" }
workerConfiguration: "unknown"
```

The actual sources are this engine's `_llm_config`, `_retain_llm_config`, `_reflect_llm_config` and
`_consolidation_llm_config`, with a UUID created once for that engine. Do not reconstruct another engine, reread
the environment as proof or expose PIDs/paths. Recognize exact supported standard provider implementations;
detect `MultiLLMProvider` and router/custom objects before accessing their forwarded properties. Unknown topology
is `unknown/routed_profile` or `unknown/unsupported_provider`, never an inferred first-member model.

Bound identifiers to 240 characters and a documented safe identifier grammar; reject controls, URI forms and
absolute paths. Provider names come from a finite supported set. Unsupported/unsafe values become unknown,
without serializing underlying objects. Never emit base URLs, keys, member structures, prompts or raw errors.
Use ASCII model identifiers matching `[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}` and additionally reject `://` and a
leading drive-letter/colon form. Other aliases are unknown/unsafe in this slice, not coerced or truncated.
`configuredModel` may be an alias: it does not attest a gateway's eventual chosen model. Separate standalone
workers and other API replicas are not covered by a response from this engine.

Read the existing Bank, database lineage and replication Bank generation with SELECTs in the authenticated schema.
Do not call the replication `ensure` helper: it writes. Missing identity is unavailable, not permission to create
state or adopt an authority. A restored database may share lineage; it is not a unique installation identifier.

## 3. Core and Home read flow

Add operator-only `memory.hindsight.configuration.observe` (one Global/Character scope selector) and
`memory.hindsight.configuration.status`. Core derives the configured Native Bank; it accepts no arbitrary evidence,
namespace, Native URL or grant from the client. The request follows existing bounded ordinary-read deadlines and
limits the observation body to 16 KiB. No long-operation exemption, model health probe or fan-out is attached.

Core captures current connection fingerprint, secret/setup revision, mapped scope and authority epoch if present;
mints the nonce; verifies the supported response version/build, exact nonce and available pinned Bank identity;
then rechecks the captured state before publication. Reject outdated connection/epoch responses and ensure a newer
request cannot be overwritten by an older response. An unpinned setup observation is labeled unpinned, not converted
into a setup/authority proof. Changed runtime session invalidates prior runtime observations.

Keep a small in-process map keyed by captured connection/scope, with a 60-second monotonic validity window.
Coalesce concurrent same-target reads. Status is `not_observed | observed | unsupported | not_authorized |
unavailable | stale | identity_mismatch`; per-field comparison is `match | mismatch | not_requested | unknown`.
Null desired fields mean no preference. Native `observedAt` is display metadata; wall-clock agreement is not
required. A newer failure/denial removes model strings from the normal current projection. Core restart returns
to not-observed. This authenticated-transport observation is not signed hardware/process attestation.

Home reuses its existing operator connection and Operations/Settings primitives. Show desired settings and
observed API profiles separately, mark partial coverage prominently, and label all unavailable coverage explicitly.
On mount/reconnect, retrieve Core status; observation refresh is a safe bounded read. No localStorage evidence
cache, mutation replay or invented subscriptions. Use one-shot reads unless a real invalidation producer is added.
Keep connectivity health as its existing separately invoked action and never derive setup or cutover readiness
from a model match. Both supported old instances and denied new instances remain usable through existing workflows.

## 4. Compatibility and rollout

The Native source requires a new maintained build identity for the feature. Introduce a finite new compatible
identity, proposed `taki-memory-hindsight-0.9.0-config-observation-v1`, plus optional
`contracts.configuration_observation` version `1.0.0`. Keep old supported build identities and existing transition,
source-evidence, application and result contract requirements explicit. Do not rewrite old Native manifests,
receipts, baselines or pinned evidence, and do not replace exact compatibility checks with a blanket prefix match.

Update necessary Core/Shared build admission and canonical generated contracts as one reviewed change. Contract
tests cover old Native without observation, new Native with grant denied, successful opt-in and all existing
mandatory transition capabilities. A changed manifest invalidates an old preview under the existing hash check;
obtain a new preview/proof instead of silently accepting its old hash. Review every actual build-gate consumer
before choosing the final identifier. Observation itself cannot mutate saved compatibility or authority state.
The new optional manifest field has no synthetic default on an old response. Do not replace existing constants
embedded in persisted local configuration fingerprints merely to add this independently negotiated capability,
and never normalize the new field out of a whole-manifest hash to make an old preview pass.

For a later real deployment, publish compatible Core support before enabling the new Native build; settle existing
effect-bearing operations and follow candidate/backup/upgrade rules before service replacement. No actual deployment
or original-instance replacement is included here. Revoking grants or disabling/removing the optional observation
surface leaves old setup/transition behavior available; do not schema-downgrade or delete evidence as rollback.

## 5. Failure and acceptance matrix

| Trigger | Required result |
| --- | --- |
| Missing/invalid credentials, no-auth extension, absent/throwing hook, wrong exact grant or forbidden Bank | Deny before profile/Bank existence disclosure; fixed safe reason. |
| Constructor/environment disagreement | Report the bound recognized engine profile; never the reparsed environment. |
| Router/custom/unsafe model, worker or embedding/reranker identity | Explicit partial/unknown evidence; no model or metadata calls. |
| Missing existing Bank/replication identity | Unavailable; zero initialization or database mutation. |
| Nonce/schema/body-size/build/Bank identity mismatch | Reject; do not overwrite a newer/current valid observation or adopt identity. |
| Changed connection/secret/epoch/session, expired cache, restart | Invalidate safely, with no persistent browser-owned truth. |
| Newest request denied/failed after an earlier match | Current projection does not retain a green model match. |
| No capability/grant/helper | Existing setup, activation and authority workflows still work. |
| New manifest versus an old transition preview | Existing stale-preview refusal; fresh valid preview still works. |

Use fail-on-call sentinels for model/initializer paths and read-only database fixtures. Test actual Core dispatcher
roles and authenticated two-observer/reconnect flows, not only a fabricated UI state. Installed/owner/real-model
acceptance remains Stage 6. No new public-facing promise exceeds API-runtime configuration observation.
