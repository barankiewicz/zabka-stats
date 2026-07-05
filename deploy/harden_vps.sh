#!/bin/bash
# VPS hardening script for zabka-dashboard (OVH Debian, Warsaw).
# Run once as root (or with sudo) on the server.
# Before running: make a VPS snapshot in the OVH panel.
#
# What this does:
#   1. File descriptor limits (ulimit)
#   2. Kernel network tuning (sysctl)
#   3. Redis memory cap
#   4. Restarts the backend with updated systemd unit (multi-worker uvicorn)
#
# Nginx config is in a separate file: deploy/nginx_zabka.conf
# Apply it manually: see the comment at the bottom of this script.

set -euo pipefail

# --- 1. File descriptor limits -------------------------------------------
# Linux default is 1024 open files per process. Each HTTP connection is a file.
# At traffic spikes we need headroom.

LIMITS_CONF=/etc/security/limits.conf

if ! grep -q "zabka nofile" "$LIMITS_CONF" 2>/dev/null; then
    echo "Setting file descriptor limits..."
    cat >> "$LIMITS_CONF" << 'EOF'

# zabka-dashboard: high-traffic headroom
zabka    soft    nofile    65535
zabka    hard    nofile    65535
# also cover root and any other user just in case
*        soft    nofile    65535
*        hard    nofile    65535
EOF
fi

# Make sure pam_limits.so is loaded for non-interactive sessions (systemd uses this)
PAM_SESSION=/etc/pam.d/common-session
if ! grep -q "pam_limits.so" "$PAM_SESSION" 2>/dev/null; then
    echo "session required pam_limits.so" >> "$PAM_SESSION"
fi

# systemd services need their own limit - pam_limits.conf does not apply to them
SYSTEMD_OVERRIDE_DIR=/etc/systemd/system/zabka-backend.service.d
mkdir -p "$SYSTEMD_OVERRIDE_DIR"
cat > "$SYSTEMD_OVERRIDE_DIR/limits.conf" << 'EOF'
[Service]
LimitNOFILE=65535
EOF

echo "File descriptor limits: done."

# --- 2. Kernel network tuning (sysctl) ------------------------------------
SYSCTL_FILE=/etc/sysctl.d/99-zabka.conf

cat > "$SYSCTL_FILE" << 'EOF'
# zabka-dashboard: network tuning for traffic spikes

# Backlog queues - how many connections the kernel can queue before accept()
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Faster release of TIME_WAIT sockets - prevents port exhaustion under load
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1

# Keep-alive: detect dead connections faster
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
EOF

sysctl -p "$SYSCTL_FILE"
echo "Kernel sysctl: done."

# --- 3. Redis memory cap --------------------------------------------------
# Without maxmemory, Redis can eat all RAM and trigger the OOM killer.
# The VPS has 4 GB. We give Redis 1.5 GB; the rest goes to nginx + uvicorn workers.
# volatile-lru evicts only keys that have a TTL set (our cached API responses do).

REDIS_CONF=/etc/redis/redis.conf

if ! grep -q "^maxmemory " "$REDIS_CONF" 2>/dev/null; then
    echo "maxmemory 1500mb" >> "$REDIS_CONF"
    echo "maxmemory-policy volatile-lru" >> "$REDIS_CONF"
else
    sed -i 's/^maxmemory .*/maxmemory 1500mb/' "$REDIS_CONF"
    sed -i 's/^maxmemory-policy .*/maxmemory-policy volatile-lru/' "$REDIS_CONF"
fi

systemctl restart redis-server
echo "Redis memory cap: done."

# --- 4. Reload systemd and restart the backend with updated unit ----------
# The systemd unit itself is managed separately (it lives at
# /etc/systemd/system/zabka-backend.service on the VPS).
# Update the ExecStart line to use multi-worker uvicorn:
#
#   ExecStart=/home/zabka/venv/bin/uvicorn backend.main:app \
#       --host 127.0.0.1 --port 8000 \
#       --workers 4 \
#       --no-access-log
#
# Also add this to the [Service] section:
#   Environment=UVICORN_WORKERS=4
#
# After editing the unit file:
systemctl daemon-reload
systemctl restart zabka-backend
echo "Backend restarted."

# --- Nginx ----------------------------------------------------------------
# Nginx config is in deploy/nginx_zabka.conf - copy it manually:
#
#   sudo cp deploy/nginx_zabka.conf /etc/nginx/sites-available/zabka
#   sudo nginx -t && sudo systemctl reload nginx
#
echo ""
echo "Done. Apply nginx config separately:"
echo "  sudo cp deploy/nginx_zabka.conf /etc/nginx/sites-available/zabka"
echo "  sudo nginx -t && sudo systemctl reload nginx"
