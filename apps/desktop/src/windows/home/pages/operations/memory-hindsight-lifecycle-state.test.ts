import { describe, expect, it, vi } from "vitest";
import { MemoryAuthorityStatusSchema, type MemoryAuthorityStatus } from "@taki/shared";
import { AT, UNMAPPABLE_CHARACTER, degradedStatus, disabledSection, hindsightStatus, lifecycleSection, localStatus, operation,
  provisioningSection, unreviewedSection } from "./memory-authority-fixtures.ts";
import { createMemoryOperationsController, type MemoryOperationsClient } from "./memory-operations-controller.ts";
import { hindsightLifecycleView } from "./memory-hindsight-lifecycle-state.ts";

const served = hindsightStatus({ hindsight: lifecycleSection() });
const provisioning = hindsightStatus({ hindsight: provisioningSection() });
const unreviewed = hindsightStatus({ hindsight: unreviewedSection() });
const disabled = degradedStatus(disabledSection(), "connection_disabled");
const unconfigured = degradedStatus(disabledSection("unconfigured"), "connection_disabled");
const UNMAPPABLE = `Character · ${UNMAPPABLE_CHARACTER}`;

describe("Hindsight lifecycle view model", () => {
  it("builds every lifecycle fixture from the shared strict schema", () => {
    for (const status of [degradedStatus(), disabled, unconfigured, served, provisioning, unreviewed]) {
      expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    }
  });

  it("projects nothing when the marker is not Hindsight", () => {
    const legacy: MemoryAuthorityStatus = { ...localStatus(), authority: { mode: "legacy-markdown", epochId: null, providerLineageId: null },
      runtime: { providerId: "legacy-markdown", available: true, unavailableReason: null } };
    expect(hindsightLifecycleView(localStatus())).toBeNull();
    expect(hindsightLifecycleView(legacy)).toBeNull();
  });

  it("labels every readiness state per scope and keeps codes and native ids in diagnostics only", () => {
    const view = hindsightLifecycleView(provisioning);
    expect(view?.banks).toEqual([
      { label: "Global", value: "可用" }, { label: "Character · taki", value: "同步中" }, { label: "Character · mika", value: "创建中" },
      { label: "Character · nana", value: "失败" }, { label: "Character · yui", value: "未创建" }, { label: UNMAPPABLE, value: "未创建" },
    ]);
    expect(view?.diagnostics).toEqual([
      { label: "Global Bank", value: "global" }, { label: "Character · taki Bank", value: "character-taki" },
      { label: "Character · mika Bank", value: "character-mika" }, { label: "Character · nana Bank", value: "character-nana · HINDSIGHT_TEMPLATE_INVALID" },
      { label: "Character · yui Bank", value: "character-yui" }, { label: `${UNMAPPABLE} Bank`, value: "无" },
    ]);
    expect(JSON.stringify([view?.connection, view?.banks])).not.toMatch(/HINDSIGHT_|character-/);
  });

  it("reuses the runtime reason labels for a changed and a disabled connection", () => {
    expect(hindsightLifecycleView(degradedStatus())?.connection).toEqual([
      { label: "连接配置", value: "已配置" }, { label: "配置变更", value: "连接配置已变更，需要重新校验" }, { label: "上次校验通过", value: "无记录" },
    ]);
    expect(hindsightLifecycleView(disabled)?.connection).toEqual([{ label: "连接配置", value: "Hindsight 连接已关闭" }]);
    expect(hindsightLifecycleView(unconfigured)?.connection).toEqual([{ label: "连接配置", value: "未填写连接参数" }]);
    expect(hindsightLifecycleView(unreviewed)?.connection).toEqual([
      { label: "连接配置", value: "已配置" }, { label: "配置变更", value: "当前配置尚未校验" }, { label: "上次校验通过", value: "无记录" },
    ]);
    expect(hindsightLifecycleView(served)?.connection).toEqual([
      { label: "连接配置", value: "已配置" }, { label: "配置变更", value: "与已校验的配置一致" }, { label: "上次校验通过", value: AT },
    ]);
  });

  it("offers exactly the Core-listed actions with their exact requests", () => {
    expect(hindsightLifecycleView(unreviewed)?.actions).toEqual([
      { key: "revalidate", label: "重新校验连接", request: { kind: "connection.revalidate", expectedEpochId: "epoch-2" } },
      { key: "provision:nana", label: "创建 Bank（nana）", request: { kind: "bank.provision", characterId: "nana" } },
      { key: "provision:yui", label: "创建 Bank（yui）", request: { kind: "bank.provision", characterId: "yui" } },
    ]);
    expect(hindsightLifecycleView(degradedStatus())?.actions.map((action) => action.key)).toEqual(["revalidate"]);
    expect(hindsightLifecycleView(served)?.actions.map((action) => action.key)).toEqual(["provision:nana", "provision:yui"]);
    expect(hindsightLifecycleView(disabled)?.actions).toEqual([]);
    // Readiness never implies an action: while a provision runs, the failed and unprovisioned Banks stay without a button.
    expect(hindsightLifecycleView(provisioning)?.actions).toEqual([]);
  });

  it("submits the descriptor's request through the generic controller unchanged", async () => {
    const submitted = vi.fn<MemoryOperationsClient["memoryOperationSubmit"]>(async () => operation());
    const client: MemoryOperationsClient = {
      memoryAuthorityStatus: async () => unreviewed, memoryActivationStatus: async () => { throw new Error("unused"); },
      memoryOperationSubmit: submitted, memoryOperationCancel: async () => operation(),
      subscribeMemoryOperations: async () => undefined, onMemoryOperationChanged: () => () => undefined,
      memoryReplicaConfigure: async () => { throw new Error("unused"); }, onMemoryReplicaChanged: () => () => undefined,
    };
    const started = vi.fn();
    const controller = createMemoryOperationsController<MemoryAuthorityStatus>({
      loading: () => undefined, loaded: () => undefined, loadFailed: () => undefined, mutationStarted: started, mutationSettled: () => undefined,
    }, (target) => target.memoryAuthorityStatus());
    controller.replace(client);
    for (const action of hindsightLifecycleView(unreviewed)?.actions ?? []) await controller.submit(action.request, action.key);
    expect(submitted.mock.calls.map(([request]) => request)).toEqual([
      { kind: "connection.revalidate", expectedEpochId: "epoch-2" }, { kind: "bank.provision", characterId: "nana" }, { kind: "bank.provision", characterId: "yui" },
    ]);
    expect(started.mock.calls.map(([key]) => key)).toEqual(["revalidate", "provision:nana", "provision:yui"]);
    controller.dispose();
  });
});
