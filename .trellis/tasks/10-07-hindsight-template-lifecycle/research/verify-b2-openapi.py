"""Compare B2's canonical OpenAPI with the accepted B1 and pinned Git inputs."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent


def compare(before: dict, after: dict) -> dict:
    return {
        "added": sorted(after.keys() - before.keys()),
        "removed": sorted(before.keys() - after.keys()),
        "changed": sorted(key for key in before.keys() & after.keys() if before[key] != after[key]),
    }


current_bytes = (ROOT / "hindsight-docs/static/openapi.json").read_bytes()
current = json.loads(current_bytes)
baseline = json.loads((HERE / "b1-independent-native-openapi.json").read_text(encoding="utf-8"))
head = json.loads(subprocess.check_output(
    ["git", "show", "HEAD:hindsight-docs/static/openapi.json"], cwd=ROOT
))
comparisons = {
    name: {
        "paths": compare(old["paths"], current["paths"]),
        "schemas": compare(old["components"]["schemas"], current["components"]["schemas"]),
    }
    for name, old in (("b1", baseline), ("head", head))
}
for section in comparisons["b1"].values():
    assert not section["removed"] and not section["changed"]
assert comparisons["b1"]["paths"]["added"] == ["/ext/taki-memory/template/label-evidence"]
assert not comparisons["b1"]["schemas"]["added"]
assert not comparisons["head"]["paths"]["removed"] and not comparisons["head"]["paths"]["changed"]
assert not comparisons["head"]["schemas"]["removed"]
# These previously reviewed additions to the optional compatibility manifest
# predate B2, whose entire B1-relative schema comparison above is byte-semantic.
assert comparisons["head"]["schemas"]["changed"] == ["TakiCompatibilityContracts", "TakiCompatibilitySupport"]
report = {"canonicalSha256": hashlib.sha256(current_bytes).hexdigest(), "comparisons": comparisons}
destination = HERE / "b2-openapi-compatibility.json"
with destination.open("x", encoding="utf-8") as output:
    json.dump(report, output, indent=2)
    output.write("\n")
print(json.dumps({"report": str(destination), "canonicalSha256": report["canonicalSha256"],
                  "b1": comparisons["b1"]}))
