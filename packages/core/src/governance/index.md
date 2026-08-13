# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, and pre-Slice-4 ask fail-closed authorization
- governed-tool.ts — execution-time wrapper for trusted Core/MCP/Skill identity sidecars while preserving original AI SDK closures
- core-tool-governance-adapter.ts — explicit stable mapping from Core-local ToolSet keys to canonical capability/cell identities; unknown Core keys fail closed
