"""Unit tests: dashboard trend bucket granularity by calendar span (no DB)."""

from app.dashboard_insights import trend_granularity_for_span


class TestTrendGranularity:
    def test_short_ranges_are_daily(self):
        assert trend_granularity_for_span(1) == "daily"
        assert trend_granularity_for_span(7) == "daily"
        assert trend_granularity_for_span(30) == "daily"
        assert trend_granularity_for_span(35) == "daily"

    def test_medium_ranges_are_weekly(self):
        assert trend_granularity_for_span(36, 2) == "weekly"
        assert trend_granularity_for_span(60, 2) == "weekly"
        assert trend_granularity_for_span(90, 2) == "weekly"

    def test_three_calendar_months_are_monthly(self):
        # 12 May → 15 Jul 2026 is ~65 days across May/Jun/Jul
        assert trend_granularity_for_span(65, 3) == "monthly"
        assert trend_granularity_for_span(91, 3) == "monthly"
        assert trend_granularity_for_span(120, 4) == "monthly"

    def test_year_scale_is_monthly(self):
        assert trend_granularity_for_span(121, 5) == "monthly"
        assert trend_granularity_for_span(365, 12) == "monthly"
        assert trend_granularity_for_span(730, 24) == "yearly"

    def test_multi_year_custom_is_yearly(self):
        assert trend_granularity_for_span(731, 25) == "yearly"
        assert trend_granularity_for_span(2820, 94) == "yearly"
