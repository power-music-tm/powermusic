"""Unit tests for manager_requests tag helpers."""

from app.manager_request_tags import (
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
    is_awaiting_manager_submission,
    is_visible_in_new_requests,
)


class TestManagerRequestTags:
    def test_verified_partner_request_is_visible(self):
        tags = [TAG_VERIFIED, TAG_PARTNER_REQUEST]
        assert is_visible_in_new_requests(tags)
        assert not is_awaiting_manager_submission(tags)

    def test_unverified_auto_mail_is_visible_and_awaiting(self):
        tags = [TAG_UNVERIFIED, TAG_AUTO_MAIL]
        assert is_visible_in_new_requests(tags)
        assert is_awaiting_manager_submission(tags)

    def test_verified_auto_mail_partner_not_awaiting(self):
        tags = [TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_AUTO_MAIL]
        assert is_visible_in_new_requests(tags)
        assert not is_awaiting_manager_submission(tags)

    def test_unverified_without_auto_mail_hidden(self):
        tags = [TAG_UNVERIFIED]
        assert not is_visible_in_new_requests(tags)
        assert not is_awaiting_manager_submission(tags)
