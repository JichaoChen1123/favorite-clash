from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app import main
from app.store import Store
from scripts.backup_history import backup_history


@pytest.fixture
def exercise_client(monkeypatch):
    directory = Path(__file__).resolve().parents[1] / '.cache' / 'tests' / uuid4().hex
    directory.mkdir(parents=True)
    monkeypatch.setattr(main, 'DATA', directory)
    with TestClient(main.app) as client:
        yield client, directory
    shutil.rmtree(directory)


def test_catalog_has_real_sources_and_valid_muscle_mappings(exercise_client):
    client, _ = exercise_client
    catalog = client.get('/api/exercises').json()
    ids = [item['id'] for item in catalog['items']]
    assert len(ids) == len(set(ids)) == 16
    original_ids = {'kneeling-pushup','dumbbell-chest-press','machine-chest-press','dumbbell-bent-row','lat-pulldown','seated-cable-row','bodyweight-squat','dumbbell-squat','seated-leg-curl','dumbbell-calf-raise'}
    assert original_ids <= set(ids)  # Saved IDs remain valid after catalog expansion.
    muscle_ids = {'chest','shoulders','biceps','triceps','forearms','abs','lats','upper-back','glutes','quads','hamstrings','inner-thigh','calves'}
    assert {muscle for item in catalog['items'] for muscle in item['primary']} == muscle_ids
    for item in catalog['items']:
        assert re.fullmatch('[a-z0-9-]+', item['id'])
        assert item['primary'] and set(item['primary'] + item['secondary']) <= muscle_ids
        assert not set(item['primary']) & set(item['secondary'])
        assert item['equipment'] in {'bodyweight','dumbbell','machine'}
        assert len(item['steps']) >= 3 and len(item['mistakes']) >= 2
        source = urlsplit(item['source']['url'])
        assert source.scheme == 'https'
        if item['source']['publisher'] == 'Mayo Clinic':
            assert source.netloc == 'www.mayoclinic.org'
            assert 'Video:' in item['source']['title'] and '/vid-' in source.path
        elif item['source']['publisher'] == 'ACE':
            assert source.netloc == 'www.acefitness.org'
            assert source.path in {'/resources/everyone/exercise-library/26/lateral-raise/', '/resources/everyone/exercise-library/30/wrist-curl-flexion/'}
        else:
            assert item['source']['publisher'] == 'Life Fitness'
            assert source.netloc == 'www.lifefitness.com.au' and source.path.endswith('.pdf')
            assert source.fragment == 'page=9'
        teaching = item['teaching']
        video = urlsplit(teaching['url'])
        assert video.scheme == 'https' and video.netloc == 'www.bilibili.com'
        assert teaching['author'] and teaching['title'] and teaching['duration'] > 0
        assert video.query == f"p={teaching['page']}"
    assert {item['category'] for item in catalog['items']} == {'胸部','背部','腿部','肩部','手臂','核心'}
    calf = next(item for item in catalog['items'] if item['id'] == 'dumbbell-calf-raise')
    assert calf['teaching']['page'] == 8 and '提踵' in calf['teaching']['part_title']
    inner = next(item for item in catalog['items'] if item['id'] == 'machine-hip-adduction')
    assert inner['teaching']['page'] == 55 and '内收' in inner['teaching']['part_title']
    wrist = next(item for item in catalog['items'] if item['id'] == 'dumbbell-wrist-curl')
    assert '膝' in wrist['teaching']['scope'] and '凳' in wrist['teaching']['scope']


def test_favorites_idempotency_persistence_and_isolation(exercise_client):
    client, directory = exercise_client
    assert client.get('/api/exercise-favorites').json() == {'items': []}
    for _ in range(2):
        assert client.put('/api/exercise-favorites/kneeling-pushup').status_code == 200
    saved = client.get('/api/exercise-favorites').json()['items']
    assert len(saved) == 1 and saved[0]['exercise_id'] == 'kneeling-pushup'
    store = Store(directory / 'favorite-clash.sqlite3')
    assert store.exercise_favorites() == saved  # Reopen the same database.
    assert store.list() == []
    assert client.put('/api/exercise-favorites/dumbbell-wrist-curl').status_code == 200
    assert client.delete('/api/exercise-favorites/dumbbell-wrist-curl').status_code == 200
    assert store.exercise_favorites() == saved
    store.pause_model('test-only quota pause')
    assert client.put('/api/exercise-favorites/lat-pulldown').status_code == 200
    assert store.model_pause()['reason'] == 'test-only quota pause'
    assert len(client.get('/api/exercise-favorites').json()['items']) == 2
    for _ in range(2):
        assert client.delete('/api/exercise-favorites/kneeling-pushup').status_code == 200
    assert [x['exercise_id'] for x in store.exercise_favorites()] == ['lat-pulldown']


def test_unknown_id_and_cross_origin_do_not_modify_favorites(exercise_client):
    client, _ = exercise_client
    for method in (client.put, client.delete):
        assert method('/api/exercise-favorites/not-a-real-exercise').status_code == 404
        assert method('/api/exercise-favorites/kneeling-pushup', headers={'Origin':'https://other.example'}).status_code == 403
    assert client.get('/api/exercise-favorites').json()['items'] == []


def test_verified_backup_includes_favorites_and_quota_state(exercise_client):
    client, directory = exercise_client
    client.put('/api/exercise-favorites/kneeling-pushup')
    store = Store(directory / 'favorite-clash.sqlite3')
    store.pause_model('test-only pause')
    report = backup_history(store.path, directory / 'backups')
    assert report['status'] == 'verified'
    assert report['tables']['exercise_favorites']['rows'] == 1
    restored = Store(Path(report['database']))
    assert restored.exercise_favorites() == store.exercise_favorites()
    assert restored.model_pause() == store.model_pause()
