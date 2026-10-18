"""Strict private C1b framing and safe status, independent of hindsight_api.

Only a separately installed live grant can authorize a frame. These wire values
are never a grant, a command, a provider configuration, or a public secret API.
"""

from __future__ import annotations

import json
import re
import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import BinaryIO, Literal, cast

PRIVATE_BYTES = 4 * 1024 * 1024
STATUS_BYTES = 16 * 1024
VALUE_CODE_UNITS = 65_536
# A Unicode scalar uses at most three UTF-8 bytes per UTF-16 code unit.
VALUE_BYTES = 3 * VALUE_CODE_UNITS
ADMISSION_SECONDS = 90.0
SHUTDOWN_SECONDS = 30.0


class Reason(StrEnum):
    DENIED = "denied"
    OVERSIZE = "input-oversize"
    STALE = "snapshot-stale"
    UNKNOWN = "outcome-unknown"
    LOCKED = "custody-locked"
    HOST = "host-unavailable"
    APPROVAL = "approval-required"
    UNSAFE = "unsafe-installation"
    UNSUPPORTED = "unsupported-installation"


class Refusal(Exception):
    """Only closed reasons cross process boundaries; never wrap a raw error."""

    def __init__(self, reason: Reason) -> None:
        super().__init__(reason.value)
        self.reason = reason


class Slot(StrEnum):
    CONNECTION = "connectionApiKey"
    DEFAULT = "defaultModelApiKey"
    RETAIN = "retainModelApiKey"
    REFLECT = "reflectModelApiKey"
    CONSOLIDATION = "consolidationModelApiKey"
    EMBEDDING = "embeddingApiKey"
    RERANKER = "rerankerApiKey"


Source = Literal["catalog", "inherit-default", "unused"]
State = Literal["waiting-for-credentials", "running", "stopped", "unavailable"]
_INHERITABLE = frozenset({Slot.RETAIN, Slot.REFLECT, Slot.CONSOLIDATION})
_OPTIONAL = _INHERITABLE | {Slot.EMBEDDING, Slot.RERANKER}
_UUID = re.compile(
    r"(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)"
)
_SHA256 = re.compile(r"[a-f0-9]{64}")
_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")


def uuid_string(value: object) -> str:
    if not isinstance(value, str) or len(value) != 36 or not _UUID.fullmatch(value.lower()):
        raise Refusal(Reason.DENIED)
    return value


def digest_string(value: object) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise Refusal(Reason.DENIED)
    return value


def timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP.fullmatch(value):
        raise Refusal(Reason.DENIED)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        raise Refusal(Reason.DENIED) from None


@dataclass(frozen=True)
class Binding:
    startup_id: str
    configuration_digest: str
    operation_id: str
    attempt_id: str
    authorization_id: str
    deadline_at: str

    def __post_init__(self) -> None:
        for identity in (self.startup_id, self.operation_id, self.attempt_id, self.authorization_id):
            uuid_string(identity)
        digest_string(self.configuration_digest)
        timestamp(self.deadline_at)


@dataclass(frozen=True)
class Selection:
    slot: Slot
    source: Source


@dataclass(frozen=True)
class FixedSelection:
    entries: tuple[Selection, ...]


@dataclass(frozen=True)
class Credential:
    slot: Slot
    source: Source
    value: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class ResolvedCredential:
    slot: Slot
    value: str = field(repr=False)


@dataclass(frozen=True)
class ResolvedCredentials:
    entries: tuple[ResolvedCredential, ...] = field(repr=False)


@dataclass(frozen=True)
class PrivateFrame:
    binding: Binding
    credentials: tuple[Credential, ...] = field(repr=False)

    def selection(self) -> FixedSelection:
        return FixedSelection(tuple(Selection(entry.slot, entry.source) for entry in self.credentials))

    def resolve(self) -> ResolvedCredentials:
        # No provider-to-environment mapping lives here. C1b's consumer is a
        # test-only fixed seven-slot process; Native model application is C3.
        values = {entry.slot: entry.value for entry in self.credentials if entry.source == "catalog"}
        resolved: list[ResolvedCredential] = []
        for entry in self.credentials:
            if entry.source == "unused":
                continue
            value = values[Slot.DEFAULT] if entry.source == "inherit-default" else entry.value
            if value is None:
                raise Refusal(Reason.LOCKED)
            resolved.append(ResolvedCredential(entry.slot, value))
        return ResolvedCredentials(tuple(resolved))


