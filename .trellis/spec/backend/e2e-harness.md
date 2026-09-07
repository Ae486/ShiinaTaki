# E2E Harness Guidelines

> The headless e2e harness lives in `e2e/` (`@taki/e2e`). It boots the full stack — core (`node packages/core/src/main.ts`) + the headless `taki-node` binary — with automated pairing and deterministic teardown. Run: `pnpm --filter @taki/e2e test:e2e`.

## Add a test = add a file

Every scenario is its own `e2e/src/<name>.e2e.test.ts` calling `withStack(opts, fn)`. Never grow one file with many scenarios. The fixture exposes capability-agnostic helpers (`l1`, `agentSay`, `audit()`, `screenshots()`, `waitForCoreLog`, ...); a new capability check reuses them.

## Two tracks per capability — L1 first, then L2

**L1 — deterministic governance (the regression workhorse).** Drive the capability via `stack.l1(capability, input)`, which routes through the dev-only `capability.trigger` — the real `tool.execute`, minus the LLM. Assert the governance signal: the gate decision in `audit()`, a file landed, a structured error code, an absent field. Fast, no API cost, CI-green. Every capability MUST have L1 coverage.

**L2 — real agent (catches what L1 can't).** Drive via `stack.agentSay(text)` through the real LLM. Key-gated with `it.skipIf(!hasKey)` (no provider key → skipped → CI stays green), inside a `describe("L2 — real agent (may red until <fix>)")` block. Assert BOTH: (a) the `"tool invoked" {capability}` log (the agent really called it), AND (b) the end-to-end result. L2 is the only thing that catches tool-call hallucination.

## Rules

- **Assertions read files / audit / structured results only — never logged content** (no-content-in-logs invariant). L2 `console.log` may print status/counts/booleans for diagnosis, never the capability's content.
- **A single-turn empty-DB L2 CANNOT catch hallucination.** Empty history = nothing for the model to imitate, so the agent invokes the tool and the test is green whether the bug exists or not. Hallucination regression needs a multi-turn or polluted-timeline scenario (see `docs/deferred-decisions.md` D1). Do not treat a green single-turn L2 as proof the hallucination is gone.
- **`capability.trigger` is dev-only and must stay so**: registered only under `TAKI_DEV_TRIGGER=1`, operator-only, and it is NOT a governance bypass — it drives the same `tool.execute` the agent does, so every call still crosses Core policy and, for Host-owned actions, the Host's sealed projection/classification/final-enforcement path. Never register it in production; its schema never enters `@taki/shared`.
- The fixture must ALWAYS tear down (process tree + temp dirs) even on a boot failure — keep boot inside the try/finally.
- A focused Core lifecycle scenario may compose the existing process/RPC primitives directly when it requires a
  local scripted provider or graceful signal delivery absent from `withStack`. Keep any IPC preload test-only,
  release its own handle, isolate data/provider configuration and retain bounded failure cleanup. See
  `e2e/src/core-shutdown.e2e.test.ts` and the [shutdown contract](server-push-and-connection-auth.md#scenario-core-shutdown-drains-accepted-connections-before-storage).

## Test-only Host-frame relay

Use `e2e/src/fixture/ws-relay.ts` only when the behavior under test requires mutating a Core-to-Node wire frame that
neither public operator APIs nor production code can create, such as stale governance generation or same-generation
projection tampering.

- The relay is test-only, imported only from `e2e/`, binds loopback, forwards text frames as text, and parses a
  `capability.request` through the Shared schema before applying the requested transformer.
- Never add a production transport injection/debug hook to make an E2E easy. Never log frames, input, projection
  content, arguments, or outputs from the relay.
- Establish an accepted generation before injecting the adversarial frame. For projection tampering, recompute a valid
  canonical SHA-256 digest so the test proves lineage/content rejection rather than only malformed-digest rejection.
- Own the bound: assert one injected request, no execution/audit growth, no replay after a bounded wait, truthful Core
  settlement after the test retires the Host generation, zero active relay connections, closed relay, killed processes,
  and removed temp directories.
- A Buffer forwarded directly by `ws` becomes a binary frame; Rust intentionally ignores it. Normalize both directions
  through `String(data)` so the relay preserves the production text-frame protocol.
