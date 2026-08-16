# Host-Local Encrypted Credential Catalog and Adapters

## Goal

Prove and implement secure writable credentials on every owning Execution Host without returning secret values through
ordinary Core/Host/UI surfaces.

## Dependencies

- `08-12-host-control-foundation` and `08-12-approval-productization` complete. (Both converged 2026-08-16;
  host-control retains only its deferred two-Node process evidence in Slice 8.)
- Dependency additions are pre-authorized by the owner ruling recorded in `docs/ZCODE-HANDOFF.md` §3.3/§19 when they
  are the most efficient correct solution — conditional on the spike gates below (Node 24, TypeScript, packaging,
  wrong-key/tamper/crash proofs), lockfile update, and a documented reason.

## Scope

- Dependency/packaging spike for exact official libsodium wrapper version and Node 24 build behavior.
- Versioned secretstream catalog envelope, atomic writes, tamper/wrong-key/crash recovery tests.
- Windows Credential Manager master-key helper/adapter and Linux `LoadCredentialEncrypted=` adapter.
- Dedicated authenticated sensitive operator command path; write-only set/clear plus presence/health.
- Backup, restore, key rotation, legacy plaintext migration, and sanitized diagnostics.

## Acceptance Criteria

- [ ] Secret values never appear in ordinary config/catalog/status/log/cache/error/run surfaces.
- [ ] Wrong key/tamper/truncation never rewrites the catalog or exposes partial data.
- [ ] Runtime set/clear survives restart without Core/systemd restart for ordinary application secrets.
- [ ] Host offline operations fail and are not queued; migration never deletes the only plaintext source early.
- [ ] Windows and supported Linux packaging smoke tests pass.

## Out of Scope

- OpenBao provider implementation; it remains an optional later profile.
- MCP lifecycle UI beyond the secret service seam.
