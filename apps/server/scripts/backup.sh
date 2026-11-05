#!/usr/bin/env sh
# SQLite 备份：优先使用 sqlite3 .backup（WAL 模式下也能得到一致快照）。
# 用法：
#   DB_PATH=/data/megrez.db BACKUP_DIR=/backup sh backup.sh
set -eu

DB_PATH="${DB_PATH:-$(pwd)/data/megrez.db}"
BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/megrez-$STAMP.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "数据库不存在：$DB_PATH" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$TARGET'"
else
  # 没有 sqlite3 时退化为文件拷贝；建议尽量安装 sqlite3
  cp "$DB_PATH" "$TARGET"
fi

find "$BACKUP_DIR" -name 'megrez-*.db' -type f -mtime "+$RETAIN_DAYS" -delete
echo "已备份到 $TARGET"