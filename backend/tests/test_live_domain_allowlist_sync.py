"""Unit and regression tests for live manager email domain allowlist enforcement."""

import uuid
from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException

from app import models
from app.partner_allowlists import (
    assert_manager_email_allowed,
    email_matches_manager_domains,
    list_manager_domain_strings,
    normalize_manager_domain,
)


def test_normalize_manager_domain():
    assert normalize_manager_domain("nu.edu.pk") == "nu.edu.pk"
    assert normalize_manager_domain("@nu.edu.pk") == "nu.edu.pk"
    assert normalize_manager_domain("JDGYMS.CO.UK ") == "jdgyms.co.uk"


def test_email_matches_manager_domains():
    domains = ["@jdgyms.co.uk", "@nu.edu.pk"]
    assert email_matches_manager_domains("i222336@nu.edu.pk", domains) is True
    assert email_matches_manager_domains("manager@jdgyms.co.uk", domains) is True
    assert email_matches_manager_domains("manager@puregym.com", domains) is False
    assert email_matches_manager_domains("fake-nu.edu.pk@evil.com", domains) is False


def test_assert_manager_email_allowed_accepts_when_domain_in_partner_allowlist():
    mock_db = MagicMock()
    partner_id = "partner-002"

    domain_row = models.ManagerAllowedDomain(
        id=uuid.uuid4(),
        partner_id=partner_id,
        domain="@nu.edu.pk",
    )
    mock_query = mock_db.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_order = mock_filter.order_by.return_value
    mock_order.all.return_value = [domain_row]

    # Mock partner lookup
    partner_row = models.Partner(id=partner_id, name="JD Gyms")
    mock_filter.first.return_value = partner_row

    with patch("app.partner_allowlists.list_manager_domain_strings", return_value=["@nu.edu.pk"]), \
         patch("app.partner_allowlists.resolve_partner_for_manager_email", return_value=partner_id):
        resolved = assert_manager_email_allowed(
            mock_db,
            "i222336@nu.edu.pk",
            partner_id=partner_id,
        )
        assert resolved == partner_id


def test_assert_manager_email_allowed_rejects_disallowed_domain():
    mock_db = MagicMock()
    partner_id = "partner-002"

    with patch("app.partner_allowlists.list_manager_domain_strings", return_value=["@jdgyms.co.uk"]):
        with pytest.raises(HTTPException) as exc_info:
            assert_manager_email_allowed(
                mock_db,
                "i222336@nu.edu.pk",
                partner_id=partner_id,
            )
        assert exc_info.value.status_code == 403
        assert "Manager accounts must use an allowed partner domain" in exc_info.value.detail


def test_domain_allowed_for_one_partner_rejected_for_another():
    mock_db = MagicMock()
    partner_jd = "partner-002"
    partner_puregym = "partner-001"

    # Nu.edu.pk is allowed for JD Gyms only
    def mock_list_domains(db, partner_id=None):
        if partner_id == partner_jd:
            return ["@jdgyms.co.uk", "@nu.edu.pk"]
        elif partner_id == partner_puregym:
            return ["@puregym.com"]
        return ["@jdgyms.co.uk", "@nu.edu.pk", "@puregym.com"]

    with patch("app.partner_allowlists.list_manager_domain_strings", side_effect=mock_list_domains), \
         patch("app.partner_allowlists.resolve_partner_for_manager_email", return_value=partner_jd):
        # Allowed for JD Gyms
        resolved = assert_manager_email_allowed(mock_db, "i222336@nu.edu.pk", partner_id=partner_jd)
        assert resolved == partner_jd

        # Rejected for PureGym
        with pytest.raises(HTTPException) as exc_info:
            assert_manager_email_allowed(mock_db, "i222336@nu.edu.pk", partner_id=partner_puregym)
        assert exc_info.value.status_code == 403
