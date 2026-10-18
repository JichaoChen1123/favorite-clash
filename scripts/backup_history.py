"""Consistent, verified SQLite history backup; safe while the app is running."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def fingerprint(connection: sqlite3.Connection) -> dict:
    result = {}
    for table, ordering in [('jobs', 'id'), ('runs', 'id'), ('traces', 'id'), ('settings', 'key')]:
        rows = connection.execute(f'SELECT * FROM "{table}" ORDER BY "{ordering}"').fetchall()
        encoded = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256(encoded).hexdigest()}
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exercise_favorites'").fetchone():
        rows = connection.execute('SELECT * FROM exercise_favorites ORDER BY exercise_id').fetchall()
        encoded = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        result['exercise_favorites'] = {'rows': len(rows), 'sha256': hashlib.sha256(encoded).hexdigest()}
    return result


def backup_history(source: Path, destination_root: Path) -> dict:
    source = source.resolve(strict=True)
    destination_root = destination_root.resolve()
    directory = destination_root / (datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=False)
    destination = directory / 'favorite-clash.sqlite3'
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=10)) as original:
            # Pin the snapshot before hashing, including databases with a live WAL.
            original.execute('BEGIN')
            before = fingerprint(original)
            with closing(sqlite3.connect(destination)) as copied:
                original.backup(copied)
                copied.commit()
            original.rollback()
        with closing(sqlite3.connect(destination.as_uri() + '?mode=ro', uri=True)) as copied:
            integrity = copied.execute('PRAGMA integrity_check').fetchone()[0]
            after = fingerprint(copied)
        if integrity != 'ok' or before != after:
            raise RuntimeError('备份校验未通过，未将该副本标记为可用。')
        report = {'status': 'verified', 'created_at': datetime.now(timezone.utc).isoformat(),
                  'database': str(destination), 'integrity': integrity, 'tables': after,
                  'includes': '历史、字幕、结果、反馈、模型运行记录、额度暂停状态及动作收藏（若已创建）',
                  'excludes': '音视频缓存、转写模型、程序环境及账号凭据'}
    except Exception:
        (directory / 'backup-report.json').write_text(json.dumps({'status': 'failed'}, indent=2), encoding='utf-8')
        raise
    (directory / 'backup-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


def main() -> int:
    try:
        report = backup_history(ROOT / 'data' / 'favorite-clash.sqlite3', ROOT / 'backups')
    except (OSError, sqlite3.Error, RuntimeError):
        print('备份未完成。请检查 W 盘空间、数据文件和 backups 中的报告；原历史没有被修改。')
        return 1
    print(f"备份完成并通过完整性校验：{report['database']}")
    print(f"保存 {report['tables']['jobs']['rows']} 条历史及全部运行记录；额度暂停状态一并保留。")
    print('不包含音视频缓存、程序环境或账号凭据。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
