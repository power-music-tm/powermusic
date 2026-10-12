"""Unit tests: manager_request_serialize note/tag helpers (no DB)."""

from __future__ import annotations

import json

from app.manager_request_serialize import (
    _looks_like_automated_notes,
    _looks_like_seed_notes,
    _needs_review,
    _parse_tags,
    _split_manager_and_automated_notes,
)
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
    TAG_VERIFIED,
)


class TestNotesClassification:
    def test_automated_prefixes(self):
        assert _looks_like_automated_notes("Automated roster email\nHi") is True
        assert _looks_like_automated_notes("Automated PureGym email from x") is True
        assert _looks_like_automated_notes("Manager typed this") is False
        assert _looks_like_automated_notes("") is False

    def test_seed(self):
        assert _looks_like_seed_notes("Seed: demo") is True
        assert _looks_like_seed_notes("not seed") is False


class TestSplitNotes:
    def test_empty_and_seed(self):
        assert _split_manager_and_automated_notes(None) == (None, "")
        assert _split_manager_and_automated_notes("Seed: x") == (None, "")

    def test_auto_only(self):
        text = "Automated roster email\nSubject: Add"
        assert _split_manager_and_automated_notes(text) == (None, text)

    def test_mixed_blocks(self):
        raw = "Please check\n\nAutomated roster email\nBody\n\nSeed: drop me"
        manager, auto = _split_manager_and_automated_notes(raw)
        assert manager == "Please check"
        assert auto.startswith("Automated roster email")


class TestParseTagsAndReview:
    def test_parse_list_and_json(self):
        assert _parse_tags(None) == []
        assert _parse_tags([TAG_VERIFIED, "x"]) == [TAG_VERIFIED, "x"]
        assert _parse_tags(json.dumps([TAG_VERIFIED])) == [TAG_VERIFIED]
        assert _parse_tags(json.dumps(json.dumps([TAG_VERIFIED]))) == [TAG_VERIFIED]
        assert _parse_tags("plain-tag") == ["plain-tag"]

    def test_needs_review(self):
        assert _needs_review([TAG_VERIFIED]) is False
        assert _needs_review([TAG_ALREADY_EXISTS]) is True
        assert _needs_review([TAG_CONFIRMED_DUPLICATE]) is True
        assert _needs_review([TAG_POTENTIAL_DUPLICATE]) is True
        assert _needs_review([], duplicate_group_id="grp-1") is True
