"""Read-only request/auxiliary accounting; emit aggregate counters, never conversation bodies."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import statistics


SHANGHAI = timezone(timedelta(hours=8))


def query(conn, sql):
    return [dict(row) for row in conn.execute(sql)]


def tariff_multiplier(timestamp):
    at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(SHANGHAI)
    # Cohorts are Oct 24–28 and Nov 1–3; none of these dates is a China public holiday.
    hour = at.hour + at.minute / 60
    return 2 if at.weekday() < 5 and (9 <= hour < 12 or 14 <= hour < 18) else 1


def summary(rows, *, auxiliary=False):
    fields = ["input_tokens", "cache_read_tokens", "input_no_cache_tokens", "output_tokens", "reasoning_tokens"]
    sums = {field: sum(r[field] for r in rows if r.get(field) is not None)
            if any(r.get(field) is not None for r in rows) else None for field in fields}
    paired = [r for r in rows if r.get("input_tokens") is not None and r.get("cache_read_tokens") is not None]
    known = [r for r in paired if r.get("cache_read_observed") == 1]
    ratio = lambda rs: sum(r["cache_read_tokens"] for r in rs) / sum(r["input_tokens"] for r in rs) if sum(r["input_tokens"] for r in rs) else None
    values = [r["input_tokens"] for r in rows if r.get("input_tokens") is not None]
    priced = [r for r in rows if all(r.get(f) is not None for f in fields[:4])
              and r["model_id"] in ("deepseek-flash", "deepseek-v4-flash")]
    base_cost = lambda r: (r["cache_read_tokens"] * .02 + r["input_no_cache_tokens"] + r["output_tokens"] * 4) / 1_000_000
    return {"requests": len(rows),
            "runs": None if auxiliary else len({r["run_id"] for r in rows if r.get("run_id")}), **sums,
            "field_coverage": {f: sum(r.get(f) is not None for r in rows) for f in fields},
            "input_mean": statistics.mean(values) if values else None,
            "input_median": statistics.median(values) if values else None,
            "input_max": max(values) if values else None,
            "stored_cache_ratio": ratio(paired),
            "explicit_cache_observation_count": None if auxiliary else len(known),
            "explicit_cache_ratio": None if auxiliary else ratio(known),
            "cache_coverage_basis": "Nullable normalized per-field counters; no separate presence bit retained."
              if auxiliary else "Stored pairs plus separately retained cache_read_observed when available.",
            "priced_requests": len(priced),
            "common_off_peak_cny_estimate": round(sum(base_cost(r) for r in priced), 8) if priced else None,
            "schedule_cny_estimate": round(sum(base_cost(r) * tariff_multiplier(r["started_at"]) for r in priced), 8) if priced else None,
            "peak_priced_requests": sum(tariff_multiplier(r["started_at"]) == 2 for r in priced),
            "cost_parts_off_peak_cny": {"cached_input": round(sum(r["cache_read_tokens"] * .02 for r in priced) / 1e6, 8),
                                       "uncached_input": round(sum(r["input_no_cache_tokens"] for r in priced) / 1e6, 8),
                                       "output_including_reasoning": round(sum(r["output_tokens"] * 4 for r in priced) / 1e6, 8)} if priced else None}


def compositions(rows):
    groups = defaultdict(int)
    origins = defaultdict(int)
    units = 0
    occupancies = []
    for row in rows:
        measured = json.loads(row["payload_json"])
        comp = measured["composition"]
        units += comp["totalUnits"]
        for key, value in comp["categories"].items():
            groups[key] += value
        for group in comp["origins"].values():
            for key, value in group.items():
                origins[key] += value
        if row["input_tokens"] is not None and measured.get("window"):
            occupancies.append(row["input_tokens"] / measured["window"]["effectiveRealTokens"])
    return {"measured_requests": len(rows), "total_estimator_units": units, "category_units": dict(groups),
            "category_shares": {key: value / units for key, value in groups.items()} if units else {},
            "origin_units": dict(origins), "occupancy_mean": statistics.mean(occupancies) if occupancies else None,
            "occupancy_max": max(occupancies) if occupancies else None}


def analyze(path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("BEGIN")
    rows = query(conn, """SELECT u.*,r.initiator,e.started_at,
        (SELECT MAX(ev.seq) FROM run_events ev WHERE ev.run_id=e.run_id AND ev.kind='effect.intent_committed'
          AND json_extract(ev.payload_json,'$.effectId')=e.effect_id) dispatch_seq
        FROM run_usage u JOIN run_effects e ON e.effect_id=u.effect_id JOIN runs r ON r.run_id=u.run_id
        WHERE e.started_at>='2026-10-24' ORDER BY e.run_id,dispatch_seq,e.started_at""")
    counters = defaultdict(int)
    for row in rows:
        row["phase"] = "first" if counters[row["run_id"]] == 0 else "continuation"
        counters[row["run_id"]] += 1
    cohorts = {
        "old_oct24_28": [r for r in rows if r["initiator"] == "primary" and r["started_at"] < "2026-11-01"],
        "nov1_reference_20runs": [r for r in rows if r["initiator"] == "primary" and "2026-11-01T12:47" <= r["started_at"] < "2026-11-01T13:05"],
        "nov1_all": [r for r in rows if r["initiator"] == "primary" and r["started_at"].startswith("2026-11-01")],
        "nov2_primary": [r for r in rows if r["initiator"] == "primary" and r["started_at"].startswith("2026-11-02")],
        "nov3_primary": [r for r in rows if r["initiator"] == "primary" and r["started_at"].startswith("2026-11-03")],
        "new_primary": [r for r in rows if r["initiator"] == "primary" and r["started_at"] >= "2026-11-02"],
        "new_scheduled": [r for r in rows if r["initiator"] == "scheduled" and r["started_at"] >= "2026-11-02"],
    }
    aux = query(conn, """SELECT *,no_cache_tokens input_no_cache_tokens
        FROM auxiliary_model_calls WHERE started_at>='2026-11-02' ORDER BY started_at""")
    tool_events = query(conn, """SELECT e.payload_json FROM run_events e JOIN runs r ON r.run_id=e.run_id
        WHERE r.initiator='primary' AND e.kind='tool.result.settled' AND e.occurred_at>='2026-11-02'""")
    tool_outcomes = defaultdict(Counter)
    tool_errors = defaultdict(Counter)
    for event in tool_events:
        payload = json.loads(event["payload_json"])
        tool_outcomes[payload["toolName"]][payload["outcome"]] += 1
        if payload.get("errorClass"):
            tool_errors[payload["toolName"]][payload["errorClass"]] += 1
    measures = query(conn, """SELECT m.payload_json,m.occurred_at,u.input_tokens
        FROM run_events m LEFT JOIN run_usage u ON u.effect_id=json_extract(m.payload_json,'$.effectId')
        WHERE m.kind='context.request.measured' AND json_extract(m.payload_json,'$.population')='primary'
        ORDER BY m.occurred_at""")
    output = {"snapshot_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "scope": "Stored canonical usage once; composition uses captured heuristic units; costs are conditional, not invoices.",
              "pricing": {"source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing", "checked_on": "2026-11-04",
                          "off_peak_cny_per_million": {"cached_input": .02, "uncached_input": 1, "output": 4}, "peak_multiplier": 2},
              "cohorts": {name: summary(rs) for name, rs in cohorts.items()},
              "new_by_phase": {phase: summary([r for r in cohorts["new_primary"] if r["phase"] == phase]) for phase in ["first", "continuation"]},
              "auxiliary_new": summary(aux, auxiliary=True),
              "auxiliary_by_label": {label: summary([r for r in aux if r["label"] == label], auxiliary=True) for label in sorted({r["label"] for r in aux})},
              "new_primary_tool_ledger": {name: {"outcomes": dict(counts), "error_classes": dict(tool_errors[name])}
                                          for name, counts in sorted(tool_outcomes.items())},
              "tool_ledger_caveat": "Execution settlement is not business success; completed may contain an unsuccessful or normal-noop tool result.",
              "composition": {day: compositions([r for r in measures if day == "all" or r["occurred_at"].startswith(day)])
                              for day in ["all", "2026-11-02", "2026-11-03"]},
              "summary": query(conn, "SELECT revision,through_seq,length(text) characters,updated_at FROM conversation_summary"),
              "first_measurement": measures[0]["occurred_at"] if measures else None}
    conn.close()
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.db)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"cohorts": result["cohorts"], "new_by_phase": result["new_by_phase"],
                      "auxiliary_new": result["auxiliary_new"], "composition": result["composition"]}, indent=2))
