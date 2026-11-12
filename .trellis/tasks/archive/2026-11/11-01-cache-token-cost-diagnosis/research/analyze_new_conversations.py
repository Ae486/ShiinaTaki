"""Read-only old/new usage comparison; outputs counters and IDs, never message/argument bodies."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import statistics
import subprocess

from analyze_runtime import group_usage, query, usage_summary


def connect(path):
    conn = sqlite3.connect(path.resolve(strict=True).as_uri() + "?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("BEGIN")
    return conn


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def price(row):
    keys = ("input_no_cache_tokens", "cache_read_tokens", "output_tokens")
    if any(row.get(key) is None for key in keys):
        return None
    return round((row[keys[0]] + row[keys[1]] * 0.02 + row[keys[2]] * 4) / 1_000_000, 8)


def summarize(rows):
    result = usage_summary(rows)
    keys = ("input_tokens", "cache_read_tokens", "input_no_cache_tokens", "output_tokens", "reasoning_tokens")
    result["known_field_counts"] = {key: sum(row.get(key) is not None for row in rows) for key in keys}
    priced = [price(row) for row in rows if price(row) is not None]
    result["common_tariff_cny"] = round(sum(priced), 8) if priced else None
    result["priced_request_count"] = len(priced)
    completed = len({row["run_id"] for row in rows if row.get("run_state") == "completed"})
    result["ledger_completed_runs"] = completed
    result["common_tariff_cny_per_ledger_completed_run"] = (
        round(sum(priced) / completed, 8) if completed and len(priced) == len(rows) else None
    )
    inputs = [row["input_tokens"] for row in rows if row.get("input_tokens") is not None]
    result["mean_input_tokens"] = statistics.mean(inputs) if inputs else None
    return result


def auxiliary_summary(rows):
    result = summarize(rows)
    for key in ("runs", "ledger_completed_runs", "common_tariff_cny_per_ledger_completed_run"):
        result.pop(key)
    result["completed_observed_calls"] = sum(row["status"] == "completed" for row in rows)
    return result


def replay_projection(path):
    # Same pure production projection used by probe_replay.mjs, with all 20 new user boundaries.
    script = r"""
import { DatabaseSync } from 'node:sqlite';
import { createTimelineRepo } from './packages/core/src/db/timeline-repo.ts';
import { createConversationStore } from './packages/core/src/agents/conversation-store.ts';
const db = new DatabaseSync(process.argv[1], {readOnly:true});
db.exec('PRAGMA query_only=ON; BEGIN');
const state = db.prepare("SELECT * FROM slot_window_state WHERE slot='main'").get();
const summary = db.prepare('SELECT * FROM conversation_summary').get();
const historyBudget = Math.floor(Math.floor(state.effective_window / state.factor) * 0.7);
const base = createTimelineRepo(db);
const points = db.prepare("SELECT seq FROM timeline_messages WHERE role='user' AND seq>=4233 ORDER BY seq").all();
let previous;
const results = points.map(({seq}) => {
  const repo = {...base, pageBefore: input => base.pageBefore({...input, before:Math.min(seq+1,input.before ?? seq+1)})};
  const store = createConversationStore({repo, window:{budget:()=>historyBudget},
    summaries:{get:()=>({throughSeq:summary.through_seq,text:summary.text})}});
  const projection = store.project(summary.character_id);
  const serialized = projection.messages.map(m=>JSON.stringify(m));
  let same = 0;
  while(previous && same<Math.min(previous.length,serialized.length) && previous[same]===serialized[same]) same++;
  const value = {userSeq:seq,windowStartSeq:projection.windowStartSeq,...projection.measurement,
    equalLeadingReplayMessages:previous ? same : null};
  previous = serialized;
  return value;
});
db.close();
console.log(JSON.stringify({calibration:state,historyBudget,points:results,
  scope:'Fixed latest calibration and current code; history projection only, not exact historical wire requests.'}));
