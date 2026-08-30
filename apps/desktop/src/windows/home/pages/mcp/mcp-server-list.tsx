/**
 * INPUT:  the Core MCP server views, the selected serverId, and the selection callback
 * OUTPUT: the master list pane (L2): one SelectionTile row per server — display name + phase badge + a one-line
 *         fact (tool count · transport anchor)
 * POS:    ui/windows/home/pages/mcp — batch-4 L2 master pane; selection is page memory, no transport ownership.
 */

import type { McpServerView } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { PHASE_LABEL, transportShortLine } from "./mcp-labels.ts";

export function McpServerList(input: {
  servers: McpServerView[];
  selectedId: string | null;
  onSelect(serverId: string): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {input.servers.map((server) => {
        const phase = PHASE_LABEL[server.status.phase];
        return (
          <SelectionTile
            key={server.serverId}
            selected={server.serverId === input.selectedId}
            stateAttr="aria-current"
            onSelect={() => input.onSelect(server.serverId)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{server.serverId}</span>
                <Badge tone={phase.tone}>{phase.text}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-text-secondary">
                工具 {server.status.toolCount} · {transportShortLine(server)}
              </p>
            </div>
          </SelectionTile>
        );
      })}
    </div>
  );
}
