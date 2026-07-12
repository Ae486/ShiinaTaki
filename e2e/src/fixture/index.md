# e2e/src/fixture/

- line-buffer.ts — line-buffered capture of a child stream + async waitFor matcher + jsonLine parser
- paths.ts — repo layout paths (core dir, taki-node binary) + dummy/real provider env builders
- procs.ts — spawnProc/killTree (Windows tree-kill) + getFreePort + hermetic childEnv
- rpc-socket.ts — raw out-of-process JSON-RPC WS client (id-correlated requests + notification waits)
- operator-drivers.ts — operator-side drivers: pairing handshake + sayToAgent (L2 chat drive) + triggerCapability (L1 dev drive) + fetchTimelineEntries (persisted-turn fidelity reads)
- seed-timeline.ts — pre-boot timeline pollution (character "taki") via core's seed-timeline-cli; hallucination L2 setup
- with-stack.ts — THE fixture: boots core + headless node, automates pairing, Stack helpers (l1/agentSay/timeline), exec-policy + gate-decisions + timeline seeding, guaranteed teardown
