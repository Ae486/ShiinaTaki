/**
 * INPUT:  one authenticated JSON request and the client's captured total-deadline AbortSignal
 * OUTPUT: one HTTP/HTTPS response with bounded decoded UTF-8 content, without redirects or retries
 * POS:    core/memory/hindsight — default network delegate; no global fetch/agent/timeout configuration
 */
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { addAbortSignal, pipeline, type Readable, type Transform } from "node:stream";
import { constants as zlibConstants, createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { HindsightTransportResponse } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

export const HINDSIGHT_DEFAULT_RESPONSE_BYTES = 512 * 1024;
const JSON_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const INIT_FIELDS = new Set(["method", "headers", "body", "signal", "redirect"]);
// Brotli exposes machine codes such as ERR__ERROR_FORMAT_PADDING_2, unlike gzip/deflate's Z_DATA_ERROR.
// Derive only format failures from Node's named decoder constants; allocation/internal errors remain distinct.
const INVALID_COMPRESSED_BODY_CODES = new Set(["Z_DATA_ERROR", "Z_BUF_ERROR", ...Object.keys(zlibConstants)
  .filter((name) => name.startsWith("BROTLI_DECODER_ERROR_FORMAT_"))
  .map((name) => `ERR_${name.slice("BROTLI_DECODER".length)}`)]);

interface PreparedHttpRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal;
}

export interface HindsightHttpTransportOptions {
  maxBytes?: number;
  responseStatuses?: readonly number[];
}

export async function hindsightHttpTransport(input: string | URL, init?: RequestInit,
  options: HindsightHttpTransportOptions = {}): Promise<HindsightTransportResponse> {
  const prepared = prepareRequest(input, init);
  const maxBytes = options.maxBytes ?? HINDSIGHT_DEFAULT_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  const send = prepared.url.protocol === "https:" ? httpsRequest : httpRequest;
  // A request-owned connection has no inherited agent/socket phase timeout or implicit replay path.
  // The Core signal already includes its finite total deadline and remains in force during decompression.
  const request = send(prepared.url, { method: prepared.method, headers: prepared.headers,
    agent: false, signal: prepared.signal, rejectUnauthorized: true });
  let response: IncomingMessage | undefined;
  try {
    response = await receiveHeaders(request, prepared.body);
    const status = response.statusCode;
    if (status === undefined) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    const headers = responseHeaders(response);
    if ((status < 200 || status >= 300) && ![400, 404, 409, 412, 422, ...(options.responseStatuses ?? [])].includes(status)) {
      return { status, headers, body: "" };
    }
    const body = prepared.method === "HEAD" || [204, 205, 304].includes(status)
      ? "" : await readBody(response, { signal: prepared.signal, maxBytes });
    return { status, headers, body };
  } finally {
    // Node request and stream abort bindings remove their signal listeners on close; each call owns all sockets.
    response?.destroy();
    request.destroy();
  }
}

function prepareRequest(input: string | URL, init: RequestInit | undefined): PreparedHttpRequest {
  let url: URL;
  try { url = new URL(input); }
  catch { throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED");
  }
  if (!init?.signal) throw hindsightError("HINDSIGHT_TIMEOUT");
  if (init.signal.aborted) throw new DOMException("Hindsight request cancelled", "AbortError");
  if (Object.keys(init).some((key) => !INIT_FIELDS.has(key)) || init.redirect !== undefined && init.redirect !== "manual") {
    throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  }
  if (init.method !== undefined && typeof init.method !== "string") throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ?? undefined;
  if (!JSON_METHODS.has(method) || body !== undefined && typeof body !== "string"
    || body !== undefined && (method === "GET" || method === "HEAD")) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  return { url, method, headers: requestHeaders(init.headers, body), body, signal: init.signal };
}

function requestHeaders(input: RequestInit["headers"], body: string | undefined): Record<string, string> {
  let headers: Headers;
  try { headers = new Headers(input); }
  catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
  if (["transfer-encoding", "expect", "upgrade"].some((key) => headers.has(key))) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  const length = headers.get("content-length");
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) !== Buffer.byteLength(body ?? "", "utf8"))) {
    throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  }
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");
  return Object.fromEntries(headers);
}

function receiveHeaders(request: ClientRequest, body: string | undefined): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(hindsightError("HINDSIGHT_RESPONSE_INVALID"));
    });
    request.end(body);
  });
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]; const value = response.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

async function readBody(response: IncomingMessage, input: { signal: AbortSignal; maxBytes: number }): Promise<string> {
  const stream = decodedStream(response, input.signal);
  const decoder = new TextDecoder();
  let bytes = 0; let body = "";
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
      bytes += chunk.byteLength;
      if (bytes > input.maxBytes) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
      body += decoder.decode(chunk, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    // A fully received but invalid compressed representation is a response failure; transport truncation
    // remains distinguishable through the original socket/stream error and the client's abort classification.
    if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
      && INVALID_COMPRESSED_BODY_CODES.has(error.code)) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    throw error;
  } finally {
    stream.destroy();
  }
}

function decodedStream(response: IncomingMessage, signal: AbortSignal): Readable {
  const names = String(response.headers["content-encoding"] ?? "identity").toLowerCase().split(",")
    .map((value) => value.trim()).filter((value) => value !== "identity" && value !== "").reverse();
  if (names.length === 0) return addAbortSignal(signal, response);
  if (names.some((name) => !["gzip", "x-gzip", "deflate", "br"].includes(name))) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  const decoders = names.map(contentDecoder);
  const last = decoders[decoders.length - 1];
  if (!last) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  // Pipeline forwards premature upstream closes and decoding errors to the consumed output. The same
  // signal also bounds buffered decompression after the HTTP response has already finished arriving.
  pipeline([response, ...decoders], (error) => { if (error) last.destroy(error); });
  return addAbortSignal(signal, last);
}

function contentDecoder(encoding: string): Transform {
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "deflate") return createInflate();
  if (encoding === "br") return createBrotliDecompress();
  throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
}
