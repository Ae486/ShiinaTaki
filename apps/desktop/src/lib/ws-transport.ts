/**
 * INPUT:  a loopback WS URL (ws://127.0.0.1:<port>).
 * OUTPUT: createBrowserTransport(url) -> WsTransport: send/close + message/open/close listener registration.
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
    send: (payload) => socket.send(payload),
    close: () => socket.close(),
    onMessage: (handler) =>
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") handler(event.data);
      }),
    onOpen: (handler) => socket.addEventListener("open", () => handler()),
    onClose: (handler) => socket.addEventListener("close", () => handler()),
  };
}
