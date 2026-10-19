// Local request-boundary tests. No browser, network or model requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { api } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const timers = [];
globalThis.setTimeout = (callback, delay, ...args) => { timers.push(delay); return originalTimeout(callback, delay, ...args); };
const cases = [];
const stalled = (_url, { signal }) => new Promise((_, reject) => {
  const cancel = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
});
try {
  globalThis.fetch = async (url, request) => {
    assert.equal(url, '/api/example'); assert.equal(request.headers.get('Content-Type'), 'application/json');
    assert.equal(request.headers.get('X-Test'), 'ok'); return Response.json({ ok: true });
  };
  assert.deepEqual(await api('/example', { method: 'POST', headers: { 'X-Test': 'ok' }, body: '{}' }), { ok: true });
  assert.equal(timers.at(-1), 30000); cases.push('Successful JSON write retains headers and returns response');
  globalThis.fetch = async () => Response.json({ ok: true });
  await api('/jobs'); assert.equal(timers.at(-1), 20000);
  await api('/videos/resolve', { method: 'POST', body: '{}' }); assert.equal(timers.at(-1), 45000);
  const form = new FormData(); form.append('subtitle', 'example');
  globalThis.fetch = async (_url, request) => { assert.equal(request.body, form); assert.equal(request.headers.has('Content-Type'), false); return Response.json({ ok: true }); };
  await api('/upload', { method: 'POST', body: form }); assert.equal(timers.at(-1), 90000);
  cases.push('Reads, video lookup and multipart upload use separate deadlines');
  globalThis.fetch = stalled;
  await assert.rejects(api('/jobs', { timeoutMs: 15 }), error => /超时/.test(error.message) && !/可能已保存/.test(error.message));
  cases.push('Stalled reads stop waiting and give a Chinese connection hint');
  let writes = 0;
  globalThis.fetch = (...args) => { writes++; return stalled(...args); };
  await assert.rejects(api('/training/example', { method: 'PUT', body: '{}', timeoutMs: 15 }), /可能已保存.*避免重复提交/);
  assert.equal(writes, 1); cases.push('Unconfirmed writes are not automatically retried');
  globalThis.fetch = async (_url, request) => ({ ok: true, json: () => stalled('', request) });
  await assert.rejects(api('/jobs', { timeoutMs: 15 }), /超时/);
  cases.push('Deadline includes reading the response body');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('/jobs'), /暂时连接不上服务.*Tailscale/);
  await assert.rejects(api('/jobs', { method: 'POST' }), /可能已保存/);
  cases.push('Offline failures are readable and distinguish unconfirmed writes');
  globalThis.fetch = async () => Response.json({ detail: '额度不足，已暂停' }, { status: 403 });
  await assert.rejects(api('/jobs'), error => error.message === '额度不足，已暂停');
  cases.push('Backend errors including quota protection stay intact');
  globalThis.fetch = async () => new Response('<html>bad</html>');
  await assert.rejects(api('/jobs'), /无法读取/); cases.push('Invalid response content is reported');
  globalThis.fetch = stalled;
  const controller = new AbortController(); const pending = api('/jobs', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(api('/jobs', { signal: cancelled.signal }), error => error.name === 'AbortError');
  cases.push('Caller cancellation is preserved before and during requests');
  console.log(JSON.stringify({ status: 'passed', cases, networkRequests: 0, realModelRequests: 0 }));
} finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; }
