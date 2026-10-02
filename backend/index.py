"""Vercel serverless entrypoint. Exposes the FastAPI ASGI app.

On Vercel the function's working directory is the repo root, so backend/
must be added to sys.path for the `app.*` package imports to resolve.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app  # noqa: E402, F401
