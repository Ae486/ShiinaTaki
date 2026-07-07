# JSON-RPC 2.0 over localhost WebSocket, with device identity and pairing from day one

All clients of the Agent Core (Rust Shell, Pet UI, future CLI / mobile nodes) speak JSON-RPC 2.0 over a localhost WebSocket, with message schemas defined once in a shared TypeScript package via zod and mirrored in Rust via serde. The protocol carries device identity, role (`operator` vs `node`), declared capabilities, and a pairing/approval handshake from v1 — borrowed from OpenClaw's nodes pattern — even though v1 ships only local clients.

Why not tRPC (TS-only, excludes the Rust client) or gRPC (codegen and binary framing overhead unjustified on localhost). JSON-RPC is trivially implementable from any language, human-readable in the audit log, and the schema lives in one place.

Why pairing now: the mobile companion (phone as a read-only node pushing notifications/usage signals, rendering the avatar) is a planned later phase. Device identity and pairing are protocol-shape decisions that are nearly free to include at design time and expensive to retrofit. Remote transport (VPS relay for off-LAN phones) stays out of scope for v1; the protocol must simply not assume localhost.
