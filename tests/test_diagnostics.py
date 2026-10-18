import json
import unittest
from unittest.mock import AsyncMock, patch

from app import model


class DiagnosticTests(unittest.IsolatedAsyncioTestCase):
    async def call_failure(self, stdout='', stderr='', code=1, exception=None):
        traces = []
        executor = AsyncMock(side_effect=exception) if exception else AsyncMock(return_value=(code, stdout, stderr))
        with patch.object(model, '_resolve_binary', return_value='selected-cli.exe'), patch.object(model, '_execute', executor):
            with self.assertRaises(model.ModelError) as caught:
                await model._structured('test', model.Extraction, 'extract:test', traces.append)
        return caught.exception, traces[0]

    async def test_real_unsupported_model_shape_keeps_safe_diagnostic_and_exit(self):
        event = {'type': 'error', 'message': "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. token=private-secret"}
        error, trace = await self.call_failure(json.dumps(event))
        self.assertEqual(trace['provider_error'], 'model_unavailable')
        self.assertEqual(trace['exit_code'], 1)
        self.assertEqual(trace['cli_binary'], 'selected-cli.exe')
        self.assertIn('不兼容', str(error))
        self.assertNotIn('private-secret', str(error) + json.dumps(trace))

    async def test_stderr_transport_error_is_safe_and_distinct(self):
        error, trace = await self.call_failure(stderr='ERROR: connection refused credential=private-secret')
        self.assertEqual(trace['provider_error'], 'network_failed')
        self.assertNotIn('private-secret', str(error) + json.dumps(trace))

    async def test_failed_turn_authentication_is_distinct(self):
        error, trace = await self.call_failure(json.dumps({'type': 'turn.failed', 'error': {'message': '401 Unauthorized'}}))
        self.assertEqual(trace['provider_error'], 'authentication_failed')
        self.assertIn('登录', str(error))

    async def test_sandbox_appserver_permission_error_is_distinct_from_account_failure(self):
        error, trace = await self.call_failure(stderr='Error: failed to initialize in-process app-server client: 拒绝访问。 (os error 5)')
        self.assertEqual(trace['provider_error'], 'runtime_permission_denied')
        self.assertIn('桌面', str(error))
        self.assertNotIsInstance(error, model.QuotaError)

    async def test_echoed_agent_content_is_not_provider_diagnostic(self):
        stdout = json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'model is not supported; not logged in'}})
        _, trace = await self.call_failure(stdout)
        self.assertEqual(trace['provider_error'], 'generation_failed')

    async def test_timeout_without_exit_code_remains_diagnosable(self):
        _, trace = await self.call_failure(exception=model.ModelError('响应超时', provider_error='timeout'))
        self.assertEqual(trace['provider_error'], 'timeout')
        self.assertIsNone(trace['exit_code'])

    async def test_invalid_json_traces_format_error_without_raw_stderr(self):
        stdout = '\n'.join(json.dumps(e) for e in [
            {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': '{bad json'}},
            {'type': 'turn.completed', 'usage': {}},
        ])
        _, trace = await self.call_failure(stdout, code=0)
        self.assertEqual(trace['provider_error'], 'invalid_output')
        self.assertEqual(trace['exit_code'], 0)

    async def test_unknown_failure_does_not_store_stderr(self):
        error, trace = await self.call_failure(stderr='ERROR: private-secret unrecognized failure')
        self.assertEqual(trace['provider_error'], 'generation_failed')
        self.assertNotIn('private-secret', str(error) + json.dumps(trace))

    async def test_quota_stays_prioritized_and_is_not_model_incompatibility(self):
        error, trace = await self.call_failure(json.dumps({'type': 'error', 'code': 'insufficient_quota', 'message': 'model not supported'}))
        self.assertIsInstance(error, model.QuotaError)
        self.assertEqual(trace['provider_error'], 'quota_or_rate_limit')


if __name__ == '__main__':
    unittest.main()