@dataclass(frozen=True)
class Status:
    state: State
    startup_id: str
    configuration_digest: str
    binding: Binding | None = None
    reason: Reason | None = None


@dataclass(frozen=True)
class _JsonObject:
    # This map is still untrusted, schema-unknown JSON. Structured data becomes
    # typed dataclasses immediately after the exact-key checks below.
    members: dict[str, object]

    def keys(self, required: set[str]) -> None:
        if set(self.members) != required:
            raise Refusal(Reason.DENIED)

    def member(self, name: str) -> object:
        return self.members[name]


def _pairs(pairs: list[tuple[str, object]]) -> _JsonObject:
    result: dict[str, object] = {}
    for name, value in pairs:
        if name in result:
            raise Refusal(Reason.DENIED)
        result[name] = value
    return _JsonObject(result)


def _constant(_value: str) -> object:
    raise Refusal(Reason.DENIED)


def _json(payload: bytes, limit: int) -> _JsonObject:
    if len(payload) > limit:
        raise Refusal(Reason.OVERSIZE)
    try:
        value: object = json.loads(
            payload.decode("utf-8", "strict"), object_pairs_hook=_pairs, parse_constant=_constant
        )
    except (ValueError, UnicodeError, RecursionError):
        raise Refusal(Reason.DENIED) from None
    if not isinstance(value, _JsonObject):
        raise Refusal(Reason.DENIED)
    return value


_BINDING_KEYS = {"startupId", "configurationDigest", "operationId", "attemptId", "authorizationId", "deadlineAt"}


def _binding(value: _JsonObject) -> Binding:
    deadline = value.member("deadlineAt")
    timestamp(deadline)
    if not isinstance(deadline, str):
        raise Refusal(Reason.DENIED)
    return Binding(
        uuid_string(value.member("startupId")),
        digest_string(value.member("configurationDigest")),
        uuid_string(value.member("operationId")),
        uuid_string(value.member("attemptId")),
        uuid_string(value.member("authorizationId")),
        deadline,
    )


def _credential(value: object) -> Credential:
    if not isinstance(value, _JsonObject):
        raise Refusal(Reason.DENIED)
    if "source" not in value.members or "slot" not in value.members:
        raise Refusal(Reason.DENIED)
    source = value.member("source")
    try:
        slot = Slot(value.member("slot"))
    except (ValueError, TypeError):
        raise Refusal(Reason.DENIED) from None
    if source == "catalog":
        value.keys({"slot", "source", "value"})
        return Credential(slot, "catalog", _checked_value(value.member("value")))
    value.keys({"slot", "source"})
    if source == "inherit-default" and slot in _INHERITABLE:
        return Credential(slot, "inherit-default")
    if source == "unused" and slot in _OPTIONAL:
        return Credential(slot, "unused")
    raise Refusal(Reason.DENIED)


def _checked_value(secret: object) -> str:
    if not isinstance(secret, str) or not secret or "\x00" in secret:
        raise Refusal(Reason.DENIED)
    # Bound code points before allocating encoded copies. UTF-16 units may be
    # larger for astral scalars; both wire limits still apply before JSON output.
    if len(secret) > VALUE_CODE_UNITS:
        raise Refusal(Reason.OVERSIZE)
    try:
        if (
            len(secret.encode("utf-16-le", "strict")) // 2 > VALUE_CODE_UNITS
            or len(secret.encode("utf-8", "strict")) > VALUE_BYTES
        ):
            raise Refusal(Reason.OVERSIZE)
    except UnicodeError:
        raise Refusal(Reason.DENIED) from None
    return secret


