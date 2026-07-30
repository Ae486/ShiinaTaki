# testing/

- mock-language-model.ts — MockLanguageModelV4 factories: streaming / slow-streaming (abort-window) / failing / mid-stream-error / scripted tool-loop (stream) + generating / failing-generate / scripted (non-streaming generate); test-only
- memory-store.ts — :memory:-SQLite conversation-store fixture (db + repo + store); test-only
- memory-fixture.ts — memory store + repo + tokenizer + reconcile fixture with reopenDb (rebuild-equivalence) and overridable bm25 weights / stoplist; test-only
- companion-fixture.ts — conversation store + memory engine over one db (timeline wired as in main.ts), with reopen (restart); test-only
- rm-temp.ts — best-effort temp-dir teardown tolerating the Windows sqlite handle-release quirk; test-only
- capture-logger.ts — pino-shaped logger stub that records (level, obj, msg) for assertions; test-only
- mcp-fixture.mjs — 3-method stdio MCP server (initialize/tools/list/tools/call) spawned by the manager integration test; test-only
- ws-test-client.ts — WS integration-test client harness (makeClient/openClient + frame helpers); test-only
- capability-tool-harness.ts — ConnectionRegistry + CapabilityBroker doubles for the Shell-backed capability tools; test-only
- seed-timeline-cli.ts — pre-boot CLI seeding timeline rows into <dataDir>/taki.db via the real migrations + repo (e2e polluted-history); test-only
