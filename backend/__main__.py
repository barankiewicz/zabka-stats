"""
Entry point for running the backend as a module.

Usage:
  python -m backend
"""

import os
import sys

# Add project root to path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if __name__ == "__main__":
    import uvicorn

    from backend.main import app

    uvicorn.run(app, host="0.0.0.0", port=8000)
