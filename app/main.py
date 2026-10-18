from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import logging
import json
import os
import shutil
import time
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import model, video
from .store import Store, now

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('CLASH_DATA_DIR', str(ROOT / 'data'))).resolve()
DIST = ROOT / 'frontend' / 'dist'
EXERCISE_CATALOG = json.loads((ROOT / 'app' / 'exercises.json').read_text(encoding='utf-8'))
EXERCISE_IDS = frozenset(item['id'] for item in EXERCISE_CATALOG['items'])
logger = logging.getLogger('favorite-clash')


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Resolve(Input):
    text: str = Field(min_length=1, max_length=4000)


class SourceInput(Input):
    url: str = Field(min_length=1, max_length=4000)
    page: int = Field(ge=1, le=10000)


class CreateJob(Input):
    question: str = Field(min_length=1, max_length=2000)
    sources: list[SourceInput] = Field(min_length=2, max_length=3)


class Feedback(Input):
    kind: Literal['comparison', 'citation']
    note: str = Field(default='', max_length=2000)


class Manager:
    def __init__(self, store: Store):
        self.store = store
        self.tasks: dict[str, asyncio.Task] = {}
        self.semaphore = asyncio.Semaphore(1)

    def submit(self, ident: str):
        if ident in self.tasks and not self.tasks[ident].done():
            return
        task = asyncio.create_task(self.run(ident), name=f'comparison-{ident}')
        self.tasks[ident] = task
        task.add_done_callback(lambda current: self.tasks.pop(ident, None) if self.tasks.get(ident) is current else None)

    def progress(self, ident: str, stage: str, percent: int | None = None):
        def update(j):
            j['stage'] = stage
            if percent is not None:
                j['progress'] = percent
        self.store.change(ident, update)

    def source_update(self, ident: str, sid: str, **values):
        def update(j):
            source = next(s for s in j['sources'] if s['id'] == sid)
            source.update(values)
        self.store.change(ident, update)

    async def run(self, ident: str):
        run_id = None
        try:
            async with self.semaphore:
                job = self.store.get(ident)
                if not job:
                    return
                if self.store.model_pause():
                    self.store.change(ident, lambda j: j.update(status='interrupted', stage='模型额度保护已暂停',
                        error='模型额度不足，后续分析已暂停。已完成内容保留，请确认额度恢复后手动恢复。'))
                    return
                self.store.change(ident, lambda j: j.update(status='running', error=None, result=None, stage='准备读取视频内容', progress=3))
                run_id = self.store.start_run(self.store.get(ident))
                failed = []
                for index, source in enumerate(job['sources']):
                    if source.get('segments'):
                        self.source_update(ident, source['id'], status='ready', error=None)
                        continue
                    self.source_update(ident, source['id'], status='fetching', error=None)
                    self.progress(ident, f"正在获取第 {index + 1}/{len(job['sources'])} 个视频", 5 + 50 * index // len(job['sources']))
                    try:
                        transcript = await video.load_transcript(source, DATA / 'cache' / ident / source['id'],
                            lambda stage: self.progress(ident, f'视频 {index + 1} · {stage}'))
                        self.source_update(ident, source['id'], status='ready', error=None,
                                           transcript_kind=transcript['kind'], segments=transcript['segments'],
                                           asr_model=transcript.get('asr_model'))
                    except video.VideoError as exc:
                        self.source_update(ident, source['id'], status='failed', error=str(exc))
                        failed.append(f'视频 {index + 1}：{exc}')
                if failed:
                    raise video.VideoError('ingestion', '；'.join(failed) + ' 已完成的字幕已保存，可上传缺失字幕后重试。')
                self.progress(ident, '正在整理观点与核对条件', 60)
                job = self.store.get(ident)
                result = await model.analyze_sources(job['question'], job['sources'],
                    lambda stage: self.progress(ident, stage, 90 if '复核' in stage else 75 if '比较' in stage else 65),
                    lambda trace: self.store.trace(run_id, trace))
                self.store.change(ident, lambda j: j.update(status='completed', stage='对照已完成', progress=100, result=result, error=None))
        except asyncio.CancelledError:
            self.store.change(ident, lambda j: j.update(status='interrupted', stage='任务已中断，可重试', error='任务已中断；已完成的字幕已保存。'))
            raise
        except model.QuotaError as exc:
            self.store.pause_model(str(exc))
            self.store.change(ident, lambda j: j.update(status='interrupted', stage='模型额度不足，已暂停', error=str(exc)))
        except (video.VideoError, model.ModelError) as exc:
            self.store.change(ident, lambda j: j.update(status='failed', stage='需要处理后重试', error=str(exc)))
        except Exception as exc:
            # No prompt, transcript, credentials or remote response in logs/errors.
            logger.error('job %s failed: %s', ident, type(exc).__name__)
            self.store.change(ident, lambda j: j.update(status='failed', stage='处理未完成', error='后台处理出现异常；已保存完成内容，请重试或查看本机运行记录。'))
        finally:
            if run_id and (job := self.store.get(ident)):
                self.store.finish_run(run_id, job)

    async def cancel(self, ident: str):
        task = self.tasks.get(ident)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def close(self):
        await asyncio.gather(*(self.cancel(ident) for ident in list(self.tasks)))


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.store = Store(DATA / 'favorite-clash.sqlite3')
    application.state.store.interrupt_pending()
    application.state.manager = Manager(application.state.store)
    application.state.health = (0, False)
    yield
    await application.state.manager.close()


app = FastAPI(title='收藏夹打架了', docs_url=None, redoc_url=None, lifespan=lifespan)
allowed_hosts = ['127.0.0.1', 'localhost', '[::1]', 'testserver'] + [h.strip() for h in os.environ.get('CLASH_ALLOWED_HOSTS', '').split(',') if h.strip()]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


@app.middleware('http')
async def same_origin(request: Request, call_next):
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        origin = request.headers.get('origin')
        if origin:
            parsed = urlsplit(origin)
            if parsed.netloc != request.headers.get('host') or parsed.scheme not in ('http', 'https'):
                return JSONResponse({'detail': '请从当前应用页面操作。'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api') else 'no-cache'
    return response


@app.exception_handler(video.VideoError)
async def video_error(request: Request, exc: video.VideoError):
    return JSONResponse({'detail': str(exc)}, status_code=422)


def get_job(request: Request, ident: str) -> dict:
    job = request.app.state.store.get(ident)
    if not job:
        raise HTTPException(404, '这条对照不存在或已删除。')
    return job


def require_model_available(request: Request):
    if request.app.state.store.model_pause():
        raise HTTPException(409, '模型额度保护已暂停。已完成内容保留；请确认额度恢复后手动恢复，再提交或重试。')


@app.get('/api/health')
async def health(request: Request):
    stamp, ready = request.app.state.health
    if time.monotonic() - stamp > 30:
        ready = await model.provider_health()
        request.app.state.health = (time.monotonic(), ready)
    return {'status': 'ok', 'app': 'favorite-clash', 'provider': 'official-codex-cli', 'model': model.MODEL_NAME,
            'provider_ready': ready, 'ffmpeg_ready': shutil.which('ffmpeg') is not None,
            'model_paused': request.app.state.store.model_pause() is not None}


@app.post('/api/videos/resolve')
async def resolve(payload: Resolve):
    return await video.resolve_video(payload.text)


@app.get('/api/exercises')
async def exercises():
    return EXERCISE_CATALOG


@app.get('/api/exercise-favorites')
async def exercise_favorites(request: Request):
    return {'items': request.app.state.store.exercise_favorites()}


@app.put('/api/exercise-favorites/{ident}')
async def save_exercise(ident: str, request: Request):
    if ident not in EXERCISE_IDS:
        raise HTTPException(404, '这个动作尚未收录。')
    request.app.state.store.set_exercise_favorite(ident, True)
    return {'exercise_id': ident, 'saved': True}


@app.delete('/api/exercise-favorites/{ident}')
async def unsave_exercise(ident: str, request: Request):
    if ident not in EXERCISE_IDS:
        raise HTTPException(404, '这个动作尚未收录。')
    request.app.state.store.set_exercise_favorite(ident, False)
    return {'exercise_id': ident, 'saved': False}


@app.post('/api/jobs', status_code=201)
async def create_job(payload: CreateJob, request: Request):
    require_model_available(request)
    manager, store = request.app.state.manager, request.app.state.store
    if len(manager.tasks) >= 8:
        raise HTTPException(429, '等待处理的任务较多，请先等待已有任务完成。')
    sources, distinct = [], set()
    for item in payload.sources:
        info = await video.resolve_video(item.url)
        part = next((p for p in info['pages'] if p['page'] == item.page), None)
        if not part:
            raise HTTPException(422, '选择的分 P 不存在，请重新确认视频。')
        if not 0 < part['duration'] <= 1200:
            raise HTTPException(422, '每个视频或分 P 必须不超过 20 分钟。')
        identity = (info['bvid'], item.page)
        if identity in distinct:
            raise HTTPException(422, '请添加不同的视频或分 P，同一来源无需重复比较。')
        distinct.add(identity)
        sources.append({'id': uuid4().hex, 'url': part['url'], 'bvid': info['bvid'],
                        'page': item.page, 'cid': part['cid'], 'title': info['title'] + (f" · P{item.page} {part['title']}" if len(info['pages']) > 1 else ''),
                        'author': info.get('author', ''), 'duration': part['duration'], 'status': 'pending',
                        'error': None, 'transcript_kind': None, 'segments': []})
    # Metadata lookup awaits network calls. Recheck immediately before the
    # no-await create/submit section, so concurrent requests cannot overfill it.
    require_model_available(request)
    if len(manager.tasks) >= 8:
        raise HTTPException(429, '等待处理的任务较多，请先等待已有任务完成。')
    created = now()
    job = store.create({'id': uuid4().hex, 'question': payload.question, 'status': 'queued', 'stage': '已排队，准备处理',
                        'progress': 0, 'created_at': created, 'updated_at': created, 'error': None,
                        'sources': sources, 'result': None, 'feedback': [], 'model': model.MODEL_NAME,
                        'prompt_version': model.PROMPT_VERSION})
    manager.submit(job['id'])
    return job


@app.get('/api/jobs')
async def jobs(request: Request):
    return {'items': request.app.state.store.list()}


@app.get('/api/jobs/{ident}')
async def job_detail(ident: str, request: Request):
    return get_job(request, ident)


@app.post('/api/jobs/{ident}/retry')
async def retry(ident: str, request: Request):
    require_model_available(request)
    job = get_job(request, ident)
    if job['status'] not in ('failed', 'interrupted'):
        raise HTTPException(409, '仅未完成的任务可以重试。')
    if len(request.app.state.manager.tasks) >= 8:
        raise HTTPException(429, '请等待已有任务完成后重试。')
    job = request.app.state.store.change(ident, lambda j: j.update(status='queued', stage='已排队，继续处理', error=None, progress=0,
                                                                  model=model.MODEL_NAME, prompt_version=model.PROMPT_VERSION))
    request.app.state.manager.submit(ident)
    return job


@app.delete('/api/jobs/{ident}')
async def delete(ident: str, request: Request):
    get_job(request, ident)
    await request.app.state.manager.cancel(ident)
    request.app.state.store.delete(ident)
    target = (DATA / 'cache' / ident).resolve()
    if target.is_relative_to((DATA / 'cache').resolve()) and target.is_dir():
        shutil.rmtree(target)
    return {'ok': True}


@app.post('/api/jobs/{ident}/sources/{sid}/subtitle')
async def upload(ident: str, sid: str, request: Request, file: UploadFile = File(...)):
    job = get_job(request, ident)
    if job['status'] not in ('failed', 'interrupted'):
        raise HTTPException(409, '请等待任务停止后补充字幕。')
    source = next((s for s in job['sources'] if s['id'] == sid), None)
    if not source:
        raise HTTPException(404, '没有找到该视频来源。')
    content = await file.read(2 * 1024 * 1024 + 1)
    await file.close()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(413, '字幕文件不能超过 2 MB。')
    segments = video.parse_subtitle(content, file.filename or 'subtitle.srt')
    if any(s['end'] > source['duration'] + 3 for s in segments):
        raise HTTPException(422, '字幕时间超出所选视频时长，请确认文件对应同一分 P。')
    def save_subtitle(current):
        # File I/O yields: a retry may have started or the job may have been
        # deleted. Check and write in the same SQLite transaction so the model
        # cannot read one transcript while the saved evidence is replaced.
        if current['status'] not in ('failed', 'interrupted'):
            raise HTTPException(409, '任务状态已变化，请等待任务停止后补充字幕。')
        target = next((s for s in current['sources'] if s['id'] == sid), None)
        if target is None:
            raise HTTPException(404, '没有找到该视频来源。')
        target.update(status='ready', error=None, transcript_kind='uploaded', segments=segments, asr_model=None)

    updated = request.app.state.store.change(ident, save_subtitle)
    if updated is None:
        raise HTTPException(404, '任务已删除，字幕未保存。')
    return updated


@app.post('/api/jobs/{ident}/feedback')
async def feedback(ident: str, payload: Feedback, request: Request):
    job = get_job(request, ident)
    if job['status'] != 'completed':
        raise HTTPException(409, '完成对照后才能反馈结果问题。')
    if len(job['feedback']) >= 100:
        raise HTTPException(429, '这条任务的反馈较多，请稍后整理。')
    request.app.state.store.change(ident, lambda j: j['feedback'].append({'kind': payload.kind, 'note': payload.note, 'created_at': now()}))
    return {'ok': True}


@app.get('/{path:path}')
async def frontend(path: str):
    if path.startswith('api/'):
        raise HTTPException(404, '没有这个接口。')
    target = (DIST / path).resolve()
    if target.is_relative_to(DIST.resolve()) and target.is_file():
        return FileResponse(target)
    index = DIST / 'index.html'
    if index.is_file() and not Path(path).suffix:
        return FileResponse(index)
    raise HTTPException(404, '界面尚未构建，请先运行安装与构建入口。')
