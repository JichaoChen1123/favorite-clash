from __future__ import annotations

import asyncio
import json
from pathlib import Path
import time
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app import main, model, video
from app.store import Store


@pytest.fixture
def client(monkeypatch):
    # Ordinary directory creation avoids Windows restricted-token tempfile ACLs.
    directory = Path(__file__).resolve().parents[1] / '.cache' / 'tests' / uuid4().hex
    directory.mkdir(parents=True)
    monkeypatch.setattr(main, 'DATA', directory)
    async def resolve(url):
        bvid = 'BV1xx4111111' if url.endswith('one') else 'BV1xx4222222'
        return {'bvid': bvid, 'title': '测试视频', 'author': '测试作者', 'url': url,
                'pages': [{'page': 1, 'cid': 11, 'title': '第一部分', 'duration': 100, 'url': url}]}
    async def transcript(source, cache_dir, progress=None):
        return {'kind': 'subtitle', 'segments': [{'id':'seg-0001','start':0,'end':5,'text':'允许的条件需要明确。'}]}
    async def analyze(question, sources, progress=None, trace=None):
        if trace:
            trace({'stage':'test', 'raw':'{}'})
        return {'overview':'合成测试结果', 'comparisons':[], 'open_questions':[]}
    monkeypatch.setattr(video, 'resolve_video', resolve)
    monkeypatch.setattr(video, 'load_transcript', transcript)
    monkeypatch.setattr(model, 'analyze_sources', analyze)
    async def provider_health():
        return True
    monkeypatch.setattr(model, 'provider_health', provider_health)
    with TestClient(main.app) as api:
        yield api
    import shutil
    shutil.rmtree(directory)


def create(client):
    return client.post('/api/jobs', json={'question':'测试问题', 'sources':[{'url':'https://www.bilibili.com/one','page':1},{'url':'https://www.bilibili.com/two','page':1}]})


def settled(client, ident):
    for _ in range(100):
        job = client.get(f'/api/jobs/{ident}').json()
        if job['status'] not in ('queued','running'):
            return job
        time.sleep(.02)
    raise AssertionError('job did not settle')


def test_create_run_feedback_history_and_delete(client):
    created = create(client)
    assert created.status_code == 201
    ident = created.json()['id']
    job = settled(client, ident)
    assert job['status'] == 'completed'
    assert len(job['sources'][0]['segments']) == 1
    assert client.post(f'/api/jobs/{ident}/feedback', json={'kind':'citation','note':'测试'}).status_code == 200
    assert client.get(f'/api/jobs/{ident}').json()['feedback'][0]['note'] == '测试'
    assert client.get('/api/jobs').json()['items'][0]['sources'][0]['segments'] == []
    assert client.post(f'/api/jobs/{ident}/retry').status_code == 409
    assert client.delete(f'/api/jobs/{ident}').status_code == 200
    assert client.get(f'/api/jobs/{ident}').status_code == 404
    with main.app.state.store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM traces').fetchone()[0] == 0


def test_duplicate_part_and_wrong_part_rejected(client):
    body = {'question':'测试','sources':[{'url':'https://www.bilibili.com/one','page':1}]*2}
    assert client.post('/api/jobs', json=body).status_code == 422
    body['sources'][1] = {'url':'https://www.bilibili.com/two','page':9}
    assert client.post('/api/jobs', json=body).status_code == 422


def test_unsafe_origin_and_host_rejected(client):
    assert client.post('/api/jobs', headers={'Origin':'https://evil.example'},json={}).status_code == 403
    assert client.get('/api/jobs', headers={'Host':'evil.example'}).status_code == 400


