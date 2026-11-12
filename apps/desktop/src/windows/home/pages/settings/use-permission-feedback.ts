/**
 * INPUT:  accepted permission action starts and guarded completion feedback.
 * OUTPUT: once-only floating outcomes plus retained refusal/conflict diagnostics.
 * POS:    Settings permission presentation owner; loaded snapshots never enqueue notices.
 */
import { useCallback, useRef, useState } from "react";
import { dismissToastGroup, pushToast, type ToastOptions } from "@/components/toast/toast-store.js";
import type { PermissionFeedback } from "./permission-state.ts";

export function usePermissionFeedback() {
  const [feedback, setFeedback] = useState<PermissionFeedback | null>(null);
  const attempt = useRef<ToastOptions | null>(null);
  const started = useCallback((key: string) => {
    const replaceKey = `permission:${key}`;
    dismissToastGroup(replaceKey);
    attempt.current = { eventKey: {}, replaceKey };
    setFeedback(null);
  }, []);
  const report = useCallback((next: PermissionFeedback) => {
    setFeedback(next.kind === "saved" ? null : next);
    const event = attempt.current;
    if (!event) return;
    // Claim before enqueueing: a conflict read or repeated completion cannot redeliver this attempt.
    attempt.current = null;
    const saved = next.kind === "saved";
    pushToast(saved ? next.message : "权限修改未完成，请查看权限设置中的说明。",
      saved ? "success" : next.kind === "conflict" || next.kind === "refused" ? "warn" : "error", event);
  }, []);
  const reset = useCallback(() => { attempt.current = null; setFeedback(null); }, []);
  return { feedback, started, report, reset };
}
