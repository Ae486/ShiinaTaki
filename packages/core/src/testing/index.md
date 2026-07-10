# testing/

- mock-language-model.ts — MockLanguageModelV4 factories: streaming / failing / mid-stream-error / scripted tool-loop (stream) + generating / failing-generate / scripted (non-streaming generate); test-only
- memory-store.ts — :memory:-SQLite conversation-store fixture (db + repo + store); test-only
- memory-fixture.ts — memory store + repo + reconcile fixture with reopenDb (rebuild-equivalence); test-only
- companion-fixture.ts — conversation store + memory engine over one db, with reopen (restart); test-only
- rm-temp.ts — best-effort temp-dir teardown tolerating the Windows sqlite handle-release quirk; test-only
- capture-logger.ts — pino-shaped logger stub that records (level, obj, msg) for assertions; test-only
- mcp-fixture.mjs — 3-method stdio MCP server (initialize/tools/list/tools/call) spawned by the manager integration test; test-only
- ws-test-client.ts — WS integration-test client harness (makeClient/openClient + frame helpers); test-only
