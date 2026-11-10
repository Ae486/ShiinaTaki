/**
 * INPUT: Core-owned model profile service and the existing JSON-RPC registry
 * OUTPUT: operator-only profile reads/writes, explicit tests and connection-owned invalidation
 * POS: core/server/methods — bounded errors and write-only secrets at the protocol boundary
 */
import { MODEL_PROFILE_METHODS, ModelProfilesParamsSchema, ModelProfileSaveParamsSchema, ModelProfileTestParamsSchema } from "@taki/shared";
import { ModelProfileError, type ModelProfileService } from "../../config/model-profile-service.ts";
import { SecretRefusalError } from "../../secrets/secret-catalog-service.ts";
import { appException } from "../app-error.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerModelProfileMethods(registry: MethodRegistry, service: ModelProfileService): void {
  const subscriptions = new WeakSet<object>();
  registry.register({ method: MODEL_PROFILE_METHODS.list, roles: ["operator"], paramsSchema: ModelProfilesParamsSchema, handler: () => service.list() });
  registry.register({ method: MODEL_PROFILE_METHODS.save, roles: ["operator"], paramsSchema: ModelProfileSaveParamsSchema,
    handler: (input) => {
      try { return service.save(input); }
      catch (cause) {
        const reason = cause instanceof ModelProfileError ? cause.message : cause instanceof SecretRefusalError ? cause.reason : "MODEL_PROFILE_SAVE_FAILED";
        throw appException("CONFIG_REFUSED", "模型配置未保存，请检查配置和凭据存储状态。", { reason });
      }
    } });
  registry.register({ method: MODEL_PROFILE_METHODS.test, roles: ["operator"], paramsSchema: ModelProfileTestParamsSchema,
    handler: async (input) => {
      try { return await service.test(input); }
      catch { throw appException("CONFIG_REFUSED", "配置已变化，请刷新后重试连接测试。", { reason: "MODEL_PROFILE_CONFLICT" }); }
    } });
  registry.register({ method: MODEL_PROFILE_METHODS.subscribe, roles: ["operator"], paramsSchema: ModelProfilesParamsSchema,
    handler: (_input, context) => {
      if (subscriptions.has(context.connection)) return { status: "ok" as const };
      subscriptions.add(context.connection);
      const close = service.subscribe(() => context.notify(MODEL_PROFILE_METHODS.changed, { slots: ["main", "utility"] }));
      context.onClose(() => { subscriptions.delete(context.connection); close(); }); return { status: "ok" as const };
    } });
}
