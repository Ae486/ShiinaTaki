"""Validate one safe native access result against its requested exact source."""

from .contracts import BridgeError, canonical_video_url, uuid_text, validate


def validate_media_access(value: dict, instance: str, video_url: str) -> None:
    validate("probe", value)
    source, access = value["source"], value["access"]
    if (value["service_instance_id"] != instance or uuid_text(value["service_instance_id"]) != instance
            or source["canonical_url"] != video_url
            or source["canonical_url"] != f"https://www.bilibili.com/video/{source['bvid']}?p={source['page']}"):
        raise BridgeError("native_binding_mismatch")
    if (canonical_video_url(source["canonical_url"]) != video_url or not value["title"].strip()
            or type(source["page"]) is not int or type(access["byte_length"]) is not int
            or type(access["checked_at"]) is not int):
        raise BridgeError("native_response_invalid")
