/** Thin operator read over the durable Run queue; runId remains the resume/cancel key. */
import { RUN_METHODS, QueueListParamsSchema, type QueueListParams, type QueueListResult } from "@taki/shared";
import type { RunService } from "../../harness/run-service.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function runQueueMethod(service: Pick<RunService, "queue">): MethodDefinition<QueueListParams> {
  return { method: RUN_METHODS.queue, roles: ["operator"], paramsSchema: QueueListParamsSchema, handler: (params): QueueListResult => service.queue(params) };
}
