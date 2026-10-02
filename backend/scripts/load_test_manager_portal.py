#!/usr/bin/env python3
"""In-process load test for manager portal (uses ASGI app directly)."""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time

import httpx
from httpx import ASGITransport

from app.api.auth import AuthenticatedUser, get_authenticated_user
from app.main import app

MANAGER = AuthenticatedUser(
    id="00000000-0000-4000-8000-000000000001",
    email="loadtest@example.com",
    role="manager",
)


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((pct / 100) * (len(ordered) - 1)))))
    return ordered[index]


async def _one_manager_session(
    client: httpx.AsyncClient,
    *,
    manager_index: int,
    search_query: str,
) -> dict:
    started = time.perf_counter()
    errors: list[str] = []
    latencies: list[float] = []

    summary_started = time.perf_counter()
    summary = await client.get("/api/manager/requests/summary")
    latencies.append((time.perf_counter() - summary_started) * 1000)
    if summary.status_code != 200:
        errors.append(f"summary HTTP {summary.status_code}")

    search_started = time.perf_counter()
    search = await client.get(
        "/api/manager/persons/search",
        params={"q": search_query, "limit": 25},
    )
    latencies.append((time.perf_counter() - search_started) * 1000)
    if search.status_code != 200:
        errors.append(f"search HTTP {search.status_code}")

    return {
        "managerIndex": manager_index,
        "ok": not errors,
        "errors": errors,
        "totalMs": (time.perf_counter() - started) * 1000,
        "latenciesMs": latencies,
    }


async def run_load_test(*, managers: int, search_query: str) -> int:
    app.dependency_overrides[get_authenticated_user] = lambda: MANAGER

    print("In-process load test (ASGI app, manager auth overridden)")
    print(f"Simulating {managers} managers at once")
    print("Each manager: GET /api/manager/requests/summary + GET /api/manager/persons/search")
    print()

    started = time.perf_counter()
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        results = await asyncio.gather(
            *[
                _one_manager_session(
                    client,
                    manager_index=i + 1,
                    search_query=search_query,
                )
                for i in range(managers)
            ]
        )

    app.dependency_overrides.clear()
    elapsed = time.perf_counter() - started

    ok = [row for row in results if row["ok"]]
    failed = [row for row in results if not row["ok"]]
    all_latencies = [ms for row in results for ms in row["latenciesMs"]]

    print(f"Finished in {elapsed:.2f}s")
    print(f"Success: {len(ok)}/{len(results)}")
    print(f"Failed: {len(failed)}")
    if failed:
        for row in failed[:5]:
            print(f"  manager {row['managerIndex']}: {', '.join(row['errors'])}")
        if len(failed) > 5:
            print(f"  … and {len(failed) - 5} more")

    if all_latencies:
        print()
        print("Latency (ms) per request:")
        print(f"  p50: {_percentile(all_latencies, 50):.0f}")
        print(f"  p95: {_percentile(all_latencies, 95):.0f}")
        print(f"  max: {max(all_latencies):.0f}")
        print(f"  mean: {statistics.mean(all_latencies):.0f}")

    print()
    if len(ok) == len(results):
        print("PASS — all manager sessions completed.")
        return 0
    print("FAIL — some manager sessions errored or timed out.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="In-process manager portal load test.")
    parser.add_argument("--managers", type=int, default=50)
    parser.add_argument("--search-query", default="test")
    args = parser.parse_args()
    return asyncio.run(
        run_load_test(
            managers=args.managers,
            search_query=args.search_query,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
