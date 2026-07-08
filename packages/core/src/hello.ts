import type { Ping, Pong } from "@taki/shared";

/**
 * Scaffold smoke helper: proves core can consume @taki/shared types and that
 * the workspace wiring resolves. Replaced by the real agent loop in M1 #3.
 */
export function pong(ping: Ping): Pong {
  return { kind: "pong", nonce: ping.nonce };
}
