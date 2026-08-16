# e2e/src/fixture/

- line-buffer.ts — line-buffered capture of a child stream + async waitFor matcher + jsonLine parser
- paths.ts — repo layout paths (core dir, taki-node binary) + dummy/real provider env builders
- procs.ts — spawnProc/killTree (Windows tree-kill) + getFreePort + hermetic childEnv
- rpc-socket.ts — raw out-of-process JSON-RPC WS client (id-correlated requests + notification waits)
- ws-relay.ts — loopback-only Core-to-Node capability.request transformer with request counts and bounded shutdown
- operator-drivers.ts — operator drivers: pairing, L2 chat, L1 capability drive (optional interactive owner), Approval prompt await/respond, Core Permission Level mutation, and persisted timeline reads
- seed-timeline.ts — pre-boot timeline pollution (character "taki") via core's seed-timeline-cli; hallucination L2 setup
- seed-memory.ts — pre-boot memory entry files into the workspace memory tree (startup reconcile indexes them); name-recall L2 setup
- with-stack.ts — THE fixture: boots core + headless node, automates pairing, Stack helpers (l1/agentSay/timeline), exec-policy + gate-decisions + timeline/memory/mcp-servers seeding, hermetic secret-catalog master-key provisioning (temp credentials dir; never the OS keyring), core kill/restartCore on the same data dir/port, guaranteed teardown
