# core/secrets/
- catalog-custody.ts — owner-backed boot/revision/digest snapshots with fixed selection, bounded file reads and external replacement refusal; no public revision or value output.
- secret-catalog-envelope.ts — compatibility re-export of the boot-free shared TSC1 codec; unchanged authenticated format and sanitized errors.
- catalog-publication.ts — the staged-write + fsync + atomic-rename publication core (create-only link for first publication, rename replace after); shared by the catalog envelope and the legacy-config rewrite
- master-key.ts — bootstrap-key seam ONLY: $CREDENTIALS_DIRECTORY file (systemd LoadCredentialEncrypted=) or the taki-secret-key helper spawn (framed u32-LE stdout, key bytes never in errors); absent/invalid key = null = LOCKED, never a silent generate
- secret-ref.ts — the only ref-derivation/marker-parse site (`secret-ref:` in mcp env/header values; `mcp.<server>.env|header.<FIELD>` refs) + candidate-time ref capture for active/draining clear safety + just-in-time resolveMcpConfigSecrets for connect-time resolution
- secret-catalog-service.ts — the owning-Host catalog authority: async factory (Wasm load) then synchronous set/clear/presence/list, internal resolve/verifyEntries/revision, rotateToKey/backup/restore; whole-file re-seal per write; process-local publication generation rejects observation ABA; locked/unreadable stores fail every mutation closed without rewriting the file
- mcp-secret-migration.ts — PRD-AC4 ordering owner: reserve/validate existing marker identities, copy plaintext env/headers into the catalog, verify encrypted read-back, ONLY THEN rewrite; collisions and failures leave the source byte-identical; `.env.local` is deliberately untouched

Invariant (grep-verifiable): no module in this directory logs or returns a secret value — log lines carry opaque refs/counts/health only, and only `resolve`/`verifyEntries` (the internal non-WS seam) ever touch values.
