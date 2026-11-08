import { describe, expect, it, vi } from "vitest";
import type { SecretPresenceResult, SecretSetResult } from "@taki/shared";
import { createHindsightKeyController, HINDSIGHT_KEY_REF, INITIAL_KEY_STATE, type HindsightKeyState } from "./hindsight-key-controller.ts";

const provenance = { source: "catalog" as const, keyVersion: 1, updatedAt: "2026-10-29T00:00:00.000Z" };
const presence = (present = false, health: SecretPresenceResult["health"] = "ok"): SecretPresenceResult => ({
  secretRef: HINDSIGHT_KEY_REF, present, health, provenance: present ? provenance : null,
});
const stored: SecretSetResult = { ...presence(true), present: true, provenance };
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function client() {
  let present = false;
  return {
    secretPresence: vi.fn(async () => presence(present)),
    secretSet: vi.fn(async () => { present = true; return stored; }),
    secretClear: vi.fn(async () => { present = false; return { secretRef: HINDSIGHT_KEY_REF, present: false as const }; }),
  };
}
function harness() {
  let state: HindsightKeyState = INITIAL_KEY_STATE;
  const publish = vi.fn((next: HindsightKeyState) => { state = next; });
  return { controller: createHindsightKeyController(publish), publish, state: () => state };
}

