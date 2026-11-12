"""Read-only avatar validation/repair analysis. Emits counters and closed diagnostics only."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import statistics
import subprocess


AVATAR = {"avatar_set_expression", "avatar_play_motion"}
NORMAL = {"already_active", "motion_busy", "speaking"}
FIELDS = ("input_tokens", "cache_read_tokens", "input_no_cache_tokens", "output_tokens", "reasoning_tokens")


def rows(conn, sql, params=()):
    return [dict(row) for row in conn.execute(sql, params)]


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def totals(items):
    return {"requests": len(items), **{key: sum(r[key] for r in items if r.get(key) is not None) for key in FIELDS},
            "known_field_counts": {key: sum(r.get(key) is not None for r in items) for key in FIELDS}}


def error_shape(output):
    body = output.get("value")
    if output.get("type") != "error-text" or not isinstance(body, str):
        return None
    value = None
    match = re.search(r"Type validation failed: Value: (.*?)\.\nError message:", body, re.S)
    if match:
        try:
            value = json.loads(match.group(1))
        except ValueError:
            pass
    try:
        issues = json.loads(body.split("Error message: ", 1)[1])
    except (ValueError, IndexError):
        issues = []
    if value == {}:
        failure_type = "missing_name_empty_object_at_sdk_validation"
    elif isinstance(value, dict) and "name" not in value:
        failure_type = "missing_name_other_object"
    elif isinstance(value, dict) and isinstance(value.get("name"), str):
        failure_type = "invalid_name"
    elif isinstance(value, dict):
        failure_type = "wrong_type_name"
    else:
        failure_type = "other_or_unparsed_input"
    vocab = [i["values"] for i in issues if isinstance(i, dict) and isinstance(i.get("values"), list)]
    # Asset vocabulary names are public identifiers; suppress anything outside that alphabet.
    vocab = [[n for n in names if isinstance(n, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", n)] for names in vocab]
    return {"type": failure_type, "issue_codes": sorted({i.get("code", "unknown") for i in issues if isinstance(i, dict)}),
            "name_path": any(i.get("path") == ["name"] for i in issues if isinstance(i, dict)),
            "guidance": "custom_required_name" if "do not repeat empty {} arguments" in body else "default_or_other",
            "allowed_values": vocab[0] if len(vocab) == 1 else None,
            "chars": len(body)}


def stats(cases):
    first = {}
    by_run = defaultdict(list)
    for case in cases:
        first.setdefault((case["run_id"], case["tool"]), case)
        by_run[case["run_id"]].append(case)
    invalid = [c for c in cases if c["validation_failed"]]
    first_invalid = [c for c in first.values() if c["validation_failed"]]
    outcome_counts = Counter(c["semantic_outcome"] for c in cases)
    return {"runs": len(by_run), "calls": len(cases), "validation_failures": len(invalid),
            "validation_failure_rate": len(invalid) / len(cases) if cases else None,
            "first_per_run_tool_calls": len(first), "first_validation_failures": len(first_invalid),
            "first_validation_failure_rate": len(first_invalid) / len(first) if first else None,
            "first_valid_calls": sum(not c["validation_failed"] for c in first.values()),
            "outcomes": dict(outcome_counts), "error_types": dict(Counter(c["error"]["type"] if c.get("error") else "no_detail" for c in invalid)),
            "min_input_tokens": min((c["input_tokens"] for c in cases if c.get("input_tokens") is not None), default=None),
            "max_input_tokens": max((c["input_tokens"] for c in cases if c.get("input_tokens") is not None), default=None)}


def input_bin(value):
    if value is None:
        return "unknown"
    for lower, upper in [(0, 50000), (50000, 60000), (60000, 80000), (80000, 95000), (95000, 110000), (110000, 1000000000)]:
        if lower <= value < upper:
            return f"{lower}-{upper}"
    return "unknown"


def replay_probe(db, root):
    # Production pure projection + production provider serialization with an offline fetch stub.
    # No URL is fetched. Neither messages nor request bodies escape the subprocess.
    script = r"""
