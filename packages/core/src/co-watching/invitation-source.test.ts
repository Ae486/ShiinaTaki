import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { selectInvitationSource } from "./invitation-source.ts";
const fixtures: Awaited<ReturnType<typeof coWatchingFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });

it("uses the fresh same-page source after player initialization without inheriting another video or document", async () => {
  const f = await coWatchingFixture(); fixtures.push(f);
  const captured = structuredClone(f.playback);
  const renewed = { ...structuredClone(captured), sourceRef: randomUUID(), attachmentGeneration: 2 };
  expect(selectInvitationSource({ captured: [captured], current: [renewed], sourceRef: captured.sourceRef })).toBe(renewed);
  renewed.source.media.cid = "123";
  expect(selectInvitationSource({ captured: [captured], current: [renewed], sourceRef: renewed.sourceRef })).toBeUndefined();
  renewed.source.media.cid = captured.source.media.cid; renewed.source.documentId = randomUUID();
  expect(selectInvitationSource({ captured: [captured], current: [renewed] })).toBeUndefined();
});

it("can select a source that became available during model execution but refuses multiple unselected sources", async () => {
  const f = await coWatchingFixture(); fixtures.push(f);
  expect(selectInvitationSource({ captured: [], current: [f.playback] })).toBe(f.playback);
  expect(selectInvitationSource({ captured: [], current: [f.playback, structuredClone(f.playback)] })).toBeUndefined();
});
