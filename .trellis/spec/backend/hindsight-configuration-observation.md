# Hindsight API-runtime configuration observation

## Ownership and scope

`memory.hindsight.configuration.observe/status` are operator-only, bounded reads over one Core-derived Global or
Character Bank. Shared owns their strict schemas. Core owns current evidence; Home is disposable. This optional
capability never changes setup, authority, grants, deployment or models and never triggers LLM health. It describes
configured API-engine aliases only, not the upstream executed model, other API replicas or standalone workers.

## Native disclosure and producer

The separately authenticated Native route requires a positive exact namespace/Bank grant from
`TenantExtension.authorize_taki_configuration_observation`. Its default is false. The built-in tenant extension
parses `HINDSIGHT_API_TENANT_TAKI_CONFIGURATION_OBSERVATION_GRANTS` as an exact finite map; invalid input, wildcards,
absent hooks, exceptions, non-boolean results, internal/MCP bypass contexts and ordinary Bank-read refusals deny.
Authentication and disclosure are separate decisions; Core cannot write these administrator-owned grants.

Only exact `LLMProvider` instances expose bounded supported provider/model identifiers. Multi-provider, router and
custom instances remain unknown without reading forwarded properties. Embedding/reranker/worker are unknown.
Models must match `[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}` and contain neither `://` nor a leading drive-letter colon.
Unsafe values become unknown, never truncated paths. Keys, endpoints, headers, prompts and raw errors are excluded.

Read the existing Bank, replication generation and provider lineage through authenticated schema-qualified SELECTs.
`peek_memories()` reads the already installed store; `get_memories()` can load extensions and is forbidden here.
The preceding compatibility GET also uses `peek_memories()`; only normal engine startup owns store initialization.
Never call backend/model initializers, replication ensure helpers or Bank writes. Missing identity is unavailable.
The engine session UUID is created once in its constructor. All route outcomes are `Cache-Control: no-store`.

## Core evidence lifetime

The client limits response size to 16 KiB and uses an ordinary total read deadline across manifest and observation.
Core mints a nonce, validates exact source/build/contract and Bank identity, then rechecks its captured connection,
secret marker and publication generation, setup revision, config write generation, authority selection and available checkpoint pins before
publication. A lineage-only or first-setup observation stays unpinned until a Bank generation pin exists.

The config generation advances on the existing successful-write producer even when a value is restored (ABA).
The internal Secret Catalog revision advances only after successful set/clear/restore/key-rotation publication;
failed writes and absent clears retain it. This closes same-millisecond replacement and backup-restore ABA even
when public metadata and the persisted connection fingerprint are identical. It is never persisted or exposed
through a secret RPC. Catalog health is fixed after construction; a new locked/unreadable catalog belongs to a
new Core boot with empty observation state. Future live lock/reload operations must also advance this revision.
Observation uses a maximum 64-entry in-process map, coalesces same-context reads and rejects obsolete responses.
A newer process session withdraws other-Bank evidence from the earlier session; an older request cannot reintroduce
that replaced session. Expiry is 60 seconds of Core monotonic time; Native timestamps are display metadata.
Current failures, denial, expiry and changed context clear observed model strings and green comparisons. Restart
returns to not-observed. No persistent operation ledger, browser evidence cache or invented subscription exists.

## Compatibility and checks

`taki-memory-hindsight-0.9.0-config-observation-v1` adds optional `configuration_observation` 1.0.0. Existing exact
builds and mandatory application/result/transition/source contracts remain checked. Adding the build does not alter
constants embedded in persisted local fingerprints. Whole-manifest preview hashes include the new optional field;
an older preview must be refused and a fresh preview requested. Denied or unsupported observation is not a gate on
the previous lifecycle workflows.

Required tests: actual Native HTTP/auth and constructor selection; actual migrated PostgreSQL read-only JOIN,
absence and zero effects; strict Shared/transport bounds; real Core dispatcher and two authenticated WS observers;
config/secret/epoch/identity/session races, ordering, expiry/restart; old/new mandatory capability and whole-manifest
preview checks; actual Home controller/browser failure/reconnect behavior. Preserve installed/manual/model-quality
acceptance as separate Stage 6 evidence.