def parse_private(payload: bytes) -> PrivateFrame:
    value = _json(payload, PRIVATE_BYTES)
    value.keys(_BINDING_KEYS | {"version", "credentials"})
    if type(value.member("version")) is not int or value.member("version") != 1:
        raise Refusal(Reason.DENIED)
    entries = value.member("credentials")
    if not isinstance(entries, list) or not 1 <= len(entries) <= len(Slot):
        raise Refusal(Reason.DENIED)
    credentials = tuple(_credential(entry) for entry in entries)
    if len({entry.slot for entry in credentials}) != len(credentials):
        raise Refusal(Reason.DENIED)
    if any(entry.source == "inherit-default" for entry in credentials) and not any(
        entry.slot == Slot.DEFAULT and entry.source == "catalog" for entry in credentials
    ):
        raise Refusal(Reason.DENIED)
    return PrivateFrame(_binding(value), credentials)


def _exact(stream: BinaryIO, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        part = stream.read(min(16 * 1024, size - len(data)))
        if not part:
            raise Refusal(Reason.DENIED)
        data.extend(part)
    return bytes(data)


def read_packet(stream: BinaryIO, limit: int, *, eof: bool) -> bytes:
    size = struct.unpack("<I", _exact(stream, 4))[0]
    if size > limit:
        raise Refusal(Reason.OVERSIZE)
    payload = _exact(stream, size)
    if eof and stream.read(1):
        raise Refusal(Reason.DENIED)
    return payload


def packet(payload: bytes, limit: int = PRIVATE_BYTES) -> bytes:
    if len(payload) > limit:
        raise Refusal(Reason.OVERSIZE)
    return struct.pack("<I", len(payload)) + payload


def encode_private(frame: PrivateFrame) -> bytes:
    if not 1 <= len(frame.credentials) <= len(Slot):
        raise Refusal(Reason.DENIED)
    for entry in frame.credentials:
        if entry.source == "catalog":
            _checked_value(entry.value)
    binding = frame.binding
    payload = json.dumps(
        {
            "version": 1,
            "startupId": binding.startup_id,
            "configurationDigest": binding.configuration_digest,
            "operationId": binding.operation_id,
            "attemptId": binding.attempt_id,
            "authorizationId": binding.authorization_id,
            "deadlineAt": binding.deadline_at,
            "credentials": [
                {
                    "slot": entry.slot,
                    "source": entry.source,
                    **({"value": entry.value} if entry.source == "catalog" else {}),
                }
                for entry in frame.credentials
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8", "strict")
    parse_private(payload)
    return payload


def encode_status(status: Status) -> bytes:
    # Do not serialize exception objects, child output, credential objects, or
    # arbitrary adapter metadata, even on a failed write or a lost reply.
    value = {
        "version": 1,
        "state": status.state,
        "startupId": status.startup_id,
        "configurationDigest": status.configuration_digest,
        "deploymentReady": False,
    }
    if status.binding is not None:
        value.update(
            {
                "operationId": status.binding.operation_id,
                "attemptId": status.binding.attempt_id,
                "authorizationId": status.binding.authorization_id,
                "deadlineAt": status.binding.deadline_at,
            }
        )
    if status.reason is not None:
        value["reason"] = status.reason.value
    payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
    parse_status(payload)
    return payload


def parse_status(payload: bytes) -> Status:
    value = _json(payload, STATUS_BYTES)
    required = {"version", "state", "startupId", "configurationDigest", "deploymentReady"}
    if "operationId" in value.members:
        required |= _BINDING_KEYS
    if "reason" in value.members:
        required.add("reason")
    value.keys(required)
    if (
        type(value.member("version")) is not int
        or value.member("version") != 1
        or value.member("deploymentReady") is not False
    ):
        raise Refusal(Reason.DENIED)
    state = value.member("state")
    if state not in ("waiting-for-credentials", "running", "stopped", "unavailable"):
        raise Refusal(Reason.DENIED)
    if not isinstance(state, str):
        raise Refusal(Reason.DENIED)
    reason = None
    if "reason" in value.members:
        try:
            reason = Reason(value.member("reason"))
        except (TypeError, ValueError):
            raise Refusal(Reason.DENIED) from None
    if (state == "unavailable") != (reason is not None):
        raise Refusal(Reason.DENIED)
    return Status(
        cast(State, state),
        uuid_string(value.member("startupId")),
        digest_string(value.member("configurationDigest")),
        _binding(value) if "operationId" in value.members else None,
        reason,
    )