import { DatabaseSync } from 'node:sqlite';
import { createTimelineRepo } from './packages/core/src/db/timeline-repo.ts';
import { createConversationStore } from './packages/core/src/agents/conversation-store.ts';
import { createNativeImageAttempt } from './packages/core/src/agents/native-image-attempt.ts';
import { reduceMessages } from './packages/core/src/agents/context-reduction.ts';
import { createAvatarTools } from './packages/core/src/avatar/avatar-tools.ts';
import { createAvatarSubscriptions } from './packages/core/src/avatar/avatar-subscriptions.ts';
import { createAvatarOutcomes } from './packages/core/src/avatar/avatar-outcomes.ts';
import { ToolLoopAgent } from './packages/core/node_modules/ai/dist/index.js';
import { createOpenAICompatible } from './packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js';
const db = new DatabaseSync(process.argv[1], {readOnly:true});
db.exec('PRAGMA query_only=ON; BEGIN');
const state = db.prepare("SELECT * FROM slot_window_state WHERE slot='main'").get();
const summary = db.prepare('SELECT * FROM conversation_summary').get();
const budget = Math.floor(Math.floor(state.effective_window / state.factor) * 0.7);
const base = createTimelineRepo(db);
const points = db.prepare("SELECT seq FROM timeline_messages WHERE role='user' AND seq>=4233 ORDER BY seq").all();
const validationParts=JSON.parse(db.prepare('SELECT parts FROM timeline_messages WHERE seq=4241').get().parts);
const vocabulary=JSON.parse(validationParts[0].output.value.split('Error message: ')[1])[0].values;
const tools=createAvatarTools({logger:{child(){return this;}},characterId:'offline',
  subscriptions:createAvatarSubscriptions(),outcomes:createAvatarOutcomes({deadlineMs:()=>1}),vocab:{expressions:vocabulary,motions:[]}});
