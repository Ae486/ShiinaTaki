import { describe, expect, it, vi } from "vitest";
import type { InitiativeSetupInstallSkillResult, InteractionPatternChanged } from "@taki/shared";
import { INITIAL_SETUP_STATE, InitiativeSetupController, type SetupClient } from "./initiative-setup-controller.ts";
import { deferred, pattern, setupStatus } from "./pattern-test-fixtures.ts";

function fixture() {
  let state = INITIAL_SETUP_STATE;
  const data = setupStatus();
  const changed = new Set<(event: InteractionPatternChanged) => void>();
  const client: SetupClient = {
    initiativeSetupRead: vi.fn(async () => data),
    initiativeSetupInstallSkill: vi.fn<SetupClient["initiativeSetupInstallSkill"]>(async () => ({ status: "installed", reason: null, setup: data })),
    initiativeSetupProposeSeed: vi.fn<SetupClient["initiativeSetupProposeSeed"]>(async () => ({ status: "applied", pattern: pattern() })),
    onInitiativeSetupChanged: (listener) => { changed.add(listener); return () => { changed.delete(listener); }; },
    configSet: vi.fn<SetupClient["configSet"]>(async (params) => ({ status: "ok", key: params.key, value: params.value, apply: "live" })),
    subscribeConfig: vi.fn(async () => undefined), onConfigChanged: () => () => undefined,
  };
  const controller = new InitiativeSetupController((next) => { state = next; });
  return { client, controller, state: () => state, changed: () => changed.forEach((listener) => listener({ characterId: "taki" })) };
}

describe("Initiative explicit setup", () => {
  it("subscribes before reading and preserves disabled or conflicting packages", async () => {
    const f = fixture(); f.controller.bind(f.client); await f.controller.refresh();
    expect(f.client.subscribeConfig).toHaveBeenCalledTimes(1);
    vi.mocked(f.client.initiativeSetupInstallSkill).mockResolvedValueOnce({ status: "refused", reason: "package-disabled", setup: setupStatus() });
    await f.controller.install(); await f.controller.refresh();
    expect(f.state().feedback?.message).toContain("已保留该选择");
    expect(f.client.configSet).not.toHaveBeenCalled();
    vi.mocked(f.client.initiativeSetupInstallSkill).mockResolvedValueOnce({ status: "refused", reason: "name-conflict", setup: setupStatus() });
    await f.controller.install();
    expect(f.state().feedback?.message).toContain("未覆盖");
  });

  it("seed setup proposes without activating or enabling anything", async () => {
    const f = fixture(); f.controller.bind(f.client); await f.controller.refresh();
    await f.controller.proposeSeed("evening-reflection");
    expect(f.client.initiativeSetupProposeSeed).toHaveBeenCalledWith(expect.objectContaining({ seedId: "evening-reflection", characterId: "taki" }));
    expect(f.state().feedback?.message).toContain("待确认提案");
    expect(f.client.configSet).not.toHaveBeenCalled();
  });

  it("serializes setup commands and retires a lost response without replaying", async () => {
    const f = fixture(), pending = deferred<InitiativeSetupInstallSkillResult>();
    f.controller.bind(f.client); await f.controller.refresh();
    vi.mocked(f.client.initiativeSetupInstallSkill).mockReturnValueOnce(pending.promise);
    const operation = f.controller.install(); await f.controller.proposeSeed("evening-reflection");
    expect(f.client.initiativeSetupProposeSeed).not.toHaveBeenCalled();
    f.controller.bind(null); f.controller.bind(f.client); await f.controller.refresh();
    pending.resolve({ status: "installed", reason: null, setup: setupStatus() }); await operation;
    expect(f.state().feedback?.message).toContain("尚未确认");
    expect(f.client.initiativeSetupInstallSkill).toHaveBeenCalledTimes(1);
  });

  it("retains prior policy during errors and defers hidden event reads", async () => {
    const f = fixture(); f.controller.bind(f.client); await f.controller.refresh();
    vi.mocked(f.client.initiativeSetupRead).mockRejectedValueOnce(new Error("failed"));
    await f.controller.refresh(); expect(f.state().data).toEqual(setupStatus()); expect(f.state().fresh).toBe(false);
    const reads = vi.mocked(f.client.initiativeSetupRead).mock.calls.length;
    f.controller.setVisible(false); f.changed(); f.changed();
    expect(f.client.initiativeSetupRead).toHaveBeenCalledTimes(reads);
    f.controller.setVisible(true); await f.controller.refresh(); expect(f.state().fresh).toBe(true);
  });
});
