# e2e/src/fixture/

- line-buffer.ts — line-buffered capture of a child stream + async waitFor matcher + jsonLine parser
- paths.ts — repo layout paths (core dir, taki-node binary) + dummy/explicit-file/.env.local real provider env builders
- procs.ts — spawnProc/killTree (Windows tree-kill) + getFreePort + hermetic childEnv
- rpc-socket.ts — raw out-of-process JSON-RPC WS client (id-correlated requests + notification waits)
- ws-relay.ts — loopback-only capability request/response transformer with directional counts and bounded shutdown
- operator-drivers.ts — negotiated and explicit legacy operator pairing, L1 capability/Approval drivers, L2 chat and typed operator reads
- seed-timeline.ts — pre-boot timeline pollution (character "taki") via core's seed-timeline-cli; hallucination L2 setup
- seed-memory.ts — pre-boot memory entry files into the workspace memory tree (startup reconcile indexes them); name-recall L2 setup
- seed-canonical-memory.ts — pre-boot migrated empty canonical Local authority and global/Character banks for isolated production-shaped tests
- stack-support.ts — JSON log/audit parsing, node seed data, and bounded multi-process teardown for withStack
- with-stack.ts — THE fixture: boots an isolated Core with bounded test env plus one Node by default or an optional second isolated Node, pairs Nodes sequentially by distinct debug names, exposes independent process/relay/audit kill+restart state plus Stack helpers (l1/agentSay/timeline), seeds node/core state, and guarantees process/temp-dir teardown
- node-process.ts — isolated debug taki-node spawn with optional catalog override, deterministic pairing injection, and independent kill/restart lifecycle
