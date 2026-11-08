"""Source delta and generated-header checks; no real image or collector entrypoint."""

import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PACKET = ROOT / "docker-dependency-inventory-v2"
OLD = ROOT / "docker-dependency-inventory"
STATIC = ROOT / "c2b-dependency-v2-source-01a180b6-static"
OLD_TOKEN = "0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d"
TOKEN = "e309a1b4-7047-44bb-a4af-cdd65b1a994a"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def module(name):
    spec = importlib.util.spec_from_file_location("v2_review_" + name, PACKET / (name + ".py"))
    assert spec is not None and spec.loader is not None
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


release = read(PACKET / "release.json")
assert sha(PACKET / "release.json") == "09cecd8d80419224d6b562c179ffee6044551c6ae00523b961bf16b435b1e789"
assert release["token"] == TOKEN
assert sha(OLD / "release.json") == "5fd19647e62dc6791066eb5a216d3ee9eb7fe911a5e0c49d10a97374c61a77a1"
assert sha(ROOT / ("c2b-dependencies-run-" + OLD_TOKEN) / "result.json") == "54c5998b118e9f35ab42a12863fe7e3f5830296b1d549b639c2a4a32c3703c6b"
assert all(sha(OLD / name) == value for name, value in read(OLD / "release.json")["files"].items())
assert all(sha(PACKET / name) == value for name, value in release["files"].items())
assert all(sha(PACKET / name) == value for name, value in read(STATIC / "integrity.json")["files"].items())
unchanged = ["compare.py", "docker-commands.mjs", "evidence-store.mjs", "source-pyproject.toml"]
assert all((PACKET / name).read_bytes() == (OLD / name).read_bytes() for name in unchanged)
assert (PACKET / "launch.mjs").read_bytes() == (OLD / "launch.mjs").read_bytes().replace(OLD_TOKEN.encode(), TOKEN.encode())
assert not Path("G:/TakiAgent-c2b-native-api/dependencies-" + TOKEN).exists()
assert not Path(release["archive"]).exists()
delta = "".join(difflib.unified_diff((OLD / "collect.py").read_text().splitlines(True),
                                     (PACKET / "collect.py").read_text().splitlines(True),
                                     fromfile="original/collect.py", tofile="v2/collect.py"))
(HERE / "collector-delta.diff").write_text(delta, encoding="utf-8")

collector = module("collect")
comparator = module("compare")
comparator.load_parser(release)
environment = {key: "generated-review-fixture" for key in comparator.ENVIRONMENT_KEYS}
environment.update(implementation_name="cpython", implementation_version="3.11.16", os_name="posix",
                   platform_machine="x86_64", platform_system="Linux", python_full_version="3.11.16",
                   platform_python_implementation="CPython", python_version="3.11", sys_platform="linux")
fixture = HERE / "generated-purelib"
fixture.mkdir(exist_ok=True)
for directory, name, version in [("a-demo.dist-info", "demo", "2.4"),
                                  ("m-unknown.dist-info", "unknown", "99.0"),
                                  ("z-later.dist-info", "later", "2.4")]:
    target = fixture / directory
    target.mkdir(exist_ok=True)
    (target / "METADATA").write_bytes(f"Metadata-Version: {version}\nName: {name}\nVersion: 1.0\n\n".encode())
# Only the collector module's environment adapters are substituted; file enumeration/read/parsing
# and accumulation are the actual implementation over the generated directory above.
collector.PURELIB = fixture
collector.sys = SimpleNamespace(flags=SimpleNamespace(no_site=1, isolated=1), dont_write_bytecode=True,
                                platform="linux", version_info=(3, 11), executable="generated-fixture")
collector.os = SimpleNamespace(scandir=os.scandir, getuid=lambda: 1000, getgid=lambda: 1000)
collector.environment = lambda: environment
inventory = collector.collect()
assert inventory["complete"] and inventory["failure"] is None
assert [item["name"] for item in inventory["distributions"]] == ["demo", "unknown", "later"]
assert [item["metadataVersionSupported"] for item in inventory["distributions"]] == [True, False, True]
assert inventory["unsupportedMetadata"] == [{"file": "m-unknown.dist-info/METADATA", "metadataVersion": "99.0"}]
assert inventory["metadataBytes"] == sum(item["bytes"] for item in inventory["distributions"])
project = {"name": "demo", "version": "1.0", "requires-python": ">=3.11", "dependencies": ["later>=1"],
           "optional-dependencies": {"embedded-db": []}}
try:
    comparator.compare(inventory, project)
except ValueError as error:
    assert str(error) == "metadata_version_unsupported"
else:
    raise AssertionError("Raw collection success admitted unknown metadata semantics")
supported = {**inventory, "distributions": [item for item in inventory["distributions"] if item["metadataVersionSupported"]],
             "unsupportedMetadata": []}
positive = comparator.compare(supported, project)
assert positive["comparisonComplete"] and positive["metadataCompatible"]
result = {"verdict": "PASS_SOURCE_DELTA", "releaseSha256": sha(PACKET / "release.json"),
          "runtimeExecuted": False, "generatedEnvironmentOnly": True, "unchangedFiles": unchanged,
          "launcherOnlyTokenChanged": True, "originalPacketAndFailurePreserved": True,
          "stageAndArchiveAbsent": True, "generatedInventory": inventory,
          "unknownComparison": "metadata_version_unsupported", "supported2_4Comparison": "compatible",
          "sourceChecks": {name: sha(STATIC / name) for name in ["checks.json", "after-javascript.json", "test-metadata.py"]},
          "deploymentReady": False}
(HERE / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: value for key, value in result.items() if key != "generatedInventory"}))
