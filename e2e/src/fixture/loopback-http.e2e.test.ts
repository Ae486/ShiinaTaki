import { createServer, Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { listenLoopbackHttp } from "./loopback-http.ts";
import { startScriptedProvider, type ScriptedProvider } from "./scripted-provider.ts";

describe("Fetch-compatible local HTTP allocation", () => {
  it("rejects a reported port 6000 before exposing the provider, without consuming a request", async () => {
    // Simulate the OS's forbidden allocation without requiring an otherwise-unused fixed port on the test host.
    const address = vi.spyOn(Server.prototype, "address").mockReturnValueOnce({ address: "127.0.0.1", family: "IPv4", port: 6000 });
    const closed = vi.spyOn(Server.prototype, "close");
    let provider: ScriptedProvider | undefined;
    try {
      provider = await startScriptedProvider(() => ({ text: "synthetic unchanged response" }));
      expect(new URL(provider.baseUrl).port).not.toBe("6000");
      expect(closed).toHaveBeenCalled();
      expect(provider.requests).toHaveLength(0);
      expect(provider.errors).toEqual([]);
      address.mockRestore(); closed.mockRestore();
      const body = { model: "dummy", messages: [{ role: "user", content: "synthetic request" }], stream: true };
      const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", body: JSON.stringify(body) });
      const stream = await response.text();
      expect(response.status).toBe(200);
      expect(stream).toContain("synthetic unchanged response");
      expect(stream).toContain("data: [DONE]");
      expect(provider.requests).toEqual([body]);
      expect(provider.errors).toEqual([]);
    } finally {
      address.mockRestore(); closed.mockRestore();
      await provider?.close();
    }
  });

  it("bounds repeated forbidden allocations and leaves no listening server or probe request", async () => {
    let requests = 0;
    const server = createServer((_request, response) => { requests += 1; response.end(); });
    const address = vi.spyOn(server, "address").mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 6000 });
    const listen = vi.spyOn(server, "listen");
    try {
      await expect(listenLoopbackHttp(server)).rejects.toThrow("exhausted Fetch-compatible port allocation");
      expect(listen).toHaveBeenCalledTimes(16);
      expect(server.listening).toBe(false);
      expect(requests).toBe(0);
    } finally {
      address.mockRestore(); listen.mockRestore();
      await close(server);
    }
  });

  it("propagates a bind failure without retrying it as a forbidden allocation", async () => {
    const server = createServer();
    const failure = new Error("synthetic bind failure");
    const listen = vi.spyOn(server, "listen").mockImplementation(() => {
      queueMicrotask(() => server.emit("error", failure));
      return server;
    });
    try {
      await expect(listenLoopbackHttp(server)).rejects.toBe(failure);
      expect(listen).toHaveBeenCalledTimes(1);
      expect(server.listening).toBe(false);
      expect(server.listenerCount("error")).toBe(0);
    } finally {
      listen.mockRestore();
      await close(server);
    }
  });

  it("closes a bound server if the required address cannot be read", async () => {
    const server = createServer();
    const address = vi.spyOn(server, "address").mockReturnValue(null);
    try {
      await expect(listenLoopbackHttp(server)).rejects.toThrow("has no TCP address");
      expect(server.listening).toBe(false);
    } finally {
      address.mockRestore();
      await close(server);
    }
  });
});

async function close(server: Server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
