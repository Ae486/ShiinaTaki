# testing/

- mock-language-model.ts — MockLanguageModelV4 factories (streaming / failing / mid-stream-error / scripted tool-loop models); test-only
- memory-store.ts — :memory:-SQLite conversation-store fixture (db + repo + store); test-only
- memory-fixture.ts — memory store + repo + reconcile fixture with reopenDb (rebuild-equivalence); test-only
- companion-fixture.ts — conversation store + memory engine over one db, with reopen (restart); test-only
- rm-temp.ts — best-effort temp-dir teardown tolerating the Windows sqlite handle-release quirk; test-only
- ws-test-client.ts — WS integration-test client harness (makeClient/openClient + frame helpers); test-only
