"""Task-only Native log projection; the existing launcher retains all isolation and stop controls."""
import json
import re
import runpy
import sys
import time
from pathlib import Path


def instrument_requests(output):
    # Installed FastAPI delegates to this Starlette entry. The scope marker avoids counting mounted apps twice.
    from starlette.applications import Starlette
    original = Starlette.__call__
    sequence = 0

    async def observed(app, scope, receive, send):
        nonlocal sequence
        if scope["type"] != "http" or scope.get("taki_maintenance_observed"):
            return await original(app, scope, receive, send)
        scope["taki_maintenance_observed"] = True
        sequence += 1
        request_id = sequence
        start_at = time.time() * 1000
        start = time.perf_counter()
        status = None

        async def response(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        path = re.sub(r"/(banks|bodies|parts|operations|snapshots|commits)/[^/]+", r"/\1/{id}", scope["path"])
        output.write(json.dumps({"event": "native-request-start", "id": request_id,
            "startAt": start_at, "method": scope["method"], "path": path}) + "\n")
        try:
            return await original(app, scope, receive, response)
        finally:
            output.write(json.dumps({"event": "native-request-end", "id": request_id, "endAt": time.time() * 1000,
                "durationMs": (time.perf_counter() - start) * 1000, "status": status}) + "\n")

    Starlette.__call__ = observed


class MetadataStream:
    def __init__(self, stream):
        self.stream = stream
        self.pending = ""

    def write(self, text):
        self.pending += text
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            match = re.search(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^ ?"]+)(?:\?[^ "]*)? HTTP/1\.1" (\d{3})', line)
            if match:
                method, path, status = match.groups()
                path = re.sub(r"/(banks|bodies|parts|operations|snapshots|commits)/[^/]+", r"/\1/{id}", path)
                self.stream.write(json.dumps({"event": "native-access", "at": time.time() * 1000,
                    "method": method, "path": path, "status": int(status)}) + "\n")
            elif "consolidation" in line.lower() and "completed" in line.lower():
                self.stream.write(json.dumps({"event": "native-consolidation-completed", "at": time.time() * 1000}) + "\n")
        return len(text)

    def flush(self):
        self.stream.flush()

    def isatty(self):
        return False

    @property
    def encoding(self):
        return "utf-8"


if __name__ == "__main__":
    instrument_requests(sys.stdout)
    sys.stdout = MetadataStream(sys.stdout)
    sys.stderr = MetadataStream(sys.stderr)
    original = Path(__file__).resolve().parents[3] / "archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py"
    runpy.run_path(str(original), run_name="__main__")
