/**
 * INPUT:  operator-selected Hindsight base endpoint
 * OUTPUT: normalizeHindsightEndpoint() -> safe URL or a bounded policy refusal
 * POS:    core/memory/hindsight — SSRF/redirect preflight; explicit loopback and private deployments remain supported
 */
export class HindsightEndpointError extends Error {
  constructor() {
    super("Hindsight endpoint is not permitted");
    this.name = "HindsightEndpointError";
  }
}

export function normalizeHindsightEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HindsightEndpointError();
  }
  if (!allowedShape(url) || blockedHost(url.hostname)) throw new HindsightEndpointError();
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function allowedShape(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !url.search && !url.hash;
}

function blockedHost(raw: string): boolean {
  const host = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "0.0.0.0" || host === "::" || host === "metadata.google.internal") return true;
  if (host === "169.254.169.254" || host.startsWith("169.254.")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const first = parts[0] ?? 0;
    return first === 0 || first >= 224;
  }
  return host.startsWith("fe80:") || host.startsWith("ff") || host === "::ffff:169.254.169.254";
}
