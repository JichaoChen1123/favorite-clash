"""Run explicit independent scope rechecks against previously saved real ASR.

No audio is listened to or retranscribed; old jobs and results are never updated.
"""
from __future__ import annotations
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import model
from app.main import Manager
from app.store import Store, now

OUTPUT = ROOT / '.cache' / 'scope-recheck.json'
DATABASE = ROOT / 'data' / 'favorite-clash.sqlite3'
CASES = [('squat', '6a158ecb363841b983b5cdc0884b1af1', 'BV119GCzEEvM-p1', 'seg-0005', '新手'),
         ('protein', '132139b48d8043048d2230bd826670bb', 'BV1ti421v7CQ-p1', 'seg-0006', '自然')]

async def main():
    store = Store(DATABASE)
    manager = Manager(store)
    report = {'kind': 'real_saved_transcript_scope_recheck', 'created_at': now(),
              'model': model.MODEL_NAME, 'prompt_version': model.PROMPT_VERSION,
              'schema_version': model.SCHEMA_VERSION, 'validation_version': model.VALIDATION_VERSION,
              'method': 'Independent new jobs run through production Manager using complete saved real ASR transcripts; no audio listening or scientific fact-checking.',
              'cases': []}
    def save():
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    for name, original_id, target_source_id, target_segment_id, expected_term in CASES:
        old = store.get(original_id)
        if not old or old['status'] != 'completed':
            raise RuntimeError('Missing completed reference job')
        old_result = deepcopy(old['result'])
        job = deepcopy(old)
        job.update(id=uuid4().hex, created_at=now(), updated_at=now(), status='queued', progress=0,
                   stage='新版全片范围复核，复用已保存的完整机器转写', error=None, result=None,
                   feedback=[], model=model.MODEL_NAME, prompt_version=model.PROMPT_VERSION)
        for source in job['sources']:
            source.update(status='ready', error=None)
        store.create(job)
        entry = {'name': name, 'original_job_id': original_id, 'new_job_id': job['id'],
                 'scope_expectation': {'source_id': target_source_id, 'segment_id': target_segment_id,
                                       'expected_term': expected_term}, 'status': 'running'}
        report['cases'].append(entry)
        save()
        print('START', name, job['id'], flush=True)
        manager.submit(job['id'])
        task = manager.tasks[job['id']]
        await task
        result = store.get(job['id'])
        entry.update(status=result['status'], error=result.get('error'), result=result.get('result'))
        with sqlite3.connect('file:'+str(DATABASE)+'?mode=ro', uri=True) as db:
            run_id = db.execute('SELECT id FROM runs WHERE job_id=? ORDER BY id DESC LIMIT 1',(job['id'],)).fetchone()[0]
            entry['traces'] = [json.loads(row[0]) for row in db.execute('SELECT document FROM traces WHERE run_id=? ORDER BY id',(run_id,))]
        entry['original_result_unchanged'] = store.get(original_id)['result'] == old_result
        extraction = next((json.loads(trace['raw']) for trace in entry['traces'] if trace['stage'] == 'extract:'+target_source_id), None)
        source = next(s for s in result['sources'] if s['id']==target_source_id)
        entry['named_segment'] = next(s for s in source['segments'] if s['id']==target_segment_id)
        if extraction:
            context = extraction['source_context']
            entry['scope_context'] = context
            entry['scope_contains_expected_term'] = any(expected_term in field['value'] for field in context.values())
            entry['scope_cites_named_segment'] = any(target_segment_id in field['segment_ids'] for field in context.values())
            perspectives = [p for card in (result.get('result') or {}).get('comparisons',[]) for p in card['perspectives'] if p['source_id']==target_source_id and p['evidence']]
            entry['perspectives_show_scope'] = any(expected_term in ' '.join(p[field] for field in ('audience','goal','conditions')) for p in perspectives)
            entry['perspectives_cite_named_segment'] = any(any(e['segment_id']==target_segment_id for e in p['evidence']) for p in perspectives)
        entry['passed'] = result['status']=='completed' and entry['original_result_unchanged'] and all(entry.get(k,False) for k in ('scope_contains_expected_term','scope_cites_named_segment','perspectives_show_scope','perspectives_cite_named_segment'))
        save()
        print('DONE', name, entry['status'], 'passed', entry['passed'], entry.get('error'), flush=True)
    report['passed'] = all(case['passed'] for case in report['cases'])
    save()
    print('REPORT', report['passed'], OUTPUT, flush=True)

if __name__ == '__main__':
    asyncio.run(main())
