"""Desktop-only activation after files were updated and tested in the workspace."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / '.runtime' / 'maintenance-result.json'


def service(action: str):
    shell = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    command = [str(shell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
               '-File', str(ROOT / 'scripts' / f'{action}.ps1')]
    if action == 'start':
        command.append('-NoBrowser')
    with (ROOT / '.runtime' / 'update-activation.log').open('ab') as output:
        subprocess.run(command, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                       timeout=60, check=True, creationflags=subprocess.CREATE_NO_WINDOW)


def snapshots(client):
    response = client.get('http://127.0.0.1:8787/api/jobs')
    response.raise_for_status()
    jobs = response.json()['items']
    if any(job['status'] in ('running', 'queued') for job in jobs):
        raise RuntimeError('还有任务正在处理，未重启后台；请处理完成后再运行。')
    result = {}
    for job in jobs:
        response = client.get('http://127.0.0.1:8787/api/jobs/' + job['id'])
        response.raise_for_status()
        encoded = json.dumps(response.json(), sort_keys=True, ensure_ascii=False).encode('utf-8')
        result[job['id']] = hashlib.sha256(encoded).hexdigest()
    return result


async def probe():
    # Match the normal desktop startup selection, preserving an explicit override.
    if not os.environ.get('CODEX_BINARY'):
        folder = Path(os.environ['LOCALAPPDATA']) / 'OpenAI' / 'Codex' / 'bin'
        candidates = sorted(folder.glob('*/codex.exe'), key=lambda path: path.stat().st_mtime, reverse=True)
        if candidates:
            os.environ['CODEX_BINARY'] = str(candidates[0])
    os.environ.setdefault('CLASH_MODEL_TIMEOUT', '45')
    os.environ['CLASH_MODEL'] = 'gpt-6.1-sol'
    os.environ['CLASH_REASONING_EFFORT'] = 'high'
    sys.path.insert(0, str(ROOT))
    from app import model
    class Probe(model.StrictModel):
        ok: bool
    traces = []
    try:
        answer = await model._structured('Return only the required JSON object with ok true.',
                                         Probe, 'desktop-update-activation', traces.append)
        if not answer.ok:
            raise RuntimeError('模型检查结果未通过。')
        return {'status': 'passed', 'cli_binary': model._resolve_binary(), 'traces': traces}
    except model.QuotaError:
        from app.store import Store
        Store(ROOT / 'data' / 'favorite-clash.sqlite3').pause_model('模型激活检查遇到额度或限流，等待手动确认。')
        raise


def main():
    report = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.is_file() else {}
    try:
        with httpx.Client(trust_env=False, timeout=20) as client:
            before = snapshots(client)
            if report.get('status') == 'active_verified':
                print('更新已生效，无需重复检查模型。', flush=True)
                return 0
            print('1/3 历史检查通过，正在安全重启后台……', flush=True)
            service('stop')
            service('start')
            print('2/3 核对新后台和历史……', flush=True)
            response = client.get('http://127.0.0.1:8787/api/health')
            response.raise_for_status()
            state = json.loads((ROOT / '.runtime/server.json').read_text(encoding='utf-8-sig'))
            if response.json().get('status') != 'ok' or Path(state['project_root']).resolve() != ROOT.resolve():
                raise RuntimeError('后台身份或健康检查未通过。')
            if snapshots(client) != before:
                raise RuntimeError('历史内容与更新前不一致，请保留窗口并联系助手。')
            print('3/3 验证一次最小模型请求，最长等待45秒……', flush=True)
            report['model_probe'] = asyncio.run(probe())
            report.update(status='active_verified', history_count=len(before), history_unchanged=True,
                          server_pid=state['pid'], activated_at=datetime.now(timezone.utc).isoformat())
            print('完成：补丁已生效，后台与模型正常，历史完整。请告诉助手“更新已生效”。', flush=True)
            return 0
    except Exception as exc:
        report.update(status='activation_not_verified', activation_error=str(exc))
        print('未通过：' + str(exc), flush=True)
        print('没有自动重试模型；报告已保存。请把结果告诉助手。', flush=True)
        return 1
    finally:
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
