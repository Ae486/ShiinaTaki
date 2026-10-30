import { describe, expect, it, vi } from "vitest";
import type { InteractionPatternGetResult, InteractionPatternListResult, InteractionPatternMutationResult } from "@taki/shared";
import { PatternController } from "./pattern-controller.ts";
import { INITIAL_PATTERN_STATE } from "./pattern-state.ts";
import { deferred, definition, pattern, patternClient } from "./pattern-test-fixtures.ts";

function fixture() {
  let state = INITIAL_PATTERN_STATE;
  const controller = new PatternController((next) => { state = next; });
  return { controller, state: () => state };
}

describe("Pattern read ownership", () => {
  it("keeps last-good data and selection through failure and connection replacement", async () => {
    const f = fixture(), first = patternClient();
    f.controller.bind(first.client); await f.controller.refresh();
    f.controller.select("opaque-pattern"); await f.controller.refresh();
    vi.mocked(first.client.initiativePatternsList).mockRejectedValueOnce(new Error("opaque-transport-error"));
    await f.controller.refresh();
    expect(f.state().list?.patterns).toEqual([pattern()]);
    expect(f.state().readError).not.toContain("opaque-transport-error");
    expect(f.state().fresh).toBe(false);
    f.controller.bind(null);
    expect(f.state().selectedId).toBe("opaque-pattern");
    expect(f.state().detail?.pattern).toEqual(pattern());
    const second = patternClient(pattern({ version: 178924 }));
    f.controller.bind(second.client); await f.controller.refresh();
    expect(f.state().detail?.pattern?.version).toBe(178924);
    expect(f.state().fresh).toBe(true);
  });

  it("coalesces invalidations, suppresses uncovered snapshots and never polls", async () => {
    const f = fixture(), transport = patternClient(), old = deferred<InteractionPatternListResult>();
    vi.mocked(transport.client.initiativePatternsList).mockReturnValueOnce(old.promise);
    f.controller.bind(transport.client);
    const demand = f.controller.refresh();
    transport.changed(); transport.changed(); transport.changed();
    expect(transport.client.initiativePatternsList).toHaveBeenCalledTimes(1);
    const latest = pattern({ version: 178924 }); transport.setRow(latest);
    old.resolve({ patterns: [pattern()], nextAfter: null }); await demand;
    expect(transport.client.initiativePatternsList).toHaveBeenCalledTimes(2);
    expect(f.state().list?.patterns[0]).toEqual(latest);
    expect(f.state().loading).toBe(false);
  });

  it("ignores retired client answers and defers hidden invalidations until re-entry", async () => {
    const f = fixture(), old = patternClient(), delayed = deferred<InteractionPatternListResult>();
    vi.mocked(old.client.initiativePatternsList).mockReturnValueOnce(delayed.promise);
    f.controller.bind(old.client);
    const next = patternClient(pattern({ patternId: "current-pattern" }));
    f.controller.bind(next.client); await f.controller.refresh();
    delayed.resolve({ patterns: [pattern()], nextAfter: null }); await Promise.resolve();
    expect(f.state().list?.patterns[0]?.patternId).toBe("current-pattern");
    f.controller.setVisible(false); next.changed(); next.changed();
    expect(next.client.initiativePatternsList).toHaveBeenCalledTimes(1);
    f.controller.setVisible(true); await f.controller.refresh();
    expect(next.client.initiativePatternsList).toHaveBeenCalledTimes(2);
  });

  it("commits selected identity with its own detail and discards an older requested target", async () => {
    const f = fixture(), transport = patternClient();
    f.controller.bind(transport.client); await f.controller.refresh();
    f.controller.select("opaque-pattern"); await f.controller.refresh();
    const slow = deferred<InteractionPatternGetResult>();
    vi.mocked(transport.client.initiativePatternRead).mockReturnValueOnce(slow.promise);
    f.controller.select("second-pattern");
    expect(f.state().selectedId).toBe("opaque-pattern");
    const third = pattern({ patternId: "third-pattern" }); transport.setRow(third);
    f.controller.select("third-pattern"); await f.controller.refresh();
    slow.resolve({ pattern: pattern({ patternId: "second-pattern" }) }); await Promise.resolve();
    expect(f.state().selectedId).toBe("third-pattern");
    expect(f.state().detail?.pattern).toEqual(third);
  });
});

describe("Pattern explicit mutations", () => {
  it("confirms the exact reviewed revision and serializes actions", async () => {
    const f = fixture(), transport = patternClient(), pending = deferred<InteractionPatternMutationResult>();
    f.controller.bind(transport.client); await f.controller.refresh();
    vi.mocked(transport.client.initiativePatternConfirm).mockReturnValueOnce(pending.promise);
    const reviewed = pattern(), confirmation = f.controller.confirm(reviewed);
    await f.controller.changeState(reviewed, "pause");
    expect(transport.client.initiativePatternChangeState).not.toHaveBeenCalled();
    expect(transport.client.initiativePatternConfirm).toHaveBeenCalledWith(expect.objectContaining({
      patternId: reviewed.patternId, candidateRevisionId: reviewed.candidateRevision?.revisionId, expectedVersion: reviewed.version,
    }));
    expect(vi.mocked(transport.client.initiativePatternConfirm).mock.calls[0]?.[0].commandId).toBeTruthy();
    pending.resolve({ status: "applied", pattern: reviewed }); expect(await confirmation).toBe(true);
    expect(f.state().feedback?.tone).toBe("ok");
  });

  it("preserves refusal feedback and requires a new action instead of automatically rebasing", async () => {
    const f = fixture(), transport = patternClient();
    f.controller.bind(transport.client); await f.controller.refresh();
    const current = pattern({ version: 178924 }); transport.setRow(current);
    vi.mocked(transport.client.initiativePatternPropose).mockResolvedValueOnce({ status: "refused", reason: "conflict", current });
    expect(await f.controller.propose(pattern(), definition())).toBe(false);
    await f.controller.refresh();
    expect(f.state().feedback?.message).toContain("草稿");
    expect(f.state().list?.patterns[0]).toEqual(current);
    expect(transport.client.initiativePatternPropose).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transport.client.initiativePatternPropose).mock.calls[0]?.[0].expectedVersion).toBe(178923);
  });

  it("retains unknown outcome across reconnect without replay or old success feedback", async () => {
    const f = fixture(), transport = patternClient(), pending = deferred<InteractionPatternMutationResult>();
    f.controller.bind(transport.client); await f.controller.refresh();
    vi.mocked(transport.client.initiativePatternConfirm).mockReturnValueOnce(pending.promise);
    const completion = f.controller.confirm(pattern());
    f.controller.bind(null);
    const next = patternClient(); f.controller.bind(next.client); await f.controller.refresh();
    pending.resolve({ status: "applied", pattern: pattern() });
    expect(await completion).toBe(false);
    expect(next.client.initiativePatternConfirm).not.toHaveBeenCalled();
    expect(f.state().feedback?.message).toContain("尚未确认");
    expect(f.state().pending).toBe(false);
  });

  it("rollback only requests a new candidate and never confirms it", async () => {
    const f = fixture(), transport = patternClient();
    f.controller.bind(transport.client); await f.controller.refresh();
    await f.controller.rollback(pattern(), "old-accepted-revision");
    expect(transport.client.initiativePatternRollback).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "old-accepted-revision", expectedVersion: 178923 }));
    expect(transport.client.initiativePatternConfirm).not.toHaveBeenCalled();
    expect(f.state().feedback?.message).toContain("建立新提案");
  });
});
