"""Integration validation using real transcripts from prepare_validation_sources.

Imports snapshots produced by the real video module (no fabricated transcripts),
then runs the production worker, provider, evidence validator and SQLite storage.
This staged test is distinct from the separate paste-link browser/API test.
"""
from __future__ import annotations
import asyncio
import json
from pathlib import Path
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.main import Manager, DATA
from app.model import MODEL_NAME, PROMPT_VERSION
from app.store import Store, now


async def run():
    store = Store(DATA / 'favorite-clash.sqlite3')
    manager = Manager(store)
    report_path = ROOT / '.cache' / 'real-validation-jobs.json'
    report = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {'method':'real ingestion snapshots → production worker → model → SQLite; staged integration, not browser-paste E2E', 'groups':[]}
    for index in range(3):
        for _ in range(120):
            fixture = json.loads((ROOT / '.cache' / 'validation_sources.json').read_text(encoding='utf-8'))
            groups = fixture.get('groups', [])
            if len(groups) > index and len(groups[index]['sources']) == 2 and all(s.get('segments') for s in groups[index]['sources']):
                break
            await asyncio.sleep(5)
        else:
            raise RuntimeError('Real source snapshots not ready; no results fabricated.')
        group = groups[index]
        existing = next((r for r in report['groups'] if r['group'] == group['id']), None)
        if existing and (old := store.get(existing['job_id'])) and old['status'] == 'completed':
            print(group['id'], 'already completed', flush=True)
            continue
        created, ident = now(), uuid4().hex
        job = {'id':ident, 'question':group['question'], 'status':'queued', 'stage':'真实素材集成验收',
               'progress':0,'created_at':created,'updated_at':created,'error':None,
               'sources':group['sources'],'result':None,'feedback':[],'model':MODEL_NAME,
               'prompt_version':PROMPT_VERSION,'validation_method':'staged_real_ingestion'}
        store.create(job)
        row = {'group':group['id'],'job_id':ident,'url':f'http://127.0.0.1:8787/?job={ident}','status':'running'}
        if existing:
            report['groups'].remove(existing)
        report['groups'].append(row)
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(group['id'], ident, 'started', flush=True)
        await manager.run(ident)
        result = store.get(ident)
        row.update(status=result['status'],error=result['error'],finished_at=now())
        if result['result']:
            row['classifications']=[c['classification'] for c in result['result']['comparisons']]
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(group['id'],row['status'],row.get('error') or row.get('classifications'),flush=True)


if __name__ == '__main__':
    asyncio.run(run())
