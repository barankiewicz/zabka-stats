"""
Entry point for running the Żabka Dashboard backend.

Usage:
  python -m zabka-dashboard.backend.main  (from parent dir if installed as package)
  python backend/main.py                   (from project root)

Or set PYTHONPATH and run:
  export PYTHONPATH=/home/alice/zabka-dashboard:$PYTHONPATH
  python backend/main.py
"""

import sys
import os

# Add project root to path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# Now import and run
if __name__ == "__main__":
    import uvicorn
    from backend.main import app

    uvicorn.run(app, host="0.0.0.0", port=8000)
