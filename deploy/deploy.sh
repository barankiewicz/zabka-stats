#!/usr/bin/env bash
#
# deploy.sh - push local commits to GitHub, then roll them out on the OVH VPS.
#
# Why this exists: the VPS deploys by `git pull`, but it has no node/npm, so it
# cannot build the Vite frontend itself. We build frontend/dist/ here and ship it
# over (dist is gitignored, never committed). The server also has no rsync, so the
# bundle travels as a tar piped over SSH.
#
# Flow:
#   1. refuse to run on a dirty tree (the shipped dist must match what is in git)
#   2. build the frontend locally (npm run build)
#   3. push the current branch to origin
#   4. on the VPS: git pull --ff-only
#   5. if requirements.txt changed in that pull, refresh the venv
#   6. ship frontend/dist/ to the VPS (tar over SSH)
#   7. restart the backend service
#   8. verify the loopback health check and the public HTTPS endpoint
#
# Config (override via env vars):
#   SSH_HOST    SSH alias/host for the VPS          (default: zabka-vps)
#   REMOTE_DIR  repo path on the VPS                (default: /home/zabka/zabka-stats)
#   SERVICE     systemd unit name                   (default: zabka-backend)
#   PUBLIC_URL  public URL to smoke-test            (default: https://zabka-stats.rejewska.pl)
#   BRANCH      branch to push/pull                 (default: current branch)
#
# Usage:
#   deploy/deploy.sh            # full deploy
#   ALLOW_DIRTY=1 deploy/deploy.sh   # build/ship the working tree even if uncommitted (skips push)

set -euo pipefail

SSH_HOST="${SSH_HOST:-zabka-vps}"
REMOTE_DIR="${REMOTE_DIR:-/home/zabka/zabka-stats}"
SERVICE="${SERVICE:-zabka-backend}"
PUBLIC_URL="${PUBLIC_URL:-https://zabka-stats.rejewska.pl}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

# resolve project root (this script lives in deploy/)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

say() { printf '\n=== %s\n' "$1"; }

# --- 1. clean tree check ----------------------------------------------------
if [ "$ALLOW_DIRTY" != "1" ] && [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree has uncommitted changes." >&2
  echo "Commit them first (so the shipped build matches git), or set ALLOW_DIRTY=1." >&2
  git status --short >&2
  exit 1
fi

# --- 2. build frontend locally ----------------------------------------------
say "Building frontend (npm run build)"
npm run build

# --- 3. push to origin ------------------------------------------------------
if [ "$ALLOW_DIRTY" = "1" ]; then
  say "ALLOW_DIRTY=1 — skipping git push, shipping working-tree build only"
else
  say "Pushing $BRANCH to origin"
  git push origin "$BRANCH"
fi

# --- 4. pull on the VPS -----------------------------------------------------
say "Pulling on $SSH_HOST"
REQ_CHANGED=$(ssh "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR'
  OLD=\$(git rev-parse HEAD)
  git pull --ff-only
  NEW=\$(git rev-parse HEAD)
  if git diff --name-only \"\$OLD\" \"\$NEW\" | grep -q '^requirements.txt$'; then echo yes; else echo no; fi
")
echo "requirements.txt changed: $REQ_CHANGED"

# --- 5. refresh python deps only if needed ----------------------------------
if [ "$REQ_CHANGED" = "yes" ]; then
  say "requirements.txt changed — refreshing venv on $SSH_HOST"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && venv/bin/pip install -q -r requirements.txt"
fi

# --- 6. ship the built dist (tar over SSH; server has no rsync) --------------
say "Shipping frontend/dist to $SSH_HOST"
( cd frontend && tar czf - dist ) | ssh "$SSH_HOST" "cd '$REMOTE_DIR/frontend' && rm -rf dist && tar xzf -"

# --- 7. restart the backend -------------------------------------------------
say "Restarting $SERVICE"
ssh "$SSH_HOST" "sudo -n systemctl restart '$SERVICE'"
sleep 4

# --- 8. verify --------------------------------------------------------------
say "Verifying"
ACTIVE=$(ssh "$SSH_HOST" "systemctl is-active '$SERVICE'" || true)
echo "service: $ACTIVE"
LOOPBACK=$(ssh "$SSH_HOST" "curl -s http://127.0.0.1:8000/health" || true)
echo "loopback health: $LOOPBACK"
PUBLIC_BUNDLE=$(curl -s "$PUBLIC_URL/" | grep -o 'index-[A-Za-z0-9_]*\.js' | head -1 || true)
echo "public bundle: $PUBLIC_BUNDLE"
LOCAL_BUNDLE=$(grep -o 'index-[A-Za-z0-9_]*\.js' frontend/dist/index.html | head -1 || true)
echo "local bundle:  $LOCAL_BUNDLE"

if [ "$ACTIVE" = "active" ] && [ "$PUBLIC_BUNDLE" = "$LOCAL_BUNDLE" ] && [ -n "$PUBLIC_BUNDLE" ]; then
  say "Deploy OK — $PUBLIC_URL is serving $PUBLIC_BUNDLE"
else
  echo "" >&2
  echo "WARNING: deploy finished but verification did not fully match." >&2
  echo "Check the service logs: ssh $SSH_HOST 'sudo journalctl -u $SERVICE -n 50'" >&2
  exit 1
fi
