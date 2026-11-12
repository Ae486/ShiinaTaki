# Native Home to production Runtime acceptance

Date: 2026-10-23. The owner resumed automatic/live verification and requested stopping before human acceptance.

## Result

Four integrated scenarios passed on the final UI source in [2026-10-23T02-54-01-719Z/native-evidence.json](2026-10-23T02-54-01-719Z/native-evidence.json). The nested `native-home-production-runtime-*/result.json` records a passing production-Core scenario, stable Core/Shared/E2E hashes, no deadline expiry and successful cleanup. Native evidence independently records unchanged Desktop/source/example-binary hashes. The coordinator inspected the final rendered screenshot.

1. The real Home page connects to the actual production Core over authenticated WS and reads the newly delegated child and its model-intent input receipt.
2. Clicking Stop records the durable user latch and cancels that child's actual Run. The local scripted provider holds its first request to make this lifecycle interval reproducible.
3. Sending input from the real editor while stopped persists it as private pending input without another model request or latch removal.
4. Clicking Continue creates a new Run, consumes the queued input at the real model Effect, and renders the retained private result. The cancelled Run stays terminal; no parent continuation, Delivery or private-input relationship Timeline row is created.

There were four Core HTTP requests: three local HTTP 200 responses and one request actually cancelled by the client. No external provider or paid model was used. The model responses are scripted; the UI/Core/SubagentService/SQLite/SDK transport and controls are real. The native shell is the existing isolated debug example, not the user's profile or a packaged release. Playback and human usability acceptance are not claimed.

## Native-found UI correction

The first integrated run also passed its lifecycle assertions and retained screenshots in `2026-10-23T02-44-49-787Z/`. Visual inspection showed `Execution 1/2` labels implying chronological order even though the API pages by random `run_id`, and supplied no chronological ordinal. The earlier-cancelled Run could therefore appear as the second execution.

The coordinator verified `subagentHistory` and the execution repository's `ORDER BY run_id`, then removed the invented array-index ordinal from `subagent-detail.tsx`. Each row now displays its actual execution state. No schema, cursor, ordering or control behavior changed. The final native run verifies both retained states and absence of invented ordinals; its result screenshot scrolls the actual result into view. The feature index and Home contract were updated.

## Reproduction and files

```text
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --example c2-presence-fixture
pnpm exec eslint apps/desktop/test/s7-subagent-runtime-smoke.mjs apps/desktop/src/features/subagents/subagent-detail.tsx
node apps/desktop/test/s7-subagent-runtime-smoke.mjs
```

All commands ran in `H:/TakiAgent-worktrees/t4`. The existing Vite large-chunk advisory remains; it did not fail the build. The script launches the native example with `windowsHide: true`, isolated assets/WebView storage and an ephemeral Core endpoint. It retains task-owned evidence, closes its own UI/Core/provider/asset resources, and leaves real profiles untouched.

The coordinator owns the new `apps/desktop/test/s7-subagent-runtime-smoke.mjs`, the single presentation correction, its feature/test indexes and the Home spec note. The R2 owner supplied the additive test-only `AgentContextScenario.wsUrl` seam. There is no production debug endpoint or replacement Subagent RPC server in this test.

The first script lint caught an unsafe throw directly in `finally`; finalization now reports cleanup/evidence failure through its helper while retaining an existing scenario failure. Final scoped lint passes. Final whole-workspace checks and independent review are recorded by the coordinating acceptance report, not inferred from this native run.
