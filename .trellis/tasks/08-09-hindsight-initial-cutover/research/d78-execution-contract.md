# D78 Current-State Import and First-Activation Proof

## Execution boundary

Continue existing B4 after the completed first slice. The owner authorized advancing the clear engineering route.
This addendum supersedes the raw-source-only roadmap and its old pre-authorization prohibition on editing Hindsight.
It does not authorize existing user data, actual cutover, provider/model charges, Git commit/push/rebase/reset, new
dependencies, finish or archive. Preserve the protected B2 backup and other worktrees.

Use the owned PostgreSQL/HTTP/SQLite fixture from `09-07-hindsight-recovery-evidence/research/validation`; never load
`.env`. Taki remains Canonical Local. Preserve frozen G1/B2/source-evidence-v1 bytes. Read `d78-native-preflight.md`.

## Integration contract

1. Freeze current Local under the existing writer reservation. Preserve full typed Bank/source/unit/policy/provenance/
   lineage/derived/Block evidence and an explicit disposition for every manifest record. Actual B3 bindings/templates
   govern target Banks. Blocks/policies are retained artifacts, not submitted as facts.
2. Add transfer-aware preparation/evidence. All current Canonical facts/observations, including B2 conversions, use
   structured current state. Nullable source text does not require extraction. Keep source/unit maps separate and
   detect genuine representation gaps before submission. Preserve old v1 evidence and APIs.
3. Native transfer is a separate single-Bank protocol: caller operation UUID, canonical request hash, Local manifest
   digest, source Bank identity and expected native lineage/generation. Persist complete source kind/ID/revision/hash
   to target kind/ID/revision/payload-hash mappings and committed journal boundaries. Prefer an atomic bounded Bank
   import; if parts are needed, immutable part identities, committed mappings and sealing survive partial success.
4. Under the native Bank writer lock, require empty target/proven replay or an explicit fully proven supersession set.
   The B3 Bank row is expected. Never silently skip content, replace unknown objects or change IDs on retry. Establish
   final lifecycle and complete source links before publishing native state.
5. First-activation verification consumes the exact transfer result/manifest. The provider enumerates the whole
   required set, persists actual native source/scope/model input and outcome receipts, and binds a certificate to its
   immutable logical snapshot. Missing outcomes, stale inputs or incomplete lifecycle are typed incomplete results.
6. Taki validates full mapping/required-set/page coverage, hashes, namespace and snapshot binding; persists evidence
   outside B2 history/caches; and uses it in actual B4 readiness/verify/promotion. Final Local epoch/fence/digest checks
   stay transaction-local. Old B2 imports cannot discharge current proof; empty Banks get explicit current proof.

New native module families are `current_state_transfer` (structured import) and `cutover_verification` (maintenance).
Publish Python schemas to the Taki worker/root before freezing mirrored Shared DTOs. Cross-language canonical hash
fixtures must match exact snake_case serialization. Never independently invent incompatible wire contracts. Results
provide immutable identity/hash and stable paged mappings, not only counts. HTTP handlers delegate authenticated typed
engine methods, never SQL. Root owns router registration, compatibility publication, backup lists and generated output.

This is a finite first-activation pass, separate from G1 routine completion and automatic native scheduling. Capability
must not claim ready while producers/consumer are stubs. Incomplete model/lifecycle proof is not full D78 acceptance.

Integration refinements: preserve exact verified B3 control-resource baselines (its model/directive predate import);
use new protocol-only tagged/binary64 hashes and supplemental certificate `snapshot_records_hash` while retaining old
snapshot SHA checks; connect full snapshot payloads to the existing B4 raw logical staging/checkpoint repository.
Do not fabricate B5 Canonical policy for new observations. Trusted derived-policy projection remains an explicit
D77/B6 dependency, so this gate alone does not establish full B4 or live/runtime activation acceptance.

## Ownership and migration allocation

| Workstream | Owns | Coordination |
| --- | --- | --- |
| Native transfer | New `engine/transfer/current_state*`, `api/current_state_transfer.py`, transfer tests; migration `d78a1c4e6f90` parent `a8e1b6d4f0c3`; transfer method region of `memory_engine.py`. | Publish DTOs first; provide router factory and backup table names. Leave common registration/codegen to root. |
| Native proof | New `engine/cutover_verification*`, `api/cutover_verification.py`, consolidation/model producer seams, snapshot binding, tests; migration `d78b2d5e7a01` parent `d78a1c4e6f90`. | Consume real transfer results; coordinate concurrent engine imports/edits. Preserve routine scheduling. |
| Taki | Shared transfer/proof schemas, current-state preparation/store/client/orchestrator, migration 039, actual B4 consumers and affected tests/indexes. | Preserve 036-038 and v1; align native DTOs before wire freeze. Root owns task/spec/hand-off docs. |
| Root | Research/design/plan/manifests, protocol review, common provider registration/capabilities/backup, HTTP-to-SQLite fixture, codegen, independent checks and final gates. | Do not generate while schemas change; preserve other edits and unrelated CLI file. |

These migration IDs are reserved. Keep both 035 histories through 038 tested. Implementers are already spawned Trellis
implement agents: implement directly without recursively spawning implement/check agents.

## Validation waves

- Transfer: schema/hash parity; null/empty fields; current edits/lifecycle; observations, cross-document links and
  standalone units; derived resources; source/unit metadata; empty Bank; conflict/supersession; real transaction,
  journal/mapping rollback, replay and ACK loss; no extraction invocation.
- Maintenance: full revision/scope set and mixed scopes; true action/no-op/failure; partial receipt recovery/input CAS;
  authored content/current-input window; native irrelevant-facts no-op; lifecycle-only and missing-history refusal;
  definition/policy/time/ABA/pruning cases; final native persisted outcome/certificate/snapshot equality.
- Taki: real repository-backed capture/dispositions/evidence, reopen, exact result/pages/namespace, full mappings,
  missing/forged/stale proof refusal, empty-Bank proof and stale Local writer refusal; G1 backward compatibility.
- Integration: owned PostgreSQL + HTTP + real SQLite with a successful complete finite candidate and failures leaving
  Local active. Deterministic model injections prove mechanics, not semantic quality or manual/real-model acceptance.
- Quality: independent Trellis check, migration/DAG/backup/HTTP/auth gates; affected package tests, five TS typechecks,
  root lint, serial recursive tests and strip-only boot; native lint/type checks; canonical OpenAPI/all client generation,
  locked/offline SDK checks, backward compatibility and repeat generation.

No task closeout, manual acceptance or D77/B6/B7 completion follows merely from these automated checks.
