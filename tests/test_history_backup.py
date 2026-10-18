from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
from uuid import uuid4

import pytest

from app.store import Store
from scripts.backup_history import backup_history, fingerprint


@pytest.fixture
def workspace():
    directory = Path(__file__).resolve().parents[1] / '.cache' / 'tests' / uuid4().hex
    directory.mkdir(parents=True)
    yield directory
    assert directory.resolve().is_relative_to(Path(__file__).resolve().parents[1] / '.cache' / 'tests')
    shutil.rmtree(directory)


def test_live_wal_backup_keeps_results_traces_and_quota_pause(workspace):
    source = workspace / 'history.sqlite3'
    store = Store(source)
    with closing(sqlite3.connect(source)) as writer:
        writer.execute('INSERT INTO jobs VALUES (?,?,?)', ('example', '2026-10-18', '{"question":"备份测试","result":{"text":"原文"}}'))
        writer.execute('INSERT INTO runs(job_id,started_at,status,snapshot,result) VALUES (?,?,?,?,?)', ('example', '2026-10-18', 'completed', '{}', '{"ok":true}'))
        run = writer.execute('SELECT id FROM runs').fetchone()[0]
        writer.execute('INSERT INTO traces(run_id,created_at,document) VALUES (?,?,?)', (run, '2026-10-18', '{"stage":"test"}'))
        writer.commit()
        store.pause_model('合成测试额度暂停，不得自动恢复')
        expected = fingerprint(writer)
        first = backup_history(source, workspace / 'backups')
        second = backup_history(source, workspace / 'backups')
        assert first['database'] != second['database']
        assert first['status'] == second['status'] == 'verified'
        assert first['tables'] == second['tables'] == expected
        assert fingerprint(writer) == expected
    for report in [first, second]:
        with closing(sqlite3.connect(report['database'])) as restored:
            assert restored.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert restored.execute("SELECT value FROM settings WHERE key='model_quota_pause'").fetchone()


def test_missing_source_does_not_create_empty_backup(workspace):
    with pytest.raises(FileNotFoundError):
        backup_history(workspace / 'missing.sqlite3', workspace / 'backups')
    assert not (workspace / 'backups').exists()
