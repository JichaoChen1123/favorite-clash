"""Exercise real copy/SQLite/launcher writes with mocked service/install commands."""
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import json
import shutil

import httpx
import pytest

from app.store import Store
from scripts import migrate_project as migration


@pytest.fixture
def setup_migration(monkeypatch):
    directory = Path(__file__).resolve().parents[1] / '.cache/tests' / uuid4().hex
    source, target = directory / 'source', directory / 'target'
    source.mkdir(parents=True)
    (source / '.cache/whisper-models').mkdir(parents=True)
    (source / '.cache/whisper-models/model.bin').write_bytes(b'local-test-model')
    (source / '.runtime').mkdir()
    (source / 'requirements.lock.txt').write_text('')
    for name in migration.ENTRY_NAMES:
        (source / name).write_bytes(b'original launcher\r\n')
    store = Store(source / 'data/favorite-clash.sqlite3')
    store.create({'id':'saved-job', 'created_at':'2026-10-18', 'status':'completed'})
    store.pause_model('test quota pause')
    monkeypatch.setattr(migration, 'ROOT', source)
    monkeypatch.setattr(migration, 'TARGET', target)
    monkeypatch.setattr(migration, 'run', lambda *a, **k: None)
    monkeypatch.setattr(migration.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
    service = {'running': source, 'fail_target_start': False, 'calls': []}

    def idle():
        assert service['running'] in (None, source)
        return service['running'] == source, ['saved-job']

    def script(root, name, *args):
        service['calls'].append((root, name))
        if name == 'stop.ps1':
            service['running'] = None
        else:
            if root == target and service['fail_target_start']:
                raise RuntimeError('simulated startup failure')
            service['running'] = root
            (root / '.runtime/server.json').write_text(json.dumps({'project_root':str(root), 'data_dir':str(root / 'data')}))

    def get_json(path):
        if service['running'] is None:
            raise httpx.ConnectError('simulated stopped service')
        if path.endswith('jobs'):
            return {'items':[{'id':'saved-job'}]}
        return {'app':'favorite-clash', 'model_paused':True}

    monkeypatch.setattr(migration, 'idle_service', idle)
    monkeypatch.setattr(migration, 'script', script)
    monkeypatch.setattr(migration, 'get_json', get_json)
    yield source, target, service
    # Test-owned path is resolved and contained in this project's test directory.
    assert directory.resolve().is_relative_to(Path(__file__).resolve().parents[1] / '.cache/tests')
    shutil.rmtree(directory)


def test_copy_keeps_history_pause_and_forwards_launchers(setup_migration):
    source, target, service = setup_migration
    migration.migrate()
    assert migration.database_snapshot(source / 'data/favorite-clash.sqlite3') == migration.database_snapshot(target / 'data/favorite-clash.sqlite3')
    assert service['running'] == target
    assert str(target) in (source / migration.ENTRY_NAMES[0]).read_text(encoding='utf-8')
    assert (target / migration.ENTRY_NAMES[0]).read_bytes() == b'original launcher\r\n'


def test_report_disk_failure_does_not_skip_service_recovery(setup_migration, monkeypatch):
    source, target, service = setup_migration
    service['fail_target_start'] = True
    real_write = migration.write_json

    def write(path, value):
        if value.get('status') == 'failed':
            raise OSError('simulated disk full')
        real_write(path, value)

    monkeypatch.setattr(migration, 'write_json', write)
    with pytest.raises(RuntimeError, match='startup failure'):
        migration.migrate()
    assert service['running'] == source
    assert service['calls'][-1] == (source, 'start.ps1')


def test_partial_launcher_failure_restores_all_changed_entries(setup_migration, monkeypatch):
    source, target, service = setup_migration
    real_atomic = migration.atomic_bytes

    def atomic(path, value):
        if path == source / migration.ENTRY_NAMES[2] and b'Project migrated' in value:
            raise OSError('simulated launcher failure')
        real_atomic(path, value)

    monkeypatch.setattr(migration, 'atomic_bytes', atomic)
    with pytest.raises(OSError, match='launcher failure'):
        migration.migrate()
    assert service['running'] == source
    assert all((source / name).read_bytes() == b'original launcher\r\n' for name in migration.ENTRY_NAMES)


def test_existing_target_is_not_overwritten(setup_migration):
    source, target, service = setup_migration
    target.mkdir()
    (target / 'user-data').write_bytes(b'keep')
    with pytest.raises(RuntimeError, match='已存在'):
        migration.migrate()
    assert (target / 'user-data').read_bytes() == b'keep'
    assert not service['calls']
