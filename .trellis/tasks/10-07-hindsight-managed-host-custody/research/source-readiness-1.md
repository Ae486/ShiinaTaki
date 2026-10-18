# C1 independent readiness excerpt 1

Source: `.trellis/tasks/10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md`; SHA-256 `7589003217c782fa3904e6a097c14212edbb48c73d351e057dd8c51aabeb3562`.
This is source/design evidence, not code or installed-platform acceptance.

# Research: Stage 5C / C1 implementation readiness

- Query: Review the proposed installed Hindsight Host, read-only Secret Catalog custody and fake-secret bootstrap; identify the minimum engineering resolutions and independent check gates before implementation.
- Scope: Internal source/design review; external runtime/version facts are limited to the supplied source-research reports. No network or environment execution.
- Date: 2026-10-07
- Active task supplied by the leader: `.trellis/tasks/10-07-hindsight-template-lifecycle` (B1 remains the production owner).
- Reviewed planning task: `.trellis/tasks/10-07-hindsight-managed-host-custody` (`prd.md`, `design.md`, `implement.md`).

## Findings

### Verdict and change boundary

The proposed direction is viable for implementation planning: reuse the existing TSC1 codec, retain Core as its sole writer, introduce a real release Host/helper, and use an authenticated Host operation rather than an operator receipt. The new C1 draft already incorporates the main earlier findings. **Readiness is conditional on freezing the concrete contracts below; this report is not an implementation or installed-platform PASS.** No additional product decision is needed for these engineering corrections.

Do not reopen the completed Stage 5B design review. Do not overlap its current Shared/Core/Native/migration owners. Recheck the relevant source interfaces after B1/B2 release them, because this review records the currently observed production seams, not a reserved future migration number.

| Priority | Remaining decision to freeze | Failure if omitted | Minimum resolution |
| --- | --- | --- | --- |
| P1 | Trusted invocation and accepted-result producer | Plausible JSON can acquire custody/deployment authority; Core and Host attempts can be confused. | Internal per-pending issued/accepted evidence and an explicit Core-to-Host ID map; only the gate supplies execution context. |
| P1 | One-owner catalog snapshot and final check | Same-millisecond change, restore ABA, or fresh disk bytes combined with stale cached metadata can admit the wrong credentials. | Core boot + private publication revision + owner-consistent sealed digest, checked at acceptance and fresh injection authorization. |
| P1 | Installed Windows execution boundary | Hash-then-spawn, writable parents, reparse points or Node preload variables can execute an unverified program. | External expected identity, actual handle/DACL/owner checks, held replacement guards and an allowlisted process environment. |
| P1 | Ubuntu release Host and credential custody | An operator CLI or a token alone gets mistaken for an authorized same-host executor. | Actual `role=node` enrollment, canonical Host gate, effective-UID registration and service-local protected credentials. |
| P2 | Offline JS/dependency closure | A development checkout passes while the installed helper cannot resolve TypeScript, sodium/Wasm or adapters. | Compiled ESM and a complete pinned installation tree tested without checkout/store access. |
| P2 | C1/C2 bootstrap evidence split | Process mocks are presented as Docker restart/confidentiality proof, or a persistent observer is left ownerless. | C1 owns protocol/process prototype and release Host lifetime; C2 owns real resource observer and mandatory isolated Docker proof before real delivery. |

### 1. Preserve authority through the real broker and executor

**Trigger and evidence.** `packages/core/src/server/methods/capability-respond.ts:22` obtains authenticated current Host provenance before calling the broker. `capabilities/capability-broker.ts:133` verifies the pending control and provenance; `capability-response.ts:19` rejects a wrong Host/generation/control, and `:45` reduces a successful response to `{ ok: true, output }`. That returned JSON does not retain its provenance. A protocol-level `{accepted:true}` is also not sufficient: `responseOutcome` can produce a governance denial from a terminal frame. The custody consumer must require an actually successful verified outcome.

`capabilities/route-capability.ts:39` has no `operationId` request field and forwards `attemptId` as `coreAttemptId` at `:93`. The broker creates a separate `requestId` at `capability-broker.ts:115`, defaults `operationId`, and always creates a new Host `attemptId` at `:167-173`. Rust `apps/desktop/src-tauri/src/capabilities_impl.rs:38` currently exposes `run(&Value)`, not trusted Host operation context.

`packages/core/src/memory/hindsight/hindsight-setup-service.ts:213-228` still parses `params.managedReceipt` and validates endpoint/time/image naming. `packages/shared/src/hindsight-setup-schema.ts:58-70` describes ordinary receipt JSON. Neither is an installed managed-resource producer.

**Recommended minimal API contract.** Exact names can follow local style; preserve these semantics:

1. Add an internal per-request broker observer/options path, such as `onIssued({requestId, control})` and `onAccepted({requestId, control, provenance, authorization, outcome})`, held on that pending entry. Register it before `notify`, never via append-only global listeners. Existing `request()` and ordinary output shapes keep their behavior. These callbacks are code-owned and never parsed from WS.
2. `onIssued` records the exact mapping `{coreOperationId, coreAttemptId, brokerOperationId, hostAttemptId, requestId, inputDigest}` in the live custody admission owner before external execution. Add explicit `operationId` routing only where needed; do not infer equality between Core and Host attempt IDs. A naming choice that deliberately reuses `operationId` must still record the separate `hostAttemptId`.
3. Mint accepted evidence only after terminal lineage/governance checks, current target/generation/policy validation and the original deadline check. Invoke at most once; timeout, cancellation, wrong control, duplicate and replay produce no successful custody evidence. The consumer performs its own final snapshot check before publishing custody acceptance. If persistence involves `await`, recheck after it at the final state transition; checking only before an asynchronous operation reintroduces a gap.
4. Treat evidence as an internal opaque handle or branded value backed by a Core-owned live admission record. A TypeScript cast or parsing the same JSON must not construct it. Persist only sanitized accepted evidence where recovery requires it; invalidate transient preparation on Core boot change.
5. Introduce a narrow `TrustedHostInvocationContext` at the Host executor boundary, after the actual permission gate has validated the issued request. A compatibility default `run_with_context(input, context) -> run(input)` can preserve existing capabilities. The custody executor consumes actual control/request identity; it never copies a purported trusted Host/user field from user input.
6. Windows Shell adds the verified local OS/install identity to the private helper envelope. Ubuntu supplies it from its release Host implementation. Helper output is decoded as an ordinary bounded result and wrapped with real broker evidence by Core; the helper cannot declare its own trust level.
7. C1 exposes diagnostic/custody status only. It cannot mint `ready` deployment receipts. Gate the old raw `managedReceipt` admission path so it cannot bypass the new boundary. C2 consumes a `receiptRef` looked up in a Core-owned accepted deployment ledger; it never accepts operator JSON as evidence. Preserve the existing-instance path independently. Historical recovery reads the previously accepted owner record, not re-parsed user receipt text.

The accepted Host is a trusted local executor; this protocol does not remotely attest the physical machine against a malicious credential-owning user. Its contribution is exact current provenance and ownership, not protection from a compromised admitted Host.

### 2. Snapshot the catalog through its owner, including restore ABA

**Trigger and evidence.** `packages/core/src/secrets/secret-catalog-service.ts:43,85` already exposes private `revision()`. `:143-151` increments it after successful publication, `:199-214` after rotation, and `:223-229` after restore. `:178-189` reads cached metadata. `backupOf` at `:218` combines current file bytes with the cached key/version state; it is not an owner-consistent admission snapshot API. `.trellis/spec/backend/secret-catalog.md:3-7` explicitly keeps revision process-local and outside public metadata. `hindsight-configuration-context.ts:60` already uses it privately.

Envelope digest detects different bytes but not `A -> B -> restore exact A`. Timestamps can repeat; key version need not change on set/clear. `catalog-publication.ts:17-43` publishes by staged write/fsync/link/rename, so a complete old open file is not necessarily the current registered file.

**Recommended API and invariants.** Add an owner-internal read-only capture/validate pair, e.g. `captureCustodySnapshot(fixedSelection)` and `validateCustodySnapshot(snapshot)`. The live admission owner stores:

```text
coreBootId, privateCatalogRevision, custodySnapshotId,
catalogStoreId, catalogKeyVersion, sealedEnvelopeSha256,
fixedSlotSelection, desiredConfigIdentity,
installationIdentity, executionHostId,
originalCoreAndHostAttemptMap, issuedGenerations, deadline
```

The service records the digest of the exact successfully loaded/published/restored envelope alongside cached plaintext state. Capture reads a bounded current envelope and requires it to match that owner-published identity before combining it with cached presence/provenance. Do not independently call `backup()` and `presence()` and assume they describe one state. Every successful writer path updates the owner identity; failed writes do not. Uncoordinated external replacement yields unavailable/stale, not an implicit reload or silent adoption.

The Host receives an opaque `custodySnapshotId`, store/key version, sealed digest and fixed selection as non-secret request context. Private revision stays Core-internal; do not extend `secret.set/presence/list`, historical connection fingerprints or public telemetry with it. `coreBootId` scopes both revisions and live nonce/admission state.

Read one complete envelope through a bounded read-only handle. Verify the registered path/handle identity before and after the read and recheck current registration at final acceptance. An old descriptor surviving an atomic rename does not grant permission to use old credentials. Do not hold a no-delete catalog lock across the whole operation, because that would prevent the legitimate Core writer's rename publication.

At final custody acceptance check the original boot/revision/digest/store/key/config/install/Host/policy/deadline tuple again. In C2, obtain fresh **non-secret** reauthorization from this owner before injection, using the existing authenticated Host channel; do not turn it into a secret retrieval service. Check again before accepting a deployment-ready result. Disconnection, Core reboot and exhausted deadline invalidate the old admission; a new request cannot silently upgrade the old attempt.

There is necessarily a bounded cross-process interval between last authorization and use. This contract prevents stale acceptance and blind reuse; it does not provide instantaneous revocation. An already running Native child keeps its old credentials until a later controlled restart/rebind. A catalog/key-source rotation mismatch is locked and must never trigger fallback to another key or catalog.

