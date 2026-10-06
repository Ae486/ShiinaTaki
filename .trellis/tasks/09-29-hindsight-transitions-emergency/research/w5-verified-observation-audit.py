"""Audit the approved observer delivery without opening or modifying any working database."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent
PREIMAGES = RESEARCH / "w5-verified-observation-preimages"
DATABASE = ROOT / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/application.sqlite"
DATABASE_HASH = "a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def entry(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size}


anchors = {
    "w5-core-validation-source-manifest.json": "bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4",
    "w5-postcommit-readiness-source-manifest.json": "5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341",
    "w5-verified-observation-preimage-manifest.json": "0f09be95af97b6d3e4677c6a5feb30360f1e069803372b0e1b04b226ec55fac0",
}
for name, expected in anchors.items():
    assert digest(RESEARCH / name) == expected, name
assert digest(DATABASE) == DATABASE_HASH, "Original working SQLite changed"

saved = json.loads((RESEARCH / "w5-verified-observation-preimage-manifest.json").read_text(encoding="utf-8"))
saved.append(json.loads((RESEARCH / "w5-verified-observation-guard-preimage.json").read_text(encoding="utf-8")))
for item in saved:
    original = PREIMAGES / item["path"]
    assert digest(original) == item["sha256"], item["path"]
    assert original.stat().st_size == item["bytes"], item["path"]

new_paths = ["packages/core/src/memory/transitions/transition-observation-store.ts",
             "packages/core/src/memory/transitions/transition-observation-store.test.ts",
             "packages/core/src/db/memory-transition-observation.test.ts"]
files = sorted({item["path"] for item in saved} | set(new_paths))
prior = {item["path"]: item["sha256"] for item in saved}
records = []
for name in files:
    path = ROOT / name
    data = path.read_bytes()
    assert not data.startswith(b"\xef\xbb\xbf"), name
    source = data.decode("utf-8", errors="strict")
    assert all(line.rstrip(" \t") == line for line in source.splitlines()), name
    record = entry(path)
    record["change"] = "added" if name in new_paths else "modified" if record["sha256"] != prior[name] else "unchanged-anchor"
    if name.endswith(".ts") and not name.endswith(".test.ts"):
        assert all(key in source[:500] for key in ["INPUT:", "OUTPUT:", "POS:"]), name
        assert path.name in (path.parent / "index.md").read_text(encoding="utf-8"), name
    records.append(record)

owned = set(files)
narrow = json.loads((RESEARCH / "w5-postcommit-readiness-source-manifest.json").read_text(encoding="utf-8"))
for item in narrow["files"]:
    if item["path"] not in owned:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]

evidence_names = ["w5-verified-observation-implementation.md", "w5-verified-observation-audit.py",
    "w5-verified-observation-types-initial.log", "w5-verified-observation-types-final.log",
    "w5-verified-observation-final-tests.log", "w5-verified-observation-driver-tests.log",
    "w5-verified-observation-service-tests.log", "w5-verified-observation-lint-final.log",
    "w5-verified-observation-boot.log", "w5-verified-observation-replay.mjs",
    "w5-verified-observation-replay-result.json", "w5-verified-observation-driver.mjs",
    "w5-verified-observation-driver-result.json", "w5-verified-observation-driver.log"]
evidence = [entry(RESEARCH / name) for name in evidence_names]
evidence.append(entry(ROOT / ".trellis/.runtime/w5-boot/ff4774fb-ec26-4629-b0bb-1a2b5a288127/result.json"))
output = {"version": 1, "createdAtUtc": datetime.now(timezone.utc).isoformat(),
          "originalDatabaseSha256": DATABASE_HASH, "preservedManifests": anchors,
          "preimagesVerified": len(saved), "files": records, "evidence": evidence,
          "checks": {"strictUtf8NoBom": True, "trailingWhitespace": False,
                     "headersAndIndexes": True, "unownedNarrowPathsUnchanged": True}}
manifest = RESEARCH / "w5-verified-observation-source-manifest.json"
with manifest.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(output, indent=2) + "\n")
print(json.dumps({"manifest": entry(manifest), "files": len(records), "preimages": len(saved),
                  "productionChanges": sum(item["path"].endswith(".ts") and not item["path"].endswith(".test.ts")
                    and item["change"] != "unchanged-anchor" for item in records),
                  "sourceUnchanged": True}, indent=2))
