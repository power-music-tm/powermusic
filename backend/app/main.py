import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import models
from app.database import DatabaseConnectionError, get_db, verify_database_connection, engine
from app.api.auth import auth_router
from app.api.routers import pilot1, pilot2
from app.pilot2 import scheduler

_is_production = bool(os.getenv("VERCEL")) or os.getenv("ENVIRONMENT", "").lower() == "production"

# Best-effort: creates missing tables in dev. Skipped on Vercel — the tables
# already exist in production (managed by Alembic), and running create_all on
# every serverless cold start opens an extra DB connection that competes for
# Supabase's session-pooler client budget, contributing to exhaustion under a
# burst of cold starts. Must never crash the app at import time.
if not os.getenv("VERCEL"):
    try:
        models.Base.metadata.create_all(bind=engine)
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: skipping create_all — database not reachable at startup: {exc}")

app = FastAPI(
    title="Power Music MVP API",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)


@app.exception_handler(DatabaseConnectionError)
async def database_connection_error_handler(_request, exc: DatabaseConnectionError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(OperationalError)
async def database_operational_error_handler(_request, exc: OperationalError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "Database connection failed. On Vercel, set DATABASE_URL to your "
                "Supabase session pooler URI with a URL-encoded password (e.g. @ → %40)."
            )
        },
    )

origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "https://power-music-mock.vercel.app",
]
# Extra allowed frontend origins for deployment, comma-separated.
# e.g. EXTRA_CORS_ORIGINS=https://powermusic-app.vercel.app,https://ops.powermusic.com
origins += [o.strip() for o in os.getenv("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        verify_database_connection(db)
    except DatabaseConnectionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok", "database": "connected"}

app.include_router(auth_router)
app.include_router(pilot1.router)
app.include_router(pilot2.router)


@app.on_event("startup")
def start_background_jobs():
    scheduler.start()
    # Recover backfills interrupted by a restart; a stuck "running" status
    # would otherwise block history sync (new mail) for that inbox forever.
    #
    # Skipped on Vercel: serverless has no long-lived process to own backfills
    # (the scheduler is disabled there), and running this on every cold start
    # opens an extra DB connection that competes for Supabase's session-pooler
    # client budget. Backfill recovery on serverless is driven by the poll cron.
    if os.getenv("VERCEL"):
        return
    try:
        from app.pilot2 import sync

        sync.resume_interrupted_backfills()
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: could not resume interrupted backfills: {exc}")


@app.on_event("shutdown")
def stop_background_jobs():
    scheduler.shutdown()
