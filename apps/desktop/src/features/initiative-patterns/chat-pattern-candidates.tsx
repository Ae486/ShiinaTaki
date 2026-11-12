/**
 * INPUT: Home's authenticated Pattern/setup read owners while Chat is actually visible.
 * OUTPUT: actionable proposal cards within the existing conversation scroll container.
 * POS: Chat adjunct; proposal invalidation never rewrites Timeline or uses permission approval.
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { usePatterns } from "./use-patterns.ts";
import { useInitiativeSetup } from "./use-initiative-setup.ts";
import { PatternCandidateCard } from "./pattern-candidate-card.tsx";
import { InitiativePolicyView } from "./initiative-policy-view.tsx";

export function ChatPatternCandidates() {
  const patterns = usePatterns("chat");
  const setup = useInitiativeSetup("chat");
  const candidates = patterns.state.list?.patterns.filter((row) => row.candidateRevision !== null && row.state !== "retired") ?? [];
  if (!candidates.length && !patterns.state.readError && !patterns.state.feedback) return null;
  const feedback = patterns.state.feedback && <FeedbackLine tone={patterns.state.feedback.tone}>{patterns.state.feedback.message}</FeedbackLine>;
  return <section className="space-y-3 py-2" aria-label="互动提案">
    <div className="flex justify-end"><ActionButton tone="link" onClick={setup.openPatterns}>管理互动规则</ActionButton></div>
    {patterns.state.readError && <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void patterns.controller.refresh() }}>{patterns.state.readError}</FeedbackLine>}
    {setup.state.error && <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void setup.controller.refresh() }}>{setup.state.error}</FeedbackLine>}
    {feedback}
    {candidates.map((row) => <PatternCandidateCard key={row.patternId} pattern={row} available={patterns.available && setup.available}
      confirm={(reviewed) => patterns.controller.confirm(reviewed)} policy={<InitiativePolicyView setup={setup.state.data} />} feedback={feedback} />)}
    {patterns.state.list?.nextAfter && <ActionButton disabled={patterns.state.loading} onClick={() => patterns.controller.loadMore()}>查看更多互动提案</ActionButton>}
  </section>;
}
