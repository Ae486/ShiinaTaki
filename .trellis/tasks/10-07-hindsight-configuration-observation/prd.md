# Hindsight API runtime configuration observation

## Goal

Let a Taki operator inspect an existing instance's selected Bank and distinguish permitted, actual API-runtime
LLM configuration from desired Taki settings, connectivity health and unknown deployment coverage. This is the
proposed first independently testable Stage 5 slice under the existing B7 task.

## Status and owner decision

The owner approved proceeding with the presented Stage 5 plan and Trellis implementation on 2026-10-07,
including this first bounded slice and its administrator-opt-in disclosure policy. Stage 4 W9 independently
passed. Native disclosure remains denied by default: only exact administrator-granted namespace/Bank pairs
may be observed through authenticated tenant credentials and Core operator access. API-only coverage and
the requirements below remain unchanged. Actual deployment, grants on original instances and paid calls
are outside this implementation authorization.

## Requirements

1. Observation is optional and denied by default. A tenant key alone and a Taki operator role do not grant Native
   administrator authority or model-disclosure permission. Only the Native administrator controls exact grants.
2. Inspect the already constructed API engine's default/retain/reflect/consolidation profiles. Never substitute
   environment/configuration text, desired settings, a first router member or a health result for runtime evidence.
3. Identify supported single profiles only. Multi-provider/router/custom profiles, worker/fleet, embedding and
   reranker coverage remain explicit unknowns. Model identifiers are configured aliases, not proof of the actual
   upstream model used for a future call. Observation never establishes complete setup or authority readiness.
4. Expose only bounded provider/model identifiers and safe correlation/identity metadata. Keep ordinary Bank
   configuration and LLM-health confidentiality intact. No keys, endpoints, headers, member structures, prompts,
   host paths, secret presence or raw error data may reach the new route, Core, Home or diagnostics.
5. Observing a Bank performs no model call, model initialization, Bank/configuration write, authority mutation,
   provisioning, filesystem inspection or secret operation. Existing-instance use remains independent of helpers.
6. Bind observations to the actual connection, Bank incarnation and API engine session. Distinguish observed,
   unsupported, denied, unavailable, stale and identity-mismatched states. Reject obsolete responses; share Core
   truth across authenticated Home observers, with no browser-owned evidence cache.
7. Existing setup, activation, transitions and recovery keep their contracts when the feature is unsupported or
   denied. Old previews are not silently accepted after a compatibility-manifest change.

## Acceptance Criteria

Automated and isolated-fixture acceptance passed on 2026-10-07. See
[independent check](research/independent-check.md) and its final source/verification manifests. Installed
environment, original instances and owner/manual acceptance remain outside this slice.

- [x] Ungranted, unauthenticated, wrong namespace/key, restricted Bank, validator-refused and failing/missing grant
      hook cases cannot inspect a profile; an explicit exact grant succeeds only for its authenticated target.
- [x] Ordinary config/health responses still withhold model identity. Secret/endpoint/path/error sentinels do not
      appear in observation, Core/Home projections or recorded diagnostics.
- [x] Runtime constructor overrides beat disagreeing environment values; supported single/disabled profiles are
      truthful and routed/custom/worker/embedding/reranker cases remain typed unknowns.
- [x] Fail-on-call provider/initializer and read-only DB fixtures prove zero model calls and zero data/configuration
      writes, including an absent Bank or absent existing replication identity.
- [x] Wrong nonce/build/Bank incarnation, malformed/oversized payload, changed connection/secret/epoch, newer
      response ordering, process replacement, expiry and Core restart have explicit safe outcomes.
- [x] Actual Core dispatch enforces operator-only access. Two observers and Home reconnect/remount use current
      Core evidence; failed refresh cannot retain an old green match. Missing helper/capability/grant does not
      disable the pre-existing setup/authority workflows.
- [x] Home presents desired settings, observed API profiles and partial coverage separately, with loading,
      denied/unsupported, mismatch, stale and failure states. Existing explicit health probing stays separate.
- [x] Old/new compatibility contracts and generated artifacts pass their relevant gates; no existing receipt,
      proof or preview is rewritten or admitted through a widened unchecked version match.

## Out of scope

- Model configuration application, managed provisioning, full template/user-overlay lifecycle or candidate upgrade.
- Worker/fleet attestation, all router/embedding/reranker identities, real upstream execution identity, performance work.
- A general administrator API/key, a new secret type, an Agent tool, a new durable operation ledger or schema migration.
- Original data/instances, production deployment, paid/model calls, owner/manual acceptance, commit/push/archive.

## Notes

- [Source-grounded authorization and producer contract](../09-29-hindsight-transitions-emergency/research/stage5-configuration-contract-2026-10-07.md).
- [Residual Stage 5/6 map](../09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md).
- This covers C02/C12 subsets, not complete Native model setup or supported-environment acceptance.