"""
    completed = subprocess.run(["node", "--input-type=module", "-e", script, str(path.resolve())],
                               cwd=Path(__file__).resolve().parents[6], capture_output=True, text=True, check=True)
    return json.loads(completed.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--old-db", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    conn, old = connect(args.db), connect(args.old_db)
    usage = query(conn, """SELECT u.*,r.initiator,r.state AS run_state,r.outcome AS run_outcome,
        r.started_at,r.terminal_at,a.ordinal AS attempt_ordinal,
        row_number() OVER(PARTITION BY u.run_id ORDER BY u.recorded_at,u.usage_id) AS request_ordinal
        FROM run_usage u JOIN runs r USING(run_id) JOIN run_attempts a USING(attempt_id)
        ORDER BY u.recorded_at,u.usage_id""")
    old_usage = query(old, "SELECT * FROM run_usage ORDER BY usage_id")
    preserved = query(conn, "SELECT * FROM run_usage WHERE recorded_at<'2026-11-01' ORDER BY usage_id")
    for row in usage:
        row["cohort"] = "new" if row["recorded_at"] >= "2026-11-01" else "old"
        row["phase"] = "first" if row["request_ordinal"] == 1 else "continuation"
        row["day_utc"] = row["recorded_at"][:10]
    new = [row for row in usage if row["cohort"] == "new"]
    matched = [row for row in usage if row["cohort"] == "old" and row["initiator"] == "primary"
               and row["provider"] == "taki-provider.chat" and row["model_id"] == "deepseek-flash"]
    first_id = new[0]["run_id"]
    old_run_order = sorted({(row["started_at"], row["run_id"]) for row in matched})
    recent_ids = {run_id for _, run_id in old_run_order[-20:]}
    cohorts = {"old_all": [row for row in usage if row["cohort"] == "old"],
               "old_matching_primary_alias": matched,
               "old_last_20_matching_primary_runs": [row for row in matched if row["run_id"] in recent_ids],
               "new_primary": new,
               "new_primary_excluding_first_cold_run": [row for row in new if row["run_id"] != first_id]}
    summaries = {name: summarize(rows) for name, rows in cohorts.items()}
    for name in ("old_matching_primary_alias", "old_last_20_matching_primary_runs", "new_primary",
                 "new_primary_excluding_first_cold_run"):
        for phase in ("first", "continuation"):
            summaries[f"{name}_{phase}"] = summarize([row for row in cohorts[name] if row["phase"] == phase])

    tool_events = []
    for row in query(conn, "SELECT run_id,occurred_at,payload_json FROM run_events WHERE kind='tool.result.settled' ORDER BY occurred_at"):
        payload = json.loads(row.pop("payload_json"))
        row.update({key: payload.get(key) for key in ("toolName", "toolCallId", "modelEffectId", "outcome", "errorClass", "errorCode")})
        tool_events.append(row)
    tools_by_run, tools_by_effect = defaultdict(list), defaultdict(list)
    tool_to_run = {}
    for row in tool_events:
        tools_by_run[row["run_id"]].append(row)
        tools_by_effect[row["modelEffectId"]].append(row)
        tool_to_run[row["toolCallId"]] = row["run_id"]
    tool_cases = []
    for row in query(conn, "SELECT seq,created_at,parts FROM timeline_messages WHERE role='tool' AND parts IS NOT NULL"):
        for part in json.loads(row["parts"]):
            if part.get("type") != "tool-result":
                continue
            output = part["output"]
            value = output.get("value", output)
            body = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            case = {"seq": row["seq"], "created_at": row["created_at"], "tool": part["toolName"],
                    "run_id": tool_to_run.get(part.get("toolCallId")), "output_type": output["type"], "chars": len(body)}
            if isinstance(value, dict):
                for key in ("ok", "code", "outcome", "reason", "exitCode", "truncated", "timedOut"):
                    if ((key in value and key != "reason")
                            or (key == "reason" and value.get(key) in {"already_active", "motion_busy", "speaking"})):
                        case[key] = value[key]
                for key in ("stdout", "stderr"):
                    if isinstance(value.get(key), str):
                        case[key + "_chars"] = len(value[key])
            if output["type"] == "error-text" and isinstance(value, str):
                case["empty_object_validation"] = "Value: {}" in value
            tool_cases.append(case)

    per_run = []
    selected = matched + new
    by_run = defaultdict(list)
    for row in selected:
        by_run[row["run_id"]].append(row)
    source_map = {row["run_id"]: row for row in query(conn, """SELECT run_id,original_user_seq,through_seq,state
        FROM primary_conversation_sources WHERE created_at>='2026-11-01T12:23:00Z'""")}
    for run_id, rows in by_run.items():
        first = rows[0]
        per_run.append({"run_id": run_id, "cohort": first["cohort"], "started_at": first["started_at"],
                        "run_state": first["run_state"], "run_outcome": first["run_outcome"],
                        "duration_ms": round((datetime.fromisoformat(first["terminal_at"].replace("Z", "+00:00"))
                                               - datetime.fromisoformat(first["started_at"].replace("Z", "+00:00"))).total_seconds() * 1000)
                        if first["terminal_at"] and first["started_at"] else None,
                        **summarize(rows), "tools": dict(Counter(t["toolName"] for t in tools_by_run[run_id])),
                        "validation_failures": sum(t["errorClass"] == "validation" for t in tools_by_run[run_id]),
                        "execution_failures": sum(t["errorClass"] == "execution" for t in tools_by_run[run_id]),
                        "primary_source": source_map.get(run_id)})

    continuation_groups = defaultdict(list)
    invalid_followups = []
    for run_id, rows in by_run.items():
        for previous, current in zip(rows, rows[1:]):
            before = tools_by_effect[previous["effect_id"]]
            after = tools_by_effect[current["effect_id"]]
            names = {row["toolName"] for row in before}
            label = "presentation_only" if names and names <= {"avatar_set_expression", "avatar_play_motion"} else "other_or_mixed"
            invalid = any(row["errorClass"] == "validation" for row in before)
            continuation_groups[(current["cohort"], label, invalid)].append(current)
            if invalid and label == "presentation_only":
                invalid_followups.append({"cohort": current["cohort"], "run_id": run_id,
                                          "effect_id": current["effect_id"], "repeated_validation_failure": any(t["errorClass"] == "validation" for t in after),
                                          "corrected_avatar_completed": any(t["toolName"] == "avatar_set_expression" and t["outcome"] == "completed" for t in after),
                                          "common_tariff_cny": price(current), **{key: current[key] for key in ("input_tokens", "input_no_cache_tokens", "cache_read_tokens", "output_tokens", "reasoning_tokens")}})

    auxiliary = query(conn, "SELECT * FROM auxiliary_model_calls ORDER BY started_at,call_id")
    auxiliary_groups = defaultdict(list)
    for row in auxiliary:
        row["cohort"] = ("historical_catchup" if row["started_at"] < "2026-11-01T12:23:00Z"
                         else "manual_tidy" if row["label"] == "tidy" else "normal_background")
        row["input_no_cache_tokens"] = row["no_cache_tokens"]
        row["run_id"] = row["call_id"]
        auxiliary_groups[row["cohort"]].append(row)
    new_ids, matched_ids = {r["run_id"] for r in new}, {r["run_id"] for r in matched}
    tool_groups = {}
    for cohort, run_ids in (("new", new_ids), ("old_matching_alias", matched_ids)):
        counts = Counter((r["toolName"], r["outcome"], r["errorClass"], r["errorCode"]) for r in tool_events if r["run_id"] in run_ids)
        tool_groups[cohort] = [{"tool": k[0], "outcome": k[1], "error_class": k[2], "error_code": k[3], "count": n}
                               for k, n in sorted(counts.items(), key=str)]
    summary_meta = query(conn, "SELECT revision,through_seq,length(text) AS chars,updated_at FROM conversation_summary")
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "sources": {"new": str(args.db), "new_sha256": digest(args.db), "old": str(args.old_db), "old_sha256": digest(args.old_db)},
        "read_mode": "SQLite mode=ro; query_only=ON; one read transaction per snapshot",
        "cohort_boundaries": {"old_last_usage": max(row["recorded_at"] for row in preserved) if preserved else None,
                              "new_first_usage": new[0]["recorded_at"], "new_last_usage": new[-1]["recorded_at"],
                              "first_cold_run_id": first_id},
        "pricing": {"currency": "CNY", "per_million_cache_hit_input": 0.02, "per_million_cache_miss_input": 1,
                    "per_million_output_including_reasoning": 4,
                    "source": "real-catchup-report.md: public Flash off-peak tariff read 2026-11-01",
                    "scope": "Conditional current-Sunday estimate for new usage; fixed common-tariff counterfactual for old usage, never historical invoice reconstruction."},
        "summaries": summaries,
        "by_provider_model_initiator_phase": group_usage(usage, ["cohort", "provider", "model_id", "initiator", "phase"]),
        "per_run_matching_alias": per_run,
        "new_requests": [{key: row[key] for key in ("run_id", "effect_id", "recorded_at", "provider", "model_id", "quality", "phase", "request_ordinal", "attempt_ordinal", "input_tokens", "input_no_cache_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "output_text_tokens", "reasoning_tokens")} for row in new],
        "tool_outcomes": tool_groups,
        "new_tool_events": [row for row in tool_events if row["run_id"] in new_ids],
        "new_tool_results": [row for row in tool_cases if row["seq"] >= 4233],
        "retained_tail_tool_results": [row for row in tool_cases if row["seq"] > summary_meta[0]["through_seq"]],
        "old_largest_tool_results": sorted([row for row in tool_cases if row["seq"] < 4233], key=lambda r: -r["chars"])[:15],
        "continuations_by_preceding_tool": [{"cohort": k[0], "preceding_tools": k[1], "preceding_validation_failure": k[2], **summarize(rows)} for k, rows in continuation_groups.items()],
        "invalid_presentation_followups": invalid_followups,
        "auxiliary_by_cohort": {key: auxiliary_summary(rows) for key, rows in auxiliary_groups.items()},
        "auxiliary_calls": [{key: row[key] for key in ("call_id", "cohort", "label", "provider", "model_id", "started_at", "finished_at", "status", "input_tokens", "input_no_cache_tokens", "cache_read_tokens", "output_tokens", "reasoning_tokens")} for row in auxiliary],
        "current_summary": summary_meta,
        "new_replay_projection": replay_projection(args.db),
        "new_primary_sources": list(source_map.values()),
        "context_snapshot_quality": query(conn, "SELECT json_extract(payload_json,'$.accountingQuality') AS quality,count(*) AS n FROM run_events WHERE kind='context.snapshot' AND occurred_at>='2026-11-01' GROUP BY 1"),
        "invariants": {"old_usage_unchanged": old_usage == preserved, "old_usage_rows": len(old_usage),
                       "new_usage_rows": len(new), "duplicate_usage_effects": len(usage) - len({r["effect_id"] for r in usage}),
                       "detail_sum_mismatches": sum(r["input_tokens"] != r["cache_read_tokens"] + r["input_no_cache_tokens"] for r in usage if all(r.get(k) is not None for k in ("input_tokens", "cache_read_tokens", "input_no_cache_tokens")))},
        "limitations": ["Run completed is an execution-ledger outcome, not independent semantic or manual acceptance.",
                        "Same provider/model alias does not prove the same served checkpoint, route, account discount or cache state.",
                        "Historical auxiliary usage and raw provider field presence are incomplete; missing fields are not zero.",
                        "Tool payload chars describe stored data, not provider tokens or exact projected wire bytes.",
                        "New activity is one warm 17-minute session; old multi-day cohorts are not controlled before/after experiments."]
    }
    conn.close()
    old.close()
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "new": summaries["new_primary"], "invariants": report["invariants"]}))


if __name__ == "__main__":
    main()
