import { describe, expect, it, vi } from "vitest";

import { createExpressionControl, type ExpressionTarget } from "./expression-control.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Matches the installed engine's reservation check and reset retaining currentExpression.
function fakeTarget() {
  const expressions = [{ name: "smile" }, { name: "angry" }];
  const loads: Promise<unknown>[] = expressions.map((expression) => Promise.resolve(expression));
  let visible: unknown = null;
  const target: ExpressionTarget = {
    expressions,
    currentExpression: {},
    reserveExpressionIndex: -1,
    destroyed: false,
    getExpressionIndex: (name) => ["smile", "angry"].indexOf(name),
    setExpression: vi.fn(async (name: string) => {
      const index = target.getExpressionIndex(name);
      if (index < 0 || expressions.indexOf(target.currentExpression as { name: string }) === index) return false;
      target.reserveExpressionIndex = index;
      const expression = await loads[index];
      if (!expression || target.reserveExpressionIndex !== index) return false;
      target.reserveExpressionIndex = -1;
      target.currentExpression = expression;
      visible = expression;
      return true;
    }),
    resetExpression: vi.fn(() => { visible = null; }),
    restoreExpression: vi.fn(() => { visible = target.currentExpression; }),
  };
  return { target, loads, visible: () => visible };
}

describe("lab expression control", () => {
  it("restores the same expression after Reset and for repeated Set", async () => {
    const fake = fakeTarget();
    const control = createExpressionControl(fake.target, () => 100);
    expect(await control.set("smile")).toBe("applied");
    control.reset();
    expect(fake.visible()).toBeNull();
    expect(await control.set("smile")).toBe("restored");
    expect(fake.visible()).toEqual({ name: "smile" });
    expect(await control.set("smile")).toBe("restored");
    expect(control.state()).toEqual({ kind: "applied", name: "smile", settleAt: 1300 });
  });

  it("cancels engine reservation when Reset arrives during Set", async () => {
    const fake = fakeTarget();
    const load = deferred<unknown>();
    fake.loads[0] = load.promise;
    const control = createExpressionControl(fake.target);
    const result = control.set("smile");
    await Promise.resolve();
    expect(fake.target.reserveExpressionIndex).toBe(0);
    control.reset();
    load.resolve({ name: "smile" });
    expect(await result).toBe("superseded");
    expect(fake.visible()).toBeNull();
    expect(control.state()).toEqual({ kind: "none" });
  });

  it("serializes same-index replacement so a stale request cannot consume the new reservation", async () => {
    const fake = fakeTarget();
    const load = deferred<unknown>();
    fake.loads[0] = load.promise;
    const control = createExpressionControl(fake.target);
    const first = control.set("smile");
    await Promise.resolve();
    const second = control.set("smile");
    expect(fake.target.reserveExpressionIndex).toBe(-1);
    load.resolve({ name: "smile" });
    expect(await first).toBe("superseded");
    expect(await second).toBe("applied");
    expect(fake.visible()).toEqual({ name: "smile" });
  });

  it("does not reapply or retain probe success after disposal or a failed request", async () => {
    const fake = fakeTarget();
    const control = createExpressionControl(fake.target);
    await control.set("smile");
    expect(await control.set("missing")).toBe("failed");
    expect(control.state().kind).toBe("failed");
    const load = deferred<unknown>();
    fake.loads[1] = load.promise;
    const pending = control.set("angry");
    await Promise.resolve();
    control.dispose();
    fake.target.destroyed = true;
    load.resolve({ name: "angry" });
    expect(await pending).toBe("superseded");
    expect(fake.visible()).toEqual({ name: "smile" });
    expect(await control.set("angry")).toBe("superseded");
  });

  it("turns engine failures into failed requests without poisoning later Set", async () => {
    const fake = fakeTarget();
    fake.loads[0] = Promise.reject(new Error("expression unavailable"));
    const control = createExpressionControl(fake.target);
    expect(await control.set("smile")).toBe("failed");
    expect(control.state()).toEqual({ kind: "failed", name: "smile", reason: "expression unavailable" });
    expect(await control.set("angry")).toBe("applied");
  });
});
