import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home navigation dependency boundary", () => {
  it("keeps runtime default-page consumers independent from the component registry", () => {
    const store = readFileSync(new URL("./home-store.ts", import.meta.url), "utf8");
    const wheel = readFileSync(new URL("../../features/operation-wheel/wheel-items.ts", import.meta.url), "utf8");

    expect(store).toMatch(/import \{ DEFAULT_PAGE_ID \} from "\.\/default-page-id\.ts"/u);
    expect(store).toMatch(/import type \{ PageId \} from "\.\/pages\.ts"/u);
    expect(wheel).toMatch(/import \{ DEFAULT_PAGE_ID \} from "@\/windows\/home\/default-page-id\.js"/u);
    expect(wheel).toMatch(/import type \{ PageId \} from "@\/windows\/home\/pages\.js"/u);
  });
});
