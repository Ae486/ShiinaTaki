/**
 * INPUT:  a physical operator client's deadline-bound request function and strict subscription schemas.
 * OUTPUT: shared, retryable Perception/Extension setup with an explicit older-Core support outcome.
 * POS:    ui/lib — wire membership only; no retry loop, data cache, mutation replay or authority fallback.
 */
import { JSONRPCErrorException, type JSONRPCParams } from "json-rpc-2.0";
import {
  EXTENSION_METHODS, ExtensionSubscribeResultSchema, JSON_RPC_ERROR_CODES,
  PERCEPTION_METHODS, PerceptionSubscribeResultSchema,
} from "@taki/shared";

export type ReadSubscriptionSupport = "supported" | "unsupported";
type Request = <T>(method: string, params: JSONRPCParams) => Promise<T>;

export function readSubscriptionMethods(request: Request) {
  return {
    subscribePerception: subscription(request, PERCEPTION_METHODS.subscribe, PerceptionSubscribeResultSchema.parse),
    subscribeExtensions: subscription(request, EXTENSION_METHODS.subscribe, ExtensionSubscribeResultSchema.parse),
  };
}

function subscription(request: Request, method: string, parse: (value: unknown) => unknown) {
  let current: Promise<ReadSubscriptionSupport> | null = null;
  return (): Promise<ReadSubscriptionSupport> => {
    if (current) return current;
    const attempt = request(method, {}).then((value): ReadSubscriptionSupport => {
      parse(value);
      return "supported";
    }).catch((cause: unknown): ReadSubscriptionSupport => {
      // Only JSON-RPC's exact missing-method reply proves an older Core. Authentication, invalid
      // acknowledgements and deadlines remain errors; another explicit demand may retry the same socket.
      if (cause instanceof JSONRPCErrorException && cause.code === JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND) return "unsupported";
      if (current === attempt) current = null;
      throw cause;
    });
    current = attempt;
    return attempt;
  };
}
