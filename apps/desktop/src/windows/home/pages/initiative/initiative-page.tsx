/**
 * INPUT: shared Core Pattern/setup projections and explicit local selection/editing sessions.
 * OUTPUT: complete Home authoring, review, history and lifecycle management surface.
 * POS: registered Home page; disposable state only, with drafts retained through refresh and conflicts.
 */
import { useState } from "react";
import type { InteractionPatternView } from "@taki/shared";
import { MasterDetail } from "@/components/ui/master-detail.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PageBody, PageHeader } from "../../page-chrome.tsx";
import { ActionButton } from "../../action-button.tsx";
import { PatternEditor } from "@/features/initiative-patterns/pattern-editor.js";
import { InitiativeSetupCard } from "@/features/initiative-patterns/initiative-setup-card.js";
import { InitiativePolicyView } from "@/features/initiative-patterns/initiative-policy-view.js";
import { usePatterns } from "@/features/initiative-patterns/use-patterns.js";
import { useInitiativeSetup } from "@/features/initiative-patterns/use-initiative-setup.js";
import { PatternList } from "./pattern-list.tsx";
import { PatternDetail } from "./pattern-detail.tsx";

export function InitiativePage() {
  const patterns = usePatterns("initiative");
  const setup = useInitiativeSetup("initiative");
  const [editing, setEditing] = useState<{ initial: InteractionPatternView | null } | null>(null);
  const latest = editing?.initial ? patterns.state.list?.patterns.find((row) => row.patternId === editing.initial?.patternId) ?? null : null;
  const available = patterns.available && setup.available;
  return <>
    <PageHeader title="主动互动" hint="一起约定什么时候关心什么；每一份提案都由你阅读并确认。" busy={patterns.state.loading} />
    <PageBody>
      <InitiativeSetupCard setup={setup} />
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton busy={patterns.state.loading} onClick={() => void patterns.controller.refresh()}>刷新规则</ActionButton>
        <ActionButton tone="primary" disabled={!available || editing !== null} onClick={() => setEditing({ initial: null })}>新建互动规则</ActionButton>
      </div>
      {patterns.state.readError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void patterns.controller.refresh() }}>{patterns.state.readError}</FeedbackLine>}
      {patterns.state.feedback && <FeedbackLine tone={patterns.state.feedback.tone}>{patterns.state.feedback.message}</FeedbackLine>}
      {editing && <PatternEditor key={editing.initial?.patternId ?? "new"} initial={editing.initial} latest={latest} disabled={!available}
        completions={setup.state.data?.completions} submit={(base, definition) => patterns.controller.propose(base, definition)} close={() => setEditing(null)} />}
      <MasterDetail list={<PatternList list={patterns.state.list} selectedId={patterns.state.selectedId} busy={patterns.state.loading}
        select={(id) => patterns.controller.select(id)} loadMore={() => patterns.controller.loadMore()} />}
        detail={<>
          {patterns.state.detailError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void patterns.controller.refresh() }}>{patterns.state.detailError}</FeedbackLine>}
          <PatternDetail key={patterns.state.selectedId ?? "none"} patterns={{ ...patterns, available }} policy={<InitiativePolicyView setup={setup.state.data} />} edit={(row) => setEditing({ initial: row })} />
        </>} />
    </PageBody>
  </>;
}
