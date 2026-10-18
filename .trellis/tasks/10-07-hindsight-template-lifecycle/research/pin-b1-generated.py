"""Pin new-schema canonical outputs and compare a repeat without using the old-input run."""

import hashlib
import json
from pathlib import Path
import sys

ROOT = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent
spec_path = ROOT / "hindsight-docs/static/openapi.json"
spec = json.loads(spec_path.read_text(encoding="utf-8"))
for operation in ("snapshot", "apply", "result", "refresh-result"):
    assert f"/ext/taki-memory/template/{operation}" in spec["paths"]
assert "TemplateApplyRequest" in spec["components"]["schemas"]
paths = {spec_path}
for directory, pattern in (
    ("hindsight-clients/python/hindsight_client_api", "*.py"),
    ("hindsight-clients/python/hindsight_client", "*.py"),
    ("hindsight-clients/typescript/generated", "*.ts"),
    ("hindsight-clients/go", "*.go"),
):
    paths.update((ROOT / directory).rglob(pattern))
for relative in (
    "hindsight-clients/go/api/openapi.yaml", "hindsight-clients/go/go.mod", "hindsight-clients/go/go.sum",
    "hindsight-clients/python/.openapi-generator/FILES", "hindsight-clients/python/README.md",
    "hindsight-clients/rust/Cargo.lock",
):
    paths.add(ROOT / relative)


def fingerprint(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


rows = {path.relative_to(ROOT).as_posix(): fingerprint(path) for path in sorted(paths)}
rust = list((ROOT / "hindsight-clients/rust/target/release/build").glob("hindsight-client-*/out/hindsight_client_generated.rs"))
assert len(rust) == 1
rows["rust-build/hindsight_client_generated.rs"] = fingerprint(rust[0])
destination = HERE / f"b1-generated-{sys.argv[1]}.json"
assert not destination.exists(), "Never replace previous generation evidence"
destination.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
if sys.argv[1] == "after":
    before = json.loads((HERE / "b1-generated-before.json").read_text(encoding="utf-8"))
    changed = [key for key in sorted(before.keys() | rows.keys()) if before.get(key) != rows.get(key)]
    print(json.dumps({"files": len(rows), "byteChanges": changed}))
    assert not changed, "Repeated new-input generation changed byte identities"
else:
    print(json.dumps({"files": len(rows), "snapshot": str(destination)}))
