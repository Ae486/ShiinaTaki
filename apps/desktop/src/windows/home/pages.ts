/**
 * INPUT:  the page components of the home window + their menu glyphs.
 * OUTPUT: HOME_PAGES (ordered registry rows) + PageId + DEFAULT_PAGE_ID + isPageId().
 * POS:    ui/windows/home — THE page registry (invariant 7): adding a page is one row here, and the left menu, the
 *         page host and every openHome() caller pick it up from the derived PageId union. No other page list exists.
 */

import type { ComponentType } from "react";
import type { IconComponent } from "@/lib/icons/glyph.js";
import { ChatIcon } from "@/lib/icons/chat-icon.js";
import { SettingsIcon } from "@/lib/icons/settings-icon.js";
import { OperationsIcon } from "@/lib/icons/operations-icon.js";
import { PerceptionIcon } from "@/lib/icons/perception-icon.js";
import { CostumeIcon } from "@/lib/icons/costume-icon.js";
import { McpIcon } from "@/lib/icons/mcp-icon.js";
import { SkillIcon } from "@/lib/icons/skill-icon.js";
import { ChatPage } from "./pages/chat/chat-page.tsx";
import { SettingsPage } from "./pages/settings/settings-page.tsx";
import { OperationsPage } from "./pages/operations/operations-page.tsx";
import { PerceptionPage } from "./pages/perception/perception-page.tsx";
import { CostumePage } from "./pages/costume/costume-page.tsx";
import { McpPage } from "./pages/mcp/mcp-page.tsx";
import { SkillsPage } from "./pages/skills/skills-page.tsx";
export { DEFAULT_PAGE_ID } from "./default-page-id.ts";

export interface HomePage {
  id: string;
  label: string;
  icon: IconComponent;
  component: ComponentType;
}

export const HOME_PAGES = [
  { id: "chat", label: "聊天", icon: ChatIcon, component: ChatPage },
  { id: "settings", label: "设置", icon: SettingsIcon, component: SettingsPage },
  { id: "operations", label: "运维", icon: OperationsIcon, component: OperationsPage },
  { id: "perception", label: "感知", icon: PerceptionIcon, component: PerceptionPage },
  { id: "costume", label: "换装", icon: CostumeIcon, component: CostumePage },
  { id: "mcp", label: "MCP", icon: McpIcon, component: McpPage },
  { id: "skills", label: "Skills", icon: SkillIcon, component: SkillsPage },
] as const satisfies readonly HomePage[];

/** The registered ids as a closed union — an unregistered page id cannot be navigated to at the type level. */
export type PageId = (typeof HOME_PAGES)[number]["id"];

/** The runtime gate for ids arriving from outside the type system (boot query param, Tauri event payload). */
export function isPageId(value: unknown): value is PageId {
  return HOME_PAGES.some((page) => page.id === value);
}
