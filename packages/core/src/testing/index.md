# testing/
- run-service-stub.ts — in-memory transport-only Run service fixture; linked persistence and accepted-purpose authority require real repository fixtures

- mock-language-model.ts — MockLanguageModelV4 factories: streaming / slow-streaming (abort-window) / failing / fail-then-stream + error-part-then-stream (the two R2 overflow transport endings) / mid-stream-error / scripted tool-loop (stream) + generating / failing-generate / scripted (non-streaming generate); test-only; resolving/rejecting bodies are scripted fixtures, with real fetch behavior covered by the server transport regression
- memory-store.ts — :memory:-SQLite conversation-store fixture (db + repo + store); test-only
- memory-fixture.ts — memory store + repo + tokenizer + reconcile fixture with reopenDb (rebuild-equivalence) and overridable bm25 weights / stoplist; test-only
- companion-fixture.ts — conversation store + memory engine over one db (timeline wired as in main.ts), with reopen (restart); test-only
- rm-temp.ts — best-effort temp-dir teardown tolerating the Windows sqlite handle-release quirk; test-only
- capture-logger.ts — pino-shaped logger stub that records (level, obj, msg) for assertions; test-only
- mcp-fixture.mjs — 3-method stdio MCP server (initialize/tools/list/tools/call) spawned by the manager integration test; test-only
- mcp-test-transport.ts — in-memory MCP transports (closedCount exactly-once assertions, deferred tools/call for in-flight leases, cursor-honoring tools/list for pagination) + memConnect; test-only
- ws-test-client.ts — WS integration-test client harness (makeClient/openClient + frame helpers); test-only
- hindsight-http-test-fixture.ts — ephemeral loopback HTTP servers and observable unfinished-response cancellation for Hindsight clients; test-only
- capability-tool-harness.ts — ConnectionRegistry + CapabilityBroker doubles, a REAL in-memory Approval service, and operator/Host Connection fakes for the Shell-backed capability tools; test-only
- seed-timeline-cli.ts — pre-boot CLI seeding timeline rows into <dataDir>/taki.db via the real migrations + repo (e2e polluted-history); test-only
- hindsight-application-fixtures.ts — complete hash-consistent D77 bundles/events and V1 baseline manifest fixtures
- hindsight-application-runtime-fixtures.ts — bound native/artifact fixtures with explicit native cursor overrides, an admitted capability manifest and isolated SQLite authority

- hindsight-runtime-composition-fixtures.ts — isolated SQLite/B3 runtime construction with exact native selectors and complete application history
- initiative-fixture.ts — isolated real SQLite Run/Attempt/Effect/Timeline/delivery owners for lifecycle and transaction tests
- prepared-publication-fixture.ts — explicit-report fixture with synthetic authorization, real SQLite/Character queue, optional linked-child participant and business adapter; test-only
- direct-request-report-fixture.ts — real primary witness/report acceptance and canonical model-free child/parent proposals for validity/publication tests
- real-playback-client.ts — explicit loopback Core/CDP connection for owner-authorized real-player controls and Shared-validated current playback; test-only, no credentials
- co-watching-fixture.ts — synthetic native/browser producers over real ChatAgent/SubagentService/Run/SQLite/Delivery owners; optional actual model/Skill/file composition with explicit context policy and main-model Utility fallback, default scripted artifact producer
- co-watching-tool-fixture.ts — actual shipped Co-Watching Skill loader and governed Workspace tools for isolated acceptance fixtures
- source-live-evidence.ts — physically capped real-provider observation, synthetic request capture and immutable per-trial Source evidence directories
- subagent-fixture.ts — synthetic real SQLite/Effect/ToolLoopAgent/child-service fixture with optional retained-image reader, without external calls or user Memory
