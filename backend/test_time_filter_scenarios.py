"""Verify dashboard time filter calculations, granularity, and directory timestamp logic."""

import sys
from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.dashboard_insights import build_dashboard_insights
from app.api.routers.pilot1 import _visible_new_requests_query
from app.manager_request_serialize import requests_to_api_dicts

def test_all_scenarios():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending = _visible_new_requests_query(db).all()
        pending_payloads = requests_to_api_dicts(db, pending)

        print(f"Total visible pending requests: {len(pending)}")

        # 1. All Time
        all_time = build_dashboard_insights(
            db, pending=pending, pending_payloads=pending_payloads
        )
        print("\n--- 1. All Time ---")
        print(f"Granularity: {all_time['granularity']}")
        print(f"Handled in Period: {all_time['handledInPeriod']}")
        print(f"Received in Period: {all_time['receivedInPeriod']}")
        print(f"WeeklyTrend bucket count: {len(all_time['weeklyTrend'])}")
        assert all_time["handledInPeriod"] >= 8, f"Expected >= 8 handled, got {all_time['handledInPeriod']}"
        assert all_time["receivedInPeriod"] >= 11, f"Expected >= 11 received, got {all_time['receivedInPeriod']}"

        # 2. This Week (7 days)
        t_week_start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        this_week = build_dashboard_insights(
            db,
            pending=pending,
            pending_payloads=pending_payloads,
            start_date=t_week_start.isoformat(),
            end_date=now.isoformat(),
        )
        print("\n--- 2. This Week (7 days) ---")
        print(f"Granularity: {this_week['granularity']}")
        print(f"Handled in Period: {this_week['handledInPeriod']}")
        print(f"Received in Period: {this_week['receivedInPeriod']}")
        print(f"WeeklyTrend bucket count: {len(this_week['weeklyTrend'])}")
        assert this_week["granularity"] == "daily"
        assert len(this_week["weeklyTrend"]) == 7

        # 3. Last 30 Days (30 days)
        t_30_start = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
        last_30 = build_dashboard_insights(
            db,
            pending=pending,
            pending_payloads=pending_payloads,
            start_date=t_30_start.isoformat(),
            end_date=now.isoformat(),
        )
        print("\n--- 3. Last 30 Days (30 days) ---")
        print(f"Granularity: {last_30['granularity']}")
        print(f"WeeklyTrend bucket count: {len(last_30['weeklyTrend'])}")
        assert last_30["granularity"] == "daily"
        assert len(last_30["weeklyTrend"]) == 30

        # 4. Custom 60 Days
        t_60_start = (now - timedelta(days=59)).replace(hour=0, minute=0, second=0, microsecond=0)
        custom_60 = build_dashboard_insights(
            db,
            pending=pending,
            pending_payloads=pending_payloads,
            start_date=t_60_start.isoformat(),
            end_date=now.isoformat(),
        )
        print("\n--- 4. Custom 60 Days ---")
        print(f"Granularity: {custom_60['granularity']}")
        print(f"WeeklyTrend bucket count: {len(custom_60['weeklyTrend'])}")
        assert custom_60["granularity"] == "weekly"

        # 5. Full Year (365 days)
        t_year_start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        t_year_end = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        full_year = build_dashboard_insights(
            db,
            pending=pending,
            pending_payloads=pending_payloads,
            start_date=t_year_start.isoformat(),
            end_date=t_year_end.isoformat(),
        )
        print("\n--- 5. Full Year 2026 ---")
        print(f"Granularity: {full_year['granularity']}")
        print(f"WeeklyTrend bucket count: {len(full_year['weeklyTrend'])}")
        assert full_year["granularity"] == "monthly"
        assert len(full_year["weeklyTrend"]) == 12

        # 6. Multi-year (>730 days)
        t_multi_start = datetime(2023, 1, 1, tzinfo=timezone.utc)
        t_multi_end = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        multi_year = build_dashboard_insights(
            db,
            pending=pending,
            pending_payloads=pending_payloads,
            start_date=t_multi_start.isoformat(),
            end_date=t_multi_end.isoformat(),
        )
        print("\n--- 6. Multi Year (2023 - 2026) ---")
        print(f"Granularity: {multi_year['granularity']}")
        print(f"WeeklyTrend bucket count: {len(multi_year['weeklyTrend'])}")
        assert multi_year["granularity"] == "yearly"
        assert len(multi_year["weeklyTrend"]) == 4

        print("\nAll Backend Test Scenarios Passed Successfully!")
    finally:
        db.close()

if __name__ == "__main__":
    test_all_scenarios()
