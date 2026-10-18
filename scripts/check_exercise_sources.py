"""Check published teaching-page metadata, without downloading media."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re

import httpx

ROOT = Path(__file__).resolve().parents[1]


def check(item):
    try:
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=True) as client:
            response = client.get(item['source']['url'])
        content = response.text
        title = re.search(r'<title[^>]*>(.*?)</title>', content, flags=re.I | re.S)
        video = bool(re.search(r'video-js|data-video-id|videoId|brightcove|<video\b', content, re.I))
        return {'id':item['id'], 'url':str(response.url), 'http_status':response.status_code,
                'title':re.sub(r'\s+', ' ', title[1]).strip() if title else None,
                'video_markup_present':video, 'playback_verified':False}
    except Exception as exc:
        return {'id':item['id'], 'error':type(exc).__name__, 'playback_verified':False}


if __name__ == '__main__':
    items = json.loads((ROOT / 'app/exercises.json').read_text(encoding='utf-8'))['items']
    with ThreadPoolExecutor(max_workers=4) as pool:
        report = {'checked_at':datetime.now(timezone.utc).isoformat(), 'scope':'Teaching pages only; no media download or playback claim.', 'items':list(pool.map(check, items))}
    target = ROOT / '.runtime' / 'exercise-sources.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
