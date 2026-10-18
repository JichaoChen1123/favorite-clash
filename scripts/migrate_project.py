"""Desktop-run migration; preserves the source and never requests model inference."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
TARGET = Path('W:/favorite-clash')
POWERSHELL = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
SKIP = {'.venv', '.runtime', 'data', '.pytest_cache', '__pycache__'}
ENTRY_NAMES = tuple('launchers/' + name for name in ('start.cmd', 'stop.cmd', 'enable-mobile.cmd', 'resume-analysis.cmd'))


def run(args: list[str | Path], cwd: Path = ROOT) -> None:
    result = subprocess.run([str(a) for a in args], cwd=cwd)
    if result.returncode:
        raise RuntimeError(f'执行失败（{result.returncode}）：{args[0]}')


def script(root: Path, name: str, *args: str) -> None:
    run([POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', root / 'scripts' / name, *args], root)


def get_json(path: str) -> dict:
    with httpx.Client(trust_env=False, timeout=20) as client:
        response = client.get('http://127.0.0.1:8787' + path)
        response.raise_for_status()
        return response.json()


def idle_service() -> tuple[bool, list[str]]:
    try:
        health = get_json('/api/health')
    except httpx.ConnectError:
        return False, []
    if health.get('app') != 'favorite-clash':
        raise RuntimeError('8787 端口不是本项目，未停止任何程序。')
    state = json.loads((ROOT / '.runtime/server.json').read_text(encoding='utf-8-sig'))
    if Path(state['project_root']).resolve() != ROOT:
        raise RuntimeError('8787 端口由另一个目录提供，不能迁移当前目录。')
    if Path(state['data_dir']).resolve() != ROOT / 'data':
        raise RuntimeError('应用使用了自定义数据目录，请先由助手核查该目录。')
    jobs = get_json('/api/jobs')['items']
    if any(j['status'] in ('running', 'queued') for j in jobs):
        raise RuntimeError('仍有对照任务正在处理。请等它们结束后再运行迁移。')
    return True, sorted(j['id'] for j in jobs)


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify_files(source: Path, target: Path) -> int:
    count = 0
    for original in source.rglob('*'):
        if original.is_file():
            copied = target / original.relative_to(source)
            if not copied.is_file() or hash_file(original) != hash_file(copied):
                raise RuntimeError(f'复制校验失败：{original.relative_to(ROOT)}')
            count += 1
    return count


def database_snapshot(path: Path) -> dict:
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('历史数据库完整性检查失败。')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        counts = {t: db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
                  for t in ('jobs', 'runs', 'traces', 'settings') if t in tables}
        ids = sorted(r[0] for r in db.execute('SELECT id FROM jobs'))
        pause = db.execute("SELECT value FROM settings WHERE key='model_quota_pause'").fetchone() if 'settings' in tables else None
    return {'counts': counts, 'job_ids': ids, 'model_pause': pause[0] if pause else None}


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.migration.tmp')
    temporary.write_bytes(value)
    os.replace(temporary, path)


def migrate(check_only: bool = False) -> None:
    target = TARGET.resolve()
    if ROOT == target or not target.parent.is_dir():
        raise RuntimeError('源目录或 W 盘目标无效。')
    if target.exists():
        raise RuntimeError('W:\\favorite-clash 已存在；为避免覆盖数据，本入口不会合并或删除它。')
    uv = shutil.which('uv') or str(Path.home() / 'AppData/Local/hermes/bin/uv.exe')
    if not Path(uv).is_file():
        raise RuntimeError('未找到 uv，无法重建运行环境。')
    if shutil.disk_usage(target.parent).free < 4 * 1024**3:
        raise RuntimeError('W 盘至少需要 4 GB 可用空间。')
    was_running, _ = idle_service()
    database_snapshot(ROOT / 'data/favorite-clash.sqlite3')
    if check_only:
        print('预检查通过。目标：W:\\favorite-clash；原目录保留；没有执行复制或停止服务。')
        return

    report = {'source': str(ROOT), 'target': str(target), 'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'preparing'}
    stopped = False
    target_started = False
    target_created = False
    changed_entries: dict[Path, bytes] = {}
    try:
        target.mkdir()
        target_created = True
        write_json(target / '.runtime/migration.json', report)
        print('1/5 复制项目和本地转写模型，原服务暂时保持运行……', flush=True)
        for item in ROOT.iterdir():
            if item.name in SKIP or item.name.startswith('pytest-cache-files-'):
                continue
            destination = target / item.name
            if item.is_dir():
                shutil.copytree(item, destination, ignore=shutil.ignore_patterns('__pycache__', '.pytest_cache'))
            else:
                shutil.copy2(item, destination)
        remote = ROOT / '.runtime/remote.json'
        if remote.exists():
            shutil.copy2(remote, target / '.runtime/remote.json')
        diagnostics = ROOT / '.runtime/model'
        if diagnostics.exists():
            shutil.copytree(diagnostics, target / '.runtime/model')
        report['model_cache_files_verified'] = verify_files(ROOT / '.cache/whisper-models', target / '.cache/whisper-models')

        print('2/5 在新位置重建 Python 环境，优先使用现有下载缓存……', flush=True)
        base_python = Path(sys._base_executable)
        run([base_python, '-m', 'venv', '--without-pip', target / '.venv'])
        python = target / '.venv/Scripts/python.exe'
        install = [uv, 'pip', 'sync', '--python', str(python), str(target / 'requirements.lock.txt')]
        offline = subprocess.run([*install, '--offline'], cwd=target)
        if offline.returncode:
            print('缓存不完整，下载缺少的软件依赖；不会调用模型。', flush=True)
            run(install, target)
        run([python, '-c', 'import sys,fastapi,uvicorn,faster_whisper; from pathlib import Path; assert Path(sys.prefix).resolve()==Path(".venv").resolve(); print("新环境导入检查通过")'], target)

        print('3/5 暂停旧服务，复制并校验历史记录……', flush=True)
        running_now, _ = idle_service()
        if running_now:
            script(ROOT, 'stop.ps1')
            stopped = True
        shutil.copytree(ROOT / 'data', target / 'data')
        report['data_files_verified'] = verify_files(ROOT / 'data', target / 'data')
        original = database_snapshot(ROOT / 'data/favorite-clash.sqlite3')
        copied = database_snapshot(target / 'data/favorite-clash.sqlite3')
        if original != copied:
            raise RuntimeError('新旧数据库内容不一致。')
        report['database'] = copied

        print('4/5 从 W 盘启动并检查历史、暂停状态和手机地址……', flush=True)
        target_started = True
        script(target, 'start.ps1', '-NoBrowser', '-DataDir', str(target / 'data'))
        state = json.loads((target / '.runtime/server.json').read_text(encoding='utf-8'))
        if Path(state['project_root']).resolve() != target or Path(state['data_dir']).resolve() != target / 'data':
            raise RuntimeError('后台仍在使用其他目录。')
        health = get_json('/api/health')
        if health.get('model_paused') != bool(copied['model_pause']):
            raise RuntimeError('额度暂停状态没有保持一致。')
        if sorted(j['id'] for j in get_json('/api/jobs')['items']) != copied['job_ids']:
            raise RuntimeError('网页历史记录与迁移前不一致。')
        report['remote_check'] = '未配置私人地址'
        if remote.exists():
            remote_url = json.loads(remote.read_text(encoding='utf-8-sig'))['url']
            try:
                with httpx.Client(trust_env=False, timeout=20) as client:
                    response = client.get(remote_url + '/api/health')
                    response.raise_for_status()
                    assert response.json()['app'] == 'favorite-clash'
                report['remote_check'] = 'HTTPS 正常，证书校验开启'
            except (httpx.HTTPError, AssertionError) as error:
                report['remote_check'] = f'本地正常，私人地址暂未通过：{type(error).__name__}；请确认 Tailscale 已连接'
        print('5/5 保存迁移记录，更新旧目录入口……', flush=True)
        backup = ROOT / '.runtime/pre-migration-launchers'
        backup.mkdir(exist_ok=True)
        for name in ENTRY_NAMES:
            original_entry = ROOT / name
            original_bytes = original_entry.read_bytes()
            atomic_bytes(backup / name, original_bytes)
            forward = f'@echo off\r\nchcp 65001 >nul\r\nrem Project migrated; original files are retained as backup.\r\ncall "{target / name}"\r\n'
            atomic_bytes(original_entry, forward.encode('utf-8'))
            changed_entries[original_entry] = original_bytes
        report.update(status='completed', completed_at=datetime.now(timezone.utc).isoformat())
        write_json(target / 'docs/MIGRATION_RESULT.json', report)
        write_json(target / '.runtime/migration.json', report)
        write_json(ROOT / '.runtime/migration-to-w.json', report)
    except Exception as error:
        report.update(status='failed', error=str(error))
        for entry, original_bytes in changed_entries.items():
            try:
                atomic_bytes(entry, original_bytes)
            except Exception as restore_error:
                print(f'旧入口恢复未通过，请暂时不要使用 {entry.name}：{restore_error}', flush=True)
        safe_to_restart = not target_started
        if target_started:
            try:
                script(target, 'stop.ps1')
                try:
                    get_json('/api/health')
                    safe_to_restart = False
                except httpx.ConnectError:
                    safe_to_restart = True
            except Exception as stop_error:
                print(f'新服务停止检查未通过：{stop_error}', flush=True)
        if stopped and was_running and safe_to_restart:
            try:
                script(ROOT, 'start.ps1', '-NoBrowser', '-DataDir', str(ROOT / 'data'))
                restored, _ = idle_service()
                if not restored:
                    raise RuntimeError('未验证到原目录的运行实例。')
            except Exception as restart_error:
                print(f'原服务恢复未通过：{restart_error}', flush=True)
        elif stopped and was_running:
            print('未确认新服务完全停止，因此没有启动原服务；请交给助手核查。', flush=True)
        # Logging must never prevent recovery, nor touch another invocation's target.
        if target_created:
            for path in (target / '.runtime/migration.json', ROOT / '.runtime/migration-to-w.json'):
                try:
                    write_json(path, report)
                except Exception:
                    pass
        raise

    print(f'迁移完成：{target}\n历史记录：{len(copied["job_ids"])} 条\n手机网址保持不变。C 盘原目录已保留为备份。\n请将此结果告诉助手，以便核验并同步 Notion。', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Only inspect prerequisites; do not copy or stop services.')
    args = parser.parse_args()
    try:
        migrate(args.check)
    except Exception as exc:
        print(f'迁移未完成：{exc}\n原目录没有删除。请把这段提示发给助手。', file=sys.stderr)
        sys.exit(1)
