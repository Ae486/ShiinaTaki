"""Derived-image-only full bootstrap replacement; old application/venv/cache stays exact."""

import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/opt/taki-c2b-producer-input")
from artifact_io import ARTIFACT, encoded, file_fact, plain_path, protected_facts, require, tree

INPUT = Path("/opt/taki-c2b-producer-input")
TARGET = Path("/opt/taki-c2b-producer")


def main() -> None:
    require(sys.argv[1:] == [] and sys.flags.no_site and sys.flags.isolated and os.getuid() == 0, "install_context")
    plain_path(INPUT)
    require(not TARGET.exists(), "producer_collision")
    expected = json.loads((INPUT / "producer-manifest.json").read_bytes())
    require(tree(INPUT / "managed_bootstrap")["entries"] == expected["bootstrap"]["entries"], "bootstrap_input")
    for name, fact in expected["fixtureFiles"].items():
        require(file_fact(INPUT / name) == fact, "fixture_input")
    old_manifest = (ARTIFACT / "source-manifest.json").read_bytes()
    source = json.loads(old_manifest)
    require(tree(Path("/app/api/hindsight_api"))["entries"] == source["trees"]["hindsight_api"]["entries"], "application_changed")
    before = protected_facts()
    require(before == json.loads((ARTIFACT / "protected-baseline.json").read_bytes()), "base_environment_changed")
    bootstrap = ARTIFACT / "managed_bootstrap"
    plain_path(bootstrap)
    shutil.rmtree(bootstrap)
    shutil.copytree(INPUT / "managed_bootstrap", bootstrap)
    source["trees"]["managed_bootstrap"] = expected["bootstrap"]
    require(not (ARTIFACT / "base-source-manifest.json").exists(), "base_manifest_collision")
    (ARTIFACT / "base-source-manifest.json").write_bytes(old_manifest)
    (ARTIFACT / "source-manifest.json").write_bytes(encoded(source))
    TARGET.mkdir(mode=0o755)
    for name in ("fixture.py", "fixture_support.py", "artifact_io.py", "producer-manifest.json"):
        shutil.copyfile(INPUT / name, TARGET / name)
    require(tree(bootstrap)["entries"] == expected["bootstrap"]["entries"], "installed_bootstrap")
    require(protected_facts() == before, "virtualenv_changed")
    volume_template = Path("/home/hindsight/.pg0")
    plain_path(volume_template)
    require(volume_template.is_dir() and not list(volume_template.iterdir()), "volume_template_not_empty")
    require(volume_template.stat().st_uid == volume_template.stat().st_gid == 1000, "volume_template_owner")
    for root in (bootstrap, TARGET):
        for directory, _dirs, files in os.walk(root):
            os.chmod(directory, 0o555)
            for name in files:
                os.chmod(Path(directory) / name, 0o444)
    os.chmod(ARTIFACT / "source-manifest.json", 0o444)
    os.chmod(ARTIFACT / "base-source-manifest.json", 0o444)
    shutil.rmtree(INPUT)
    print(json.dumps({"schema": "c2b-producer-install-v1", "token": expected["token"], "complete": True,
                      "deploymentReady": False, "protectedEnvironmentUnchanged": True,
                      "bootstrapSha256": expected["bootstrap"]["sha256"]}))


if __name__ == "__main__":
    main()
