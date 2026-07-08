import { z } from "zod";

/**
 * Smoke-test message proving the WS protocol layer: schema defined once here,
 * consumed by core and desktop. Real protocol messages replace this in M1 #3.
 */
export const PingSchema = z.object({
  kind: z.literal("ping"),
  nonce: z.string(),
});

export type Ping = z.infer<typeof PingSchema>;

export const PongSchema = z.object({
  kind: z.literal("pong"),
  nonce: z.string(),
});

export type Pong = z.infer<typeof PongSchema>;
