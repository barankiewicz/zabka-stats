#!/bin/bash
set -eo pipefail

# SCRIPT_DIR is deploy/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting daily ETL run in $PROJECT_DIR..."
cd "$PROJECT_DIR"

# Load environment variables if env file exists
if [ -f .env ]; then
    source .env
fi

# 1. Update codebase
git pull --ff-only

# 2. Update Python dependencies
source venv/bin/activate
pip install -r requirements.txt

# 3. Stop backend to release DuckDB lock (single-writer)
sudo systemctl stop zabka-backend.service

# 4. Run ETL
LOG_FILE="/tmp/daily_etl.log"
echo "Running ETL..." > "$LOG_FILE"
if python -m backend.daily_etl >> "$LOG_FILE" 2>&1; then
    ETL_STATUS="success"
    echo "ETL completed successfully." >> "$LOG_FILE"
else
    ETL_STATUS="failure"
    echo "ETL failed." >> "$LOG_FILE"
fi

# 5. Nightly DuckDB backup
DB_FILE="data/zabka.duckdb"
BACKUP_DIR="data/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/zabka_$(date +%F_%H-%M-%S).duckdb.gz"

if [ -f "$DB_FILE" ]; then
    echo "Creating DuckDB backup..." >> "$LOG_FILE"
    gzip -c "$DB_FILE" > "$BACKUP_FILE"
    echo "Backup saved to $BACKUP_FILE." >> "$LOG_FILE"
    # Retain only the last 7 daily backups
    find "$BACKUP_DIR" -name "*.duckdb.gz" -mtime +7 -delete
    
    # If off-box SCP target is configured, copy the backup there
    if [ -n "$BACKUP_OFFBOX_TARGET" ]; then
        echo "Copying backup off-box to $BACKUP_OFFBOX_TARGET..." >> "$LOG_FILE"
        scp -i /home/zabka/.ssh/id_backup "$BACKUP_FILE" "$BACKUP_OFFBOX_TARGET" >> "$LOG_FILE" 2>&1 || echo "Warning: Off-box copy failed" >> "$LOG_FILE"
    fi
else
    echo "Warning: DuckDB file not found, skipping backup." >> "$LOG_FILE"
fi

# 6. Restart backend
sudo systemctl start zabka-backend.service

# 7. Warm the Redis cache
echo "Warming cache..." >> "$LOG_FILE"
python -m backend.warm_cache >> "$LOG_FILE" 2>&1 || echo "Warning: Cache warming failed" >> "$LOG_FILE"

# 8. Email status via Resend API
if [ -n "$RESEND_API_KEY" ] && [ -n "$MAIL_TO" ]; then
    echo "Sending status email..."
    SUBJECT="Zabka ETL: $ETL_STATUS ($(date -u +%F))"
    BODY="$(tail -c 6000 "$LOG_FILE" 2>/dev/null || echo 'No log available')"
    
    # Build payload using jq to handle formatting safely
    PAYLOAD=$(jq -n \
        --arg from "${MAIL_FROM:-onboarding@resend.dev}" \
        --arg to "$MAIL_TO" \
        --arg subject "$SUBJECT" \
        --arg text "$BODY" \
        '{from: $from, to: [$to], subject: $subject, text: $text}')
        
    curl -sS -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" > /dev/null || echo "Warning: Failed to send email via Resend"
fi

if [ "$ETL_STATUS" = "failure" ]; then
    exit 1
fi
