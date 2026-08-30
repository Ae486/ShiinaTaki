/**
 * INPUT:  one Core-returned permission cell, connection/pending state, and an exact cell mutation callback.
 * OUTPUT: <PermissionCellRow> — factory/override/effective/mode facts plus reset and second-confirm editing.
 * POS:    ui/windows/home/pages/settings — presentational row; it never classifies capability risk or invents authority.
 */
import { useState } from "react";
import { PermissionPostureSchema, type PermissionCellState, type PermissionPosture } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { CARD_ROW } from "../../page-card.tsx";
import { Badge, type BadgeTone } from "../../badge.tsx";

const POSTURES: PermissionPosture[] = ["auto", "ask", "deny"];
const TONE: Record<PermissionPosture, BadgeTone> = { auto: "ok", ask: "warn", deny: "neutral" };

interface PermissionCellRowProps {
  cell: PermissionCellState;
  policyGeneration: number;
  disabled: boolean;
  pending: boolean;
  onSet(posture: PermissionPosture | null, secondConfirm?: boolean): void;
}

interface ConfirmChoice {
  posture: PermissionPosture;
  generation: number;
}

export function PermissionCellRow(props: PermissionCellRowProps) {
  const [confirmation, setConfirmation] = useState<ConfirmChoice | null>(null);

  const choose = (posture: PermissionPosture) => {
    if (requiresSecondConfirm(props.cell, posture)) {
      setConfirmation({ posture, generation: props.policyGeneration });
      return;
    }
    props.onSet(posture);
  };

  return (
    <div className={`border-t border-border-subtle first:border-t-0 ${CARD_ROW}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CellSummary cell={props.cell} />
        <CellControls {...props} onChoose={choose} />
      </div>
      {props.cell.overrideMode === "immutable" && <p className="mt-2 text-xs text-text-secondary">不可变：Core 拒绝任何实质覆盖。</p>}
      <SecondConfirm
        choice={confirmation?.generation === props.policyGeneration ? confirmation : null}
        confirmDisabled={props.disabled || props.pending}
        onConfirm={(posture) => props.onSet(posture, true)}
        onClose={() => setConfirmation(null)}
      />
    </div>
  );
}

function CellSummary({ cell }: { cell: PermissionCellState }) {
  const modeTone = cell.overrideMode === "immutable" ? "neutral" : cell.overrideMode === "second-confirm" ? "warn" : "muted";
  return (
    <div>
      <code className="text-xs font-semibold text-text-body">{cell.key}</code>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge tone={TONE[cell.factoryPosture]}>factory {cell.factoryPosture}</Badge>
        <Badge tone={cell.overridePosture ? TONE[cell.overridePosture] : "muted"}>override {cell.overridePosture ?? "none"}</Badge>
        <Badge tone={TONE[cell.effectivePosture]}>effective {cell.effectivePosture}</Badge>
        <Badge tone={modeTone}>{cell.overrideMode}</Badge>
      </div>
    </div>
  );
}

function CellControls(props: PermissionCellRowProps & { onChoose(posture: PermissionPosture): void }) {
  const immutable = props.cell.overrideMode === "immutable";
  const disabled = props.disabled || props.pending || immutable;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <select
        aria-label={`${props.cell.key} posture`}
        value={props.cell.overridePosture ?? props.cell.factoryPosture}
        disabled={disabled}
        onChange={(event) => props.onChoose(PermissionPostureSchema.parse(event.target.value))}
        className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-text-body focus:border-accent-border-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {POSTURES.map((posture) => <option key={posture} value={posture}>{posture}</option>)}
      </select>
      <ActionButton tone="secondary" disabled={disabled || props.cell.overridePosture === null} onClick={() => props.onSet(null)}>
        重置
      </ActionButton>
    </div>
  );
}

function SecondConfirm(props: {
  choice: ConfirmChoice | null;
  confirmDisabled: boolean;
  onConfirm(posture: PermissionPosture): void;
  onClose(): void;
}) {
  const choice = props.choice;
  if (!choice) return null;
  return (
    <div className="mt-3 rounded-lg border border-warn-border bg-warn-soft p-3 text-xs text-warn-strong">
      <p>此修改会放宽工厂保护。请再次确认；Host 仍可拒绝或进一步收紧。</p>
      <div className="mt-2 flex gap-2">
        <ActionButton tone="danger-soft" disabled={props.confirmDisabled} onClick={() => { props.onConfirm(choice.posture); props.onClose(); }}>
          再次确认
        </ActionButton>
        <ActionButton tone="secondary" onClick={props.onClose}>取消</ActionButton>
      </div>
    </div>
  );
}

function postureRank(posture: PermissionPosture): number {
  return { auto: 0, ask: 1, deny: 2 }[posture];
}

export function requiresSecondConfirm(cell: PermissionCellState, posture: PermissionPosture): boolean {
  return cell.overrideMode === "second-confirm" && postureRank(posture) < postureRank(cell.factoryPosture);
}
