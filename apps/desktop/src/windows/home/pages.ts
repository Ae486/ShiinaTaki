/**
 * INPUT:  the page components of the home window.
 * OUTPUT: HOME_PAGES (ordered registry rows) + PageId + DEFAULT_PAGE_ID + isPageId().
 * POS:    ui/windows/home — THE page registry (invariant 7): adding a page is one row here, and the left menu, the
 *         page host and every openHome() caller pick it up from the derived PageId union. No other page list exists.
 */

import type { ComponentType } from "react";
import { ChatPage } from "./pages/chat/chat-page.tsx";

export interface HomePage {
  id: string;
  label: string;
  component: ComponentType;
}

export const HOME_PAGES = [{ id: "chat", label: "聊天", component: ChatPage }] as const satisfies readonly HomePage[];

/** The registered ids as a closed union — an unregistered page id cannot be navigated to at the type level. */
export type PageId = (typeof HOME_PAGES)[number]["id"];

export const DEFAULT_PAGE_ID: PageId = "chat";

/** The runtime gate for ids arriving from outside the type system (boot query param, Tauri event payload). */
export function isPageId(value: unknown): value is PageId {
  return HOME_PAGES.some((page) => page.id === value);
}
