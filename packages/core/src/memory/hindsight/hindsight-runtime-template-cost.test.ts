import { afterEach, expect, it, vi } from "vitest";
import { templateLifecycleFixture } from "./template-lifecycle/template-lifecycle-fixtures.ts";
import * as selections from "./template-lifecycle/template-runtime-selection.ts";
import * as overlays from "./template-lifecycle/template-overlay-store.ts";

afterEach(() => vi.restoreAllMocks());

// Failure mode: every unchanged Bank lookup rebuilds all applied template history after binding already verified it.
it("keeps repeated current guards free of full template reconstruction after managed binding", async () => {
  const f = templateLifecycleFixture();
  try {
    const applied = f.owner.submit(await f.request());
    await f.owner.stop();
    expect(f.owner.status(applied.operationId).state).toBe("completed");
    const reconstruct = vi.spyOn(selections, "readTemplateSelectionIdentity");
    const history = vi.spyOn(overlays, "readAppliedTemplateSelection");
    const subsystem = f.base.subsystem();
    const runtime = subsystem.state.runtime;
    expect(runtime.templateSelectionIdentity).not.toBeNull();
    expect(reconstruct).toHaveBeenCalled();
    reconstruct.mockClear();
    history.mockClear();
    f.db.transaction(() => {
      for (let index = 0; index < 8; index++) {
        expect(runtime.bank(f.bindings[0].externalBankId).bankId).toBe(f.bindings[0].externalBankId);
      }
    });
    expect(reconstruct).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
