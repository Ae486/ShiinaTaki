/**
 * INPUT:  a fake WsClient (costumeResolution/reportAvatar spies) + a fake PetScene whose switchCostume returns a
 *         re-read vocabulary; the Tauri asset resolver (character-asset-url) is mocked out for node.
 * OUTPUT: assertions that a costume switch re-reports the NEW model's vocabulary through avatar.report (report-trace,
 *         acceptance #2) and threads the costume's external-ref resolution into the asset resolver.
 * POS:    unit test for the shared costume switch+report dance. Node-safe (character-asset-url mocked). Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

// costumeAssetResolver touches Tauri (convertFileSrc/homeDir); mock it so the dance runs in node.
vi.mock("./character-asset-url.ts", () => ({
  costumeAssetResolver: vi.fn(async () => ({ settingsUrl: "asset://taki/live_01/x.model3.json", resolve: () => null })),
}));

import { resolveSwitchReport, type SwitchReportDeps } from "./resolve-switch-report.ts";
import { costumeAssetResolver } from "./character-asset-url.ts";

type Vocab = { motions: string[]; expressions: string[] };

function fakeClient() {
  const reportAvatar = vi.fn(async () => undefined);
  const costumeResolution = vi.fn(async () => ({ resolution: { "../x.mtn": "taki/arbeit/x.mtn" } }));
  return { client: { reportAvatar, costumeResolution } as unknown as SwitchReportDeps["client"], reportAvatar, costumeResolution };
}

function fakeScene(vocabulary: Vocab) {
  const switchCostume = vi.fn(async () => vocabulary);
  const abortSwitch = vi.fn();
  return { scene: { switchCostume, abortSwitch } as unknown as SwitchReportDeps["scene"], switchCostume, abortSwitch };
}

describe("resolveSwitchReport", () => {
  it("re-reports the switched model's vocabulary through avatar.report (report-trace, accept #2)", async () => {
    const vocab: Vocab = { motions: ["mtn_idle01_C"], expressions: ["exp_smile05"] };
    const { client, reportAvatar, costumeResolution } = fakeClient();
    const { scene, switchCostume } = fakeScene(vocab);

    await resolveSwitchReport({ client, scene, costume: "live_01", settingsFile: "x.model3.json", timeoutMs: 30_000 });

    expect(costumeResolution).toHaveBeenCalledWith("taki", "live_01");
    expect(switchCostume).toHaveBeenCalledTimes(1);
    // The reported names equal the NEW model's re-read vocabulary + the worn costume id (1f change-detection key).
    expect(reportAvatar).toHaveBeenCalledWith({
      characterId: "taki",
      motions: ["mtn_idle01_C"],
      expressions: ["exp_smile05"],
      costume: "live_01",
    });
  });

  it("threads the costume's external-ref resolution into the asset resolver (prune feed)", async () => {
    const { client } = fakeClient();
    const { scene } = fakeScene({ motions: [], expressions: [] });
    await resolveSwitchReport({ client, scene, costume: "casual", settingsFile: "model.json", timeoutMs: 30_000 });
    expect(vi.mocked(costumeAssetResolver)).toHaveBeenCalledWith({
      characterId: "taki",
      costume: "casual",
      settingsFile: "model.json",
      resolution: { "../x.mtn": "taki/arbeit/x.mtn" },
    });
  });

  it("aborts the switch and does NOT report when the reload fails/times out (1f Fix 1)", async () => {
    const { client, reportAvatar } = fakeClient();
    const switchCostume = vi.fn(() => Promise.reject(new Error("costume live_01 timed out after 30s")));
    const abortSwitch = vi.fn();
    const scene = { switchCostume, abortSwitch } as unknown as SwitchReportDeps["scene"];

    await expect(
      resolveSwitchReport({ client, scene, costume: "live_01", settingsFile: "x.model3.json", timeoutMs: 30_000 }),
    ).rejects.toThrow(/timed out/);

    // The in-flight switch is marked stale so a late-resolving model self-discards; a timed-out costume id is never
    // reported (the re-report stays downstream of the timeout guard).
    expect(abortSwitch).toHaveBeenCalledTimes(1);
    expect(reportAvatar).not.toHaveBeenCalled();
  });
});
