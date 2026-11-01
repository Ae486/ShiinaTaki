/**
 * INPUT:  current Home client and invalidation for the memory/storage projections affected by tidy.
 * OUTPUT: one explicit tidy attempt, success/failure details and independent refresh errors; hiding retains its lock.
 * POS:    Home Operations — mutation lifetime only; no timeout/reconnect replay or hidden read work.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { createMemoryTidyController, type MemoryTidyState } from "./memory-tidy-controller.ts";

export function useMemoryTidy(client: WsClient | null, onSettled: () => Promise<void>) {
  const [state, setState] = useState<MemoryTidyState>({ tidy: null, tidyFailure: null, tidying: false, error: null, refreshError: null });
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const controller = useMemo(() => createMemoryTidyController({ changed: setState, settled: () => settled.current() }), []);
  useLayoutEffect(() => controller.replace(client), [controller, client]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...state, runTidy: controller.runTidy };
}
