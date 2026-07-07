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
#   PUBLIC_URL  public URL to smoke-test            (default: https://zabkozbior.barankiewicz.dev)
#   BRANCH      branch to push/pull                 (default: current branch)
#
# Usage:
#   deploy/deploy.sh            # full deploy
#   ALLOW_DIRTY=1 deploy/deploy.sh   # build/ship the working tree even if uncommitted (skips push)

set -euo pipefail

SSH_HOST="${SSH_HOST:-zabka-vps}"
REMOTE_DIR="${REMOTE_DIR:-/home/zabka/zabka-stats}"
SERVICE="${SERVICE:-zabka-backend}"
PUBLIC_URL="${PUBLIC_URL:-https://zabkozbior.barankiewicz.dev}"
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
  say "ALLOW_DIRTY=1 - skipping git push, shipping working-tree build only"
else
  say "Pushing $BRANCH to origin"
  git push origin "$BRANCH"
fi

# --- 4. pull on the VPS -----------------------------------------------------
say "Pulling on $SSH_HOST"
# NB: send git's chatter to stderr so stdout carries ONLY the yes/no signal.
REQ_CHANGED=$(ssh "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR'
  OLD=\$(git rev-parse HEAD)
  git pull --ff-only 1>&2
  NEW=\$(git rev-parse HEAD)
  if git diff --name-only \"\$OLD\" \"\$NEW\" | grep -q '^requirements.txt$'; then echo yes; else echo no; fi
")
echo "requirements.txt changed: $REQ_CHANGED"

# --- 5. refresh python deps only if needed ----------------------------------
if [ "$REQ_CHANGED" = "yes" ]; then
  say "requirements.txt changed - refreshing venv on $SSH_HOST"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && venv/bin/pip install -q -r requirements.txt"
fi

# --- 6. ship the built dist (tar over SSH; server has no rsync) --------------
say "Shipping frontend/dist to $SSH_HOST"
# --exclude '*.map': keep sourcemaps local only - no point shipping ~5 MB and
# exposing unminified source on the server (Vite uses 'hidden' so browsers never
# fetch them anyway).
#
# Atomic swap: extract into a timestamped releases/ dir, then flip the 'dist'
# symlink with a single mv -Tf (rename(2), atomic). The old 'rm -rf dist && tar
# xzf -' left a window where the running backend served 404s for every asset,
# and a mid-extract failure left a broken dist with no rollback. Now a failed
# extract never touches the live 'dist', and old releases are pruned (keep 3).
( cd frontend && tar czf - --exclude='*.map' dist ) | ssh "$SSH_HOST" "
  set -e
  cd '$REMOTE_DIR/frontend'
  REL=\"releases/\$(date +%s)\"
  mkdir -p \"\$REL\"
  tar xzf - -C \"\$REL\" --strip-components=1   # extract dist/* into \$REL
  # First run only: 'dist' is still a real directory, not a symlink. You can't
  # mv a symlink over a non-empty dir, so drop it once to bootstrap the scheme.
  if [ -e dist ] && [ ! -L dist ]; then rm -rf dist; fi
  ln -sfn \"\$REL\" dist.tmp
  mv -Tf dist.tmp dist                          # atomic symlink replace (rename(2))
  ls -1dt releases/*/ | tail -n +4 | xargs -r rm -rf   # keep the last 3 releases
"

# --- 6b. sync large geo data files (gitignored, must be kept in sync manually) --
# These files are too big / too static to live in git, so we compare checksums
# and only ship what changed. data/geo/*.geojson and *.json.
GEO_FILES=(
  data/geo/gminy.geojson
  data/geo/gmina_pop.json
  data/geo/miasta_pl.json
  data/geo/administrative_division_gus.json
  data/geo/amphibians_pl.json
)
NEED_SYNC=()
for f in "${GEO_FILES[@]}"; do
  [ -f "$ROOT/$f" ] || continue
  LOCAL_MD5=$(md5sum "$ROOT/$f" | cut -d' ' -f1)
  REMOTE_MD5=$(ssh "$SSH_HOST" "md5sum '$REMOTE_DIR/$f' 2>/dev/null | cut -d' ' -f1" || true)
  if [ "$LOCAL_MD5" != "$REMOTE_MD5" ]; then
    NEED_SYNC+=("$f")
  fi
done
if [ ${#NEED_SYNC[@]} -gt 0 ]; then
  say "Syncing geo files: ${NEED_SYNC[*]}"
  tar czf - "${NEED_SYNC[@]}" | ssh "$SSH_HOST" "cd '$REMOTE_DIR' && tar xzf -"
else
  say "Geo files up to date, skipping"
fi

# --- 7. restart the backend -------------------------------------------------
say "Restarting $SERVICE"
# SECURITY TIP: To minimize privilege escalation risks if SSH keys are compromised,
# do NOT grant the deployment user passwordless sudo for all commands.
# Instead, add a rule to /etc/sudoers.d/zabka-deploy on the VPS allowing only:
#   YOUR_SSH_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart zabka-backend
ssh "$SSH_HOST" "sudo -n systemctl restart '$SERVICE'"
sleep 4

# --- 8. verify --------------------------------------------------------------
say "Verifying"
ACTIVE=$(ssh "$SSH_HOST" "systemctl is-active '$SERVICE'" || true)
echo "service: $ACTIVE"
LOOPBACK=$(ssh "$SSH_HOST" "curl -s http://127.0.0.1:8000/health" || true)
echo "loopback health: $LOOPBACK"
PUBLIC_BUNDLE=$(curl -s "$PUBLIC_URL/" | grep -o 'assets/[A-Za-z0-9_-]*\.js' | head -1 || true)
echo "public bundle: $PUBLIC_BUNDLE"
LOCAL_BUNDLE=$(grep -o 'assets/[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1 || true)
echo "local bundle:  $LOCAL_BUNDLE"

if [ "$ACTIVE" = "active" ] && [ "$PUBLIC_BUNDLE" = "$LOCAL_BUNDLE" ] && [ -n "$PUBLIC_BUNDLE" ]; then
  say "Deploy OK - $PUBLIC_URL is serving $PUBLIC_BUNDLE"
else
  echo "" >&2
  echo "WARNING: deploy finished but verification did not fully match." >&2
  echo "Check the service logs: ssh $SSH_HOST 'sudo journalctl -u $SERVICE -n 50'" >&2
  exit 1
fi
