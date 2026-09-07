# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, copied classifier metadata, and auto/ask/deny execution decisions
- governed-tool.ts — execution-time wrapper for trusted Core/MCP/Skill identity sidecars with governance events, service-owned Approval classifier metadata, shared closed tool-outcome Effect settlement, and tool-call correlation
- core-tool-governance-adapter.ts — explicit Core tool identity map with per-turn Approval, Effect, and tool-observer context; shared precise tool names affect approval presentation only, and unknown Core keys fail closed
