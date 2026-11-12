/**
 * INPUT: the native transport factory, effective Home visibility, and a React snapshot sink.
 * OUTPUT: one disposable shared QQMM controller with serialized native listener setup/teardown.
 * POS: Home QQ messages — lifecycle glue only; polling, recovery and expiry stay in the shared client.
 */

import { createManagementController, safeError, type ManagementController, type ManagementState, type ManagementTransport } from "@qqmm/management-client";

export interface QqmmView {
  controller: ManagementController | null;
  state: ManagementState | null;
  error: string | null;
}

interface SessionInput {
  open(): Promise<ManagementTransport & { close(): Promise<void> }>;
  visible(): boolean;
  observeVisibility(listener: () => void): () => void;
  publish(view: QqmmView): void;
}

// React StrictMode can retire a mount before async native listener registration
// completes. The successor must not be closed by that retired mount's cleanup.
let nativeLifecycle: Promise<void> = Promise.resolve();

export function observeQqmmSession(input: SessionInput): () => void {
  let retired = false;
  let transport: Awaited<ReturnType<SessionInput["open"]>> | undefined;
  let controller: ManagementController | undefined;
  let removeState = () => {};
  let removeVisibility = () => {};
  nativeLifecycle = nativeLifecycle.then(async () => {
    if (retired) return;
    try {
      transport = await input.open();
      if (retired) return;
      controller = createManagementController(transport);
      controller.setVisible(false);
      void controller.loadSettings(); void controller.refreshControls();
      removeState = controller.subscribe((state) => {
        if (!retired) input.publish({ controller: controller!, state, error: null });
      });
      let visible = false;
      const synchronize = () => {
        const next = input.visible();
        if (visible === next) return;
        visible = next;
        controller!.setVisible(next);
      };
      removeVisibility = input.observeVisibility(synchronize);
      synchronize();
    } catch (error) {
      if (!retired) input.publish({ controller: null, state: null, error: safeError(error).message });
    }
  });
  return () => {
    retired = true;
    removeVisibility(); removeState(); controller?.dispose();
    nativeLifecycle = nativeLifecycle.then(async () => { await transport?.close().catch(() => {}); });
  };
}
