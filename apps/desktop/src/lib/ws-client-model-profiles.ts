/**
 * INPUT: deadline-bound operator requests and Shared model profile schemas.
 * OUTPUT: typed profile reads, writes, explicit tests and retryable subscription setup.
 * POS: ui/lib — write-only credentials cross this boundary without entering any cache.
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  MODEL_PROFILE_METHODS, ModelProfilesResultSchema, ModelProfileTestResultSchema, ConfigSubscribeResultSchema,
  type ModelProfileSaveParams, type ModelProfileTestParams,
} from "@taki/shared";

export function modelProfileMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  let subscription: Promise<void> | null = null;
  return {
    modelProfiles: async () => ModelProfilesResultSchema.parse(await request(MODEL_PROFILE_METHODS.list, {})),
    modelProfileSave: async (params: ModelProfileSaveParams) =>
      ModelProfilesResultSchema.parse(await request(MODEL_PROFILE_METHODS.save, params)),
    modelProfileTest: async (params: ModelProfileTestParams) =>
      ModelProfileTestResultSchema.parse(await request(MODEL_PROFILE_METHODS.test, params)),
    subscribeModelProfiles() {
      if (subscription) return subscription;
      const attempt = request(MODEL_PROFILE_METHODS.subscribe, {}).then((result) => {
        ConfigSubscribeResultSchema.parse(result);
      }).catch((cause: unknown) => {
        if (subscription === attempt) subscription = null;
        throw cause;
      });
      subscription = attempt;
      return attempt;
    },
  };
}

export type ModelProfileMethods = ReturnType<typeof modelProfileMethods>;
