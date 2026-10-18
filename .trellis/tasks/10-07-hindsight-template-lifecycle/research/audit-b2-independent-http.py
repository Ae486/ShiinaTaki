"""Read back one completed owned HTTP fixture without issuing any requests."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def main() -> None:
    artifact = sys.argv[1]
    if not re.fullmatch(r"[0-9a-f]{32}", artifact):
        raise ValueError("An exact owned HTTP artifact ID is required")
    exchange_path = RESEARCH / f"b2-native-http-{artifact}-exchanges.jsonl"
    node_path = RESEARCH / f"b2-native-http-{artifact}.log"
    raw = exchange_path.read_bytes()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
    node = json.loads(node_path.read_text(encoding="utf-8").splitlines()[-1])
    assert digest(raw) == node["exchangeSha256"]
    assert len(rows) == node["requests"] == 200
    # Responses are appended when completed, not in request issue order.
    assert sorted(row["ordinal"] for row in rows) == list(range(1, len(rows) + 1))
    expected_keys = {"ordinal", "method", "path", "requestBody", "requestSha256", "status", "responseBody", "responseSha256"}
    for row in rows:
        assert set(row) == expected_keys, "No headers or unknown fields may enter the fixture recording"
        assert digest((row["requestBody"] or "").encode("utf-8")) == row["requestSha256"]
        assert digest(row["responseBody"].encode("utf-8")) == row["responseSha256"]
        assert 200 <= row["status"] < 300

    labels = [row for row in rows if row["path"] == "/ext/taki-memory/template/label-evidence"]
    assert len(labels) == node["labelEvidenceReads"] == 7
    proofs = []
    empty = 0
    for row in labels:
        request = json.loads(row["requestBody"])
        response = json.loads(row["responseBody"])
        assert row["method"] == "POST" and row["status"] == 200
        assert len(request["units"]) == 1
        assert request["target"] == response["target"]
        assert request["contract_version"] == response["contract_version"] == "1.0.0"
        assert len(response["evidence"]) <= 1
        empty += not response["evidence"]
        for proof in response["evidence"]:
            assert proof["target"] == request["target"]
            assert all(proof[key] == value for key, value in request["units"][0].items())
            assert proof["unit_revision"] == 2, "The positive proofs must attest the consolidated version"
            assert proof["producer"] == "taki-structured-label-v1" and proof["group_key"] == "taki-layer"
            proofs.append(proof)
    assert empty == 5
    assert {(proof["scope"], proof["value"]) for proof in proofs} == {("global", "activity"), ("character", "episodes")}
    commits = sum(row["method"] == "POST" and row["path"].endswith("/application-state/commits") for row in rows)
    assert commits == node["applicationCommits"] == 11
    assert node["banks"] == 2 and node["units"] == 7
    assert node["registryPolicies"] == 2 and node["neutralPolicies"] == 5
    assert node["consolidatedProvenUnits"] == 2
    assert node["reopenVerified"] and node["remoteIoOutsideSqlite"]
    suite = json.loads((RESEARCH / "b2-independent-native-labels-green-02-result.json").read_text(encoding="utf-8"))
    assert suite["exitCode"] == 0

    result = {
        "kind": "Independent read-only retained HTTP exchange audit",
        "exitCode": 0,
        "artifactId": artifact,
        "suiteResult": "b2-independent-native-labels-green-02-result.json",
        "exchangeFile": str(exchange_path),
        "exchangeSha256": digest(raw),
        "nodeLogSha256": digest(node_path.read_bytes()),
        "records": len(rows),
        "httpStatuses": dict(Counter(row["status"] for row in rows)),
        "requestOrdinalsUniqueAndComplete": True,
        "rowOrder": "HTTP completion order",
        "allRecordedBodyHashesVerified": True,
        "authorizationHeadersRecorded": False,
        "exactRequestTargetAndVersionMatches": True,
        "labelEvidenceReads": len(labels),
        "exactConsolidatedProofs": proofs,
        "emptyEvidenceResponses": empty,
        "applicationCommits": commits,
        "nodeSummary": node,
    }
    output = RESEARCH / "b2-independent-http-audit-01.json"
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"audit": str(output), "artifactId": artifact, "records": len(rows),
                      "exchangeSha256": digest(raw), "exactProofs": len(proofs), "neutralReads": empty}))


if __name__ == "__main__":
    main()
