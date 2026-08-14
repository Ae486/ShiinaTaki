# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, and auto/ask/deny execution decisions
- governed-tool.ts — execution-time wrapper for trusted Core/MCP/Skill identity sidecars; interactive asks revalidate current Governance and Approval lineage before preserving the original closure
- core-tool-governance-adapter.ts — explicit stable mapping from Core-local ToolSet keys to canonical capability/cell identities, with per-turn exact-Connection Approval context; unknown Core keys fail closed
