# Host Secret Catalog — Execution Plan

> Design: `design.md`. Seams: `research/live-secret-catalog-seam-map.md` (file:line anchors). Execute as ONE
> coherent wave with focused tests throughout; one formal check after convergence. Every changed production file
> keeps its INPUT/OUTPUT/POS header; affected `index.md` files updated.

## Phase 0 — Spike gates (adopt or reject the wrapper BEFORE building on it)

1. Add `libsodium-wrappers@0.8.4` to `packages/core`. Prove under Node 24 + vitest: secretstream encrypt/decrypt
   roundtrip; wrong-key rejection; tampered-body rejection; truncated-stream rejection; Wasm module load in the
   plain-Node paths Core actually uses (no bundler). If any gate fails, STOP and report — do not silently swap
   wrappers (a swap reopens the frozen-research question).

## Phase 1 — Shared protocol

2. Define the sensitive operator command schemas in `@taki/shared` (strict Zod, following existing method schema
   conventions): set/clear/presence-family with opaque `secretRef`, key/version metadata, and write-only result
   shapes (presence/provenance/health; structurally incapable of carrying a value). Fixtures + schema tests.
3. Register Core methods with `roles: ["operator"]` via the one-register-call seam; handler errors are sanitized to
   bounded app exceptions BEFORE `method-registry.ts` verbatim echo points (`:100-103`, `:113-121`).

## Phase 2 — Rust key helper

4. Small release-safe bin in the existing Tauri crate (reusing `secrets.rs` `KeyringStore`): create-only versioned
   master key get/create; writes key bytes to stdout for the calling process only; bounded diagnostics without key
   material. Linux path reads `$CREDENTIALS_DIRECTORY` (systemd `LoadCredentialEncrypted=`); absence fails closed.
   Unit tests + `cargo clippy -D warnings` clean.

## Phase 3 — Core catalog service

5. Versioned envelope file with staged atomic write + fsync + rename (mirror `hosts/host-identity.ts:28-68`);
   secretstream crypto; presence/health; rotation; backup/restore validation. Wrong key/tamper/truncation never
   rewrites the file and never exposes partial plaintext.
6. Method handlers wired to the catalog; every response/log/error path value-free (sentinel probes in tests).
7. Legacy plaintext migration: copy `mcp-servers.json` `env`/`headers` values into the catalog, verify encrypted
   read-back, THEN rewrite the source to opaque references — never delete the only plaintext source before
   verification (PRD AC4). `.env.local` untouched.

## Phase 4 — CLI/Desktop seams (minimum)

8. CLI secret set/clear reads values from stdin (never argv). Desktop surface is Slice 6's management UI; this
   slice exposes only the WS methods the CLI exercises.

## Phase 5 — Verification

9. Focused suites: shared schema/fixture tests; core catalog/migration/method tests (incl. sentinel-absence
   probes over logs/responses/errors); Rust helper tests.
10. Real process: extend `withStack` with a Core restart helper; e2e proving set → restart → presence survives
    without systemd/Core restart semantics for ordinary application secrets; offline-Host operation fails (never
    queues).
11. Full gates: `pnpm -r typecheck`, `pnpm lint`, package test suites, `cargo test --locked` + clippy, locked
    builds, `git diff --check`, header/index audits.

## Exclusions

No MCP CRUD/reload UI, no Skill lifecycle, no OpenBao, no Node-host catalog replication, no Heartbeat/Scheduled
Task work. Do not weaken the Slice 2-4 contracts.

## Rollback points

- Phase 0 failure → remove the dependency, report; nothing else depends on it yet.
- Any phase leaves prior behavior fail-closed intact; the catalog is additive until Slice 6 consumes it.
