import os
import sys

# Ensure backend directory is in sys.path so app.* imports resolve on Vercel
current_dir = os.path.dirname(os.path.abspath(__file__))
repo_root = os.path.dirname(current_dir)
backend_dir = os.path.join(repo_root, "backend")

if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

try:
    import dotenv
    dotenv.load_dotenv(os.path.join(backend_dir, ".env"))
    dotenv.load_dotenv(os.path.join(repo_root, ".env"))
except Exception:
    pass

from app.main import app  # noqa: E402, F401
