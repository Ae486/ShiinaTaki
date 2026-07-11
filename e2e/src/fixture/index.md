# e2e/src/fixture/

- line-buffer.ts — line-buffered capture of a child stream + async waitFor matcher + jsonLine parser
- paths.ts — repo layout paths (core dir, taki-node binary) + dummy/real provider env builders
- procs.ts — spawnProc/killTree (Windows tree-kill) + getFreePort + hermetic childEnv
- rpc-socket.ts — raw out-of-process JSON-RPC WS client (id-correlated requests + notification waits)
- operator-drivers.ts — operator-side drivers: pairing handshake + sayToAgent (L2 chat drive)
- with-stack.ts — THE fixture: boots core + headless node, automates pairing, Stack helpers, guaranteed teardown