describe("Hindsight key write-only controller", () => {
  it("reads fresh absence, saves and clears only the fixed secret reference, and reports storage separately", async () => {
    const target = client();
    const h = harness();
    h.controller.replace(target);
    await settle();
    expect(target.secretPresence).toHaveBeenCalledExactlyOnceWith({ secretRef: HINDSIGHT_KEY_REF });
    expect(h.state().presence).toEqual(presence());
    await h.controller.save("transient-test-key");
    expect(target.secretSet).toHaveBeenCalledExactlyOnceWith({ secretRef: HINDSIGHT_KEY_REF, value: "transient-test-key" });
    expect(h.state()).toMatchObject({ presence: presence(true), busy: null, feedback: { tone: "ok" } });
    expect(h.state().feedback?.message).toContain("尚未校验连接");
    expect(JSON.stringify(h.publish.mock.calls)).not.toContain("transient-test-key");
    await h.controller.clear();
    expect(target.secretClear).toHaveBeenCalledExactlyOnceWith({ secretRef: HINDSIGHT_KEY_REF });
    expect(h.state()).toMatchObject({ presence: presence(), busy: null, feedback: { tone: "ok" } });
    expect(target.secretPresence).toHaveBeenCalledTimes(3);
  });

  it.each(["locked", "unreadable", "unsupported"] as const)("preserves %s as unknown and refuses writes", async (health) => {
    const target = client();
    target.secretPresence.mockResolvedValue(presence(false, health));
    const h = harness();
    h.controller.replace(target);
    await settle();
    await h.controller.save("never-dispatched");
    await h.controller.clear();
    expect(h.state().presence?.health).toBe(health);
    expect(target.secretSet).not.toHaveBeenCalled();
    expect(target.secretClear).not.toHaveBeenCalled();
  });

  it("serializes writes and blocks an overlapping refresh until the post-write read", async () => {
    const target = client();
    const reply = deferred<SecretSetResult>();
    target.secretSet.mockReturnValueOnce(reply.promise);
    const h = harness();
    h.controller.replace(target);
    await settle();
    const pending = h.controller.save("one-input");
    await h.controller.save("second-input");
    await h.controller.clear();
    await h.controller.refresh();
    expect(target.secretSet).toHaveBeenCalledTimes(1);
    expect(target.secretClear).not.toHaveBeenCalled();
    expect(target.secretPresence).toHaveBeenCalledTimes(1);
    reply.resolve(stored);
    await pending;
    expect(target.secretPresence).toHaveBeenCalledTimes(2);
  });

  it("drops old presence reads and does not retain prior metadata across client replacement", async () => {
    const first = client();
    const pending = deferred<SecretPresenceResult>();
    first.secretPresence.mockReturnValueOnce(pending.promise);
    const h = harness();
    h.controller.replace(first);
    const second = client();
    h.controller.replace(second);
    expect(h.state().presence).toBeNull();
    await settle();
    h.publish.mockClear();
    pending.resolve(presence(true));
    await settle();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.state().presence).toEqual(presence());
  });

  it.each(["replace", "dispose"] as const)("ignores a late secret write after %s without replay", async (retire) => {
    const first = client();
    const reply = deferred<SecretSetResult>();
    first.secretSet.mockReturnValueOnce(reply.promise);
    const h = harness();
    h.controller.replace(first);
    await settle();
    const pending = h.controller.save("old-generation-key");
    const second = client();
    if (retire === "replace") h.controller.replace(second);
    else h.controller.dispose();
    await settle();
    h.publish.mockClear();
    reply.resolve(stored);
    await pending;
    expect(h.publish).not.toHaveBeenCalled();
    expect(first.secretPresence).toHaveBeenCalledTimes(1);
    expect(second.secretSet).not.toHaveBeenCalled();
    expect(second.secretClear).not.toHaveBeenCalled();
  });

  it("sanitizes a lost reply and re-reads presence without resending the secret", async () => {
    const target = client();
    target.secretSet.mockRejectedValueOnce(new Error("sensitive-error-test-key"));
    const h = harness();
    h.controller.replace(target);
    await settle();
    await h.controller.save("sensitive-error-test-key");
    expect(target.secretSet).toHaveBeenCalledTimes(1);
    expect(target.secretPresence).toHaveBeenCalledTimes(2);
    expect(h.state().feedback).toMatchObject({ tone: "warn" });
    expect(h.state().feedback?.message).toContain("结果未知");
    expect(JSON.stringify(h.publish.mock.calls)).not.toContain("sensitive-error-test-key");
  });

  it("distinguishes a confirmed Core refusal from an unknown write result", async () => {
    const target = client();
    target.secretSet.mockRejectedValueOnce(Object.assign(new Error("secret-in-error"), {
      data: { code: "SECRET_REFUSED", reason: "store-locked" },
    }));
    const h = harness();
    h.controller.replace(target);
    await settle();
    target.secretPresence.mockResolvedValue(presence(false, "locked"));
    await h.controller.save("secret-in-error");
    expect(h.state().feedback?.message).toContain("Core 拒绝");
    expect(h.state().feedback?.message).not.toContain("结果未知");
    expect(h.state().presence?.health).toBe("locked");
    expect(JSON.stringify(h.publish.mock.calls)).not.toContain("secret-in-error");
  });

  it("keeps a failed presence read unknown and never interprets it as absent", async () => {
    const target = client();
    target.secretPresence.mockRejectedValueOnce(new Error("read-failure"));
    const h = harness();
    h.controller.replace(target);
    await settle();
    expect(h.state()).toMatchObject({ presence: null, loading: false, feedback: { tone: "danger" } });
    await h.controller.save("blocked-input");
    expect(target.secretSet).not.toHaveBeenCalled();
    await h.controller.refresh();
    expect(h.state()).toMatchObject({ presence: presence(), feedback: null });
  });

  it("preserves a confirmed save receipt if the following presence refresh fails", async () => {
    const target = client();
    const h = harness();
    h.controller.replace(target);
    await settle();
    target.secretPresence.mockRejectedValueOnce(new Error("post-write-read-failure"));
    await h.controller.save("confirmed-write-test-key");
    expect(h.state()).toMatchObject({ presence: null, loading: false, busy: null });
    expect(h.state().feedback?.message).toContain("API Key 已保存");
    expect(h.state().feedback?.message).toContain("无法读取最新 API Key 状态");
    expect(h.state().feedback?.message).toContain("尚未校验连接");
  });
});
