/**
 * INPUT:  test-owned loopback HTTP handlers and finite client calls
 * OUTPUT: ephemeral endpoints with guaranteed socket cleanup and observable unfinished response cancellation
 * POS:    core/testing — Hindsight HTTP integration-test support; test-only, never bound to a fixed port
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export async function withHindsightHttpServer<T>(input: {
  handle: (request: IncomingMessage, response: ServerResponse) => void;
  run: (endpoint: string) => Promise<T>;
}): Promise<T> {
  const server = createServer(input.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("owned Hindsight test endpoint missing");
  try { return await input.run(`http://127.0.0.1:${address.port}`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

interface OpenResponseObservation {
  requests: number;
  closes: number;
  finishes: number;
  chunksOffered: number;
  bytesOffered: number;
}

export async function withOpenHindsightResponse(input: {
  status: number;
  chunks: readonly Uint8Array[];
  run: (endpoint: string, observation: OpenResponseObservation) => Promise<void>;
}): Promise<void> {
  const observation: OpenResponseObservation = { requests: 0, closes: 0, finishes: 0, chunksOffered: 0, bytesOffered: 0 };
  await withHindsightHttpServer({ handle: (request, response) => {
    observation.requests++;
    request.resume();
    response.once("close", () => { observation.closes++; });
    response.once("finish", () => { observation.finishes++; });
    response.writeHead(input.status);
    response.flushHeaders();
    for (const chunk of input.chunks) {
      response.write(chunk);
      observation.chunksOffered++;
      observation.bytesOffered += chunk.byteLength;
    }
    // Keep the response open with its remainder unavailable. Waiting for a full body reaches the client's
    // deadline; only early classification/budget refusal can pass and close this unfinished response.
  }, run: (endpoint) => input.run(endpoint, observation) });
}