def test_failed_sources_keep_completed_and_upload_then_retry(client, monkeypatch):
    calls = []
    async def partially_fail(source, cache_dir, progress=None):
        calls.append(source['id'])
        if source['bvid'].endswith('22222'):
            raise video.VideoError('no_audio', '视频需要登录')
        return {'kind':'asr','asr_model':'small','segments':[{'id':'seg-0001','start':0,'end':5,'text':'已有字幕'}]}
    monkeypatch.setattr(video,'load_transcript',partially_fail)
    ident=create(client).json()['id']
    job=settled(client,ident)
    assert job['status']=='failed'
    assert job['sources'][0]['segments']
    assert job['sources'][0]['asr_model'] == 'small'
    sid=job['sources'][1]['id']
    path=f'/api/jobs/{ident}/sources/{sid}/subtitle'
    assert client.post(path, files={'file':('x.srt',b'1\n00:02:00,000 --> 00:02:01,000\nwrong\n')}).status_code==422
    uploaded=client.post(path, files={'file':('x.srt','1\n00:00:00,000 --> 00:00:04,000\n已上传字幕\n'.encode())})
    assert uploaded.status_code==200
    assert client.post(f'/api/jobs/{ident}/retry').status_code==200
    assert settled(client,ident)['status']=='completed'
    assert len(calls)==2  # Both saved transcripts are reused.
    with main.app.state.store.connection() as db:
        runs=db.execute('SELECT status,snapshot FROM runs ORDER BY id').fetchall()
    assert [r[0] for r in runs]==['failed','completed']
    assert json.loads(runs[0][1])['sources'][1]['segments']==[]


def test_delete_cancels_active_worker(client,monkeypatch):
    async def slow(*args,**kwargs):
        await asyncio.sleep(30)
    monkeypatch.setattr(video,'load_transcript',slow)
    ident=create(client).json()['id']
    assert client.delete(f'/api/jobs/{ident}').status_code==200
    assert client.get('/api/jobs').json()['items']==[]


def test_restart_marks_interrupted_without_erasing_segments(client):
    ident=create(client).json()['id']
    settled(client,ident)
    store=main.app.state.store
    store.change(ident,lambda j:j.update(status='running'))
    store.interrupt_pending()
    assert store.get(ident)['status']=='interrupted'
    assert store.get(ident)['sources'][0]['segments']


@pytest.mark.parametrize('concurrent_action', ['retry', 'delete'])
def test_subtitle_upload_rechecks_state_after_file_read(client, concurrent_action):
    from types import SimpleNamespace
    from fastapi import HTTPException

    ident = create(client).json()['id']
    job = settled(client, ident)
    sid = job['sources'][0]['id']
    previous = job['sources'][0]['segments']
    store = main.app.state.store
    store.change(ident, lambda j: j.update(status='failed'))

    class ConcurrentUpload:
        filename = 'replacement.srt'

        async def read(self, limit):
            if concurrent_action == 'retry':
                store.change(ident, lambda j: j.update(status='running'))
            else:
                store.delete(ident)
            await asyncio.sleep(0)
            return b'1\n00:00:00,000 --> 00:00:04,000\nreplacement\n'

        async def close(self):
            pass

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.upload(ident, sid, SimpleNamespace(app=main.app), ConcurrentUpload()))
    assert error.value.status_code == (409 if concurrent_action == 'retry' else 404)
    if concurrent_action == 'retry':
        assert store.get(ident)['sources'][0]['segments'] == previous
        assert store.get(ident)['sources'][0]['transcript_kind'] == 'subtitle'
    else:
        assert store.get(ident) is None


def test_quota_pause_persists_and_blocks_queue_until_explicit_resume(client, monkeypatch):
    calls = []

    async def no_quota(*args, **kwargs):
        calls.append('model')
        raise model.QuotaError('额度不足，已暂停。')

    monkeypatch.setattr(model, 'analyze_sources', no_quota)
    ident = create(client).json()['id']
    job = settled(client, ident)
    assert job['status'] == 'interrupted'
    assert job['sources'][0]['segments']
    store = main.app.state.store
    assert store.model_pause()
    # Reopening the DB and manager cannot reset quota protection.
    reopened = Store(store.path)
    assert reopened.model_pause()
    queued = dict(job, id=uuid4().hex, status='queued')
    reopened.create(queued)
    asyncio.run(main.Manager(reopened).run(queued['id']))
    assert reopened.get(queued['id'])['status'] == 'interrupted'
    assert calls == ['model']
    assert create(client).status_code == 409
    assert client.post(f'/api/jobs/{ident}/retry').status_code == 409
    assert client.get('/api/health').json()['model_paused'] is True
    assert len(client.get('/api/jobs').json()['items']) == 2
    reopened.resume_model()
    assert store.model_pause() is None
    # Resuming the switch alone does not retry any saved job.
    assert store.get(ident)['status'] == 'interrupted'
    assert calls == ['model']
