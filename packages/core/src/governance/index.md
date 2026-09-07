# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, copied classifier metadata, and auto/ask/deny execution decisions
- governed-tool.ts — unchanged Core/MCP/Skill authorization and Effect outcomes, with isolated payload-free observation at durable Approval wait and confirmed dispatch
- core-tool-governance-adapter.ts — explicit Core tool identity map with per-turn Approval, Effect, and tool-observer context; shared precise tool names affect approval presentation only, and unknown Core keys fail closed
