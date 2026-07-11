# e2e/src/

Headless end-to-end scenarios (PRD 07-11-e2e-test-harness layer B). Run with `pnpm --filter @taki/e2e test:e2e`
(requires a debug `taki-node` build: `cargo build --bin taki-node --manifest-path apps/desktop/src-tauri/Cargo.toml`).

- fixture/ — the reusable withStack harness (see fixture/index.md)
- reconnect.e2e.test.ts — node pairs once, reconnects by persisted token (no second pairing code)
- screenshot-l2.e2e.test.ts — L2 agent drive: real LLM asked to screenshot (key-gated; the H2 diagnosis)
