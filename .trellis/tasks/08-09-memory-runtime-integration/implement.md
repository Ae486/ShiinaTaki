# Runtime Recall, Tools, and Memory Policy - Execution Plan

Planning remains inert until B6 is explicitly started after B5 contracts are reviewed. Keep edits serial for shared
`main.ts`, `chat-agent.ts`, `run-snapshot-capture.ts`, and registry wiring; recheck migrations before assigning schema work.

## Wave 1 - Snapshot/provider coordinator wiring

**Ownership:** provider/coordinator construction, immutable capability snapshot, RunSnapshot and tool factory wiring.

**Proof:** one captured provider identity/capability set is used by coordinator and tools; drift returns structured
authority/outcome-unknown errors; Hindsight selection fails closed until a real provider is installed.

## Wave 2 - Automatic recall projection

**Ownership:** outgoing request preparation, Global/active Character parallel recall, shared budget, ephemeral
`<turn-context>` projection, timeout/partial results, and measurement ordering.

**Proof:** recall is present before request measurement and absent from stable/timeline/summary/Write Gate/Retain paths;
foreground chat continues on timeout or complete recall failure.

## Wave 3 - Canonical tools, ingestion, and policy

**Ownership:** canonical memory tool registry, compatibility aliases, primary conversational Write Gate routing, separate
autonomous provenance, Hindsight narrow curator, and Local full maintenance selection.

**Proof:** one advertised vocabulary, bounded structured errors, no feedback loop, correct bank routing, and policy edits
go only through the authority provider.

## Wave 4 - Flush/recovery integration and quality gate

**Ownership:** `MemoryFlushPort` pre-retirement durability binding, B5 Pending recovery coordinator invocation, status /
diagnostics projection, and focused/full quality checks.

**Proof:** accepted Local work is durable before retirement; Pending replay is ordered and CAS-fenced; no generic blind
Effect replay or automatic authority failover. Live activation remains gated by B4 current-Local coverage and owner
approval.
