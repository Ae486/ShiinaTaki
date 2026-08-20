# Host-Local Encrypted Secret Catalog

The Core-owned credential store for Host secrets (MCP credentials first). Secret values live ONLY inside the
versioned encrypted envelope on the owning Host's disk; Core SQLite, config files, logs, WS responses, errors,
and caches carry opaque `secret-ref:` markers and sanitized metadata only. Implemented by the
`08-12-host-secret-catalog` slice (commits `0965358` + `c26e3f8`).

## Scenario: Secret catalog storage and sensitive command path

### 1. Scope / Trigger

Apply when changing: `packages/core/src/secrets/**`, `secret-catalog-schema.ts`, `secret-methods.ts`,
`taki-secret-key.rs`, `mcp-secret-migration.ts`, `secret-ref.ts` resolution, or any consumer that stores or
reads a secret value (Slice 6 MCP lifecycle, later Node-host catalogs).

### 2. Signatures

- Envelope `TSC1`: secretstream (libsodium `0.8.4` Wasm via `libsodium-wrappers`, pinned) with the header bound
  as AAD to `{version, storeId, keyVersion}`; one FINAL-tagged chunk; staged `wx` 0600 + fsync + create-only
  link / rename publication mirroring `hosts/host-identity.ts`.
- Master key: 32 bytes, versioned. Sources: `TAKI_CREDENTIALS_DIRECTORY`/`CREDENTIALS_DIRECTORY` (systemd
  `LoadCredentialEncrypted=`) or `TAKI_SECRET_KEY_HELPER` → `taki-secret-key` bin (Windows Credential Manager,
  create-only, `[u32 LE 32][bytes]` stdout frame; diagnostics never carry key material; interactive-user account
  model). Windows first creation is serialized by a `Global\` mutex whose SHA-256 identity binds the process-token
  user SID, keyring service, and account. New credentials explicitly use `persistence=Local`; existing credentials
  remain readable without migration. Framing parity is pinned by unit tests on both sides of the language boundary.
- WS surface: `secret.set/clear/presence/list` — operator-role only, write-only result shapes that are
  structurally value-free (strictObject rejects a smuggled `value`).

### 3. Contracts

- Locked semantics: no key source (or unreadable/wrong key/tampered file) ⇒ `health:"locked"`, reads report
  unknown presence, every mutation fails closed with `SECRET_REFUSED` + machine `reason`; boot NEVER mints a
  fresh store over existing ciphertext and never rewrites a file it could not open (byte-identical on failure).
- Error discipline: catalog/refusal errors are converted to bounded app exceptions BEFORE the method-registry
  verbatim echo points (`error.message` and zod `issues`). Secret values never appear in any error surface.
- Secret resolution: `secret-ref:` markers resolve ONLY just-in-time at MCP connect (`mcp-manager`), never into
  config, logs, or cached state; an unresolvable ref skips only that server, fail-closed.
- Migration ordering (PRD AC4): copy → `verifyEntries` encrypted read-back → only then staged rewrite of the
  plaintext source to opaque refs; every failure stage leaves the source byte-identical; `.env.local` is never
  touched; the only plaintext source is never deleted before a verified encrypted copy exists.
- CLI takes secret values via stdin only (never argv / shell history).
- Windows `set_if_absent` holds the SID/service/account mutex across read-and-create. A losing creator returns
  `false` and must reread the persisted winner; token and mutex handles are released/closed on every path. The debug
  file store is process-local only, so parallel debug nodes require distinct temporary data directories.
- Offline owning-Host secret operations fail immediately; there is no queue/retry/persistence path.
- Boot behavior: an unlaunchable or create-refused helper with NO existing catalog fails boot fast with a
  sanitized diagnostic; with an existing catalog the same failure degrades to `locked` and boot survives. Both
  are fail-closed.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrong key, tampered byte, truncation, missing TAG_FINAL, AAD splice, bad magic, future version | Sanitized `SecretCatalogError` category; file byte-identical; no partial plaintext |
| No key source at boot with existing catalog | Locked; no fresh mint; no rewrite |
| Secret-bearing handler throws or fails validation | Bounded `SECRET_REFUSED`; no value in echo/logs |
| `secret.set` with value-sized-over-limit or smuggled value field | Schema rejection without value echo |
| Migration stage failure (copy/verify/write/locked/collision/unparsable) | Source byte-identical; re-run is a no-op |
| Helper: existing key account on `create` | Refuse (create-only); never overwrite |
| Concurrent Windows creators for the same SID/service/account | One Local-persistence winner; every loser rereads it |
| Process-token SID, mutex wait, or handle operation fails | Refuse creation with sanitized error; never overwrite |

### 5. Good / Base / Bad Cases

- Good: two same-user sessions create one account concurrently; the global mutex serializes them and both processes
  converge on the same persisted key or device identity.
- Base: an older Enterprise-persistence credential already exists. The Local-modified entry reads it without rewriting;
  only a later explicit replacement changes persistence.
- Bad: use a session-local mutex, omit the user SID/service/account from its identity, or use get-then-overwrite. Any of
  these can make the catalog key differ from the key used to encrypt the winning file.

### 6. Tests Required

Envelope matrix (wrong-key/tamper/truncation/final-tag/AAD/magic/version), service restart/lock/rotation/
backup-restore (foreign-store refused), master-key env precedence + Rust framing parity, migration ordering
per stage, method sentinel probes over responses/errors/logs, CLI stdin round-trip, and the real-process e2e
(set → Core restart → presence survives; key-source removal → locked fail-closed; boot migration rewrites
plaintext after verified copy). Rust coverage also pins create-only contention, SID/service/account mutex partitioning,
device-identity loser adoption, non-Windows test cfg compilation, strict Clippy, and the helper binary contract.

### 7. Wrong vs Correct

```rust
// Wrong: two sessions can both observe absence and overwrite the account.
if store.get(account)?.is_none() {
    store.set(account, generated_key)?;
}

// Correct: the Host-local adapter serializes create-only publication; losers adopt persisted truth.
if !store.set_if_absent(account, generated_key)? {
    return store.get(account)?.ok_or_else(|| "winning credential missing".to_string());
}
```

### Residual verification (recorded, not blocking)

Real-Linux systemd/Wasm/locked-build proofs, live Windows keyring round-trip, and `desktop:build` packaging
smoke remain manual/owner-dispatch items. Operator surfaces for backup/restore/rotation arrive with Slice 6
consumers.
