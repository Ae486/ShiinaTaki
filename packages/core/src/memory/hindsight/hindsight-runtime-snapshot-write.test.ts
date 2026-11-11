import { afterEach, expect, it, vi } from "vitest";
import { applicationCommandTestInput } from "../../db/hindsight-application-command-fixtures.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { templateLifecycleFixture } from "./template-lifecycle/template-lifecycle-fixtures.ts";

afterEach(() => vi.restoreAllMocks());

// Failure modes: an admitted read is reused as write authorization after a
// yield, or an already prepared command dispatches under changed live evidence.
it.each(["authority", "secret", "bank", "checkpoint"] as const)("refuses %s drift after snapshot admission before preparation or dispatch", async (damage) => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem(); const scope = f.banks[0]!.scope;
  const input = applicationCommandTestInput({ scope }); input.key.authorityEpochId = "epoch";
  const upload = vi.spyOn(f.remote.client, "uploadApplicationBody"); const commit = vi.spyOn(f.remote.client, "commitApplication");
  try {
    state.replica.readSnapshot((reader) => expect(reader.bankBinding(scope.bankId)?.bank).toBeDefined());
    state.commands.prepare(input);
    await Promise.resolve();
    if (damage === "authority") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
    if (damage === "secret") f.secrets.state.version++;
    if (damage === "bank") f.db.exec("UPDATE hindsight_bank_setup SET status='pending' WHERE scope_kind='global'");
    if (damage === "checkpoint") f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash").run({ hash: "0".repeat(64) });
    const code = damage === "bank" ? "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH" : damage === "checkpoint"
      ? "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID" : "MEMORY_AUTHORITY_MISMATCH";
    expect(() => state.commands.prepare({ ...input, key: { ...input.key, requestId: "new-after-drift" } })).toThrow(code);
    await expect(state.writer.run({ key: input.key, context: { timeoutMs: 10_000 } })).rejects.toThrow(code);
    expect(upload).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM hindsight_application_command_jobs").all()).toEqual([{ state: "prepared" }]);
  } finally { await f.close(); }
});

it("refuses a newly admitted template hold after snapshot admission and before Native dispatch", async () => {
  const f = templateLifecycleFixture();
  try {
    const request = await f.request();
    const { state } = f.base.subsystem(); const scope = f.base.banks[0]!.scope;
    const input = applicationCommandTestInput({ scope }); input.key.authorityEpochId = "epoch";
    state.replica.readSnapshot((reader) => expect(reader.bankBinding(scope.bankId)?.bank).toBeDefined());
    state.commands.prepare(input);
    const upload = vi.spyOn(f.base.remote.client, "uploadApplicationBody");
    await Promise.resolve();
    const operation = f.admit(request); f.plan(operation);
    expect(() => state.commands.prepare({ ...input, key: { ...input.key, requestId: "new-after-template-drift" } })).toThrow("MEMORY_TEMPLATE_HOLD");
    await expect(state.writer.run({ key: input.key, context: { timeoutMs: 10_000 } })).rejects.toThrow("MEMORY_TEMPLATE_HOLD");
    expect(upload).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM hindsight_application_command_jobs").all()).toEqual([{ state: "prepared" }]);
  } finally { await f.close(); }
});
