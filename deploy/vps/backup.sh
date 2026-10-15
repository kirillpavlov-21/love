#!/usr/bin/env bash
# Ежедневная копия базы: снимок на ходу (VACUUM INTO), хранится 14 дней в /opt/kuda-backups.
# Если задан RCLONE_REMOTE (например «s3backup:kuda»), копия уходит ещё и к другому провайдеру в другом регионе.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${BACKUP_DIR:-/opt/kuda-backups}"
mkdir -p "$OUT"
docker compose exec -T api node -e "
const fs = require('node:fs'); const { DatabaseSync } = require('node:sqlite');
fs.rmSync('/data/backup.db', { force: true });
new DatabaseSync('/data/kuda.db').exec(\"VACUUM INTO '/data/backup.db'\");"
FILE="$OUT/kuda-$(date +%F).db"
docker compose cp api:/data/backup.db "$FILE"
chmod 600 "$FILE"
find "$OUT" -name 'kuda-*.db' -mtime +14 -delete
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$FILE" "$RCLONE_REMOTE" --quiet
fi
echo "backup: $FILE"
