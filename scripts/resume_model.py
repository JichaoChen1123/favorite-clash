"""Explicit local action after the user has confirmed their quota is available."""
from pathlib import Path
import os
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from app.store import Store

data = Path(os.environ.get('CLASH_DATA_DIR', str(root / 'data')))
store = Store(data / 'favorite-clash.sqlite3')
if store.model_pause():
    store.resume_model()
    print('额度暂停保护已解除。请回到网页手动重试；旧任务不会自动运行。')
else:
    print('目前没有额度暂停记录，无需恢复。')
