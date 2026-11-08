/**
 * INPUT: one owned Native port and an explicit test-only write interruption flag
 * OUTPUT: transparent forwarding, retain 503 injection and one explicitly released Bank application-state hold
 * POS: first-use verification only; no credentials/payload logging, persistence or product relay
 */
import { once } from "node:events";
import { createServer, request } from "node:http";

export async function startNativeFault(targetPort) {
  let interrupted = false;
  let rejected = 0;
  let hold = null;
  const server = createServer((incoming, outgoing) => {
    if (interrupted && incoming.method === "POST" && /\/banks\/[^/]+\/(?:memories|retains)(?:\?|$)/.test(incoming.url)) {
      rejected += 1;
      incoming.resume();
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end('{"detail":"owned fixture write interruption"}');
      return;
    }
    const upstream = request({ host: "127.0.0.1", port: targetPort, path: incoming.url,
      method: incoming.method, headers: incoming.headers }, (response) => {
      const gate = hold;
      if (gate && incoming.method === "GET" && incoming.url.startsWith(gate.prefix)) {
        const record = { path: incoming.url.split("?")[0], statusCode: response.statusCode,
          heldAt: Date.now(), releasedAt: null, abortedAt: null };
        gate.responses.push(record);
        // Keep the real response paused; no fabricated body or timeout override reaches Core.
        outgoing.once("close", () => {
          if (!outgoing.writableFinished && record.releasedAt === null) {
            record.abortedAt = Date.now();
            response.destroy();
          }
        });
        gate.released.then(() => {
          record.releasedAt = Date.now();
          if (outgoing.destroyed) { response.destroy(); return; }
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        });
        return;
      }
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); });
    incoming.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { port: server.address().port, interrupt: (value) => { interrupted = value; }, rejected: () => rejected,
    holdApplicationState(bankId) {
      if (hold) throw new Error("application-state hold already armed");
      let release;
      const released = new Promise((resolve) => { release = resolve; });
      const gate = { prefix: `/ext/taki-memory/banks/${encodeURIComponent(bankId)}/application-state`,
        responses: [], released, release: () => { if (hold === gate) hold = null; release(); } };
      hold = gate;
      return { release: gate.release, snapshot: () => ({ bankId, armed: hold === gate,
        pending: gate.responses.filter((row) => row.releasedAt === null && row.abortedAt === null).length,
        responses: gate.responses.map((row) => ({ ...row })) }) };
    },
    close: () => new Promise((resolve) => { hold?.release(); server.close(resolve); server.closeAllConnections(); }) };
}
