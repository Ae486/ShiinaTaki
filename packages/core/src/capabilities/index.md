# core/capabilities/
- capability-broker.ts — core→node ask/await broker; correlate by requestId; 90s backstop + denyAll on disconnect
- screenshot-store.ts — the sanctioned Workspace write site: base64 PNG → screenshots/<ts>.png (invariant 2)
- screenshot-tool.ts — the agent tool: route → broker.request → persist → { ok, path, width, height, bytes }
- (the node-role capability.respond method lives in server/methods/capability-respond.ts)
