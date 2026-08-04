/**
 * INPUT:  the Database wrapper + get/set calls (model-slot-scoped calibration state)
 * OUTPUT: createWindowStateRepo(db) -> { get, set, list } over slot_window_state
 * POS:    core/db — the window calibrator's typed SQL (single writer, invariant 2); upsert semantics; no
 *         node:sqlite import (uses the wrapper)
 */
import { z } from "zod";
import type { Database } from "./sqlite.ts";

export interface SlotWindowState {
  /** The slot's effective REAL-token window (≤ declared; shrunk by R2 overflow recalibration). */
  effectiveWindow: number;
  /** EMA of observed/estimated input tokens — the estimator's rolling correction factor (R1 tier 2). */
  factor: number;
}

export interface SlotWindowRow extends SlotWindowState {
  slot: string;
  updatedAt: string;
}

export interface WindowStateRepo {
  /** Persisted calibration for a slot; null = never calibrated (the calibrator falls back to declared × 1.0). */
  get(slot: string): SlotWindowState | null;
  /** Upsert the slot's calibration (creating the row on first write). */
  set(slot: string, state: SlotWindowState): void;
  /** Every calibrated slot, slot-ordered — the operator status read (memory.status). */
  list(): SlotWindowRow[];
}

const GET_SQL = "SELECT effective_window, factor FROM slot_window_state WHERE slot = :slot";

const LIST_SQL = "SELECT slot, effective_window, factor, updated_at FROM slot_window_state ORDER BY slot";

const SET_SQL =
  "INSERT INTO slot_window_state (slot, effective_window, factor, updated_at) " +
  "VALUES (:slot, :effectiveWindow, :factor, :updatedAt) " +
  "ON CONFLICT(slot) DO UPDATE SET effective_window = excluded.effective_window, " +
  "factor = excluded.factor, updated_at = excluded.updated_at";

const StateSchema = z.object({
  effective_window: z.int().positive(),
  factor: z.number().positive(),
});

const RowSchema = StateSchema.extend({ slot: z.string().min(1), updated_at: z.string().min(1) });

export function createWindowStateRepo(db: Database): WindowStateRepo {
  const getState = db.prepare(GET_SQL);
  const setState = db.prepare(SET_SQL);
  const listState = db.prepare(LIST_SQL);

  return {
    get(slot) {
      const row = getState.get({ slot });
      if (!row) return null;
      const parsed = StateSchema.parse(row);
      return { effectiveWindow: parsed.effective_window, factor: parsed.factor };
    },
    set(slot, state) {
      setState.run({
        slot,
        effectiveWindow: state.effectiveWindow,
        factor: state.factor,
        updatedAt: new Date().toISOString(),
      });
    },
    list() {
      return listState.all().map((row) => {
        const parsed = RowSchema.parse(row);
        return {
          slot: parsed.slot,
          effectiveWindow: parsed.effective_window,
          factor: parsed.factor,
          updatedAt: parsed.updated_at,
        };
      });
    },
  };
}
