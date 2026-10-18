"""One-startup credential admission and owned fake-consumer supervision.

LiveGrant is supplied in-process by an independent owner, never decoded from
the credential frame. C2/C3 release admission and Native launch remain unwired.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

from .protocol import (
    ADMISSION_SECONDS,
    Binding,
    FixedSelection,
    PrivateFrame,
    Reason,
    Refusal,
    ResolvedCredentials,
    State,
    Status,
    digest_string,
    parse_private,
    timestamp,
)
from .supervision import OwnedChild


class LiveGrant:
    """Independent, revocable, exact-input grant for one original deadline."""

    def __init__(self, binding: Binding, selection: FixedSelection) -> None:
        self.binding = binding
        self.selection = selection
        self._revoked: Reason | None = None
        remaining = (timestamp(binding.deadline_at) - datetime.now(timezone.utc)).total_seconds()
        # Capture a monotonic bound once. Neither wall-clock rollback, another
        # submitter nor a late retransmission can extend the admitted budget.
        self._deadline = time.monotonic() + min(ADMISSION_SECONDS, max(0.0, remaining))

    def revoke(self, reason: Reason) -> None:
        self._revoked = reason

    def remaining(self) -> float:
        return max(
            0.0,
            min(
                self._deadline - time.monotonic(),
                (timestamp(self.binding.deadline_at) - datetime.now(timezone.utc)).total_seconds(),
            ),
        )

    def require_live(self) -> None:
        if self._revoked is not None:
            raise Refusal(self._revoked)
        if self.remaining() <= 0:
            raise Refusal(Reason.STALE)


class Bootstrap:
    def __init__(
        self, configuration_digest: str, consumer: Callable[[ResolvedCredentials], OwnedChild] | None = None
    ) -> None:
        self.startup_id = str(uuid.uuid4())
        self.configuration_digest = digest_string(configuration_digest)
        self._consumer = consumer
        self._grant: LiveGrant | None = None
        self._binding: Binding | None = None
        self._attempted = False
        self._closed = False
        self._reason: Reason | None = None
        self._child: OwnedChild | None = None
        self._lock = threading.RLock()

    def authorize(self, grant: LiveGrant) -> None:
        with self._lock:
            if self._closed or self._attempted or self._grant is not None:
                raise Refusal(Reason.DENIED)
            if (
                grant.binding.startup_id != self.startup_id
                or grant.binding.configuration_digest != self.configuration_digest
            ):
                raise Refusal(Reason.STALE)
            grant.require_live()
            self._grant = grant
            self._binding = grant.binding

    def invalidate(self, reason: Reason) -> None:
        with self._lock:
            if self._grant is not None:
                self._grant.revoke(reason)
            # Already running Native retains its credentials. Catalog rotation
            # is not instant revocation, and never authorizes another startup.
            if not self._attempted:
                self._reason = reason

    def remaining(self) -> float:
        return self._grant.remaining() if self._grant is not None else ADMISSION_SECONDS

    def _require_frame(self, frame: PrivateFrame) -> LiveGrant:
        if self._closed or self._attempted:
            raise Refusal(Reason.DENIED)
        grant = self._grant
        if grant is None or self._consumer is None:
            raise Refusal(Reason.APPROVAL)
        grant.require_live()
        if frame.binding != grant.binding or frame.selection() != grant.selection:
            raise Refusal(Reason.STALE)
        return grant

    def accept(self, payload: bytes) -> Status:
        frame = parse_private(payload)
        with self._lock:
            grant = self._require_frame(frame)
            credentials = frame.resolve()
            grant.require_live()
            # Fence before a possible OS effect. A throw/lost reply cannot make
            # this exact startup eligible for an automatic second injection.
            self._attempted = True
            try:
                consumer = self._consumer
                if consumer is None:
                    raise Refusal(Reason.APPROVAL)
                self._child = consumer(credentials)
                grant.require_live()
            except Exception:
                self._reason = Reason.UNKNOWN
                if self._child is not None:
                    self._child.stop()
                raise Refusal(Reason.UNKNOWN) from None
            finally:
                del credentials
            return self.status()

    def status(self) -> Status:
        with self._lock:
            state: State
            if self._grant is not None and not self._attempted and not self._closed:
                try:
                    self._grant.require_live()
                except Refusal as error:
                    self._reason = error.reason
            if self._reason is not None:
                state = "unavailable"
            elif self._child is not None and self._child.poll() is not None:
                if self._child.poll() != 0 and not self._closed:
                    self._reason = Reason.HOST
                    state = "unavailable"
                else:
                    state = "stopped"
            elif self._closed:
                state = "stopped"
            elif self._child is not None:
                state = "running"
            else:
                state = "waiting-for-credentials"
            return Status(state, self.startup_id, self.configuration_digest, self._binding, self._reason)

    def refusal(self, reason: Reason) -> Status:
        return Status("unavailable", self.startup_id, self.configuration_digest, self._binding, reason)

    def close(self) -> Status:
        with self._lock:
            self._closed = True
            if self._child is not None:
                try:
                    self._child.stop()
                except Exception:
                    self._reason = Reason.UNKNOWN
            return self.status()
