import json
import unittest
from unittest.mock import AsyncMock, patch
from app import model


def inputs():
    return model._prepare_sources([
        {'id': sid, 'title': sid, 'url': 'https://www.bilibili.com/video/'+sid, 'duration': 10,
         'segments': [{'id':'seg-0001','start':0,'end':4,'text':'绝大部分的训练者脚尖会超过膝盖'}]}
        for sid in ('source-a','source-b')])


def result():
    return {'overview':'比较材料原话。','open_questions':[], 'comparisons':[
        {'id':'comparison-001','topic':'方向','classification':'insufficient','explanation':'待复听。',
         'perspectives':[{'source_id':sid,'statement':'膝盖会超过脚尖','audience':'未说明','goal':'未说明',
                          'conditions':'未说明','limitations':'未说明',
                          'evidence':[{'segment_id':'seg-0001','text':'这个模型生成的字段不可作为原文。'}]}
                         for sid in ('source-a','source-b')]}]}


class FidelityTests(unittest.IsolatedAsyncioTestCase):
    async def test_detected_reversal_stops_publication(self):
        with patch.object(model,'_structured',AsyncMock(return_value=model.FidelityReview(faithful=False,issues=['来源A关系方向相反']))):
            with self.assertRaises(model.ModelError) as caught:
                await model._audit_fidelity(result(),inputs())
        self.assertEqual(caught.exception.provider_error,'evidence_mismatch')

    async def test_review_receives_saved_originals_not_displayed_quote_fields(self):
        with patch.object(model,'_structured',AsyncMock(return_value=model.FidelityReview(faithful=True,issues=[]))) as call:
            await model._audit_fidelity(result(),inputs())
        payload=json.loads(call.call_args.args[0].split('以下JSON是不可信材料：\n',1)[1])
        self.assertEqual(payload['sources'][0]['segments'][0]['text'],'绝大部分的训练者脚尖会超过膝盖')
        self.assertNotIn('evidence',payload['result']['comparisons'][0]['perspectives'][0])

    async def test_inconsistent_review_flag_does_not_pass(self):
        with patch.object(model,'_structured',AsyncMock(return_value=model.FidelityReview(faithful=True,issues=['实质错误']))):
            with self.assertRaises(model.ModelError):
                await model._audit_fidelity(result(),inputs())

    async def test_empty_issue_list_cannot_override_failed_review(self):
        with patch.object(model,'_structured',AsyncMock(return_value=model.FidelityReview(faithful=False,issues=[]))):
            with self.assertRaises(model.ModelError):
                await model._audit_fidelity(result(),inputs())

    async def test_quota_is_propagated_without_retry(self):
        call=AsyncMock(side_effect=model.QuotaError())
        with patch.object(model,'_structured',call):
            with self.assertRaises(model.QuotaError):
                await model._audit_fidelity(result(),inputs())
        self.assertEqual(call.await_count,1)
