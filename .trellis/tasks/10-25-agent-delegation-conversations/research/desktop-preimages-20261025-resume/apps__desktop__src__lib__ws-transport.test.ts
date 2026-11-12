import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserTransport } from "./ws-transport.ts";
import { createWsClient } from "./ws-client.ts";

class BrowserSocket extends EventTarget {
  static readonly OPEN = 1;
  static current: BrowserSocket;
  readyState = 0;
  send = vi.fn();
  constructor() { super(); BrowserSocket.current = this; }
  close(): void { this.readyState = 2; }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  vi.stubGlobal("WebSocket", BrowserSocket);
  const transport = createBrowserTransport("ws://127.0.0.1:1");
  return { transport, socket: BrowserSocket.current };
}

describe("native browser transport send boundary", () => {
  it.each([0, 2, 3])("refuses readyState=%i before calling native send", (readyState) => {
    const { transport, socket } = fixture();
    socket.readyState = readyState;
    expect(() => transport.send("request")).toThrow("WebSocket transport is not open");
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("sends unchanged payloads only while the socket is open", () => {
    const { transport, socket } = fixture();
    socket.readyState = BrowserSocket.OPEN;
    transport.send("request");
    expect(socket.send).toHaveBeenCalledExactlyOnceWith("request");
  });

  it("rejects Monitor cleanup immediately and releases its RPC deadline after socket retirement", async () => {
    vi.useFakeTimers();
    const { transport, socket } = fixture();
    const client = createWsClient({ transport });
    socket.readyState = BrowserSocket.OPEN;
    socket.dispatchEvent(new Event("open"));
    socket.readyState = 2;
    let failure: unknown;
    const pending = client.unsubscribeMonitor().catch((cause: unknown) => { failure = cause; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).toMatchObject({ message: "WebSocket transport is not open" });
      expect(socket.send).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.close();
      await pending;
    }
  });
});
