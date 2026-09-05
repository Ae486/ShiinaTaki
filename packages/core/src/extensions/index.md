# core/extensions/
- extension-composition.ts — main.ts composition seam for compatibility Skill tools and per-Run Extension contexts
- extension-registry.ts — immutable per-Run host-qualified registry with collision rejection, bounded discovery/call, and Run-id-free stable model context while internal snapshots/results retain authority identity
- extension-run-context.ts — one-shot Host/Skill/MCP Run assembly with captured MCP display names reused across model retries
- extension-sources.ts — authority adapters into registry candidates; direct MCP tools and names come from the same unbudgeted snapshot iteration
- extension-tools.ts — AI SDK progressive discovery, description, and sealed call bridge
- extension-transfer.ts — fail-closed adapter for advertised, governed, explicit-target cross-Host transfer capabilities
