"""Compile and compare source ASTs without importing or evaluating packet code."""

import ast
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "docker-loopback-relay"
BASELINE = HERE / "released-before-review"


def normalized_tree(raw, fixture_baseline=False):
    tree = ast.parse(raw)
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
    if fixture_baseline:
        imports = [node for node in imports if ast.dump(node) != ast.dump(ast.Import(names=[ast.alias(name="sys")]))]
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                if node.targets[0].id == "code" and isinstance(node.value, ast.Call):
                    if ast.unparse(node.value) == "errno.errorcode.get(error.errno, 'UNKNOWN')":
                        node.value = ast.parse(
                            'errno.errorcode.get(error.errno, "UNKNOWN") if error.errno is not None else "UNKNOWN"',
                            mode="eval",
                        ).body
    other = [node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))]
    tree.body = sorted(imports, key=ast.dump) + other
    return ast.dump(tree, include_attributes=False)


records = []
for name in ["fixture-server.py", "stream-relay.py", "observe-reaping.py"]:
    path = PACKET / name
    raw = path.read_bytes()
    raw.decode("utf-8", errors="strict")
    assert not raw.startswith(b"\xef\xbb\xbf")
    assert len(raw) <= 65536
    compile(raw, str(path), "exec", dont_inherit=True)
    expected = normalized_tree((BASELINE / name).read_bytes(), name == "fixture-server.py")
    assert expected == normalized_tree(raw), name + ": unexpected semantic change"
    records.append({"file": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                    "compileOnly": "PASS", "astEquivalentExceptReviewedChanges": True})

report = {"python": sys.version, "executable": sys.executable, "runtimeExecuted": False,
          "packetModulesEvaluated": False, "pass": True,
          "reviewedSemanticChanges": ["Explicit None errno maps to the existing UNKNOWN refusal; remove unused sys import"],
          "records": records}
(HERE / "after-python-ast.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
