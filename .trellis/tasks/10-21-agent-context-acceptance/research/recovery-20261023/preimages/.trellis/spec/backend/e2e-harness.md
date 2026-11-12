# E2E Harness Guidelines

> The headless e2e harness lives in `e2e/` (`@taki/e2e`). It boots the full stack — core (`node packages/core/src/main.ts`) + the headless `taki-node` binary — with automated pairing and deterministic teardown. Run: `pnpm --filter @taki/e2e test:e2e`.

## Group tests by behavior and isolation

Use `e2e/src/<name>.e2e.test.ts` calling `withStack(opts, fn)`. Related scenarios may share a file when that keeps one
behavior and its setup readable; use separate files for distinct concerns or isolation needs. Tests and test-only
harness/fixture files have no file/function line caps: do not split them solely to meet a numeric threshold. Keep
independent cleanup and non-size lint rules. The fixture exposes capability-agnostic helpers (`l1`, `agentSay`,
`audit()`, `screenshots()`, `waitForCoreLog`, ...); a new capability check reuses them.

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

## Real-provider observation

- A new paid acceptance suite requires its explicit opt-in as well as provider credentials; merely running the normal
  E2E suite must not enable it. C3 uses `TAKI_E2E_REAL_INITIATIVE=1`. This does not change older L2 suite gates.
- `fixture/real-provider-observer.ts` binds loopback and forwards the original request body and streamed upstream
  response body without substituting model answers. Respect downstream backpressure and propagate cancellation.
  A partially forwarded response remains incomplete on failure; never append fabricated success/error JSON to it.
- Diagnostics retain only bounded tool-schema shape, HTTP status, closed failure reasons, allow-listed provider
  code/type and the boolean object-root-schema rejection classification. Inspect at most 8 KiB of an error body;
  do not retain raw provider error text or assume replacing one literal API key removes echoed request content.
- Context probes inspect outgoing messages and publish booleans only. A selected-Memory marker must occur exclusively
  in its seeded Memory Block, not also in a Pattern purpose or user request. Use a separate unique primary-history
  marker. A valid structural decision alone does not prove which context was actually sent.
- Close owns in-flight uploads, upstream requests and server connections. Scenario teardown attempts every independent
  close, evidence write and temporary-directory cleanup even after a prior failure. Preserve the original scenario
  error; a previously passing scenario must fail when teardown or required evidence fails.
- Synthetic test prompts/replies may be retained in the explicitly requested evidence artifact for semantic review;
  this is separate from non-content relay diagnostics and ordinary Core logs. Natural-language clarification needs
  that review: no stored Pattern plus a nonempty reply does not by itself prove the reply clarified the request.
- Local HTTP regressions verify bytes, bounded diagnostics, backpressure and cancellation without external API calls.
  They establish the observer's behavior, not real-model capability or native presentation acceptance.

## Scenario: delegated real-browser playback acceptance

### 1. Scope / Trigger

After owner authorization to operate the computer, exercise the staged extension, paired desktop Shell and Core
against a real selected video. Keep this distinct from model-backed Co-Watching acceptance.

### 2. Signatures

Use the existing Home `browser_attachment_pair` action, extension options form, `browser.playback.read`, and
operator `config.set` for `TAKI_BROWSER_PLAYBACK_ENABLED`. Do not inject synthetic samples as real-page evidence.

### 3. Contracts

- Use a separate Edge user-data directory and loopback CDP endpoints. Home may use the documented WebView2 CDP recipe.
- Pair through the trusted Home and extension options contexts. Keep the dedicated attachment token in memory;
  never print it, write it into the harness, export account cookies, or hand it to the video page.
- Keep the existing `TAKI_SHELL_DATA_DIR` spelling byte-for-byte. The current `lib.rs::build_client` hashes the raw
  path into its isolated keyring service. Windows slash aliases can currently select different identities (T4-D83).
- A direct debug Shell launch still needs Vite. The Tauri dev supervisor may terminate Vite after Shell exit;
  restart that server or supervise it independently before evaluating reconnection.

### 4. Validation & Error Matrix

| Condition | Required interpretation |
| --- | --- |
| Paused video with increasing sequence and fresh reception | Valid paused source; pause is not disconnect |
| Shell loss / browser exit / reception disabled | Retire sources; do not reuse their references on recovery |
| Core restart | Revalidate current Host and new source identity; pre-restart counters alone are not identity |
| Browser exit | Session credential is absent; explicit local pairing is required again |
| Edge blocks the unpacked extension after restart | Check the visible developer-mode control in this test profile |
| `Pairing required` after changing the configured path spelling | Inspect the isolated keyring namespace before re-pairing |

### 5. Good / Base / Bad Cases

Good: control the real player, compare position/state to Core, then repeat after process restart.
Base: report source-only acceptance and leave commentary gates incomplete.
Bad: call mocked capture, a listening port, or a stale source snapshot successful browser acceptance.

### 6. Tests Required

Assert playback advance, paused freshness beyond receiver expiry, seek/rewind, visibility, exact media/document
replacement, disable/enable retirement, Shell/Core reconnection, and loss of session credentials on browser exit.
Retain failures and repaired harness runs separately. Observe dev-mode persistence after a clean browser restart.

### 7. Wrong vs Correct

Do not rewrite an existing profile path with `Join-Path` and assume its keyring identity is unchanged. Reuse the
recorded environment literal until T4-D83 has a compatibility-safe migration. Do not edit browser preference files
to bypass extension controls; operate the visible control under the owner's existing testing authorization.

### Real-model prepared-playback composition

`packages/core/src/co-watching/real-prepared-playback.test.ts` requires
`TAKI_E2E_REAL_PREPARED_PLAYBACK=1`, the existing `TAKI_PROVIDER_*` credentials/model, a hash-pinned
`TAKI_E2E_NATIVE_RESULT_PATH`, and `TAKI_E2E_PREPARED_EVIDENCE_DIR`. Its optional Core/CDP endpoints must be loopback.
Ordinary package tests skip it even when provider credentials exist. It operates the current selected test video;
the owner must have authorized browser control and real-model use before invoking it.

The real components are ChatAgent/SDK, confined file tools, stored original native analysis, live browser/Core
observations and SQLite Run/Effect/Timeline owners. Acceptance, captured governance/Host snapshot and final client
transport remain controlled fixtures. Report those limits instead of claiming the production Co-Watching UI works.
Non-primary preparation must not append conversation rows. Foreground revision retains actual tool-call/results.
Two publication children must have no model Effects; expiry/Stop must prevent later output and replay.

Persist model usage/Effects after each completed phase and on failure before fixture cleanup. A later assertion
failure must not discard already reported usage. Counters are observed SDK/Effect calls, not proof of every physical
HTTP attempt or billed cost. Missing rows remain unknown. Preserve failed runs rather than merging their costs into
a later passing subtotal. Raw provider exceptions cannot become assertion causes because they may echo credentials.
