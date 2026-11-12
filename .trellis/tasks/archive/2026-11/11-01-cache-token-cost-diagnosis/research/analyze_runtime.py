"""Read-only cost evidence. Emits counters/identifiers, never conversation bodies or secrets."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import statistics


def total(rows, key):
    values = [r[key] for r in rows if r.get(key) is not None]
    return sum(values) if values else None


def usage_summary(rows):
    paired = [r for r in rows if (r.get("input_tokens") or 0) > 0
              and r.get("cache_read_tokens") is not None]
    denominator = total(paired, "input_tokens")
    return {
        "requests": len(rows),
        "runs": len({r["run_id"] for r in rows}),
        "known_input_requests": sum(r.get("input_tokens") is not None for r in rows),
        "cache_paired_requests": len(paired),
        "cache_excluded_requests": len(rows) - len(paired),
        "input_tokens": total(rows, "input_tokens"),
        "paired_input_tokens": denominator,
        "cache_read_tokens": total(paired, "cache_read_tokens"),
        "input_no_cache_tokens": total(rows, "input_no_cache_tokens"),
        "output_tokens": total(rows, "output_tokens"),
        "output_text_tokens": total(rows, "output_text_tokens"),
        "reasoning_tokens": total(rows, "reasoning_tokens"),
        "weighted_cache_ratio": total(paired, "cache_read_tokens") / denominator if denominator else None,
        "mean_request_cache_ratio": statistics.mean(r["cache_read_tokens"] / r["input_tokens"] for r in paired) if paired else None,
        "requests_with_positive_cache": sum(r["cache_read_tokens"] > 0 for r in paired),
        "median_input_tokens": statistics.median(r["input_tokens"] for r in rows if r.get("input_tokens") is not None) if any(r.get("input_tokens") is not None for r in rows) else None,
    }


def group_usage(rows, keys):
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(row.get(k) for k in keys)].append(row)
    return [dict(zip(keys, key), **usage_summary(value))
            for key, value in sorted(groups.items(), key=lambda item: str(item[0]))]


def query(conn, sql):
    return [dict(r) for r in conn.execute(sql)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    db_path = args.db.resolve(strict=True)
    conn = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("BEGIN")
    usage = query(conn, """SELECT u.*,r.initiator,r.state AS run_state,r.started_at AS run_started_at,
        r.parent_run_id,a.ordinal AS attempt_ordinal,a.retry_reason,
        row_number() OVER(PARTITION BY u.run_id ORDER BY u.recorded_at,u.usage_id) AS request_ordinal
        FROM run_usage u JOIN runs r USING(run_id) JOIN run_attempts a USING(attempt_id)
        ORDER BY u.recorded_at,u.usage_id"""
    )
    for row in usage:
        row["phase"] = "first" if row["request_ordinal"] == 1 else "continuation"
        row["day_utc"] = row["recorded_at"][:10]
        row["day_shanghai"] = datetime.fromisoformat(row["recorded_at"].replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=8))).date().isoformat()
    tools = []
    for row in query(conn, "SELECT run_id,occurred_at,payload_json FROM run_events WHERE kind='tool.result.settled' ORDER BY occurred_at"):
        payload = json.loads(row.pop("payload_json"))
        for key in ("toolName", "outcome", "errorClass", "errorCode", "modelEffectId", "toolCallId", "durationMs"):
            row[key] = payload.get(key)
        tools.append(row)
    tool_counts = Counter((r["toolName"], r["outcome"], r["errorClass"], r["errorCode"]) for r in tools)
    per_effect_tools = defaultdict(list)
    for row in tools:
        if row["modelEffectId"]:
            per_effect_tools[row["modelEffectId"]].append(row)
    per_run = defaultdict(list)
    for row in usage:
        per_run[row["run_id"]].append(row)
    continuations = []
    for run_rows in per_run.values():
        for previous, current in zip(run_rows, run_rows[1:]):
            preceding = per_effect_tools.get(previous["effect_id"], [])
            label = "no_exact_tool_link"
            if preceding:
                names = {t["toolName"] for t in preceding}
                presentation_only = names <= {"avatar_set_expression", "avatar_play_motion"}
                failed = any(t["outcome"] == "failed" for t in preceding)
                label = ("presentation_only" if presentation_only else "informational_or_mixed") + ("_with_failure" if failed else "_without_failure")
            continuations.append(dict(current, preceding_tools=label))
    result_sizes = defaultdict(list)
    tool_case_sizes = []
    for row in query(conn, "SELECT seq,created_at,parts FROM timeline_messages WHERE role='tool' AND parts IS NOT NULL"):
        for part in json.loads(row["parts"]):
            if part.get("type") != "tool-result":
                continue
            output = part["output"]
            value = output.get("value", output)
            body = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            tool_case_sizes.append({"seq": row["seq"], "created_at": row["created_at"], "tool": part["toolName"], "output_type": output["type"], "chars": len(body)})
            if row["seq"] > 3715:
                result_sizes[(part["toolName"], output["type"])].append(len(body))
    replay_sizes = [{"tool": k[0], "output_type": k[1], "count": len(v), "payload_chars": sum(v), "max_payload_chars": max(v)}
                    for k, v in sorted(result_sizes.items(), key=lambda item: -sum(item[1]))]
    recent = [r for r in usage if r["recorded_at"] >= "2026-10-24"]
    summary = {
        "database": str(db_path),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "read_mode": "SQLite URI mode=ro; PRAGMA query_only=ON; one read transaction",
        "coverage": {"first_usage_utc": usage[0]["recorded_at"], "last_usage_utc": usage[-1]["recorded_at"]},
        "all_usage": usage_summary(usage),
        "recent_usage_since_2026_10_24_utc": usage_summary(recent),
        "by_model": group_usage(usage, ["provider", "model_id"]),
        "by_initiator_phase": group_usage(usage, ["initiator", "phase"]),
        "recent_by_initiator_phase": group_usage(recent, ["initiator", "phase"]),
        "by_day_utc": group_usage(usage, ["day_utc"]),
        "by_day_shanghai": group_usage(usage, ["day_shanghai"]),
        "by_day_phase": group_usage(usage, ["day_utc", "initiator", "phase"]),
        "continuations_by_preceding_exact_tool_link": group_usage(continuations, ["preceding_tools"]),
        "tools": [{"tool": k[0], "outcome": k[1], "error_class": k[2], "error_code": k[3], "count": v} for k, v in tool_counts.most_common()],
        "post_summary_tool_payload_chars": replay_sizes,
        "largest_stored_tool_results": sorted(tool_case_sizes, key=lambda r: -r["chars"])[:15],
        "top_uncached_runs": sorted([dict(run_id=k, started_at=v[0]["run_started_at"], **usage_summary(v), tools=dict(Counter(t["toolName"] for t in tools if t["run_id"] == k))) for k, v in per_run.items()], key=lambda r: -(r["input_no_cache_tokens"] or 0))[:12],
        "compaction_operations": query(conn, "SELECT operation_id,run_id,started_at,state,failure_code,attempt_no,before_tokens,selected_from_seq,selected_through_seq,captured_tail_seq FROM conversation_compaction_operations ORDER BY started_at"),
        "compaction_event_counts": query(conn, "SELECT kind,failure_code,count(*) AS n,sum(output_chars) AS output_chars FROM conversation_compaction_events GROUP BY 1,2"),
        "current_summary_metadata": query(conn, "SELECT through_seq,revision,length(text) AS chars,updated_at FROM conversation_summary"),
        "context_event_quality": query(conn, "SELECT json_extract(payload_json,'$.accountingQuality') AS quality,count(*) AS n FROM run_events WHERE kind='context.snapshot' GROUP BY 1"),
        "timeline_counts": query(conn, "SELECT role,count(*) AS n,min(created_at) AS first,max(created_at) AS last,sum(length(content)) AS content_chars FROM timeline_messages GROUP BY role"),
        "post_summary_timeline_counts": query(conn, "SELECT role,count(*) AS n,sum(length(content)) AS content_chars FROM timeline_messages WHERE seq>3715 GROUP BY role"),
        "attempts": query(conn, "SELECT ordinal,retry_reason,count(*) AS n FROM run_attempts GROUP BY 1,2"),
        "invariants": {
            "duplicate_effects": len(usage) - len({r["effect_id"] for r in usage}),
            "detail_sum_mismatches": sum(r["input_tokens"] != r["cache_read_tokens"] + r["input_no_cache_tokens"] for r in usage if all(r.get(k) is not None for k in ("input_tokens", "cache_read_tokens", "input_no_cache_tokens"))),
        },
        "limitations": [
            "Usage is normalized SDK telemetry, not raw provider invoices. Adapter may synthesize zero for missing detail fields.",
            "Historical exact system/tools/messages and billed currency are not persisted; source-level causes are not per-request causal proof.",
            "Tool payload sizes are stored character counts before historical projection/folding, not tokens or exact billed bytes.",
            "A following request is associated with the preceding tool step, not proven avoidable without checking pending work and presentation stop semantics.",
            "The post-summary section uses the current persisted boundary 3715; it does not reconstruct every historical window.",
        ],
    }
    conn.close()
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "all_usage": summary["all_usage"], "recent_usage": summary["recent_usage_since_2026_10_24_utc"], "invariants": summary["invariants"]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
