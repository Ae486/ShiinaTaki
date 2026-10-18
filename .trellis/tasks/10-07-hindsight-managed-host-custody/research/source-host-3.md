# C1 source research excerpt source-host-3

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md`. SHA-256: `e9cab382d8754a55516c31310aaaf0ccbf8fe45b368ea27ea028d63b7c6fc1dd`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

### 6. Incremental implementation and check plan

| Milestone | Concrete result / ownership | Check immediately at this boundary |
| --- | --- | --- |
| C1: installed helper and custody contract | Shared/Rust registry and exact input fixtures; installed helper identity; one same-host read-only secret path; public non-secret status. Serial owner for Shared/permission/secret refactoring. | TS/Rust wire parity; absent/tampered helper; wrong Host/store/user/key; locked catalog; no secret in argv, WS, logs or persisted helper/container config; policy generation change; release packaging path. No real models/services required. |
| C2: isolated managed deployment | Helper prepare/start/inspect/reconcile with resource labels/IDs, operation-local lock/journal, owned persistent storage and true installed artifact digest. Core admits a receipt only from the original authenticated execution and calls ordinary setup. Minimal Home prerequisite/result controls. | Hermetic process/Docker adapter tests; failure after each externally visible step; duplicate attempt and restart observation; unknown result without replay; foreign resource collision; storage persistence proof; stale/fabricated receipt; existing-instance setup when helper is absent. |
| C3: model application and readback | Explicit canonical apply plan, finite provider adapters for all six model slots, generation-bound restart/readback, 5A reuse plus embedding/reranker extension, model health separate from configuration status. | Inheritance/clear/fallback, unsupported provider/chain, wrong runtime generation, API/poller topology, failed start and recovered result, stale desired settings, silent environment override, no implicit model calls during observation. Isolated real deployment/model acceptance is separately authorized. |
| C4: populated deployment change | Explicit drain/backup/config-candidate/verification/rebind path; preserve existing authority and data on refusal or failed migration. Re-embedding plan where required, rather than ordinary connection revalidate. | Failure before/after publication, pending/source/derived-state preservation, embedding same/different dimension and model identity, missing retained sources, rollback limits, original operation recovery. Coordinate with 5D candidate infrastructure; do not falsely mark full active-model lifecycle complete after C3. |

A single cohesive implementation agent is reasonable per milestone because each crosses coupled schema/producer/consumer changes. Helper internals and Home UI can be separate owners only once the wire contracts are frozen. Native changes to readback or startup adapters must wait for the current 5A owner to hand off its files. Independent check C1 before feeding it real credentials, C2 before trusted managed receipts are consumed, and C3/C4 before calling the flow usable. Do not rerun the full unrelated Stage 4/Core suite after every small edit; combine relevant module tests/type checks/lint at these milestones and run one integration sweep when the complete vertical path exists.

### 7. Recovery and rollback rules

- Before creating anything, record the exact approved plan and original operation/attempt/Host/config identities. After each side effect, persist its actual resource identity. A timeout/disconnect is unknown until inspection proves the original result; no automatic create/restart replay.
- Reconcile only resources owned by the exact deployment. Foreign container/volume names, changed image digest, missing journal, changed helper identity, or unknown storage contents refuse automatic adoption.
- Before first activation, failed candidate setup must leave Local authority unchanged. Retain recoverable storage and bounded evidence; automatic deletion is not a shortcut for uncertain ownership or failure.
- Do not let browser closure cancel or reconstruct a deployment operation. Helper/Core can continue and the next observer reads the original operation.
- For an active deployment, prepare/verify a backup and drain the appropriate work before replacing configuration/runtime. Existing connection revalidation rejects model/deployment drift intentionally; do not weaken it to make settings appear live.
- Old config/artifact can be selected again only if its storage/schema remains compatible. Once candidate migration or authority publication commits, recover that committed identity; never blindly downgrade a schema or switch back by rewriting a pointer.
- A managed receipt must bind actual Host/helper/artifact/configuration/storage evidence and freshness to the admitted operation. Operator JSON re-submission is not an authenticated helper result. Its readiness still does not itself authorize memory authority activation.

### 8. Leader decisions versus genuine owner choices

**Leader can decide within the approved scope:** serial ownership/check cadence; dedicated typed capability instead of generic exec; source/module placement; immutable artifact identity format; explicit refusal/unknown/recovery semantics; provider adapter implementation order; installed-helper detection; same-host-first implementation; test fixtures and finite test budgets. These are engineering choices and do not justify repeatedly asking the owner to approve routine design work.

**Make concrete in the relevant task plan before real deployment:** actual supported helper packaging, accepted Native image digest, secret delivery and restart mechanism, local endpoint/port, resource ownership/storage plan, model-provider matrix, and the supported Ubuntu managed topology. They are engineering work still to do, not facts this report has proven.

**Owner decisions only if the product/deployment choice cannot be inferred:** installing Docker/system services or granting new OS privileges; selecting a real deployment host/storage location that affects the user's environment; choosing an external model/provider/key or paid/download activity; changing scope to remote-Host secret transfer or automatic service startup; a destructive existing-data repair, migration or cleanup policy. Stage 5 source implementation authorization alone does not choose those actual environment actions. No such action was performed here.

## Related specs and references

- `.trellis/workflow.md`: task routing, persisted planning, sub-agent self-exemption and implementation/check gates.
- `.trellis/spec/backend/index.md`: OS action/Shared-contract rules; `.trellis/spec/guides/index.md`: cross-layer and source-grounding rules.
- `.trellis/spec/backend/host-operation-lifecycle.md`: Host provenance, generation loss, non-replay and receipt semantics.
- `.trellis/spec/backend/secret-catalog.md`: TSC1, master-key backends, no-value public surface and locked behavior.
- `.trellis/spec/backend/memory-operations.md`, `memory-hindsight-activation.md`, `memory-hindsight-lifecycle.md`: existing operation, activation and drift/rebind boundaries referenced by the Stage 5 readiness report; preserve them during later implementation.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md`: precisely scoped Core spawn exceptions.
- `docs/adr/0007-capability-data-locality-split-machine.md:3-18`: Core placement does not relocate Shell-owned OS effects.
- External source dependency: local Hindsight `0.9.0` compatibility line and its standalone/API/worker/configuration code cited above. No network research, new dependency, image version selection, or installed-artifact inspection occurred.

## Caveats / Not Found

- One broad `jbcontext search` reported indexed revision `fccfc4fb7895`. It was used only to find the Host/Shell seam, then current named files and nearby code were read. No second broad search was used.
- The current sources contain no production Hindsight deployment helper, no proven installed helper packaging, no safe model-secret delivery to a helper, no trusted managed-receipt provenance, and no complete all-slot model apply/readback workflow in the bounded searched seams.
- 5A is changing concurrently; its optional API observation contract is deliberately not re-audited here. Reuse the final independently checked contract, not an intermediate source snapshot or the old compatibility identity.
- A release-safe Ubuntu managed Host, real Windows Docker/secret-custody proof, installed desktop helper smoke, and data-bearing embedding migration remain unverified. Source tests cannot close those platform/manual gates.
- This report writes only its assigned research file. It does not create/activate tasks, revise specs, implement code, grant OS/API authority, or claim any acceptance case passed.
