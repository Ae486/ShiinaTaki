# core/extensions/
- notify-extension-change.ts — optional bounded producer observation; subscriber failure cannot affect lifecycle truth and no source data or follow-up work is emitted
- extension-subscriptions.ts — opt-in connection membership and bounded microtask union of actual MCP/Skill/Host changes; isolated targeted fan-out and complete retirement
- extension-composition.ts — main.ts composition seam for compatibility Skill tools and per-Run Extension contexts
- extension-registry.ts — immutable per-Run host-qualified registry with collision rejection, bounded discovery/call, and Run-id-free stable model context while internal snapshots/results retain authority identity
- extension-run-context.ts — one-shot Host/Skill/MCP Run assembly with captured MCP display names and disclosure metadata reused across model retries
- extension-sources.ts — captured registry adapters; MCP tools/names share one snapshot and Host calls retain per-execution Run/Attempt/abort identity
- extension-tools.ts — AI SDK bounded discovery, next-step direct MCP tool description, and sealed call bridge
- tool-disclosure-snapshot.ts — frozen internal links from admitted descriptors to direct MCP tools and Core Skill-load identities; overflow tools remain deferred
- extension-transfer.ts — fail-closed adapter for advertised, governed, explicit-target cross-Host transfer capabilities
