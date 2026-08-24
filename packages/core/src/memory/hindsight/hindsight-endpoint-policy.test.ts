import { describe, expect, it } from "vitest";
import { HindsightEndpointError, normalizeHindsightEndpoint } from "./hindsight-endpoint-policy.ts";

describe("Hindsight endpoint policy", () => {
  it("allows explicitly selected loopback/private endpoints", () => {
    expect(normalizeHindsightEndpoint("http://127.0.0.1:8888/").toString()).toBe("http://127.0.0.1:8888/");
    expect(normalizeHindsightEndpoint("http://192.168.1.2:8888").hostname).toBe("192.168.1.2");
  });

  it.each(["http://u:p@host", "http://host/?x=1", "ftp://host", "http://169.254.169.254", "http://0.0.0.0", "http://239.1.1.1"])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => normalizeHindsightEndpoint(endpoint)).toThrow(HindsightEndpointError);
  });
});
