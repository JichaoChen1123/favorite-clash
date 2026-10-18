"""SQLite snapshots for a single-user, single-worker local application."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Callable


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TrainingConflict(Exception):
    pass


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
                    started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
                    snapshot TEXT NOT NULL, result TEXT, error TEXT,
                    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS traces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL, document TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS exercise_favorites (
                    exercise_id TEXT PRIMARY KEY, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS training_sessions (
                    id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                    status TEXT NOT NULL, document TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_training
                    ON training_sessions(status) WHERE status='active';
            ''')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, job: dict) -> dict:
        with self.connection() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?)', (job['id'], job['created_at'], json.dumps(job, ensure_ascii=False)))
        return job

    def exercise_favorites(self) -> list[dict]:
        with self.connection() as db:
            rows = db.execute('SELECT exercise_id,created_at FROM exercise_favorites ORDER BY created_at DESC,exercise_id').fetchall()
        return [{'exercise_id': ident, 'created_at': created} for ident, created in rows]

    def training_get(self, ident: str) -> dict | None:
        with self.connection() as db:
            row = db.execute('SELECT document FROM training_sessions WHERE id=?', (ident,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def training_summary(document: dict) -> dict:
        return {**{key: document[key] for key in ('id','created_at','updated_at','ended_at','status','version')},
                'exercise_count': len(document['exercises']),
                'completed_sets': sum(bool(s['completed']) for x in document['exercises'] for s in x['sets'])}

    def training_overview(self) -> dict:
        with self.connection() as db:
            db.execute('BEGIN')
            active = db.execute("SELECT document FROM training_sessions WHERE status='active'").fetchone()
            history = [self.training_summary(json.loads(row[0])) for row in db.execute(
                "SELECT document FROM training_sessions WHERE status!='active' ORDER BY created_at DESC,id DESC LIMIT 100")]
            last = {}
            for row in db.execute("SELECT document FROM training_sessions WHERE status='completed' ORDER BY created_at DESC,id DESC LIMIT 1000"):
                document = json.loads(row[0])
                for exercise in document['exercises']:
                    sets = [s for s in exercise['sets'] if s['completed']]
                    if sets and exercise['exercise_id'] not in last:
                        last[exercise['exercise_id']] = {'session_id': document['id'], 'ended_at': document['ended_at'],
                                                        'name': exercise['name'], 'sets': sets}
        return {'active': json.loads(active[0]) if active else None, 'history': history, 'last_exercises': last}

    def training_create(self, document: dict) -> dict:
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT document FROM training_sessions WHERE id=?', (document['id'],)).fetchone()
            if existing:
                return json.loads(existing[0])
            if db.execute("SELECT 1 FROM training_sessions WHERE status='active'").fetchone():
                raise TrainingConflict('已有进行中的训练，请先继续或结束，再新建。')
            db.execute('INSERT INTO training_sessions VALUES (?,?,?,?)',
                       (document['id'], document['created_at'], document['status'], json.dumps(document, ensure_ascii=False)))
        return document

    def training_update(self, ident: str, version: int, status: str, exercises: list[dict]) -> dict | None:
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT document FROM training_sessions WHERE id=?', (ident,)).fetchone()
            if not row:
                return None
            current = json.loads(row[0])
            if current['version'] != version or current['status'] != 'active':
                raise TrainingConflict('记录已在其他页面更新或已结束；请重新读取服务器记录后再操作。')
            stamp = now()
            current.update(exercises=exercises, status=status, version=version+1, updated_at=stamp,
                           ended_at=stamp if status != 'active' else None)
            db.execute('UPDATE training_sessions SET status=?,document=? WHERE id=?',
                       (status, json.dumps(current, ensure_ascii=False), ident))
        return current

    def set_exercise_favorite(self, ident: str, saved: bool):
        with self.connection() as db:
            if saved:
                db.execute('INSERT OR IGNORE INTO exercise_favorites VALUES (?,?)', (ident, now()))
            else:
                db.execute('DELETE FROM exercise_favorites WHERE exercise_id=?', (ident,))

    def model_pause(self) -> dict | None:
        with self.connection() as db:
            row = db.execute("SELECT value FROM settings WHERE key='model_quota_pause'").fetchone()
        return json.loads(row[0]) if row else None

    def pause_model(self, reason: str):
        value = json.dumps({'reason': reason, 'paused_at': now()}, ensure_ascii=False)
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('model_quota_pause',?)", (value,))

    def resume_model(self):
        # Only called by the explicit local resume entry point, never by a timer.
        with self.connection() as db:
            db.execute("DELETE FROM settings WHERE key='model_quota_pause'")

    def get(self, ident: str) -> dict | None:
        with self.connection() as db:
            row = db.execute('SELECT document FROM jobs WHERE id=?', (ident,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self) -> list[dict]:
        with self.connection() as db:
            rows = db.execute('SELECT document FROM jobs ORDER BY created_at DESC').fetchall()
        result = []
        for row in rows:
            job = json.loads(row[0])
            job['result'] = None
            for source in job['sources']:
                source['segments'] = []
            result.append(job)
        return result

    def change(self, ident: str, update: Callable[[dict], None]) -> dict | None:
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT document FROM jobs WHERE id=?', (ident,)).fetchone()
            if not row:
                return None
            job = json.loads(row[0])
            update(job)
            job['updated_at'] = now()
            db.execute('UPDATE jobs SET document=? WHERE id=?', (json.dumps(job, ensure_ascii=False), ident))
        return job

    def delete(self, ident: str):
        with self.connection() as db:
            db.execute('DELETE FROM jobs WHERE id=?', (ident,))

    def start_run(self, job: dict) -> int:
        with self.connection() as db:
            cursor = db.execute('INSERT INTO runs(job_id,started_at,status,snapshot) VALUES (?,?,?,?)',
                                (job['id'], now(), 'running', json.dumps(job, ensure_ascii=False)))
            return int(cursor.lastrowid)

    def trace(self, run_id: int, trace: dict):
        with self.connection() as db:
            db.execute('INSERT INTO traces(run_id,created_at,document) VALUES (?,?,?)',
                       (run_id, now(), json.dumps(trace, ensure_ascii=False)))

    def finish_run(self, run_id: int, job: dict):
        with self.connection() as db:
            db.execute('UPDATE runs SET finished_at=?,status=?,snapshot=?,result=?,error=? WHERE id=?',
                       (now(), job['status'], json.dumps(job, ensure_ascii=False),
                        json.dumps(job.get('result'), ensure_ascii=False), job.get('error'), run_id))

    def interrupt_pending(self):
        for job in self.list():
            if job['status'] in ('queued', 'running'):
                self.change(job['id'], lambda j: j.update(status='interrupted', stage='任务已中断，可重试',
                                                        error='服务已重启；已保存的字幕仍可使用，请点击重试。'))
        with self.connection() as db:
            db.execute("UPDATE runs SET status='interrupted',finished_at=? WHERE status='running'", (now(),))
