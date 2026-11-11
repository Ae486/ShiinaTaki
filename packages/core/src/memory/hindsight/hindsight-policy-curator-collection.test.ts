import { expect, it } from "vitest";
import { curatorTestBank, curatorTestFixture, curatorTestTarget, curatorTestReport,
  curatorTestAssessDriver } from "./hindsight-policy-curator-fixtures.ts";

// A due target's active claim must not consume the report's remaining capacity:
// pending work may already occupy a slot while a later due target is claimable.
it("continues past an actively claimed due target until the admitted report fills", async () => {
  const bank = curatorTestBank({ memories: [{ id: "a-busy" }, { id: "b-ready" }, { id: "z-pending" }] });
  const reports: string[][] = [];
  const f = curatorTestFixture({ banks: [bank], driver: async (input) => {
    reports.push(curatorTestReport(input).policies.map((row) => row.nativeId).sort());
    return curatorTestAssessDriver(input);
  } });
  f.config.memory.reportClassCap = 2;
  try {
    const scope = { ...bank.scope, authorityEpochId: "epoch" };
    f.work.prepare({ scope, target: curatorTestTarget(f, bank, "z-pending") });
    const busy = f.work.prepare({ scope, target: curatorTestTarget(f, bank, "a-busy") });
    expect(f.work.claim({ key: busy.key, leaseMs: 60_000 })).toBeDefined();
    await f.curator.runNow("taki");
    expect(reports).toEqual([["b-ready", "z-pending"]]);
  } finally { await f.close(); }
});
