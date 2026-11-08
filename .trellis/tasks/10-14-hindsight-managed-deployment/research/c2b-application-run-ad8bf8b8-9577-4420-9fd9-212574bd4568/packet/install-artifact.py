"""Image-build-only whole application replacement; never imports an installed package."""

import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/opt/taki-c2b-application-input")
from artifact_io import (
    APP,
    ARTIFACT,
    CACHE_KEY,
    TOKEN,
    base_metadata,
    build_gate,
    cache_gate,
    encoded,
    plain_path,
    protected_facts,
    require,
    tree,
)

INPUT = Path("/opt/taki-c2b-application-input")


def install() -> None:
    require(sys.argv[1:] == [] and sys.flags.no_site == 1 and sys.flags.isolated == 1, "build_arguments")
    require(os.getuid() == 0 and os.getgid() == 0, "build_user")
    plain_path(INPUT)
    plain_path(APP)
    require(not ARTIFACT.exists(), "artifact_path_collision")
    source = json.loads((INPUT / "source-manifest.json").read_bytes())
    baseline = json.loads((INPUT / "base-facts.json").read_bytes())
    base_metadata(baseline["metadata"])
    before = protected_facts()
    for name in ("hindsight_api", "managed_bootstrap"):
        require(tree(INPUT / name)["entries"] == source["trees"][name]["entries"], "input_tree_mismatch")
    build_gate(INPUT / "hindsight_api/engine/taki_compatibility.py")
    cache_source = Path("/tmp/data-gym-cache") / CACHE_KEY
    cache_gate(cache_source)
    # APP is the exact verified immutable-base application path; only its new build layer is changed.
    shutil.rmtree(APP)
    shutil.copytree(INPUT / "hindsight_api", APP)
    ARTIFACT.mkdir(mode=0o755)
    for name in ("managed_bootstrap", "source-metadata"):
        shutil.copytree(INPUT / name, ARTIFACT / name)
    for name in ("artifact_io.py", "artifact-check.py", "base-facts.json", "source-manifest.json"):
        shutil.copyfile(INPUT / name, ARTIFACT / name)
    cache_dir = ARTIFACT / "tokenizer"
    cache_dir.mkdir(mode=0o755)
    shutil.copyfile(cache_source, cache_dir / CACHE_KEY)
    cache_gate(cache_dir / CACHE_KEY)
    negative = ARTIFACT / "negative"
    negative.mkdir()
    (negative / "wrong-build.py").write_text('TAKI_MEMORY_COMPATIBILITY_BUILD = "wrong-build"\n')
    (negative / "corrupt-cache").write_bytes(b"generated corrupt tokenizer fixture\n")
    after = protected_facts()
    require(before == after, "protected_environment_changed")
    (ARTIFACT / "protected-baseline.json").write_bytes(encoded(before))
    require(tree(APP)["entries"] == source["trees"]["hindsight_api"]["entries"], "installed_tree_mismatch")
    # Immutable artifact files remain readable to the later UID/GID 1000 checker.
    for root in (APP, ARTIFACT):
        for directory, dirs, files in os.walk(root):
            os.chmod(directory, 0o555)
            for name in files:
                os.chmod(Path(directory) / name, 0o444)
    plain_path(INPUT)
    shutil.rmtree(INPUT)
    print(
        json.dumps(
            {
                "schema": "c2b-application-install-v1",
                "token": TOKEN,
                "deploymentReady": False,
                "complete": True,
                "protectedEnvironmentUnchanged": True,
                "protected": before,
            }
        )
    )


if __name__ == "__main__":
    install()
