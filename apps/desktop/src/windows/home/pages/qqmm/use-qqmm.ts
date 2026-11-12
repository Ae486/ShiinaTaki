/**
 * INPUT: actual Home route/document visibility and the official native invoke/Channel APIs.
 * OUTPUT: disposable QQMM view state, controller actions and a listener-setup retry.
 * POS: Home QQ messages — React binding; never accesses the Core connection or persists history.
 */

import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { createTauriManagementTransport } from "@qqmm/management-client";
import { isPageActive, usePageActive, usePageVisibilityStore } from "../../page-visibility-store.ts";
import { observeQqmmSession, type QqmmView } from "./qqmm-session.ts";

const EMPTY_VIEW: QqmmView = { controller: null, state: null, error: null };

export function useQqmm() {
  const [view, setView] = useState(EMPTY_VIEW);
  const [attempt, setAttempt] = useState(0);
  const active = usePageActive("qqmm");
  useEffect(() => {
    setView(EMPTY_VIEW);
    return observeQqmmSession({
      open: () => createTauriManagementTransport({ invoke, createChannel: (handler) => new Channel<unknown>(handler) }),
      visible: () => isPageActive("qqmm"),
      observeVisibility: (callback) => usePageVisibilityStore.subscribe(callback),
      publish: setView,
    });
  }, [attempt]);
  // The visibility subscription clears shared content synchronously during the
  // shell's layout publication; this render mask also covers the hidden frame.
  return { ...view, state: active ? view.state : null, retry: () => setAttempt((value) => value + 1) };
}
