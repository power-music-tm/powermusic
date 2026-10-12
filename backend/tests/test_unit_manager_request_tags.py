"""Unit tests: manager_request_tags normalize / merge / visibility."""

from __future__ import annotations

import json

import pytest

from app.manager_request_tags import (
    ALLOWED_TAGS,
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
    has_tag,
    is_awaiting_manager_submission,
    is_visible_in_new_requests,
    merge_tags,
    normalize_tags,
)


class TestNormalizeTags:
    def test_dedupes_and_orders(self):
        tags = normalize_tags([TAG_AUTO_MAIL, TAG_VERIFIED, TAG_AUTO_MAIL, TAG_PARTNER_REQUEST])
        assert tags == [TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_AUTO_MAIL]

    def test_drops_unknown(self):
        assert normalize_tags(["evil", TAG_VERIFIED, "nope"]) == [TAG_VERIFIED]

    def test_parses_json_string(self):
        payload = json.dumps([TAG_UNVERIFIED, TAG_AUTO_MAIL])
        assert normalize_tags(payload) == [TAG_UNVERIFIED, TAG_AUTO_MAIL]

    def test_parses_double_encoded_json(self):
        payload = json.dumps(json.dumps([TAG_VERIFIED]))
        assert normalize_tags(payload) == [TAG_VERIFIED]

    def test_empty_inputs(self):
        assert normalize_tags(None) == []
        assert normalize_tags([]) == []
        assert normalize_tags("") == []


class TestMergeAndHasTag:
    def test_merge_combines_groups(self):
        assert merge_tags([TAG_VERIFIED], [TAG_PARTNER_REQUEST, "junk"]) == [
            TAG_VERIFIED,
            TAG_PARTNER_REQUEST,
        ]

    def test_has_tag(self):
        assert has_tag([TAG_VERIFIED], TAG_VERIFIED) is True
        assert has_tag([TAG_VERIFIED], TAG_AUTO_MAIL) is False
        assert has_tag(None, TAG_VERIFIED) is False


class TestVisibilityRules:
    def test_awaiting_manager_submission(self):
        assert is_awaiting_manager_submission([TAG_UNVERIFIED, TAG_AUTO_MAIL]) is True
        assert (
            is_awaiting_manager_submission(
                [TAG_UNVERIFIED, TAG_AUTO_MAIL, TAG_PARTNER_REQUEST]
            )
            is False
        )
        assert is_awaiting_manager_submission([TAG_AUTO_MAIL]) is False

    def test_visible_in_new_requests(self):
        assert is_visible_in_new_requests([TAG_VERIFIED]) is True
        assert is_visible_in_new_requests([TAG_UNVERIFIED, TAG_AUTO_MAIL]) is True
        assert is_visible_in_new_requests([TAG_ALREADY_EXISTS]) is False

    def test_allowed_tags_frozen(self):
        assert TAG_VERIFIED in ALLOWED_TAGS
        assert "random" not in ALLOWED_TAGS
