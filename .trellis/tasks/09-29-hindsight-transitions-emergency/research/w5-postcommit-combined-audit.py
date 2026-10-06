"""Read-only predecessor/replay audit; create separately named independent evidence exactly once."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent
PREFIXES = ["w5-core-validation", "w5-postcommit-readiness", "w5-verified-observation", "w5-finalization-scheduling"]
ANCHORS = [
    "bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4",
    "5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341",
    "9cb5ecbcf8c13c4e77504da52fd1c2b5fab60f72e60890defa30d40186883a66",
    "f984db6db6bbfbb0d57fe4e61c1056677f02506617c3637d9e7517460f6b2da2",
]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def record(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size}


phase = sys.argv[1]
assert phase in ["start", "final"]
suffix = sys.argv[2] if len(sys.argv) > 2 else ""
assert suffix in ["", "-v2"]
latest = {}
preserved = {}
preimages = []
for prefix, expected in zip(PREFIXES, ANCHORS):
    path = RESEARCH / f"{prefix}-source-manifest.json"
    assert digest(path) == expected, path
    preserved[path.relative_to(ROOT).as_posix()] = record(path)
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for item in manifest["files"]:
        latest[item["path"]] = item
    for item in manifest.get("evidence", []):
        target = ROOT / item["path"]
        assert digest(target) == item["sha256"], target
        preserved[item["path"]] = record(target)
    if prefix == "w5-core-validation":
        continue  # Accepted independent Core gate; later delivery preimages are checked below.
    preimage_path = RESEARCH / f"{prefix}-preimage-manifest.json"
    preserved[preimage_path.relative_to(ROOT).as_posix()] = record(preimage_path)
    saved = json.loads(preimage_path.read_text(encoding="utf-8"))
    if prefix == "w5-verified-observation":
        guard = RESEARCH / "w5-verified-observation-guard-preimage.json"
        saved.append(json.loads(guard.read_text(encoding="utf-8")))
        preserved[guard.relative_to(ROOT).as_posix()] = record(guard)
    for item in saved:
        target = RESEARCH / f"{prefix}-preimages" / item["path"]
        assert digest(target) == item["sha256"] and target.stat().st_size == item["bytes"], target
        preimages.append(record(target))

owned = {"packages/core/src/memory/transitions/transition-healthy-terminal-boundary.test.ts",
         "packages/core/src/memory/transitions/index.md", "eslint.config.js", "CLAUDE.md",
         ".trellis/spec/backend/quality-guidelines.md"} if phase == "final" else set()
for name, item in latest.items():
    if name not in owned:
        assert digest(ROOT / name) == item["sha256"], name

replay = json.loads((RESEARCH / "w5-finalization-scheduling-driver-result.json").read_text(encoding="utf-8"))
assert replay["checkedSourceUnchanged"] and replay["sourceUnchanged"] and replay["diagnostics"] == []
assert replay["operationState"] == "completed" and replay["finalPhase"] == "terminal"
assert replay["terminal"] == {"outcome": "completed", "runtime": "ready", "queue": "settled", "release": "source-retired", "banks": 2}
assert replay["requestTimeoutMs"] == 60000 and replay["pollIntervalMs"] == 10000
assert replay["heartbeat"] and all(row["outcome"] == "resolved" and row["ms"] < 60000 for row in replay["heartbeat"])
for item in replay["sourceFiles"]:
    if item["path"] not in owned:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]

copy = Path(replay["copyRoot"]) / "application.sqlite"
copy_before = digest(copy)
with sqlite3.connect(copy.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    value = db.execute("SELECT resolution_json FROM memory_transition_resolutions WHERE operation_id=?", (replay["operationId"],)).fetchone()
    resolution = json.loads(value[0])
    assert resolution["transitionId"] == replay["transitionId"] and resolution["result"]["outcome"] == "completed"
    assert resolution["release"]["disposition"] == "source-retired" and len(resolution["release"]["banks"]) == 2
assert digest(copy) == copy_before
working = ROOT / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/application.sqlite"
assert digest(working) == "a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923"

paths = sorted(set(latest) | owned | {"packages/core/src/memory/runtime-selector.ts",
                                    "packages/core/src/memory/transitions/transition-runtime.ts"})
for name in paths:
    raw = (ROOT / name).read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), name
    text = raw.decode("utf-8", errors="strict")
    assert all(line.rstrip(" \t") == line for line in text.splitlines()), name

if phase == "start":
    preimage = RESEARCH / "w5-postcommit-combined-preimages/packages/core/src/memory/transitions/index.md"
    preimage.parent.mkdir(parents=True, exist_ok=True)
    with preimage.open("xb") as stream:
        stream.write((ROOT / "packages/core/src/memory/transitions/index.md").read_bytes())
else:
    original = json.loads((RESEARCH / "w5-postcommit-combined-start-source-manifest.json").read_text(encoding="utf-8"))
    for item in original["preserved"]:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
    length_preimages = json.loads((RESEARCH / "w5-postcommit-combined-length-preimage-manifest.json").read_text(encoding="utf-8"))
    for item in length_preimages:
        target = RESEARCH / "w5-postcommit-combined-preimages" / item["path"]
        assert digest(target) == item["sha256"] and target.stat().st_size == item["bytes"]
        preimages.append(record(target))
    index_path = "packages/core/src/memory/transitions/index.md"
    original_index = next(item for item in original["files"] if item["path"] == index_path)
    target = RESEARCH / "w5-postcommit-combined-preimages" / index_path
    assert digest(target) == original_index["sha256"]
    preimages.append(record(target))

output = {"createdAtUtc": datetime.now(timezone.utc).isoformat(), "phase": phase,
          "files": [record(ROOT / name) for name in paths], "preserved": list(preserved.values()),
          "preimages": preimages, "workingDatabaseSha256": digest(working),
          "retainedCopy": {"path": str(copy), "sha256": copy_before, "integrity": "ok", "terminalResolutionVerified": True},
          "replaySourceChecks": len(replay["sourceFiles"]), "productionChangesByReviewer": 0,
          "replaySourceCurrentMatches": sum(digest(ROOT / item["path"]) == item["sha256"] for item in replay["sourceFiles"]),
          "reviewerChanges": sorted(owned)}
if phase == "final":
    # The command's own redirected output is still open; it cannot be an immutable input to its own manifest.
    active_log = f"w5-postcommit-combined-final-audit{suffix}.log"
    output["evidence"] = [record(path) for path in sorted(RESEARCH.glob("w5-postcommit-combined-*"))
                          if path.is_file() and path.name != active_log]
target = RESEARCH / f"w5-postcommit-combined-{phase}-source-manifest{suffix}.json"
with target.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(output, indent=2) + "\n")
print(json.dumps({"manifest": record(target), "files": len(paths), "preimages": len(preimages),
                  "preserved": len(preserved), "replaySourceChecks": len(replay["sourceFiles"]),
                  "copyIntegrity": "ok", "workingUnchanged": True}, indent=2))
