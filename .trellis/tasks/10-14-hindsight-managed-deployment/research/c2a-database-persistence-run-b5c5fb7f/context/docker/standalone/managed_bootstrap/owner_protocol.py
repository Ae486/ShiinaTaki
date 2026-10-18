"""INPUT: bounded, non-secret owner-control JSON, separate from credential input.
OUTPUT: typed status request or exact one-startup permit and fixed selection.
POS: managed_bootstrap C2a control boundary; parsing alone confers no authority.
"""

from __future__ import annotations

from dataclasses import dataclass

from .protocol import (
    _BINDING_KEYS,
    Binding,
    FixedSelection,
    Reason,
    Refusal,
    Selection,
    Slot,
    _binding,
    _json,
    _JsonObject,
    uuid_string,
)

CONTROL_BYTES = 32 * 1024


@dataclass(frozen=True)
class StartupPermit:
    checkpoint_id: str
    binding: Binding
    selection: FixedSelection


@dataclass(frozen=True)
class OwnerRequest:
    permit: StartupPermit | None = None


def parse_owner_request(payload: bytes) -> OwnerRequest:
    value = _json(payload, CONTROL_BYTES)
    if value.members.get("action") == "status":
        value.keys({"version", "action"})
    else:
        value.keys({"version", "action", "permit"})
        if value.member("action") != "authorize":
            raise Refusal(Reason.DENIED)
    if type(value.member("version")) is not int or value.member("version") != 1:
        raise Refusal(Reason.DENIED)
    if value.member("action") == "status":
        return OwnerRequest()
    permit = value.member("permit")
    if not isinstance(permit, _JsonObject):
        raise Refusal(Reason.DENIED)
    permit.keys({"version", "checkpointId", "binding", "selection"})
    if type(permit.member("version")) is not int or permit.member("version") != 1:
        raise Refusal(Reason.DENIED)
    binding = permit.member("binding")
    if not isinstance(binding, _JsonObject):
        raise Refusal(Reason.DENIED)
    binding.keys(_BINDING_KEYS)
    return OwnerRequest(
        StartupPermit(
            uuid_string(permit.member("checkpointId")), _binding(binding), _selection(permit.member("selection"))
        )
    )


def _selection(value: object) -> FixedSelection:
    if not isinstance(value, list) or not 1 <= len(value) <= len(Slot):
        raise Refusal(Reason.DENIED)
    entries: list[Selection] = []
    inherited = {Slot.RETAIN, Slot.REFLECT, Slot.CONSOLIDATION}
    for item in value:
        if not isinstance(item, _JsonObject):
            raise Refusal(Reason.DENIED)
        item.keys({"slot", "source"})
        try:
            slot = Slot(item.member("slot"))
        except (TypeError, ValueError):
            raise Refusal(Reason.DENIED) from None
        source = item.member("source")
        if source == "catalog":
            entries.append(Selection(slot, "catalog"))
        elif source == "inherit-default" and slot in inherited:
            entries.append(Selection(slot, "inherit-default"))
        elif source == "unused" and slot in inherited | {Slot.EMBEDDING, Slot.RERANKER}:
            entries.append(Selection(slot, "unused"))
        else:
            raise Refusal(Reason.DENIED)
    if len({entry.slot for entry in entries}) != len(entries) or (
        any(entry.source == "inherit-default" for entry in entries)
        and Selection(Slot.DEFAULT, "catalog") not in entries
    ):
        raise Refusal(Reason.DENIED)
    return FixedSelection(tuple(entries))