function count(messages) {
  const calls=[];const results=new Map();
  for(const m of messages) for(const p of Array.isArray(m.content)?m.content:[]) {
    if(p.type==='tool-call' && ['avatar_set_expression','avatar_play_motion'].includes(p.toolName)) calls.push(p);
    if(p.type==='tool-result') results.set(p.toolCallId,p.output);
  }
  const successful=calls.filter(p=>results.get(p.toolCallId)?.type==='json' && results.get(p.toolCallId)?.value?.ok===true);
  const normal=calls.filter(p=>results.get(p.toolCallId)?.type==='json' && ['already_active','motion_busy','speaking'].includes(results.get(p.toolCallId)?.value?.reason));
  return {avatarCalls:calls.length,emptyAvatarInputs:calls.filter(p=>JSON.stringify(p.input)==='{}').length,
    successPairedEmptyInputs:successful.filter(p=>JSON.stringify(p.input)==='{}').length,
    normalPairedEmptyInputs:normal.filter(p=>JSON.stringify(p.input)==='{}').length,
    validationResultPairs:calls.filter(p=>['error-text','error-json'].includes(results.get(p.toolCallId)?.type)).length};
}
let wireCapture;let nativeCapture;
const provider=createOpenAICompatible({name:'offline-probe',baseURL:'https://offline.invalid/v1',fetch:async (_url,init)=> {
  const wire=JSON.parse(init.body);const calls=wire.messages.flatMap(m=>m.tool_calls??[]).filter(p=>['avatar_set_expression','avatar_play_motion'].includes(p.function.name));
  const expression=wire.tools?.find(p=>p.function.name==='avatar_set_expression')?.function;
  wireCapture={avatarCalls:calls.length,emptyAvatarArguments:calls.filter(p=>p.function.arguments==='{}').length,requests:1,
    fixtureExpressionSchema:{required:expression?.parameters?.required,enumCount:expression?.parameters?.properties?.name?.enum?.length,
      enumMatchesHistoricalErrorSet:JSON.stringify(expression?.parameters?.properties?.name?.enum)===JSON.stringify(vocabulary),
      additionalProperties:expression?.parameters?.additionalProperties,strict:expression?.strict??null}};
  return new Response(JSON.stringify({id:'offline',object:'chat.completion',created:0,model:'offline',choices:[{index:0,message:{role:'assistant',content:'offline projection check'},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
}});
const output=[];
for(const {seq} of points) {
  const repo={...base,pageBefore:input=>base.pageBefore({...input,before:Math.min(seq+1,input.before??seq+1)})};
  const store=createConversationStore({repo,window:{budget:()=>budget},summaries:{get:()=>({throughSeq:summary.through_seq,text:summary.text})}});
  const projection=store.project(summary.character_id);
  const row={userSeq:seq,windowStartSeq:projection.windowStartSeq,...projection.measurement,...count(projection.messages)};
  const pressureReduced=reduceMessages({messages:projection.messages,targetTokens:0,summaryHead:true}).messages;
  row.exhaustiveCurrentRequestReductionCallCounts=count(pressureReduced);
  if([4233,4323,4549,4594,4686,4693].includes(seq)) {
    const native=createNativeImageAttempt({onDispatch:(request)=>{nativeCapture=count(request.outgoing);}});
    const model=native.model(provider.chatModel('offline'));
    const agent=new ToolLoopAgent({model,instructions:'Offline projection verification.',tools});
    await agent.generate({messages:native.project(projection.messages)});
    row.nativeDispatch=nativeCapture;row.offlineSerializedWire=wireCapture;
  }
  output.push(row);
}
db.close();
console.log(JSON.stringify({scope:'Current code and fixed latest calibration; offline source/dispatch/serialized-wire projection. Not exact historical wire reconstruction; no model or network call.',calibration:state,historyBudget:budget,points:output}));
"""
    completed = subprocess.run(["node", "--input-type=module", "-e", script, str(db.resolve())], cwd=root,
                               text=True, capture_output=True, check=True)
    return json.loads(completed.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skip-replay", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    conn = sqlite3.connect(args.db.resolve(strict=True).as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("BEGIN")
    runs = {r["run_id"]: r for r in rows(conn, "SELECT run_id,character_id,initiator,started_at,terminal_at,state FROM runs")}
    sources = {r["run_id"]: r for r in rows(conn, "SELECT run_id,original_user_seq,through_seq FROM primary_conversation_sources WHERE run_id IS NOT NULL")}
    usage = rows(conn, "SELECT * FROM run_usage ORDER BY recorded_at,usage_id")
    by_effect = {u["effect_id"]: u for u in usage}
    per_run_usage = defaultdict(list)
    for u in usage:
        per_run_usage[u["run_id"]].append(u)
    for run_id, items in per_run_usage.items():
        for ordinal, u in enumerate(items, 1):
            u["request_ordinal"] = ordinal
    measured = {}
    settled, all_tools, started = [], defaultdict(list), {}
    for e in rows(conn, "SELECT * FROM run_events ORDER BY run_id,seq"):
        p = json.loads(e["payload_json"])
        if e["kind"] == "context.request.measured":
            measured[p["effectId"]] = p
        if e["kind"] == "tool.call.started":
            started[p.get("invocationId", p["toolCallId"])] = p
        if e["kind"] == "tool.result.settled":
            event = {**e, "payload": p}
            all_tools[p.get("modelEffectId")].append(p)
            if p["toolName"] in AVATAR:
                settled.append(event)
    timeline_results = defaultdict(list)
    call_persistence = Counter()
    for t in rows(conn, "SELECT seq,role,created_at,parts FROM timeline_messages WHERE parts IS NOT NULL ORDER BY seq"):
        for part in json.loads(t["parts"]):
            if part.get("type") == "tool-result" and part.get("toolName") in AVATAR:
                timeline_results[(part["toolCallId"], part["toolName"])].append((t, part))
            if part.get("type") == "tool-call" and part.get("toolName") in AVATAR:
                call_persistence["calls"] += 1
                call_persistence["with_input"] += "input" in part
    cases = []
    for e in settled:
        p = e["payload"]
        run = runs[e["run_id"]]
        u = by_effect.get(p.get("modelEffectId"))
        m = measured.get(p.get("modelEffectId"))
        matches = timeline_results.get((p["toolCallId"], p["toolName"]), [])
        t, part = matches[0] if len(matches) == 1 else (None, None)
        o = part["output"] if part else {}
        value = o.get("value")
        result = {k: value[k] for k in ("ok", "outcome", "code") if isinstance(value, dict) and k in value}
        if isinstance(value, dict) and value.get("reason") in NORMAL:
            result["reason"] = value["reason"]
        invalid = p.get("errorClass") == "validation"
        semantic = "validation_failure" if invalid else "normal_noop" if result.get("reason") in NORMAL else result.get("outcome", p["outcome"])
        source = sources.get(e["run_id"], {})
        c = {"run_id": e["run_id"], "initiator": run["initiator"], "started_at": run["started_at"], "run_state": run["state"],
             "day_utc": e["occurred_at"][:10], "day_local": (timestamp(e["occurred_at"]) + timedelta(hours=8)).date().isoformat(),
             "occurred_at": e["occurred_at"], "run_event_seq": e["seq"], "timeline_seq": t["seq"] if t else None,
             "user_seq": source.get("original_user_seq"), "through_seq": source.get("through_seq"), "tool": p["toolName"],
             "tool_call_id": p["toolCallId"], "invocation_id": p.get("invocationId"), "model_effect_id": p.get("modelEffectId"),
             "request_ordinal": u.get("request_ordinal") if u else None, "step_number": m.get("stepNumber") if m else None,
             "provider": u.get("provider") if u else None, "usage_model_id": u.get("model_id") if u else None,
             "validation_failed": invalid, "start_validation_state": started.get(p.get("invocationId", p["toolCallId"]), {}).get("validationState"),
             "ledger_outcome": p["outcome"], "error_class": p.get("errorClass"), "semantic_outcome": semantic,
             "result": result, "error": error_shape(o) if invalid else None,
             "result_match": "unique" if len(matches) == 1 else "missing" if not matches else "ambiguous",
             "usage_link": "exact_model_effect" if u and u["run_id"] == e["run_id"] else "unknown",
             **{key: u.get(key) if u else None for key in FIELDS},
             "request_measurement": {"population": m.get("population"), "window": m.get("window"),
                                     "total_units": m.get("composition", {}).get("totalUnits"),
                                     "categories": m.get("composition", {}).get("categories")} if m else None}
        cases.append(c)
    cases.sort(key=lambda c: (c["occurred_at"], c["run_event_seq"]))
    primary = [c for c in cases if c["initiator"] == "primary"]
    fresh = [c for c in primary if c["day_utc"] >= "2026-11-01"]
    cohorts = {"oct24_28_matching_alias": [c for c in primary if "2026-10-24" <= c["day_utc"] <= "2026-10-28" and c["usage_model_id"] == "deepseek-flash"],
               "nov1_initial_20_runs": [c for c in fresh if c["day_utc"] == "2026-11-01" and c["user_seq"] is not None and 4233 <= c["user_seq"] <= 4323],
               "nov1_later_4_runs": [c for c in fresh if c["day_utc"] == "2026-11-01" and c["user_seq"] is not None and c["user_seq"] > 4323],
               "nov1_3": fresh}
    by_day = {day: {tool: stats([c for c in primary if c["day_utc"] == day and c["tool"] == tool]) for tool in sorted(AVATAR)} for day in sorted({c["day_utc"] for c in primary})}
    by_cohort = {name: {tool: stats([c for c in items if c["tool"] == tool]) for tool in sorted(AVATAR)} for name, items in cohorts.items()}
    first_fresh = {}
    for c in fresh:
        first_fresh.setdefault((c["run_id"], c["tool"]), c)
    bin_stats = []
    first_expression = [c for c in first_fresh.values() if c["tool"] == "avatar_set_expression"]
    for label, items in [("all_calls", fresh), ("first_per_run_tool", list(first_fresh.values())),
                         ("first_expression_per_run", first_expression)]:
        for b in sorted({input_bin(c["input_tokens"]) for c in items}):
            bin_stats.append({"population": label, "input_bin": b, **stats([c for c in items if input_bin(c["input_tokens"]) == b])})
    per_run_cases = defaultdict(list)
    for c in primary:
        per_run_cases[c["run_id"]].append(c)
    repairs = []
    retry_requests = {}
    for run_id, items in per_run_cases.items():
        for tool in AVATAR:
            same_tool = [c for c in items if c["tool"] == tool]
            invalid_items = [c for c in same_tool if c["validation_failed"]]
            if not invalid_items:
                continue
            initial = invalid_items[0]
            later = [c for c in same_tool if c["run_event_seq"] > initial["run_event_seq"]]
            subsequent = later[0] if later else None
            following = [u for u in per_run_usage[run_id] if initial["request_ordinal"] is not None and u["request_ordinal"] > initial["request_ordinal"]]
            immediate = following[0] if following else None
            preceding_names = {p["toolName"] for p in all_tools[initial["model_effect_id"]]}
            sole_avatar = bool(preceding_names) and preceding_names <= AVATAR
            if immediate and sole_avatar:
                retry_requests[immediate["effect_id"]] = immediate
            repairs.append({"run_id": run_id, "tool": tool, "day_utc": initial["day_utc"], "user_seq": initial["user_seq"],
                            "invalid_sequences": [c["timeline_seq"] for c in invalid_items], "initial_seq": initial["timeline_seq"],
                            "initial_input_tokens": initial["input_tokens"], "initial_request_ordinal": initial["request_ordinal"],
                            "next_same_tool_seq": subsequent["timeline_seq"] if subsequent else None,
                            "next_same_tool_result": subsequent["semantic_outcome"] if subsequent else "none",
                            "repeated_invalid": bool(subsequent and subsequent["validation_failed"]),
                            "eventual_valid_same_tool": any(not c["validation_failed"] for c in later),
                            "ended_without_valid_same_tool": not any(not c["validation_failed"] for c in later),
                            "initial_step_presentation_only": sole_avatar,
                            "immediate_followup_effect_id": immediate["effect_id"] if immediate else None,
                            "immediate_followup_usage": {key: immediate[key] for key in FIELDS} if immediate else None,
                            "immediate_followup_tool_names": sorted({p["toolName"] for p in all_tools[immediate["effect_id"]]}) if immediate else [],
                            "run_state": initial["run_state"]})
    repair_summary = {}
    for day in sorted({r["day_utc"] for r in repairs}):
        items = [r for r in repairs if r["day_utc"] == day]
        retry = [retry_requests[r["immediate_followup_effect_id"]] for r in items if r["immediate_followup_effect_id"] in retry_requests]
        repair_summary[day] = {"invalid_run_tool_episodes": len(items), "repeated_invalid_next_same_tool": sum(r["repeated_invalid"] for r in items),
                               "eventual_valid_same_tool": sum(r["eventual_valid_same_tool"] for r in items),
                               "ended_without_valid_same_tool": sum(r["ended_without_valid_same_tool"] for r in items),
                               "presentation_only_followup_usage": totals(retry)}
    sessions = []
    for run in sorted([r for r in runs.values() if r["initiator"] == "primary" and r["started_at"] and r["started_at"] >= "2026-11-01"], key=lambda r: r["started_at"]):
        if not sessions or run["character_id"] != sessions[-1]["character_id"] or timestamp(run["started_at"]) - timestamp(sessions[-1]["last_started_at"]) > timedelta(minutes=30):
            sessions.append({"inferred_session": len(sessions) + 1, "character_id": run["character_id"], "started_at": run["started_at"], "last_started_at": run["started_at"], "run_ids": []})
        sessions[-1]["run_ids"].append(run["run_id"])
        sessions[-1]["last_started_at"] = run["started_at"]
    for session in sessions:
        ids = set(session["run_ids"])
        session["primary_runs"] = len(ids)
        session["tools"] = {tool: stats([c for c in fresh if c["run_id"] in ids and c["tool"] == tool]) for tool in sorted(AVATAR)}
    vocab_groups = {}
    for c in cases:
        v = c["error"].get("allowed_values") if c.get("error") else None
        if v is None:
            continue
        key = hashlib.sha256(json.dumps(v, separators=(",", ":")).encode()).hexdigest()
        group = vocab_groups.setdefault(key, {"tool": c["tool"], "allowed_values": v, "count": 0, "first_time": c["occurred_at"], "last_time": c["occurred_at"], "fresh_count": 0})
        group["count"] += 1
        group["last_time"] = c["occurred_at"]
        group["fresh_count"] += c["day_utc"] >= "2026-11-01"
    report = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "db": str(args.db), "sha256": sha(args.db),
              "read_mode": "SQLite mode=ro; query_only=ON; one read transaction", "time_scope": "UTC day is primary; local day also retained (Asia/Shanghai UTC+8).",
              "by_day_utc": by_day, "by_cohort": by_cohort, "fresh_input_bins": bin_stats,
              "repair_summary_by_day": repair_summary, "repair_episodes": repairs,
              "inferred_sessions": sessions, "session_definition": "Primary run start gap >30 minutes or Character change; inferred analytic groups, not durable runtime sessions.",
              "fresh_cases": fresh, "all_primary_cases": primary, "vocabulary_error_sets": vocab_groups,
              "timeline_avatar_call_persistence_all_history": dict(call_persistence),
              "validation_guidance_by_day": {day: dict(Counter(c["error"]["guidance"] if c.get("error") else "no_detail" for c in primary if c["day_utc"] == day and c["validation_failed"])) for day in sorted({c["day_utc"] for c in primary})},
              "primary_usage_by_day": {day: {"runs": len({u["run_id"] for u in usage if u["recorded_at"][:10] == day and runs[u["run_id"]]["initiator"] == "primary"}),
                                              **totals([u for u in usage if u["recorded_at"][:10] == day and runs[u["run_id"]]["initiator"] == "primary"])} for day in ["2026-11-01", "2026-11-02", "2026-11-03"]},
              "checks": {"avatar_result_events": len(cases), "primary_avatar_result_events": len(primary),
                         "fresh_cases": len(fresh), "fresh_unknown_usage_links": sum(c["usage_link"] == "unknown" for c in fresh),
                         "fresh_missing_or_ambiguous_result_matches": sum(c["result_match"] != "unique" for c in fresh),
                         "fresh_validation_without_explicit_empty_value": sum(c["validation_failed"] and (not c["error"] or c["error"]["type"] != "missing_name_empty_object_at_sdk_validation") for c in fresh),
                         "duplicate_usage_effect_ids": len(usage) - len(by_effect),
                         "fresh_measurement_cases": sum(c["request_measurement"] is not None for c in fresh)},
              "limitations": ["Value:{} proves SDK validation input, not literal provider arguments; SDK normalizes blank argument strings to {}.",
                              "No historical raw argument/wire body capture; missing recorded args do not prove failed original calls.",
                              "Model aliases and commit times do not prove served checkpoint or deployment identity.",
                              "Same-run accepted repair includes normal no-op outcomes; ledger completed is not user acceptance.",
                              "Followup usage after presentation-only failure is associated overhead, not guaranteed removable savings.",
                              "Observation cannot isolate total context length, invalid historical examples, task mix and route changes."]}
    conn.close()
    if not args.skip_replay:
        report["current_code_replay_probe"] = replay_probe(args.db, root)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "checks": report["checks"], "fresh_daily_expression": {d: by_day[d]["avatar_set_expression"] for d in ["2026-11-01", "2026-11-02", "2026-11-03"]},
                      "fresh_repairs": {d: repair_summary[d] for d in ["2026-11-01", "2026-11-02", "2026-11-03"]}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
