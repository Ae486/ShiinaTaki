/**
 * INPUT: an unbound scenario-owned HTTP server.
 * OUTPUT: a retained loopback listener on a Fetch-compatible ephemeral port, or a closed failed allocation.
 * POS: e2e/fixture — HTTP binding only; sends no probe requests and changes no host port configuration.
 */
import type { Server } from "node:http";

// https://fetch.spec.whatwg.org/#bad-port (2026-10-30). Some hosts include these in their dynamic port range.
const BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389,
  427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export async function listenLoopbackHttp(server: Server): Promise<number> {
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      await listen(server);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("loopback HTTP server has no TCP address");
      if (!BAD_PORTS.has(address.port)) return address.port;
      await close(server);
    }
    throw new Error("loopback HTTP server exhausted Fetch-compatible port allocation");
  } catch (error) {
    if (server.listening) await close(server);
    throw error;
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    try {
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolve();
      });
    } catch (error) {
      server.off("error", onError);
      reject(error);
    }
  });
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
