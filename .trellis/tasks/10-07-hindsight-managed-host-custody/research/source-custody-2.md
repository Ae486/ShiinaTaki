# C1 source research excerpt source-custody-2

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-custody-design.md`. SHA-256: `b9d867a35b1fb41d573d831cf13d21be2e39d848eb9421508e733d458f97fc4a`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

### 4. Exact same-host identity and request binding

Keep these identities separate:

- `coreHostId` / `catalogStoreId`: the live Core's persisted identity and TSC1 AAD identity. `packages/core/src/hosts/host-identity.ts:19-48` defines the create-only identity; `main.ts:142-143` binds the catalog to it.
- `executionHostId`: the authenticated Shell on Windows, or the release helper Host on Ubuntu. It is not automatically equal to `coreHostId`.
- `ownerBinding`: Windows token-user SID hash plus fixed keyring service/account, or Ubuntu effective UID plus protected credential-source registration. Do not derive it from an operator-supplied username or `HOME`.
- `installationIdentity`: helper manifest digest + verified Node and key-adapter identities.
- `configurationIdentity`: original operation/attempt, immutable deployment plan digest, desired-config fingerprint, exact ref set, catalog envelope digest, key version and selected-entry provenance.

Current Windows token-user extraction exists privately in `apps/desktop/src-tauri/src/secrets.rs:132-186`; keyring uses service `TakiAgent` and Local persistence (`:23-24,45-50`). Expose a narrow non-secret fingerprint through the trusted adapter rather than adding a Node FFI dependency or relying on Windows `uid == -1`. Ubuntu can use Node's real effective UID and file ownership; the master-key file must come from the registered systemd credential directory, not a path supplied in a deployment request.

**Proposed strict request, containing no secret values:**

```text
CustodyPrepareV1 {
  operationId, attemptId, executionHostId, coreHostId,
  installationIdentity, ownerBinding, deploymentId,
  planDigest, desiredConfigFingerprint,
  catalogStoreId, catalogEnvelopeDigest, catalogKeyVersion,
  selectedRefs: [{ slot, secretRef, expectedUpdatedAt }],
  coreBootGeneration, requestNonce, expiresAt
}
```

Schema limits and deadlines should come from the relevant deployment operation plan; this report does not invent a new global timeout. Slots are the seven fixed Hindsight refs already declared in `hindsight-secret-refs.ts:9-16`. An absent optional override has explicit inheritance semantics; a missing required ref fails before Native startup. There is no arbitrary path, environment-variable map, Core URL, key-helper command or secret ref supplied by the UI/model.

The request is issued by the admitted Core operation and delivered over the existing authenticated Host control path. Shell validates its current generation/policy/input tuple before invoking the pinned helper. Stdin is an inherited private pipe, not a shell command or public listener. The helper validates registration, actual user/key source, exact local file identities and the request. Core's current handshake does not expose `coreHostId` (`packages/shared/src/connect-schema.ts:36-42`); add a narrowly scoped **non-secret** custody/status/admission contract to bind the live local Core to this registration. Do not claim that existing `connect` already proves the local catalog path.

A future Ubuntu managed helper must provide a release-safe Host/control client with the same generation and exact-input rules, using Shared schemas and explicit operator approval. The existing operator CLI's token is not Host provenance. A documented Node helper `serve`/one-shot Host mode with an explicitly provisioned Node identity/token in systemd encrypted credentials is the concrete direction; its Host client is new code and belongs in C1/C2 packaging, not in `taki-node`. A plain CLI `check-custody` command may inspect local custody, but its JSON output must never be accepted by Core as a trusted deployment receipt.

There is deliberately **no new local secret broker** in this recommendation, so there is no bearer ticket that authorizes fetching secrets from Core. Nonces bind an operation; they do not turn receipt text into a credential or replace authenticated Host provenance. The trusted same-user helper and OS credential owner remain the local trust boundary.

### 5. One-writer read path and state transitions

1. Core snapshots the admitted operation's desired configuration and **digest of the actual sealed catalog bytes**, not only timestamps. Current per-entry `updatedAt` uses wall-clock milliseconds (`secret-catalog-service.ts:153-160`); key version alone does not change on every write. Envelope digest prevents accidental acceptance of a different same-version payload.
2. Helper opens only the registered catalog file read-only, reads one bounded complete envelope, obtains the current master key using **get**/systemd-read, and authenticates `storeId`, format and key version using the shared codec. It does not instantiate the mutable service, create missing key material, rotate/restore, or write any catalog bytes.
3. Verify envelope digest and selected-ref provenance against the admitted request, select only its approved slots, and place those values in short-lived memory. The existing codec decrypts the complete payload, so both key and unused entry references should be released as soon as possible. JS strings/Wasm buffers do not establish guaranteed secure erasure; do not promise it.
4. Before credential injection and before accepting a ready receipt, revalidate original operation/attempt, live Core boot/generation, config fingerprint and current catalog digest. Do not accept a supplied old ciphertext as the authoritative current file. File publication is old-or-new via staged fsync/link/rename (`catalog-publication.ts:17-43`); verify that read-only handles behave correctly under concurrent replacement on each platform.
5. If the snapshot changes during external work, mark the result stale/unknown and reconcile the exact owned candidate. Never silently switch to new secrets inside the original attempt. Publication of ready/active state requires the final current-generation checks; prior process launch alone is not the commit point.

This is snapshot-bound delivery, not immediate global revocation. An already running Native process has its own credentials; catalog clear/rotation does not retroactively erase that process. A later controlled restart/rebind is required. Product status must expose pending/stale application rather than claim a stored clear immediately affected Native. An instant-revocation contract would require a stronger runtime design and is not present today.

| Event | Required behavior |
| --- | --- |
| Missing key/helper, unreadable or wrong-user credential source | `locked`/unavailable; zero value output, no create/fallback, no Native start. |
| Wrong store, tampered/truncated envelope or unsupported version | Bounded refusal; file bytes untouched; do not try alternate catalog paths. |
| Catalog set/clear or same-version replacement during prepare | Digest mismatch; discard prepared values and require a new admitted snapshot. |
| Catalog key rotation | Fresh key+envelope read on the next attempt; old request/key version becomes stale. A key-source/envelope publication mismatch fails closed, never restores an old key. |
| Core restart | Old boot generation/nonce cannot authorize injection/readiness. Reconcile the original helper/container state through a new operation observation; no automatic request replay. |
| Helper crash before injection | No credentials have been persisted by helper; next attempt reopens the catalog and key source. |
| Helper crash during/after injection | Outcome unknown until the bootstrap's exact startup/generation receipt is queried. No second blind injection/start. |
| Container restart | New bootstrap startup identity; previous acknowledgement invalid. Re-inject only after current ownership/config/custody checks; unavailable helper leaves Native unstarted. |

Current `rotateKey` reseals and swaps in-memory state (`secret-catalog-service.ts:194-209`); the caller owns external key provisioning. This research does not invent an atomic key-source rotation protocol. C1 must test and truthfully refuse the mismatch window.

