# Vercel AI SDK 6 as the agent engine

The Agent Core is built on Vercel AI SDK 6 (`ai` + `@ai-sdk/*` providers + `@ai-sdk/mcp`) rather than a hand-rolled loop or another framework. AI SDK 6 (May 2026, stable) ships exactly our required primitives as first-class features: unified multi-provider API (25+ providers), ToolLoopAgent for the tool-execution loop, **built-in human-in-the-loop tool approval** (which we wire directly to the Permission Gate), and stable MCP support including OAuth, resources, and prompts. With ~20M monthly downloads it is the dominant TS agent toolkit — maximum ecosystem, minimum custom code ("glue, don't build").

Considered and rejected:
- Hand-rolled loop on raw provider SDKs: full control, but we would rebuild streaming normalization, provider quirks, tool approval, and MCP plumbing that AI SDK 6 already ships and battle-tests.
- pi-mono agent core (OpenClaw's engine): proven, but smaller community and couples us to its opinionated runtime.
- LangChain/LlamaIndex JS: heavier abstractions aimed at RAG pipelines, weaker fit for a long-lived local agent.

Consequence: provider coverage and loop semantics track AI SDK's release cadence; major-version migrations (they ship codemods) become part of our maintenance. Acceptable — this dependency is the product's center of gravity and is the healthiest project in its category.

---

**Amendment 2026-07-07**: at scaffolding time the current stable is AI SDK **7** (`ai@7.0.x` — tool approvals, durable workflows, provider-level skills). Being greenfield, we start directly on `^7`. The decision and rationale above are unchanged; API names referenced in docs (ToolLoopAgent etc.) must be verified against installed v7 types before coding.

---

**Amendment 2026-08-13 — framework approval is not policy authority:** AI SDK remains the agent loop and standard MCP
integration, but its approval primitives do not define Taki's durable authorization model. Every Core, MCP,
Skill-mediated, and Host action first resolves the shared canonical identity/descriptor and Core policy. Slice 3
deliberately returns `APPROVAL_REQUIRED` without execution for `ask`; Slice 4 will bridge the one Core-owned Approval
lifecycle to the loop. This avoids an AI-SDK-only approval lane beside Host or operator policy while preserving raw
MCP tool names and SDK execution closures.
