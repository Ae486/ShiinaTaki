# Host Secret Catalog — Technical Design

> Frozen architecture: `../../08-10-skills-mcp-productization/research/vps-secret-backend-options.md`.
> Live seams: `research/live-secret-catalog-seam-map.md` (file:line anchors). This document records the design
> decisions the implementation must follow; it does not reopen product choices.

## Authority and planes (frozen)

1. Core SQLite stores sanitized secret metadata and opaque references only — never values.
2. The owning Host stores encrypted secret values in a versioned local catalog file. MVP target is the Core host
   (Core-local MCP needs it in Slice 6); the same envelope design applies to later paired Nodes.
3. Runtime generations/leases remain Host-local in-memory truth (Slice 6 concern; this slice only provides the
   catalog service seam).

## Crypto and key model

- Envelope: libsodium secretstream, versioned file format with a header of `{version, createdAt, keyVersion}`;
   atomic staged write + fsync + rename mirroring the host-identity publication pattern
   (`packages/core/src/hosts/host-identity.ts:28-68`). Never rewrite over an unreadable/tampered catalog — fail
   closed with a sanitized diagnostic and preserve the file for inspection.
- Wrapper: `libsodium-wrappers@0.8.4` (official Wasm; Node 24 + TypeScript in-place, no toolchain change;
   `sodium-native` rejected — Bare-runtime model, unpinned Node 24 support). Adoption is gated on the Phase 0
   spike proofs.
- Master key: versioned, host-local. Windows: Credential Manager via a small release-safe Rust bin in the existing
   Tauri crate reusing `secrets.rs` `KeyringStore` (create-only semantics; prints key bytes to stdout for the
   calling Core process only). Linux/VPS: `systemd LoadCredentialEncrypted=` via `$CREDENTIALS_DIRECTORY`.
- Account model (Windows MVP, frozen): interactive-user model — Core and taki-node both run as the logged-in
   user; no service-account or SYSTEM behavior is claimed. Documented boundary, not a silent assumption.

## Sensitive command path

- New operator-only Core methods (`secret.set` / `secret.clear` / `secret.presence`-family; exact names follow the
   existing method-registry conventions) registered with `roles: ["operator"]` through the one-register-call seam
   (`packages/core/src/server/method-registry.ts:60-78`). Set/clear are write-only: they return
   presence/provenance/health, never values.
- Secret-echo prevention: handlers sanitize errors BEFORE the registry's verbatim paths (zod `issues` echo at
   `method-registry.ts:113-121`, `error.message` echo at `:100-103`) — secret-adjacent failures surface bounded
   app exceptions only. CLI takes values via stdin, never argv (shell-history leak).
- Offline Host semantics: secret operations on an unavailable owning Host fail closed; nothing queues.

## Migration and durability

- Legacy plaintext sources (`mcp-servers.json` `env`/`headers`, `.env.local` conventions) are read-only inputs.
   Migration copies into the catalog and verifies an encrypted read-back BEFORE any source rewrite; the only
   plaintext source is never deleted early (PRD AC4). `.env.local` is not auto-migrated.
- Backup/restore/rotation: rotation re-encrypts under a new key version atomically; backup is the versioned
   envelope file plus key-version metadata; restore validates version + integrity before accepting.
- Crash safety: truncation/partial writes leave the previous catalog intact (staged write); wrong key or tamper
   fails closed without exposing partial plaintext.

## Test strategy

- Unit: secretstream roundtrip matrix (wrong key, tampered body, truncated file, crash-during-write via staged
   rename, rotation, restore). Method tests: operator-only role, write-only responses, sanitized errors, no value
   in logs/responses. Migration tests: copy-verify-rewrite ordering, source preservation.
- Real process: extend `e2e/src/fixture/withStack.ts` with a Core restart helper; prove set → restart → presence
   retains without Core/systemd restart for ordinary application secrets.
- Packaging smoke: Windows dev run + Linux `taki-node` locked build paths load the Wasm module.
