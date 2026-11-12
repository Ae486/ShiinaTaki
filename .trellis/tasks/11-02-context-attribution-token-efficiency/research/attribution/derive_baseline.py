"""Derive bounded attribution triage facts from the archived sanitized metrics.

This helper reads JSON only. It never opens SQLite, imports runtime code, calls a
model, or emits conversation/tool bodies or request identifiers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
RESEARCH = Path(__file__).resolve().parent
BASELINE = ROOT / ".trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis/research/new-conversation-cost-metrics.json"


def fraction(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def population(row: dict, total: dict | None = None) -> dict:
    fields = ("requests", "runs", "known_input_requests", "cache_paired_requests",
              "input_tokens", "input_no_cache_tokens", "cache_read_tokens",
              "output_tokens", "reasoning_tokens", "weighted_cache_ratio",
              "mean_input_tokens", "median_input_tokens")
    result = {key: row[key] for key in fields if key in row}
    if "common_tariff_cny" in row:
        result["conditional_cost_cny_estimate"] = row["common_tariff_cny"]
    if total is not None:
        result["share_of_foreground_input"] = fraction(row["input_tokens"], total["input_tokens"])
        result["share_of_foreground_conditional_cost"] = fraction(row["common_tariff_cny"], total["common_tariff_cny"])
    return result


def derive(source: Path) -> dict:
    contents = source.read_bytes()
    data = json.loads(contents)
    foreground = data["summaries"]["new_primary"]
    background = data["auxiliary_by_cohort"]["normal_background"]
    phases = {phase: population(data["summaries"][f"new_primary_{phase}"], foreground)
              for phase in ("first", "continuation")}
    heartbeats = [{"phase": row["phase"], **population(row)}
                  for row in data["by_provider_model_initiator_phase"]
                  if row["cohort"] == "old" and row["initiator"] == "heartbeat"
                  and row["model_id"] == "deepseek-flash"]
    correction = next(row for row in data["continuations_by_preceding_tool"]
                      if row["cohort"] == "new" and row["preceding_tools"] == "presentation_only"
                      and row["preceding_validation_failure"])
    replay = data["new_replay_projection"]
    calibration = replay["calibration"]
    real_window = calibration["effective_window"]
    factor = calibration["factor"]
    replay_points = []
    for label, point in (("first", replay["points"][0]), ("last", replay["points"][-1])):
        replay_points.append({"boundary": label,
                              **{key: point[key] for key in ("sourceRows", "selectedRows", "summaryTokens",
                                                             "historyTokens", "foldedTokensSaved",
                                                             "tokenBoundaryHit", "sourceBackstopHit")},
                              "summary_share_of_replay_estimate": fraction(point["summaryTokens"], point["historyTokens"])})
    return {
        "date": "2026-11-02",
        "source": {"artifact": source.name, "artifact_sha256": hashlib.sha256(contents).hexdigest(),
                   "generated_at_utc": data["generated_at_utc"],
                   "recorded_snapshot_hashes": {key: value for key, value in data["sources"].items()
                                                 if key.endswith("sha256")}},
        "measured": {
            "scope": "Archived November 1 normal-use cohort; normalized reported usage, not an invoice or quality acceptance.",
            "foreground": population(foreground), "phases": phases,
            "older_heartbeat_same_stored_alias": heartbeats,
            "older_heartbeat_limit": "Different dated deployment/context; no November 1 heartbeat sample or exact selected-source proportions.",
            "avatar_correction_associated_upper_bound": population(correction, foreground),
            "normal_background": {**population(background),
                                  "share_of_combined_input": fraction(background["input_tokens"], foreground["input_tokens"] + background["input_tokens"]),
                                  "share_of_combined_conditional_cost": fraction(background["common_tariff_cny"], foreground["common_tariff_cny"] + background["common_tariff_cny"])},
            "context_snapshot_quality": data["context_snapshot_quality"],
            "invariants": data["invariants"],
        },
        "estimated": {
            "scope": replay["scope"], "replay_points": replay_points,
            "captured_latest_calibration": {"effective_real_token_window": real_window,
                                            "factor": factor,
                                            "estimator_window_units": int(real_window / factor),
                                            "history_budget_estimator_units": replay["historyBudget"]},
            "cost_scope": data["pricing"]["scope"],
        },
        "unknown": ["Historical exact instruction/persona/memory/runtime/tool-schema shares",
                    "Historical MCP/Skill origin without captured construction binding",
                    "Historical per-request effective-window/factor at dispatch",
                    "Current native-media category cost and real provider capability",
                    "Causal savings, equivalent-task quality and original-result recovery acceptance"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=BASELINE)
    parser.add_argument("--output", type=Path, default=RESEARCH / "baseline-derived.json")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(RESEARCH):
        raise ValueError("Output must remain inside this task's research/attribution directory")
    result = derive(args.source.resolve())
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "foreground_requests": result["measured"]["foreground"]["requests"],
                      "historical_heartbeat_requests": sum(row["requests"] for row in result["measured"]["older_heartbeat_same_stored_alias"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
