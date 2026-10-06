"""Seal only the authorized five HTTP repairs, preserving every other input."""

from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import w5_actual_embedding_control as control
import w5_http_inventory as inventory

OLD_SHA = "24d34865c137cecfb2b0b7b92157903104e10827da9971c668685bc07f23ad66"
OLD = HERE / "w5-http-source-manifest.json"
assert control.digest(OLD) == OLD_SHA
assert not inventory.MANIFEST.exists()
old = control.read_json(OLD)
allowed = {
    str((HERE / name).resolve()).lower()
    for name in ("w5-http-diagnostic.py", "w5_http_composition.py", "w5-http-client.mjs",
                 "w5_http_inventory.py", "test_w5_http_diagnostic.py")
}
changed = []
preimages = HERE / "w5-http-independent-checks/delivery-preimages"
for row in old["files"]:
    path = Path(row["path"])
    actual = inventory.pin(path).model_dump()
    if row != actual:
        assert str(path.resolve()).lower() in allowed, f"UNAPPROVED_CHANGE: {path}"
        assert control.digest(preimages / path.name) == row["sha256"]
        changed.append({"path": str(path), "before": dict(row), "after": actual})
        row.update(actual)
assert len(changed) == len(allowed) == 5
old["purpose"] = "Checked genuine HTTP diagnostic: strict persisted outcome validation; fixed predecessor/dependency union"
old["deliveryManifestSha256"] = OLD_SHA
control.write_json(inventory.MANIFEST, old)
started = time.monotonic()
source = inventory.verify_inventory()
previous = control.read_json(inventory.PREVIOUS)
for row in previous["files"]:
    assert inventory.pin(Path(row["path"])).model_dump() == row
assert len(previous["files"]) == 404
result = {
    "source": source, "checkedManifest": str(inventory.MANIFEST),
    "originalManifestSha256": control.digest(OLD),
    "previous404ManifestSha256": control.digest(inventory.PREVIOUS),
    "dependencySha256": control.digest(inventory.DEPENDENCIES),
    "pythonVerificationMilliseconds": (time.monotonic() - started) * 1000,
    "unchangedDeliveryEntries": len(old["files"]) - len(changed),
    "changed": changed, "previous404Unchanged": True,
}
control.write_json(HERE / "w5-http-independent-checks/checked-source.json", result)
print(source)
