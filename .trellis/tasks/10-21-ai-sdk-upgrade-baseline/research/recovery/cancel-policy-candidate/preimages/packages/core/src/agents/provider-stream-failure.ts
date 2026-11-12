/**
 * INPUT: one selected provider model and a per-attempt failure observer
 * OUTPUT: model preserving the physical provider stream failure across SDK abort cancellation
 * POS: core/agents — compatibility observation only; never changes cancellation or executes/retries a call
 */
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

export function observeProviderStreamFailure(model: LanguageModel, observe: (error: unknown) => void): LanguageModel {
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    async wrapStream({ doStream }) {
      const result = await doStream();
      const reader = result.stream.getReader();
      let cancelled = false;
      return { ...result, stream: new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (cancelled) return;
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            observe(error);
            if (!cancelled) controller.error(error);
          }
        },
        async cancel(reason) {
          cancelled = true;
          try { await reader.cancel(reason); }
          catch (error) { observe(error); throw error; }
        },
      }) };
    },
  };
  return wrapLanguageModel({ model: model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware });
}
