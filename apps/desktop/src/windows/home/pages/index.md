# windows/home/pages/
One directory per home page; each page owns its hooks, stores and components (no cross-page imports).
- chat/ — the chat page: continuous timeline (markdown + tool cards + image thumbnails) + composer with image attach (#17).
- subagents/ — private delegated work conversations, exact work controls, input receipts and child/parent outcomes.
- initiative/ — reviewed interaction Patterns, manual authoring, lifecycle/history and explicit standard Skill/example setup.
- qqmm/ — local QQ message/runtime history and retention, independent of the Core connection.
- settings/ — the knobs page: every core config knob rendered from config.list metadata, with truthful apply/env-lock badges.
- operations/ — manual memory tidy, the memory/context status card and storage usage with the attachment purge (D46).
- perception/ — Privacy Pause control, sampling + activity cards, and a pointer at the retention knobs.
- costume/ — import a model archive and pick a costume; the pick is commanded to the pet window, which owns the scene.
- mcp/ — the MCP lifecycle page: desired-state CRUD with write-only secret fields, ephemeral test diagnostics, and truthful runtime phase badges; every change lands without a restart
- skills/ — the standard Skill package lifecycle page: Core-authoritative import, inspect, enable/disable, replace, remove, and reconcile
