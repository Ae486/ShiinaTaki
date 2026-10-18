"""INPUT: fixed configuration digest and independent protected owner-control requests.
OUTPUT: one startup, LiveGrant, fixed fake child and original-process observation.
POS: C2a fixture entrypoint; never starts a provider or treats credentials as authority.
"""

from __future__ import annotations

import os
import signal
import sys
import threading
from pathlib import Path

from .bootstrap import Bootstrap, LiveGrant
from .fake_consumer import DATA_DIRECTORY, C2FakeConsumer
from .owner_protocol import parse_owner_request
from .protocol import Reason, Refusal, ResolvedCredentials, Status
from .supervision import OwnedChild
from .unix_socket import RUNTIME_DIRECTORY, require_linux, serve


class C2BootstrapOwner:
    def __init__(self, configuration_digest: str, data_directory: Path = DATA_DIRECTORY) -> None:
        # Bootstrap owns its startup UUID. The consumer captures that UUID only
        # after construction; caller JSON cannot replace it on authorization.
        self.bootstrap = Bootstrap(configuration_digest, self._consume)
        self.consumer = C2FakeConsumer(self.bootstrap.startup_id, data_directory)

    def _consume(self, credentials: ResolvedCredentials) -> OwnedChild:
        return self.consumer(credentials)

    def control(self, payload: bytes) -> Status:
        request = parse_owner_request(payload)
        if request.permit is not None:
            self.bootstrap.authorize(LiveGrant(request.permit.binding, request.permit.selection))
        return self.bootstrap.status()

    def close(self) -> Status:
        return self.bootstrap.close()


def main() -> int:
    from .control import serve_control

    try:
        if len(sys.argv) != 1:
            raise Refusal(Reason.DENIED)
        require_linux()
        owner = C2BootstrapOwner(os.environ.get("TAKI_C2A_CONFIGURATION_DIGEST", ""))
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        control = threading.Thread(target=serve_control, args=(owner, stop, RUNTIME_DIRECTORY), daemon=True)
        control.start()
        try:
            serve(owner.bootstrap, stop)
        finally:
            stop.set()
            control.join(timeout=2)
            owner.close()
        return 0
    except Exception:
        return 1  # No exception or environment value reaches container logs.


if __name__ == "__main__":
    raise SystemExit(main())
