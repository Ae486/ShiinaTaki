/**
 * INPUT:  one replaceable WsClient generation and its targeted Approval request/closed notifications
 * OUTPUT: useApprovalDialog(client) — one generation-local queued modal element with bounded response feedback
 * POS:    ui/components/approval — one owner per physical socket; no persisted cache or cross-window event transport
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { ApprovalDialog } from "./approval-dialog.tsx";
import {
  createApprovalDialogController,
  type ApprovalDialogSnapshot,
} from "./approval-dialog-controller.ts";

const EMPTY: ApprovalDialogSnapshot = {
  request: null, queued: 0, status: { kind: "ready" }, disclosureAcknowledged: false,
};

export function useApprovalDialog(client: WsClient | null): ReactNode {
  const [snapshot, setSnapshot] = useState<ApprovalDialogSnapshot>(EMPTY);
  const controller = useMemo(() => createApprovalDialogController(setSnapshot), []);
  useEffect(() => {
    controller.replace(client);
    return () => controller.replace(null);
  }, [client, controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  const choose = useCallback((choice: Parameters<typeof controller.choose>[0]) => {
    void controller.choose(choice);
  }, [controller]);
  const acknowledgeDisclosure = useCallback(
    (accepted: boolean) => controller.acknowledgeDisclosure(accepted),
    [controller],
  );
  const dismiss = useCallback(() => controller.dismiss(), [controller]);

  return snapshot.request
    ? <ApprovalDialog
        request={snapshot.request}
        queued={snapshot.queued}
        status={snapshot.status}
        disclosureAcknowledged={snapshot.disclosureAcknowledged}
        onDisclosureAcknowledged={acknowledgeDisclosure}
        onChoose={choose}
        onDismiss={dismiss}
      />
    : null;
}
