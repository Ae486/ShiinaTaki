/**
 * INPUT: an explicitly chosen child/work from another Home feature
 * OUTPUT: one local navigation request for the registered private-conversation page
 * POS: ui/subagents — navigation only; selecting a child never starts or continues its work
 */
import { create } from "zustand";
import type { SubagentSummary, SubagentTarget } from "@taki/shared";
import { useHomeStore } from "@/windows/home/home-store.js";

export type SubagentNavigationTarget = Pick<SubagentSummary, "characterId" | "subagentId"> & Partial<Pick<SubagentTarget, "workInputId">>;
export const useSubagentNavigation = create<{ target: SubagentNavigationTarget | null }>(() => ({ target: null }));
export function openSubagentConversation(target: SubagentNavigationTarget): void {
  useSubagentNavigation.setState({ target });
  useHomeStore.getState().navigate("subagents");
}
