import assert from 'node:assert/strict';

const base = process.env.CLASH_QA_URL || 'http://127.0.0.1:8787';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Pass at least one real completed job ID.');
const classes = new Set(['agreement', 'different_conditions', 'conflict', 'insufficient', 'different_topic']);
for (const id of ids) {
  const response = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`);
  assert.equal(response.status, 200);
  const job = await response.json();
  assert.equal(job.status, 'completed');
  assert.ok(job.result);
  assert.ok(job.sources.length >= 2 && job.sources.length <= 3);
  const sources = new Map(job.sources.map(source => [source.id, source]));
  const counts = {};
  let evidenceCount = 0;
  for (const source of job.sources) assert.ok(source.duration <= 1200);
  for (const comparison of job.result.comparisons) {
    assert.ok(classes.has(comparison.classification));
    counts[comparison.classification] = (counts[comparison.classification] || 0) + 1;
    for (const perspective of comparison.perspectives) {
      assert.ok(sources.has(perspective.source_id));
      for (const key of ['statement', 'audience', 'goal', 'conditions', 'limitations']) assert.equal(typeof perspective[key], 'string');
      for (const evidence of perspective.evidence) {
        const source = sources.get(evidence.source_id);
        assert.ok(source);
        assert.equal(evidence.source_id, perspective.source_id);
        const segment = source.segments.find(segment => segment.id === evidence.segment_id);
        assert.ok(segment);
        assert.equal(evidence.text, segment.text);
        assert.equal(evidence.start, segment.start);
        assert.equal(evidence.end, segment.end);
        assert.ok(evidence.context.some(segment => segment.id === evidence.segment_id));
        for (const context of evidence.context) {
          const original = source.segments.find(segment => segment.id === context.id);
          assert.ok(original, 'Context must refer to a real stored subtitle segment');
          assert.deepEqual(context, original, 'Context text and timing must match stored subtitles');
        }
        assert.ok(evidence.start >= 0 && evidence.end <= source.duration + 3);
        const url = new URL(evidence.url);
        assert.equal(url.protocol, 'https:');
        assert.ok(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'));
        assert.ok(url.pathname.includes(source.bvid));
        assert.equal(Number(url.searchParams.get('p') || 1), source.page);
        assert.ok(Math.abs(Number(url.searchParams.get('t')) - evidence.start) < 1);
        evidenceCount++;
      }
    }
  }
  assert.ok(evidenceCount > 0);
  const reloaded = await (await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`)).json();
  assert.deepEqual(reloaded.result, job.result);
  console.log(JSON.stringify({ id, status: job.status, sources: job.sources.length, transcript_kinds: job.sources.map(source => source.transcript_kind), comparisons: job.result.comparisons.length, evidence: evidenceCount, classifications: counts, persisted_result: true }));
}
