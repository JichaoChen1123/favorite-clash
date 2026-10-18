import asyncio
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app import model

spec = importlib.util.spec_from_file_location('finalize_update', Path(__file__).resolve().parents[1] / 'scripts/finalize_update.py')
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ActivationTests(unittest.TestCase):
    def test_running_jobs_prevent_restart(self):
        client = Mock()
        client.get.return_value.json.return_value = {'items': [{'id': 'busy', 'status': 'running'}]}
        with self.assertRaisesRegex(RuntimeError, '还有任务'):
            activation.snapshots(client)
        self.assertEqual(client.get.call_count, 1)

    def test_snapshots_include_full_result_content(self):
        client = Mock()
        client.get.return_value.json.side_effect = [
            {'items': [{'id': 'saved', 'status': 'completed'}]},
            {'id': 'saved', 'result': {'overview': 'original'}},
            {'items': [{'id': 'saved', 'status': 'completed'}]},
            {'id': 'saved', 'result': {'overview': 'changed'}},
        ]
        self.assertNotEqual(activation.snapshots(client), activation.snapshots(client))

    def test_quota_probe_pauses_and_never_retries(self):
        execute = AsyncMock(side_effect=model.QuotaError())
        with patch.object(model, '_structured', execute), patch('app.store.Store') as store:
            with self.assertRaises(model.QuotaError):
                asyncio.run(activation.probe())
        self.assertEqual(execute.await_count, 1)
        store.return_value.pause_model.assert_called_once()
