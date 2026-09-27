/**
 * INPUT:  HTTP requests from the drill Core to its configured Hindsight endpoint; a switchable native target port
 * OUTPUT: startProxy(target, listen) -> { port, log, retarget(port), armRetainBlock(), disarm(), blockedBank(), close() }; forwards
 *         bodies unchanged and logs method, path (no query), status and blocked only — never headers or bodies
 * POS:    09-25-hindsight-backup-restore W6 drill — keeps one stable Core endpoint across native A/R/O and, when armed,
 *         lets exactly one tracked retain reach native and then resets every later request for that Bank, so the native
 *         effect lands while Core cannot confirm it
 */
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";

const RETAINS = /^\/ext\/taki-memory\/banks\/([^/]+)\/retains$/;

export async function startProxy(targetPort, listenPort) {
  const log = [];
  const state = { target: targetPort, armed: false, bank: null };
  const blocked = (path) => state.bank !== null && path.includes(`/banks/${state.bank}/`);
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url.split("?")[0];
    const entry = { at: new Date().toISOString(), target: state.target, method: incoming.method, path, status: null, blocked: false };
    log.push(entry);
    if (blocked(path)) {
      entry.blocked = true;
      incoming.socket.destroy();
      return;
    }
    const upstream = httpRequest({ host: "127.0.0.1", port: state.target, method: incoming.method, path: incoming.url,
      headers: incoming.headers }, (response) => {
      entry.status = response.statusCode;
      const retain = RETAINS.exec(path);
      if (state.armed && incoming.method === "POST" && retain && response.statusCode < 300) {
        state.armed = false;
        state.bank = retain[1];
        entry.armedBlockStarts = true;
      }
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", (error) => {
      entry.status = `upstream-error:${error.code ?? error.message}`;
      incoming.socket.destroy();
    });
    incoming.pipe(upstream);
  });
  server.listen(listenPort, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    log,
    retarget: (port) => { state.target = port; },
    armRetainBlock: () => { state.armed = true; state.bank = null; },
    disarm: () => { state.armed = false; state.bank = null; },
    blockedBank: () => state.bank,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
