/**
 * INPUT:  a Core WebSocket URL and the native socket's readiness state.
 * OUTPUT: WsTransport with fail-fast non-open send rejection and message/open/close listener registration.
 * POS:    ui/lib — the browser-native WebSocket seam under ws-client. Isolating it keeps ws-client testable in node
 *         (tests inject a fake WsTransport; no jsdom/WebSocket needed) and framework-free of any Node `ws` package.
 */

// Minimal transport surface ws-client needs — a fake in tests, a real WebSocket in the webview.
export interface WsTransport {
  send(payload: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  onOpen(handler: () => void): void;
  onClose(handler: () => void): void;
}

export function createBrowserTransport(url: string): WsTransport {
  const socket = new WebSocket(url);
  return {
    send(payload) {
      // CLOSING/CLOSED native sockets discard send() without rejecting the pending JSON-RPC request.
      // Reject before calling the browser so retired-controller cleanup cannot wait on its RPC deadline.
      if (socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket transport is not open");
      socket.send(payload);
    },
    close: () => socket.close(),
    onMessage: (handler) =>
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") handler(event.data);
      }),
    onOpen: (handler) => socket.addEventListener("open", () => handler()),
    onClose: (handler) => socket.addEventListener("close", () => handler()),
  };
}
