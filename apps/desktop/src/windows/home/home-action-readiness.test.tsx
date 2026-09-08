import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS, type ConfigEntry } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { HomeClientContext } from "./home-client-context.ts";
import { CostumePage } from "./pages/costume/costume-page.tsx";
import { OperationsPage } from "./pages/operations/operations-page.tsx";
import { PerceptionPage } from "./pages/perception/perception-page.tsx";
import { KnobField } from "./pages/settings/knob-field.tsx";

const CLIENT = {} as WsClient;
const refuseSave = async () => ({ kind: "refused" as const, message: "unavailable" });

function pageMarkup(page: React.ReactNode, connected: boolean): string {
  return renderToStaticMarkup(
    <HomeClientContext.Provider
      value={{
        client: connected ? CLIENT : null,
        status: { kind: connected ? "connected" : "reconnecting" },
        currentTimingPolicy: () => TIMING_POLICY_DEVELOPMENT_DEFAULTS,
      }}
    >
      {page}
    </HomeClientContext.Provider>,
  );
}

function buttonMarkup(markup: string, label: string): string {
  return [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(([button]) => button)
    .find((button) => button.replace(/<[^>]*>/g, "").trim() === label) ?? "";
}

const EDITABLE_KNOB: ConfigEntry = {
  key: "TAKI_RPC_INTERACTIVE_TIMEOUT_MS",
  value: 15_000,
  stored: false,
  envLocked: false,
  default: 15_000,
  apply: "live",
  secret: false,
  secretSet: false,
  input: { kind: "int", min: 1 },
  description: "Interactive RPC deadline.",
};

describe("Home connection-dependent action readiness", () => {
  it("disables otherwise-editable settings fields while the shared Home client is unavailable", () => {
    const disconnected = renderToStaticMarkup(
      <KnobField entry={EDITABLE_KNOB} connectionReady={false} onSave={refuseSave} />,
    );
    const connected = renderToStaticMarkup(
      <KnobField entry={EDITABLE_KNOB} connectionReady onSave={refuseSave} />,
    );

    expect(disconnected).toContain('disabled=""');
    expect(connected).not.toContain('disabled=""');
  });

  it("disables maintenance and destructive Core actions while reconnecting", () => {
    const markup = pageMarkup(<OperationsPage />, false);

    expect(buttonMarkup(markup, "立即整理")).toContain('disabled=""');
    expect(buttonMarkup(markup, "清除全部附件字节")).toContain('disabled=""');
  });

  it("disables every Privacy Pause mutation while reconnecting", () => {
    const markup = pageMarkup(<PerceptionPage />, false);

    for (const label of ["暂停观察", "暂停到明天", "恢复观察"]) {
      expect(buttonMarkup(markup, label)).toContain('disabled=""');
    }
  });

  it("disables Home-socket import and Refresh without disabling the independent Pet result path", () => {
    const disconnected = pageMarkup(<CostumePage />, false);
    const connected = pageMarkup(<CostumePage />, true);

    for (const label of ["导入模型 (.zip/.zst)", "刷新列表"]) {
      expect(buttonMarkup(disconnected, label)).toContain('disabled=""');
      expect(buttonMarkup(connected, label)).not.toContain('disabled=""');
    }
  });
});
