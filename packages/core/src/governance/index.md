# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, and auto/ask/deny execution decisions
- governed-tool.ts — execution-time governance wrapper with Approval revalidation, canonical nested Memory errors in Effect settlement, and tool-call correlation
- core-tool-governance-adapter.ts — explicit Core tool identity map with per-turn Approval, Effect, and tool-observer context; unknown Core keys fail closed
