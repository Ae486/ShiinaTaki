# e2e/src/fixture/

- line-buffer.ts — line-buffered capture of a child stream + async waitFor matcher + jsonLine parser
- paths.ts — repo layout paths (core dir, taki-node binary) + dummy/real provider env builders
- procs.ts — spawnProc/killTree (Windows tree-kill) + getFreePort + hermetic childEnv
- rpc-socket.ts — raw out-of-process JSON-RPC WS client (id-correlated requests + notification waits)
- ws-relay.ts — loopback-only capability request/response transformer with directional counts and bounded shutdown
- operator-drivers.ts — operator drivers: pairing, L2 chat, L1 capability drive (optional interactive owner), Approval prompt await/respond, Core Permission Level mutation, and persisted timeline reads
- seed-timeline.ts — pre-boot timeline pollution (character "taki") via core's seed-timeline-cli; hallucination L2 setup
- seed-memory.ts — pre-boot memory entry files into the workspace memory tree (startup reconcile indexes them); name-recall L2 setup
- stack-support.ts — JSON log/audit parsing, node seed data, and bounded multi-process teardown for withStack
- with-stack.ts — THE fixture: boots Core + one Node by default or an optional second isolated Node, pairs Nodes sequentially by distinct debug names, exposes independent process/relay/audit kill+restart state plus Stack helpers (l1/agentSay/timeline), seeds node/core state, and guarantees process/temp-dir teardown
- node-process.ts — isolated debug taki-node spawn with optional catalog override, deterministic pairing injection, and independent kill/restart lifecycle
