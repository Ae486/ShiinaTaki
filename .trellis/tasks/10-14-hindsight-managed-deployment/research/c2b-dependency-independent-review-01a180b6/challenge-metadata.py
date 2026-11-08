"""Small generated source-review challenges; no collector entrypoint or runtime invocation."""

import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PACKET = ROOT / "docker-dependency-inventory"


def module(name):
    spec = importlib.util.spec_from_file_location("review_" + name, PACKET / (name + ".py"))
    assert spec is not None and spec.loader is not None
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


collector = module("collect")
comparator = module("compare")
release = json.loads((PACKET / "release.json").read_bytes())
comparator.load_parser(release)
environment = {key: "review" for key in comparator.ENVIRONMENT_KEYS}
environment.update(implementation_name="cpython", implementation_version="3.11.16", os_name="posix",
                   platform_machine="x86_64", platform_system="Linux", python_full_version="3.11.16",
                   platform_python_implementation="CPython", python_version="3.11", sys_platform="linux")
project = {"name": "demo", "version": "1.0", "requires-python": ">=3.11", "dependencies": [],
           "optional-dependencies": {"embedded-db": []}}
collector.PURELIB = HERE
cases = []
for name, headers in [
    ("unknown-metadata-version", b"Metadata-Version: 99.0\nName: demo\nVersion: 1.0\n\n"),
    ("invalid-unused-extra", b"Metadata-Version: 2.4\nName: unused\nVersion: 1.0\nProvides-Extra: bad???\n\n"),
]:
    path = HERE / (name + ".METADATA")
    path.write_bytes(headers)
    try:
        parsed = collector.metadata(path)
        records = [parsed] if name == "unknown-metadata-version" else [
            {"name": "demo", "version": "1.0", "requiresPython": None, "requiresDist": [], "providesExtra": []}, parsed]
        result = comparator.compare({"schema": "c2b-installed-dependencies-v1", "complete": True,
                                     "environment": environment, "distributions": records}, project)
        cases.append({"case": name, "collectorAccepted": True, "comparison": result})
    except Exception as error:
        cases.append({"case": name, "refusal": type(error).__name__, "message": str(error)})

pins = {name: hashlib.sha256((PACKET / name).read_bytes()).hexdigest() for name in release["files"]}
assert pins == release["files"]
assert hashlib.sha256((PACKET / "release.json").read_bytes()).hexdigest() == "b83d9284e23ded4dbd18157a7ba3e1791661c867d8f11a0084051096d8c43a59"
relay = ROOT / "docker-loopback-relay"
assert (PACKET / "docker-commands.mjs").read_bytes() == (relay / "docker-commands.mjs").read_bytes()
before = (relay / "evidence-store.mjs").read_text()
expected = before.replace(".c2b-relay-owner", ".c2b-dependencies-owner").replace("c2b-relay-disposition-v1", "c2b-dependency-disposition-v1").replace("result.transportPassed", "result.inventoryComplete")
assert (PACKET / "evidence-store.mjs").read_text() == expected
assert (PACKET / "source-pyproject.toml").read_bytes() == Path("H:/hindsight/hindsight-api-slim/pyproject.toml").read_bytes()
answer = {"sourcePinsMatch": True, "commandHelperByteIdentical": True, "evidenceDeltaExact": True,
          "frozenCurrentPyprojectMatches": True, "runtimeExecuted": False, "cases": cases}
(HERE / "challenge-metadata.json").write_text(json.dumps(answer, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"pins": True, "runtimeExecuted": False, "cases": cases}))
