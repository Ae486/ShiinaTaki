"""Recompute request and reported token accounting from retained synthetic evidence."""
import hashlib
import json
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parent
repo = root.parent.parent
campaign = json.loads((root / "campaign.json").read_text(encoding="utf-8"))
fields = ("input_tokens", "output_tokens", "total_tokens", "input_no_cache_tokens",
          "cache_read_tokens", "cache_write_tokens", "output_text_tokens", "reasoning_tokens")
cases = []
all_usage = []


def usage_totals(rows):
    totals = {}
    for field in fields:
        values = [row[field] for row in rows if isinstance(row.get(field), int)]
        unknown = len(rows) - len(values)
        totals[field] = {"reportedSubtotal": sum(values), "unknownRows": unknown,
                         "completeRecordedRowsTotal": sum(values) if unknown == 0 else None}
    return totals


for scenario in campaign["scenarios"]:
    if "evidence" not in scenario:
        continue
    directory = repo / scenario["evidence"]
    result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
    evidence = json.loads((directory / "interface-evidence.json").read_text(encoding="utf-8"))
    counts = evidence["counts"]
    physical = counts["physicalUpstreamForwards"]
    confirmed = physical
    counted = physical
    basis = "timing-relay forward records"
    if physical is None:
        counted = counts["observerAdmittedReservations"]
        confirmed = counts["successfulHttpStatuses"]
        physical = confirmed if confirmed == counted else None
        basis = "successful upstream responses confirm sends; charge every admitted fetch attempt to the bound"
    assert counted == scenario["requests"]
    usage = evidence["usage"]
    assert len({row["effect_id"] for row in usage}) == len(usage)
    all_usage.extend(usage)
    cases.append({"name": scenario["name"], "evidence": scenario["evidence"],
                  "originalStatus": result["status"], "exactPhysicalRequests": physical,
                  "confirmedRequests": confirmed, "countedAttempts": counted, "countBasis": basis,
                  "unconfirmedAttempts": [request["requestNumber"] for request in result["requests"]
                                          if request.get("upstreamAttempted") and request.get("status") is None],
                  "producerCounts": counts, "usageQualities": dict(Counter(row["quality"] for row in usage)),
                  "reportedUsage": usage_totals(usage),
                  "sourceUnchanged": result["sourceUnchanged"], "cleanupFailed": result["cleanupFailed"],
                  "artifactSha256": {name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
                                     for name in ("result.json", "interface-evidence.json")}})

confirmed = sum(case["confirmedRequests"] for case in cases)
counted = sum(case["countedAttempts"] for case in cases)
assert confirmed == campaign["confirmedUpstreamRequests"]
assert counted == campaign["countedUpstreamAttempts"]
assert len({row["effect_id"] for row in all_usage}) == len(all_usage)
summary = {"exactPhysicalRequests": confirmed if confirmed == counted else None,
           "confirmedRequests": confirmed, "countedAttempts": counted,
           "announcedCeiling": campaign["revisedUpstreamRequestCeiling"],
           "cases": cases, "reportedUsage": usage_totals(all_usage),
           "limits": ["Reported usage is not provider billing; missing values remain unknown.",
                      "Token subtotals cover recorded usage rows only; the cancelled utility fetch has no completed usage row.",
                      "Failed scenarios remain failed; this calculation does not grant acceptance."]}
(root / "usage-accounting.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"confirmedRequests": confirmed, "countedAttempts": counted,
                  "cases": len(cases), "usageRows": len(all_usage)}))
