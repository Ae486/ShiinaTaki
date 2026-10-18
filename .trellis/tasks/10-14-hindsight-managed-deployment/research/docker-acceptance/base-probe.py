"""Fixed, read-only cached-base probe; stdin only, no provider or database imports."""

import io
import json
import os
import stat
import sys
import sysconfig
from importlib.metadata import version
from pathlib import Path

from dotenv import load_dotenv

data = Path("/home/hindsight/.pg0")
metadata = data.lstat()
os.environ["PYTHON_DOTENV_DISABLED"] = "true"
before = dict(os.environ)
load_dotenv(stream=io.StringIO("C2A_PROBE_POISON=must_not_load\n"), override=True)
result = {
    "python": sys.version.split()[0],
    "dotenv": version("python-dotenv"),
    "uid": os.getuid(),
    "gid": os.getgid(),
    "venv": sys.prefix,
    "purelib": sysconfig.get_path("purelib"),
    "dataUid": metadata.st_uid,
    "dataGid": metadata.st_gid,
    "dataMode": stat.S_IMODE(metadata.st_mode),
    "dataDirectory": stat.S_ISDIR(metadata.st_mode),
    "dataEmpty": not any(data.iterdir()),
    "dotenvDisabled": dict(os.environ) == before,
}
result["compatible"] = (
    sys.platform == "linux"
    and sys.version_info >= (3, 11)
    and result["dotenv"] == "1.2.2"
    and result["uid"] == result["gid"] == 1000
    and result["venv"] == "/app/api/.venv"
    and result["dataUid"] == result["dataGid"] == 1000
    and result["dataDirectory"]
    and result["dataMode"] & stat.S_IRWXU == stat.S_IRWXU
    and result["dataEmpty"]
    and result["dotenvDisabled"]
)
print(json.dumps(result))
raise SystemExit(0 if result["compatible"] else 1)
