"""Read-only W5 state audit, including receipt-backed lifecycle deltas."""

import base64
import hashlib
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

if sys.argv[1:] != ["--verify-owned-copy"]:
    print(json.dumps({"executed": False, "readOnly": True}))
    raise SystemExit(0)
from w5_working_custody import stopped

stopped()
root = Path(
    "H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97"
)
core_sha = hashlib.file_digest(
    (root / "application.sqlite").open("rb"), "sha256"
).hexdigest()
assert core_sha == "274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45"
db = sqlite3.connect(
    (root / "application.sqlite").as_uri() + "?mode=ro&immutable=1", uri=True
)
state = json.loads(
    json.loads((root / "journey-checkpoint.json").read_text(encoding="utf-8"))[
        "payloadJson"
    ]
)
t = "6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53"
rt = state["steps"]["return"]["transitionId"]


def candidate(t):
    return json.loads(
        db.execute(
            "SELECT body FROM memory_transition_candidates "
            "WHERE transition_id=? AND slot='final'",
            (t,),
        ).fetchone()[0]
    )


old = candidate(rt)
final = candidate(t)
changes = state["localChanges"]
plan = state["journey"]["localMutation"]
records = {
    (r["unit"]["bankId"], r["unit"]["memoryId"]): r for r in final["state"]["records"]
}
assert len(final["state"]["sources"]) == 722 and len(final["scopes"]) == 2
oldDocs = [m for m in old["mappings"] if m["kind"] == "document"]
maps = {(m["kind"], m["localBankId"], m["localId"]): m for m in final["mappings"]}
for m in oldDocs:
    n = maps[(m["kind"], m["localBankId"], m["localId"])]
    for k in ["native", "application", "applicationBodyHash"]:
        assert n[k] == m[k], k
policy = records[(changes["bankId"], changes["memoryId"])]["policy"]
assert (
    policy["importance"] == changes["importance"]
    and policy["policyVersion"] == changes["policyVersion"]
)
block = next(
    b
    for b in final["state"]["blocks"]
    if b["block_id"] == plan["block"]["blockId"]
    and b["scope"] == plan["block"]["scope"]
)
assert (
    block["block_revision"] == changes["blockRevision"] == 2
    and hashlib.sha256(block["content"].encode()).hexdigest()
    == plan["desiredBlockHash"]
)

evidence = [
    json.loads(r[0])
    for r in db.execute(
        "SELECT body FROM memory_transition_native_evidence WHERE transition_id=?", (t,)
    )
]
bodies = {b["ref"]["bytes_sha256"]: b for e in evidence for b in e["bodies"]}
nativeBefore = {
    r["object_id"]: r
    for e in [
        json.loads(r[0])
        for r in db.execute(
            "SELECT body FROM memory_transition_native_evidence WHERE transition_id=?",
            (rt,),
        )
    ]
    for p in e["nativePages"]
    for r in p["records"]
}
nativeFinal = {
    r["object_id"]: r for e in evidence for p in e["nativePages"] for r in p["records"]
}


def original_unit(key):
    m = maps[("memory_unit", *key)]
    return json.loads(base64.b64decode(bodies[m["applicationBodyHash"]]["base64"]))[
        "original_record"
    ]["unit"]


invalid = [r for r in old["state"]["records"] if r["unit"]["state"] == "invalidated"]
assert len(invalid) == 21
for r in invalid:
    n = records[(r["unit"]["bankId"], r["unit"]["memoryId"])]["unit"]
    a = {k: v for k, v in r["unit"].items() if k != "authorityEpochId"}
    b = {k: v for k, v in n.items() if k != "authorityEpochId"}
    assert datetime.fromisoformat(a["updatedAt"]) == datetime.fromisoformat(
        b["updatedAt"]
    ), "invalidated-timestamp-instant-drift"
    a["updatedAt"] = b["updatedAt"]
    assert a == b, "original-invalidated-unit-drift"
    key = (r["unit"]["bankId"], r["unit"]["memoryId"])
    oid = maps[("memory_unit", *key)]["native"]["object_id"]
    assert original_unit(key)["updatedAt"] == n["updatedAt"]
    assert (
        nativeBefore[oid]["payload"]["updated_at"]
        == nativeFinal[oid]["payload"]["updated_at"]
    )
p = json.loads(
    db.execute(
        "SELECT body FROM memory_transition_preparations "
        "WHERE transition_id=? AND slot=?",
        (t, changes["bankId"]),
    ).fetchone()[0]
)
capture = json.loads(
    db.execute(
        "SELECT body FROM memory_transition_captures WHERE id=?", (p["captureId"],)
    ).fetchone()[0]
)
captured = {
    (r["unit"]["bankId"], r["unit"]["memoryId"]): r for r in capture["state"]["records"]
}
wanted = {
    (p["scope"]["localBankId"], r["source"]["source_id"])
    for r in p["request"]["rows"]["memory_units"]
}
receipts = [
    json.loads(r[0])
    for r in db.execute(
        "SELECT result_json FROM canonical_memory_operation_receipts "
        "WHERE authority_epoch_id=? AND operation='invalidate' AND created_at=?",
        (plan["policy"]["epochId"], "2026-10-04T07:54:39.432Z"),
    )
]
assert len(receipts) == 68
assert {(r["bankId"], r["memoryId"]) for r in receipts} == wanted
for r in receipts:
    assert r["outcome"] == "applied" and r["revision"] == 5
    key = (r["bankId"], r["memoryId"])
    cu = captured[key]["unit"]
    fu = records[key]["unit"]
    assert (
        cu["state"] == fu["state"] == "invalidated"
        and cu["invalidationReason"] == fu["invalidationReason"] == "retention"
    )
    m = maps[("memory_unit", *key)]
    native = nativeFinal[m["native"]["object_id"]]
    original = original_unit(key)
    assert (
        m["native"]["object_revision"]
        == native["object_revision"]
        == native["payload"]["revision"]
    )
    assert original == cu, "retention-original-body-drift"
    assert fu["revision"] == max(native["object_revision"], original["revision"] + 1)
    a = {k: v for k, v in cu.items() if k not in ["authorityEpochId", "revision"]}
    b = {k: v for k, v in fu.items() if k not in ["authorityEpochId", "revision"]}
    for k in ["updatedAt", "invalidatedAt"]:
        assert datetime.fromisoformat(a[k]) == datetime.fromisoformat(b[k]), (
            "retention-timestamp-instant-drift"
        )
        a[k] = b[k]
    assert a == b, "retention-unit-drift"
print(
    json.dumps(
        {
            "remainingAssertionsWithProvenTimestampAndRevisionProjectionPassed": True,
            "banks": len(final["scopes"]),
            "documents": len(final["state"]["sources"]),
            "units": len(final["state"]["records"]),
            "invalidated": sum(
                r["unit"]["state"] == "invalidated" for r in final["state"]["records"]
            ),
            "originalInvalidatedPreserved": len(invalid),
            "receiptBackedRetentionUpserts": len(receipts),
            "documentMappings": len(oldDocs),
            "policyVersion": policy["policyVersion"],
            "blockRevision": block["block_revision"],
        }
    )
)
db.close()

assert (
    hashlib.file_digest((root / "application.sqlite").open("rb"), "sha256").hexdigest()
    == core_sha
)
