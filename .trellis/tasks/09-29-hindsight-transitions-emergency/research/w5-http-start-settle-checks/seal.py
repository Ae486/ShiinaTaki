"""Seal only the startup-settle preservation repair; all checked-v3 history stays immutable."""

import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control
import w5_http_inventory as inventory

OLD_SHA = "12ab49508b637cca1ac51567dee58a4d064830720d638c28ca182b81097a7884"
old_path = HERE / "w5-http-checked-v3-source-manifest.json"
assert control.digest(old_path) == OLD_SHA
assert not inventory.MANIFEST.exists()
value = control.read_json(old_path)
allowed = {str((HERE / name).resolve()).lower() for name in (
    "w5_http_composition.py", "w5_http_inventory.py", "w5-http-client.mjs",
)}
changes = []
for row in value["files"]:
    path = Path(row["path"])
    actual = inventory.pin(path).model_dump()
    if actual != row:
        assert str(path.resolve()).lower() in allowed, f"UNAPPROVED_CHANGE: {path}"
        assert control.digest(HERE / "w5-http-start-settle-checks/preimages" / path.name) == row["sha256"]
        changes.append({"path": str(path), "before": dict(row), "after": actual})
        row.update(actual)
assert len(changes) == len(allowed) == 3
value["purpose"] = "Checked HTTP diagnostic: preserve pg-starting anchor on exceptional startup"
value["checkedV3ManifestSha256"] = OLD_SHA
control.write_json(inventory.MANIFEST, value)
source = inventory.verify_inventory()
control.write_json(HERE / "w5-http-start-settle-checks/source.json", {
    "source": source, "manifest": str(inventory.MANIFEST), "checkedV3Sha256": control.digest(old_path),
    "changes": changes, "unchangedCheckedV3Entries": 5081,
    "previous404Preserved": True, "dependenciesPreserved": True,
})
code = "import {verifyInventory} from " + json.dumps((HERE / "w5-http-client.mjs").as_uri()) + ";\nconsole.log(JSON.stringify(verifyInventory(process.argv[2],process.argv[3])));"
argv = ["C:/Program Files/nodejs/node.exe", "--input-type=module", "-", str(inventory.MANIFEST), source["sha256"]]
result = subprocess.run(argv, input=code, capture_output=True, text=True, encoding="utf-8", timeout=60,
                        cwd=HERE.parents[3], env=control.clean_environment(), creationflags=subprocess.CREATE_NO_WINDOW)
control.write_json(HERE / "w5-http-start-settle-checks/node-source.json", {
    "argv": argv, "stdin": code, "exitCode": result.returncode,
    "stdout": result.stdout, "stderr": result.stderr,
})
assert result.returncode == 0 and json.loads(result.stdout) == source
print(source)
