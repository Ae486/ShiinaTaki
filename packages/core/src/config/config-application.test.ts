import { describe, expect, it } from "vitest";
import type { ConfigValue } from "@taki/shared";
import { createConfigSource } from "./config-source.ts";
import { configApplicationBoundary, createConfigApplication } from "./config-application.ts";
import { CONFIG_KNOBS } from "./knob-registry.ts";

function fixture() {
  const values = new Map<string, ConfigValue>();
  const source = createConfigSource({ env: {}, repo: {
    get: (key) => values.get(key) ?? null, all: () => values,
    upsert: (key, value) => { values.set(key, value); }, delete: (key) => { values.delete(key); },
  } });
  return { values, tracker: createConfigApplication({ source, changed() {} }) };
}

describe("configuration application observations", () => {
  it("classifies every registered setting and keeps bootstrap/external boundaries distinct", () => {
    for (const knob of CONFIG_KNOBS) expect(configApplicationBoundary(knob.key)).toBeTruthy();
    expect(configApplicationBoundary("TAKI_DATA_DIR")).toBe("bootstrap");
    expect(configApplicationBoundary("TAKI_HINDSIGHT_MODEL_DEFAULT")).toBe("external");
  });

  it("preserves old active value on preparation failure and never publishes private error text", async () => {
    const { values, tracker } = fixture();
    tracker.mark(["TAKI_WS_PORT"], "applied");
    values.set("TAKI_WS_PORT", 12000);
    await tracker.apply(["TAKI_WS_PORT"], () => { throw new Error("private path/credential"); });
    expect(tracker.read("TAKI_WS_PORT")).toMatchObject({ state: "failed", activeValue: 8974 });
    expect(JSON.stringify(tracker.read("TAKI_WS_PORT"))).not.toContain("private path");
  });

  it("fences delayed prior results while retaining the value captured for each application", async () => {
    const { values, tracker } = fixture();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    values.set("TAKI_WS_PORT", 12000);
    const old = tracker.apply(["TAKI_WS_PORT"], () => pending);
    values.set("TAKI_WS_PORT", 13000);
    await tracker.apply(["TAKI_WS_PORT"], () => {});
    finish();
    await old;
    expect(tracker.read("TAKI_WS_PORT")).toMatchObject({ state: "applied", activeValue: 13000 });
  });
});
