# Hindsight Connection, Secrets, and Setup

## Goal

Provide a safe connection/setup foundation for exact Hindsight `0.9.0`, including authentication, extension compatibility, secrets, models, banks, templates, and managed-versus-existing deployment boundaries.

## Dependencies

- `08-09-hindsight-compatibility-extensions`.
- `08-09-memory-provider-foundation`.

## Scope

- REST/OpenAPI-backed Hindsight client with explicit behavior-affecting defaults.
- Authenticated `/version`, `/health`, bank LLM health, and required extension handshake.
- Provider-neutral operator-only secret set/clear/presence contracts with Windows and documented headless backends.
- Existing-instance connection flow and operator-driven managed deployment-helper contract.
- Global/Character bank creation, versioned Taki template overlay, and progressive model configuration.
- Actionable diagnostics for auth, model, storage, feature, version, and extension failures.

## Acceptance Criteria

- [ ] Missing/wrong API keys fail, including loopback, and unauthenticated success is rejected.
- [ ] Secret values never appear in ordinary config, protocol responses, logs, memory, exports, or UI cache.
- [ ] Unsupported base or extension versions fail before migration or authority mutation.
- [ ] Existing self-hosted instances remain usable without managed provisioning.
- [ ] Core performs no Docker, process, service, filesystem, or OS credential operations directly.

## Out of Scope

- Legacy import execution and authority cutover.
- Replica synchronization and degraded replay.
- The final polished setup/status UI, which belongs to the operations task.
