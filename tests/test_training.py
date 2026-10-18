import copy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app import main
from app.store import Store, TrainingConflict
from scripts.backup_history import backup_history


@pytest.fixture
def client(monkeypatch):
    directory = Path(__file__).resolve().parents[1] / '.cache/tests' / uuid4().hex
    monkeypatch.setattr(main, 'DATA', directory)
    with TestClient(main.app) as instance:
        yield instance, directory
    shutil.rmtree(directory)


def create(client, ids=None):
    return client.post('/api/training', json={'id':str(uuid4()),'exercise_ids':ids or ['dumbbell-chest-press']})


def payload(session, status='active'):
    return {'version':session['version'],'status':status,'exercises':[
        {'exercise_id':x['exercise_id'],'sets':x['sets']} for x in session['exercises']]}


def test_complete_resume_last_record_and_backup_without_changing_other_data(client):
    api, directory = client
    store = Store(directory/'favorite-clash.sqlite3')
    store.pause_model('test quota pause')
    store.set_exercise_favorite('lat-pulldown', True)
    assert api.get('/api/training').json() == {'active':None,'history':[],'last_exercises':{}}
    response = create(api)
    assert response.status_code == 201
    document = response.json()
    assert document['exercises'][0]['name'] == '哑铃卧推'
    assert all(s['weight_kg'] is None and s['reps'] is None and not s['completed'] for s in document['exercises'][0]['sets'])
    update = payload(document)
    update['exercises'][0]['sets'][0].update(weight_kg=7.5,reps=12,completed=True)
    saved = api.put('/api/training/'+document['id'],json=update).json()
    assert saved['version'] == 2
    assert Store(store.path).training_get(saved['id']) == saved
    assert api.get('/api/training').json()['active'] == saved
    ended = api.put('/api/training/'+saved['id'],json=payload(saved,'completed')).json()
    overview = api.get('/api/training').json()
    assert overview['active'] is None
    assert overview['history'][0]['completed_sets'] == 1
    assert overview['last_exercises']['dumbbell-chest-press']['sets'][0]['weight_kg'] == 7.5
    assert len(overview['last_exercises']['dumbbell-chest-press']['sets']) == 1
    assert ended['ended_at'] and api.get('/api/training/'+ended['id']).json() == ended
    next_session = create(api).json()
    assert next_session['exercises'][0]['sets'][0]['weight_kg'] is None  # Last data is a reference, never fabricated as today's completion.
    backup = backup_history(store.path,directory/'backups')
    assert backup['tables']['training_sessions']['rows'] == 2
    restored = Store(Path(backup['database']))
    assert restored.training_get(ended['id']) == ended
    assert restored.model_pause() == store.model_pause()
    assert restored.exercise_favorites() == store.exercise_favorites()
    assert store.list() == []


def test_idempotent_creation_single_active_and_stale_version_rejected(client):
    api, _ = client
    body={'id':str(uuid4()),'exercise_ids':['lat-pulldown']}
    document=api.post('/api/training',json=body).json()
    assert api.post('/api/training',json=body).json() == document
    assert create(api).status_code == 409
    first=api.put('/api/training/'+document['id'],json=payload(document))
    assert first.status_code == 200
    assert api.put('/api/training/'+document['id'],json=payload(document)).status_code == 409
    cancelled=api.put('/api/training/'+document['id'],json=payload(first.json(),'cancelled')).json()
    assert cancelled['status'] == 'cancelled'
    assert api.put('/api/training/'+document['id'],json=payload(cancelled)).status_code == 409
    assert create(api).status_code == 201
    assert api.get('/api/training').json()['last_exercises'] == {}


def test_validation_and_cross_origin_do_not_mutate(client):
    api,_=client
    assert create(api,['not-a-real-exercise']).status_code == 422
    assert create(api,['lat-pulldown','lat-pulldown']).status_code == 422
    session=create(api).json()
    path='/api/training/'+session['id']
    assert api.put(path,json=payload(session,'completed')).status_code == 422
    assert api.post('/api/training',json={'id':str(uuid4()),'exercise_ids':[]}).status_code == 422
    for changes in [dict(weight_kg=-1),dict(weight_kg=2001),dict(reps=0),dict(reps=1.5),dict(reps=True),dict(completed=True),dict(weight_kg='10')]:
        update=payload(copy.deepcopy(session));update['exercises'][0]['sets'][0].update(changes)
        assert api.put(path,json=update).status_code == 422, changes
    update=payload(copy.deepcopy(session));update['exercises'][0]['sets'][1]['id']=update['exercises'][0]['sets'][0]['id']
    assert api.put(path,json=update).status_code == 422
    assert api.put(path,json=payload(session),headers={'Origin':'https://other.example'}).status_code == 403
    assert api.get(path).json() == session
    assert api.get('/api/training/'+str(uuid4())).status_code == 404


def test_two_writers_cannot_silently_overwrite_each_other(client):
    api,directory=client
    session=create(api).json()
    store=Store(directory/'favorite-clash.sqlite3')
    def write():
        try:
            return store.training_update(session['id'],session['version'],'active',session['exercises'])['version']
        except TrainingConflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:write(),range(2)))
    assert sorted(map(str,results)) == ['2','conflict']
