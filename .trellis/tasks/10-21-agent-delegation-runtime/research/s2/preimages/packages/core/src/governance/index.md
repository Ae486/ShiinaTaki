# core/governance/
- governance-policy-repo.ts — atomic SQLite policy singleton/override repository with optimistic generation conflicts and registry reconciliation
- governance-policy-service.ts — canonical registry reconciliation, operator mutation legality, effective evaluation, copied classifier metadata, and auto/ask/deny execution decisions
- governed-tool.ts — canonical interactive/durable unattended authorization and attributed Effect outcomes, with isolated observation at Approval wait and dispatch
- captured-tool-execution.ts — detached captured closures carrying per-execution Run/Attempt/Effect/abort authority through private SDK options, with no discovery or additional Effect bracket
- core-tool-governance-adapter.ts — explicit Core identity map (including recommendation preparation under existing media control), durable approval and per-execution Effect/abort/observer context; unknown Core keys fail closed
