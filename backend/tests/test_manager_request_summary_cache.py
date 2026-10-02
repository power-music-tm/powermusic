"""Tests for manager request summary cache."""

from app.manager_request_summary_cache import (
    SUMMARY_CACHE_TTL_SECONDS,
    get_manager_request_summary,
    invalidate_manager_request_summary,
    set_manager_request_summary,
)


def test_summary_cache_round_trip():
    manager_id = "mgr-test-1"
    invalidate_manager_request_summary(manager_id)

    assert get_manager_request_summary(manager_id) is None

    set_manager_request_summary(manager_id, total=5, pending_count=2)
    cached = get_manager_request_summary(manager_id)
    assert cached == {"total": 5, "pendingCount": 2}


def test_summary_cache_invalidate():
    manager_id = "mgr-test-2"
    set_manager_request_summary(manager_id, total=1, pending_count=0)
    invalidate_manager_request_summary(manager_id)
    assert get_manager_request_summary(manager_id) is None


def test_summary_cache_ttl_configured():
    assert SUMMARY_CACHE_TTL_SECONDS >= 10
