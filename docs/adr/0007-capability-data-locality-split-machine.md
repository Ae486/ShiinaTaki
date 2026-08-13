# Capability and data locality in single- vs split-machine deployments

TakiAgent runs as one client/server system (ADR 0001): a headless Agent Core (the brain — LLM loop, DB, memory, scheduler) exposing a WS API, and one or more Nodes (the hands — the Rust Shell, a future phone) that connect and declare the Capabilities they provide. The Core never touches the OS (invariant 1); every OS action executes on a Node behind its Permission Gate. This ADR settles where the two processes sit and, when they are split across machines, whose files and processes the agent acts on.

Two deployment topologies, one codebase:
- **Single-machine (v1 default, most users):** Core and Shell run on the same Windows box, talking over a loopback socket (`ws://127.0.0.1`). Zero latency, no network exposure.
- **Split-machine (v1.5, optional):** Core runs on a Linux VPS, the Shell + Pet UI stay on the user's Windows host, talking over a real network socket (`wss://`, secured by the existing pairing + keyring token, ADR 0004). Only the headless brain relocates; everything the user sees or touches stays local. Enabled by an operator who wants to offload LLM/DB compute off the host (the low-footprint goal) and happens to own a VPS — not required.

**Decision — Stance A: the host is the agent's world; the VPS is pure compute offload.** The companion's job is to sense and act on the user's own machine (their screen, processes, clipboard, files). Therefore every Capability that touches user data or the OS — screenshot, process-list, clipboard, shell-open, **exec, and file read/write** — executes **Node-side (on the host)**. The Core (VPS or local) holds only agent-internal state: the DB, memory layers, the skills registry, the scheduler. This mirrors the Claude Code model exactly: a remote brain whose local client executes tools against the user's machine and ships results back.

Rules:
- Capabilities are routed to the Node that declares them (`findNodeForCapability`); they run where the Node runs. The Core decides, the Node acts. A split adds one network hop, nothing more.
- The Core is never a file/process actor for user-facing work. Its Workspace holds agent-internal state; it is not where the agent's user-facing file activity must physically land in a split deployment.
- `exec` cwd is **Shell-resolved, never assumed to be Core's filesystem**: it defaults to the Workspace directory when that path exists on the Shell's host (the single-machine case), and to a Shell-owned working directory otherwise. exec never fails because it assumed Core's Workspace on a machine that has none.

Considered and rejected:
- **Stance B (agent lives on the VPS; the host is only eyes+hands for screen/clipboard):** makes taki a cloud agent whose files live on the VPS. Rejected — it contradicts the product (a companion for *your* machine): the agent would write files the user cannot see and cannot act on their real projects.
- **Two separate builds (a "single-machine app" and a "client/server app"):** rejected — the Core/Node split (ADR 0001) already is the client/server seam; deployment differs only in process placement and socket security, not in code. invariant 8 already keeps `packages/core`/`packages/shared` OS-neutral precisely to let the Core run unchanged on the Ubuntu VPS.

Consequence, phased (so v1 ships without rework):
- **v1 (single-machine):** file read/write remains Core-side TS as built in #11 — Core and host share one disk, so Core-side `node:fs` and a Node-routed file capability are indistinguishable. exec (#12) runs Node-side with cwd defaulting to the Workspace. Nothing about Stance A is observable yet; no #11 rework.
- **v1.5 (split-machine, when built):** file read/write **migrates from Core-side to a Node-routed Capability** so it lands on the host, exactly like exec/screenshot already do. This is a localized change to the file-capability placement decision recorded in #11's devlog, not a redesign — the gate, broker, and routing spine already carry it. Network transport hardening (routable bind + `wss`/TLS + pairing over the network) is the other v1.5 work item; the protocol and auth (ADR 0004) already exist, so it is configuration + hardening, not new architecture.

---

**Amendment 2026-08-13 — locality and authority are orthogonal:** an Execution Host owns where a capability, Workspace,
Skill resource, MCP instance, credential, or OS effect executes; Core Authority owns the profile's durable global
Permission Level and common policy. Core sends a complete versioned projection to the selected Host, bound to the
explicit Host plus connection/catalog generations. The Host classifies its local arguments and may tighten the result,
but availability, path labels, display names, or a different Host's legacy allow can never widen policy or select a
replacement execution location implicitly.
