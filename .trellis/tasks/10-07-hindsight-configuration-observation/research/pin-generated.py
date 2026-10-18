"""Pin canonical outputs and preserved wrapper/module bytes across regeneration."""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent
paths = {ROOT / "hindsight-docs/static/openapi.json"}
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
rows = {str(path.relative_to(ROOT)).replace("\\", "/"): {
    "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
} for path in sorted(paths)}
generated_rust = list((ROOT / "hindsight-clients/rust/target/release/build").glob("hindsight-client-*/out/hindsight_client_generated.rs"))
assert len(generated_rust) == 1, "Exactly one canonical Rust generated source is required"
rows["rust-build/hindsight_client_generated.rs"] = {
    "bytes": generated_rust[0].stat().st_size, "sha256": hashlib.sha256(generated_rust[0].read_bytes()).hexdigest(),
}
destination = HERE / f"generated-{sys.argv[1]}.json"
destination.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
if sys.argv[1] == "after":
    before = json.loads((HERE / "generated-before.json").read_text(encoding="utf-8"))
    changed = [key for key in sorted(before.keys() | rows.keys()) if before.get(key) != rows.get(key)]
    print(json.dumps({"files": len(rows), "byteChanges": changed}))
    assert not changed, "Repeated generation changed byte identities"
else:
    print(json.dumps({"files": len(rows), "snapshot": str(destination)}))
