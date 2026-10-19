// Browser regression against a disposable server, never the live port 8787.
// Set PLAYWRIGHT_MODULE to a file URL when Playwright is supplied externally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2];
assert.ok(base, 'Pass the disposable server URL explicitly');
const address = new URL(base);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.port, '8790', 'Refuse to create QA records on the production port');
const output = new URL('../../.runtime/training-retry-qa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const overview = await (await context.request.get(base + '/api/training')).json();
  if (overview.active) {
    const record = overview.active;
    const cancel = await context.request.put(base + '/api/training/' + record.id, { data: { version: record.version, status: 'cancelled', exercises: record.exercises.map(x => ({ exercise_id: x.exercise_id, sets: x.sets })) } });
    assert.equal(cancel.status(), 200);
  }
  const created = await context.request.post(base + '/api/training', { data: { id: randomUUID(), exercise_ids: ['dumbbell-chest-press'] } });
  assert.equal(created.status(), 201);
  const session = await created.json();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const field = name => page.getByRole('textbox', { name, exact: true });
  async function add(name) {
    await button('添加动作').click(); await button('全部动作').click();
    await page.getByRole('checkbox', { name, exact: true }).check();
    await button('添加到本次训练').click();
  }
  const read = async () => (await context.request.get(base + '/api/training/' + session.id)).json();
  await page.goto(base + '/?view=training');
  await field('哑铃卧推第1组重量').fill('7.5'); await field('哑铃卧推第1组次数').fill('12');
  let rejectOnce = true;
  await page.route('**/api/training/*', async route => {
    if (rejectOnce && route.request().method() === 'PUT') {
      rejectOnce = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '隔离测试：保存失败' }) });
    } else await route.continue();
  });
  await add('徒手深蹲 防滑地面');
  await page.getByRole('alert').filter({ hasText: '保存未确认，当前输入仍保留' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Failed save must not trap the user in the picker');
  assert.equal(await button('查看徒手深蹲教学').count(), 1);
  assert.equal(await field('哑铃卧推第1组重量').inputValue(), '7.5');
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await page.screenshot({ path: new URL('save-failure.png', output).pathname.replace(/^\/(.:)/, '$1') });
  await button('保存记录').click(); await page.getByText('记录已保存', { exact: true }).waitFor();
  let saved = await read(); assert.equal(saved.exercises.length, 2);
  assert.equal(new Set(saved.exercises.map(x => x.exercise_id)).size, 2);
  assert.equal(saved.exercises[0].sets[0].weight_kg, 7.5);
  await page.reload(); assert.equal(await field('哑铃卧推第1组重量').inputValue(), '7.5');
  await page.getByRole('checkbox', { name: '完成哑铃卧推第1组', exact: true }).check();
  await page.getByText('正在休息', { exact: true }).waitFor();
  await field('哑铃卧推第2组重量').fill('9');
  await button('查看哑铃卧推教学').click(); await button('返回本次训练').click();
  assert.equal(await field('哑铃卧推第2组重量').inputValue(), '9');
  assert.equal(await page.getByText('正在休息', { exact: true }).isVisible(), true);
  await button('视频对照').click(); await button('训练').click();
  assert.equal(await field('哑铃卧推第2组重量').inputValue(), '9');
  await field('哑铃卧推第2组重量').fill('-');
  await add('哑铃弯举 一对哑铃或单只哑铃');
  await page.getByRole('alert').filter({ hasText: '重量需为' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Invalid input must remain editable after adding an action');
  assert.equal(await button('查看哑铃弯举教学').count(), 1);
  await field('哑铃卧推第2组重量').fill('9'); await button('保存记录').click();
  await page.getByText('记录已保存', { exact: true }).waitFor(); saved = await read();
  assert.equal(saved.exercises.length, 3); assert.equal(new Set(saved.exercises.map(x => x.exercise_id)).size, 3);
  await page.unroute('**/api/training/*');
  let loseResponse = true;
  await page.route('**/api/training/*', async route => {
    if (loseResponse && route.request().method() === 'PUT') {
      loseResponse = false; const result = await route.fetch(); assert.equal(result.status(), 200); await route.abort('failed');
    } else await route.continue();
  });
  await field('哑铃卧推第1组重量').fill('8'); await button('保存记录').click();
  await page.getByRole('alert').filter({ hasText: '保存未确认' }).waitFor();
  assert.equal((await read()).exercises[0].sets[0].weight_kg, 8, 'Simulate a saved request whose reply was lost');
  await field('哑铃卧推第1组重量').fill('8.5'); await button('保存记录').click();
  await page.getByRole('alert').filter({ hasText: '其他页面更新' }).waitFor();
  assert.equal(await field('哑铃卧推第1组重量').inputValue(), '8.5');
  await button('重新读取服务器记录').click(); await button('保留当前修改').click();
  assert.equal(await field('哑铃卧推第1组重量').inputValue(), '8.5');
  await button('重新读取服务器记录').click(); await button('确认重新读取').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="哑铃卧推第1组重量"]')?.value === '8');
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await button('结束训练').click(); await page.getByRole('heading', { name: '训练完成，收好这次进步' }).waitFor();
  assert.match(await page.locator('.training-summary').innerText(), /1个/);
  assert.match(await page.locator('.training-summary').innerText(), /1组/);
  await page.screenshot({ path: new URL('after.png', output).pathname.replace(/^\/(.:)/, '$1'), fullPage: true });
  await page.reload(); await button('训练历史').click();
  await page.locator('.training-history-card').filter({ hasText: '已完成' }).first().click();
  await page.getByRole('heading', { name: '训练完成，收好这次进步' }).waitFor();
  assert.match(await page.locator('.training-history-sets').innerText(), /8 kg × 12 次/);
  assert.deepEqual(errors, []);
  const report = { status: 'passed', environment: 'disposable server only', cases: ['503 retry without duplicate actions', 'saved rows survive reload', 'teaching and menu preserve drafts and timer', 'invalid input stays editable after adding action', 'committed request with lost reply and 409 recovery', '360 layout', 'completion summary and history reopen'], modelRequests: 0 };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
