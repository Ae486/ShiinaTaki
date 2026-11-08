import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionButton, type ActionButtonProps } from "../../action-button.tsx";
import { hindsightStatus, unreviewedSection } from "./memory-authority-fixtures.ts";
import { HindsightLifecycleBlock } from "./memory-hindsight-lifecycle-block.tsx";
import { hindsightLifecycleView } from "./memory-hindsight-lifecycle-state.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

const noop = async () => undefined;
// The unreviewed-config status is the one Core state that offers revalidate and provision together.
const status = hindsightStatus({ hindsight: unreviewedSection() });

/** Walks the returned element tree (no DOM in this suite) so a click is driven through the real onClick props. */
function actionButtons(node: ReactNode): ReactElement<ActionButtonProps>[] {
  if (Array.isArray(node)) return node.flatMap(actionButtons);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return node.type === ActionButton ? [node as ReactElement<ActionButtonProps>] : actionButtons(node.props.children);
}

function block(locked: boolean, busyKey: string | null = null) {
  const submit = vi.fn<MemoryOperationsView["submit"]>(noop);
  const ops: MemoryOperationsView = { status, loading: false, error: null, busyKey, feedback: null, connectionReady: true,
    refresh: noop, submit, submitSync: noop, configureSync: noop, cancel: noop };
  const lifecycle = hindsightLifecycleView(status);
  if (!lifecycle) throw new Error("fixture must carry a Hindsight section");
  return { submit, buttons: actionButtons(HindsightLifecycleBlock({ lifecycle, ops, locked })) };
}

describe("Hindsight lifecycle block", () => {
  it("submits each clicked action's exact request and busy key through the generic submit", () => {
    const { submit, buttons } = block(false);
    for (const button of buttons) button.props.onClick();
    expect(submit.mock.calls).toEqual([
      [{ kind: "connection.revalidate", expectedEpochId: "epoch-2" }, "revalidate"],
      [{ kind: "bank.provision", characterId: "nana" }, "provision:nana"],
      [{ kind: "bank.provision", characterId: "yui" }, "provision:yui"],
    ]);
  });

  it("passes the card lock to every button and marks only the pending one busy", () => {
    const { buttons } = block(true, "revalidate");
    expect(buttons.map((button) => [button.props.disabled, button.props.busy])).toEqual([[true, true], [true, false], [true, false]]);
  });
});
