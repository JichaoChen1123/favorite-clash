"""Bounded real-model regression using one user-confirmed source excerpt."""
import asyncio
import copy
import json
import os
from pathlib import Path
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if not os.environ.get('CODEX_BINARY'):
    base = Path(os.environ['LOCALAPPDATA']) / 'OpenAI/Codex/bin'
    candidates = sorted(base.glob('*/codex.exe'), key=lambda path: path.stat().st_mtime, reverse=True)
    if candidates:
        os.environ['CODEX_BINARY'] = str(candidates[0])
os.environ['CLASH_MODEL'] = 'gpt-6.1-sol'
os.environ['CLASH_REASONING_EFFORT'] = 'high'
from app import model
from app.store import Store
from scripts.finalize_update import snapshots, service


async def check(folder, report):
    job = json.loads((folder / 'original-job.json').read_text(encoding='utf-8'))
    prepared = model._prepare_sources(job['sources'])
    sid = job['sources'][0]['id']
    source = prepared[sid]
    source['segments'] = {ident: segment for ident, segment in source['segments'].items()
                          if 139 <= segment['start'] <= 151}
    assert source['segments']['seg-0085']['text'] == '绝大部分的训练者脚尖会超过膝盖'
    prepared = {sid: source}
    specimen = {'overview': '核对高杠段的原话，不作训练建议。', 'open_questions': [], 'comparisons': [
        {'id': 'comparison-002', 'topic': '高杠段原话', 'classification': 'insufficient',
         'explanation': '这里只核对一个来源的原话，不比较其他来源。', 'perspectives': [
             {'source_id': sid, 'statement': '绝大部分的训练者膝盖会超过脚尖',
              'audience': '未说明', 'goal': '未说明', 'conditions': '未说明', 'limitations': '未说明',
              'evidence': [{'segment_id': 'seg-0085'}]}]}]}
    traces = []
    try:
        await model._audit_fidelity(specimen, prepared, traces.append)
    except model.QuotaError:
        raise
    except model.ModelError as exc:
        if exc.provider_error != 'evidence_mismatch':
            raise
        report['reversed_claim_rejected'] = True
    else:
        raise RuntimeError('反向归纳未被识别，未部署新版。')
    report['bad_case_traces'] = traces
    print('1/3 反向归纳已被真实模型复核拦截。', flush=True)
    specimen = copy.deepcopy(specimen)
    specimen['comparisons'][0]['perspectives'][0]['statement'] = '原文表述为：绝大部分的训练者脚尖会超过膝盖。'
    traces = []
    await model._audit_fidelity(specimen, prepared, traces.append)
    report.update(literal_claim_accepted=True, good_case_traces=traces)
    print('2/3 忠实保留原话的版本通过。', flush=True)


def main():
    folder = Path((ROOT / '.runtime/fidelity-fix-path.txt').read_text(encoding='utf-8').strip()).resolve()
    if not folder.is_relative_to((ROOT / '.runtime').resolve()):
        raise RuntimeError('验证记录目录超出项目运行目录。')
    report = {'status': 'failed', 'prompt_version': model.PROMPT_VERSION, 'tests': 'real excerpt regression, not full-video human acceptance'}
    try:
        asyncio.run(check(folder, report))
        with httpx.Client(trust_env=False, timeout=20) as client:
            before = snapshots(client)
            service('stop')
            service('start')
            response = client.get('http://127.0.0.1:8787/api/health')
            response.raise_for_status()
            if response.json()['status'] != 'ok' or snapshots(client) != before:
                raise RuntimeError('重启或历史核对未通过。')
            state = json.loads((ROOT / '.runtime/server.json').read_text(encoding='utf-8-sig'))
            if Path(state['project_root']).resolve() != ROOT.resolve():
                raise RuntimeError('后台目录不符。')
            report.update(status='passed_and_loaded', history_count=len(before), history_unchanged=True, server_pid=state['pid'])
        print('3/3 新版复核已加载，历史完整。', flush=True)
        return 0
    except model.QuotaError:
        Store(ROOT / 'data/favorite-clash.sqlite3').pause_model('忠实度回归测试遇到额度或限流，已暂停。')
        report['status'] = 'quota_pause'
        print('额度不足，已暂停，没有继续或自动重试。', flush=True)
        return 1
    except Exception as exc:
        report['error'] = str(exc)
        print('验证未通过：' + str(exc), flush=True)
        return 1
    finally:
        (folder / 'model-regression.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
