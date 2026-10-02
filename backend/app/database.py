import os
import socket
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

load_dotenv()


class DatabaseConnectionError(Exception):
    """Raised when the database cannot be reached."""


def _force_ipv4(url: str) -> str:
    """Pin the connection to the host's IPv4 address via psycopg's hostaddr.

    Some hosts (e.g. Vercel serverless) cannot open outbound IPv6 sockets,
    while Supabase hostnames often resolve to IPv6 first — connections then
    fail with 'Cannot assign requested address'. TLS still validates against
    the hostname. No-op if the host has no IPv4 or is already pinned.
    """
    try:
        parsed = urlparse(url)
        if not parsed.hostname or "hostaddr=" in (parsed.query or ""):
            return url
        infos = socket.getaddrinfo(
            parsed.hostname, parsed.port or 5432, socket.AF_INET, socket.SOCK_STREAM
        )
        ipv4 = infos[0][4][0]
        separator = "&" if parsed.query else "?"
        return f"{url}{separator}hostaddr={ipv4}"
    except (socket.gaierror, OSError, IndexError):
        return url


def _ensure_sslmode(url: str) -> str:
    """Supabase requires TLS; ensure sslmode is set for remote hosts."""
    parsed = urlparse(url)
    if not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1"}:
        return url
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "sslmode" not in params:
        params["sslmode"] = "require"
    return urlunparse(parsed._replace(query=urlencode(params)))


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise DatabaseConnectionError(
            "DATABASE_URL environment variable is not set. "
            "Add it to backend/.env (see python-dotenv)."
        )

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    url = _force_ipv4(url)
    return _ensure_sslmode(url)


def _is_network_unreachable(error: Exception) -> bool:
    message = str(error).lower()
    network_markers = (
        "could not translate host name",
        "name or service not known",
        "temporary failure in name resolution",
        "nodename nor servname provided",
        "network is unreachable",
        "connection refused",
        "timeout expired",
        "timed out",
    )
    if any(marker in message for marker in network_markers):
        return True

    cause = getattr(error, "__cause__", None)
    if isinstance(cause, (socket.gaierror, OSError, TimeoutError)):
        return True
    return False


def create_db_engine():
    try:
        kwargs = {}
        db_url = get_database_url()
        # Disable psycopg server-side prepared statements. They are unsafe
        # against a transaction-mode pooler (Supabase Supavisor / PgBouncer on
        # port 6543): a prepared statement created on one pooled backend may not
        # exist on the next, raising "prepared statement does not exist". This is
        # the recommended setting for transaction pooling and is harmless (tiny
        # perf cost) on direct / session-mode connections, so we set it always.
        #
        # connect_timeout caps how long a new connection may block. With NullPool
        # (serverless) every request opens a fresh connection, so a pooler hiccup
        # could otherwise hang the whole 60s function → 504. Fail fast instead so
        # the request errors quickly and the dashboard's next poll/refetch
        # succeeds rather than the user seeing a 60s stall.
        if db_url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            kwargs["connect_args"] = {
                "prepare_threshold": None,
                "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
            }
            if os.getenv("VERCEL"):
                if os.getenv("DB_SERVERLESS_PERSISTENT_POOL", "").lower() in ("1", "true", "yes"):
                    kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "1"))
                    kwargs["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW", "2"))
                    kwargs["pool_pre_ping"] = True
                    kwargs["pool_recycle"] = int(os.getenv("DB_POOL_RECYCLE", "280"))
                else:
                    kwargs["poolclass"] = NullPool
            else:
                kwargs["pool_pre_ping"] = True
                kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "8"))
                kwargs["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW", "12"))
                kwargs["pool_timeout"] = int(os.getenv("DB_POOL_TIMEOUT", "30"))
                kwargs["pool_recycle"] = int(os.getenv("DB_POOL_RECYCLE", "300"))
        return create_engine(db_url, **kwargs)
    except Exception as exc:
        if _is_network_unreachable(exc):
            host = urlparse(os.getenv("DATABASE_URL", "")).hostname or "unknown"
            raise DatabaseConnectionError(
                f"Cannot reach PostgreSQL host '{host}' (DNS or network error). "
                "Supabase direct connections often resolve to IPv6 only; if IPv6 is "
                "unavailable on your network, use the session pooler connection string "
                "from the Supabase dashboard (Connect → Session pooler) in DATABASE_URL."
            ) from exc
        raise


engine = create_db_engine()
# expire_on_commit=False: committing mid-request (e.g. to release the DB backend
# before a slow LLM call) must NOT expire already-loaded ORM objects, or the next
# attribute access would re-query per object. Lets us end the transaction during
# LLM calls without a reload storm.
SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, expire_on_commit=False, bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_database_connection(db) -> None:
    try:
        db.execute(text("SELECT 1"))
    except OperationalError as exc:
        if _is_network_unreachable(exc):
            host = urlparse(os.getenv("DATABASE_URL", "")).hostname or "unknown"
            raise DatabaseConnectionError(
                f"Cannot reach PostgreSQL host '{host}' (DNS or network error). "
                "Supabase direct connections often resolve to IPv6 only; if IPv6 is "
                "unavailable on your network, use the session pooler connection string "
                "from the Supabase dashboard (Connect → Session pooler) in DATABASE_URL."
            ) from exc
        raise DatabaseConnectionError(
            "Database connection failed. Check DATABASE_URL on Vercel. The password "
            "must be URL-encoded (e.g. @ → %40) and use the Supabase session pooler URI."
        ) from exc
