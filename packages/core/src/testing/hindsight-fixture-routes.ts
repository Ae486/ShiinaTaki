/**
 * INPUT:  a request path answered by an in-memory Hindsight transport double
 * OUTPUT: hindsightFixtureCommonRoute() — the health/version/compatibility bodies every native double answers identically
 * POS:    core/testing — shared by the runtime composition fixture and the activation transport; carries no Bank state
 */
import type { HindsightTransportResponse } from "../memory/hindsight/hindsight-client.ts";
import { applicationTestCompatibility } from "./hindsight-application-runtime-fixtures.ts";

export function hindsightFixtureCommonRoute(path: string): HindsightTransportResponse | undefined {
  if (path === "/health") return { status: 200, body: JSON.stringify({ status: "healthy", database: "connected" }) };
  if (path === "/version") return { status: 200, body: JSON.stringify({ api_version: "0.9.0" }) };
  if (path === "/ext/taki-memory/version") return { status: 200, body: JSON.stringify(applicationTestCompatibility()) };
  return undefined;
}
