import { describe, expect, it } from "vitest";
import { CANONICAL_GOVERNANCE_REGISTRY } from "./governance-registry.ts";
import { GovernanceOverrideModeSchema } from "./governance-schema.ts";
import { PermissionPostureSchema } from "./permission-level-schema.ts";
import {
  getCapabilityLabel, getPermissionCellDisplay, PERMISSION_OVERRIDE_LABELS, PERMISSION_POSTURE_LABELS,
} from "./governance-presentation.ts";

describe("governance presentation vocabulary", () => {
  it("covers every canonical capability and cell without changing registry authority", () => {
    const before = JSON.stringify(CANONICAL_GOVERNANCE_REGISTRY);
    const { descriptors } = CANONICAL_GOVERNANCE_REGISTRY;
    expect(descriptors).toHaveLength(19);
    expect(descriptors.flatMap((descriptor) => descriptor.cells)).toHaveLength(31);
    for (const descriptor of descriptors) {
      expect(getCapabilityLabel(descriptor.capabilityId)).not.toBe(getCapabilityLabel("unknown"));
      expect(getCapabilityLabel(descriptor.capabilityId)).not.toContain(descriptor.capabilityId);
      for (const cell of descriptor.cells) {
        const display = getPermissionCellDisplay(cell.key);
        expect(display.label).not.toBe(getPermissionCellDisplay("unknown").label);
        expect(display.description).toMatch(/\p{Script=Han}/u);
        expect(`${display.label} ${display.description}`).not.toContain(cell.key);
      }
    }
    expect(JSON.stringify(CANONICAL_GOVERNANCE_REGISTRY)).toBe(before);
  });

  it.each(["", "unknown.internal-id", "__proto__", "constructor", "toString", "fs-write:dir-root:C:/private"])(
    "uses a generic fallback for unknown or historical whole keys: %s", (key) => {
      expect(getCapabilityLabel(key)).toBe("未识别的操作");
      expect(getPermissionCellDisplay(key)).toEqual({ label: "未识别的权限项", description: "当前版本没有这项权限的说明。" });
    },
  );

  it("describes classifier limitations instead of promising content safety or unsupported execution", () => {
    expect(getPermissionCellDisplay("shell-open:url-safe").description).toContain("不验证网页或邮件内容是否安全");
    expect(getPermissionCellDisplay("shell-open:local-exec").description).toMatch(/UNC.*无扩展名/u);
    expect(getPermissionCellDisplay("exec:compound")).toMatchObject({ label: "复合或无法解析的命令" });
    expect(getPermissionCellDisplay("exec:compound").description).toMatch(/引号.*当前执行器不支持/u);
    expect(getPermissionCellDisplay("exec:allowlist-miss").description).toMatch(/程序定位失败.*文件类型.*本地执行模式/u);
    for (const key of ["dir-root", "outside-root", "skill-hook", "sensitive", "self-escalation"]) {
      expect(getPermissionCellDisplay(`fs-write:${key}`).description).toMatch(/预留分类.*当前写入工具仅支持工作区/u);
    }
  });

  it("keeps display maps on the existing wire values and returns isolated descriptions", () => {
    expect(Object.keys(PERMISSION_POSTURE_LABELS)).toEqual(PermissionPostureSchema.options);
    expect(Object.keys(PERMISSION_OVERRIDE_LABELS)).toEqual(GovernanceOverrideModeSchema.options);
    const display = getPermissionCellDisplay("exec:compound");
    display.label = "consumer edit";
    expect(getPermissionCellDisplay("exec:compound").label).toBe("复合或无法解析的命令");
  });
});
