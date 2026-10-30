import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitationState } from "./invitation-controller.ts";
import { INITIAL_INVITATION_STATE, InvitationController } from "./invitation-controller.ts";
import { useCoWatchingInvitation } from "./use-co-watching-invitation.ts";
import { ChatCoWatchingInvitation } from "./chat-co-watching-invitation.tsx";

vi.mock("./use-co-watching-invitation.ts", () => ({ useCoWatchingInvitation: vi.fn() }));
const hook = vi.mocked(useCoWatchingInvitation);
function show(state: Partial<InvitationState> = {}) {
  hook.mockReturnValue({ state: { ...INITIAL_INVITATION_STATE, stale: false, ...state },
    controller: new InvitationController("taki", vi.fn()),
    available: true, connected: true, openChild: vi.fn() });
  return renderToStaticMarkup(<ChatCoWatchingInvitation />);
}
beforeEach(() => vi.clearAllMocks());
describe("invitation-first Chat controls", () => {
  it("shows no persistent start action from detection or an empty read", () => { expect(show()).toBe(""); });
  it("renders accept/defer only for a Core-offered invitation", () => {
    const html = show({ invitation: { invitationId: "id", version: 0, characterId: "taki", title: "Current video",
      media: { kind: "bilibili", bvid: "BV1xx411c7mD", cid: "123", page: 1 }, timelineSeq: 9, expiresAt: "2026-10-17T12:00:00.000Z" } });
    expect(html).toContain("一起看"); expect(html).toContain("暂时不看"); expect(html).not.toContain("停止共看");
  });
  it("keeps Stop available while accepted preparation is still running", () => {
    const html = show({ session: { sessionId: "session", sourceRef: "source", analysisId: "analysis", title: "Current video",
      status: "analyzing", reason: null, expiresAt: "2026-10-17T14:00:00.000Z", preparedCount: null, sentCount: 0, pendingRevision: false } });
    expect(html).toContain("停止共看"); expect(html).toContain("正在分析视频"); expect(html).not.toContain("暂时不看");
  });
  it("exposes paused child navigation without an automatic continuation action", () => {
    const html = show({ session: { sessionId: "session", sourceRef: "source", analysisId: "analysis", title: "Current video",
      status: "paused_child", subagentId: "00000000-0000-4000-8000-000000000001", workInputId: "00000000-0000-4000-8000-000000000011",
      reason: null, expiresAt: "2026-10-17T14:00:00.000Z", preparedCount: null, sentCount: 0, pendingRevision: false } });
    expect(html).toContain("等待你明确继续"); expect(html).toContain("查看子代理工作"); expect(html).not.toContain("继续此工作");
  });
});
