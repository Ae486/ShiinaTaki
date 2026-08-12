/**
 * INPUT:  lifecycle outcomes from an independent desktop operator connection owner.
 * OUTPUT: ConnectionStatus plus one semantic connectionStatusNotice() mapping shared by Home, Chat, and Pet.
 * POS:    ui/lib — framework-free connection presentation vocabulary; connected deliberately has no notice.
 */

import type { ErrorCode } from "@taki/shared";

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "reconnecting" }
  | { kind: "connected" }
  | { kind: "pairing-required" }
  | { kind: "disconnected" }
  | { kind: "error"; code: ErrorCode | null; message: string };

export interface ConnectionNotice {
  text: string;
  tone: "attention" | "error";
}

export function connectionStatusNotice(status: ConnectionStatus): ConnectionNotice | null {
  switch (status.kind) {
    case "connected":
      return null;
    case "connecting":
      return { text: "正在连接 Agent Core…", tone: "attention" };
    case "reconnecting":
      return { text: "与 Agent Core 的连接已中断，正在重连…", tone: "attention" };
    case "pairing-required":
      return { text: "需要完成配对后才能连接 Agent Core", tone: "attention" };
    case "disconnected":
      return { text: "与 Agent Core 的连接已断开", tone: "attention" };
    case "error":
      return { text: status.message, tone: "error" };
  }
}
