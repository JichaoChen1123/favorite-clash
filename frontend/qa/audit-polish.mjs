// UI and weak-network acceptance on an explicitly disposable server.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2];
assert.equal(new URL(base).hostname, '127.0.0.1'); assert.equal(new URL(base).port, '8790');
const out = new URL('../../.runtime/polish-qa/', import.meta.url); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const cases = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => original(fn, delay === 8000 ? 150 : delay, ...args);
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { detail: 'QA forbids video processing' } });
    return route.continue();
  });
  await page.route('**/models/ecorche/*.glb', async route => { await new Promise(resolve => setTimeout(resolve, 2000)); await route.abort().catch(() => {}); });
  const button = name => page.getByRole('button', { name, exact: true });
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(base + '/');
  await page.getByText('加载比平时慢，可以先从肌群列表选择。', { exact: true }).waitFor();
  await page.getByRole('progressbar', { name: '人体模型加载进度' }).waitFor();
  await button('先从列表选择').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'muscle-picker');
  await button('选择胸部').click(); await button('确认，进入胸部').click();
  await button('查看跪姿俯卧撑教学').click();
  const font = await page.locator('.exercise-dialog .exercise-description').evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
  assert.ok(font >= 14); await noOverflow(); await button('返回动作列表').click();
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow();
  await page.screenshot({ path: new URL('actions-360.png', out).pathname.replace(/^\/(.:)/, '$1'), fullPage: true });
  cases.push('Slow model shows progress and direct list selection; keyboard focus follows list entry');
  cases.push('Mobile teaching body at least 14px; 390/360 action and dialog layout does not overflow');
  await button('训练').click(); await page.locator('.training-heading').waitFor();
  const inputFont = await page.getByRole('textbox', { name: '休息秒数', exact: true }).evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
  assert.ok(inputFont >= 16); await noOverflow();
  await page.screenshot({ path: new URL('training-360.png', out).pathname.replace(/^\/(.:)/, '$1'), fullPage: true });
  cases.push('Mobile rest input uses 16px and training remains within viewport');
  const network = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await network.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => original(fn, delay === 20000 ? 180 : delay, ...args);
  });
  const net = await network.newPage(); net.on('pageerror', e => errors.push(e.message));
  let reads = 0;
  await net.route('**/api/jobs', async route => {
    reads++;
    if (reads === 1) { await new Promise(resolve => setTimeout(resolve, 1000)); await route.abort().catch(() => {}); }
    else await route.fulfill({ json: { items: [] } });
  });
  await net.goto(base + '/?view=history');
  await net.getByRole('alert').filter({ hasText: '等待服务响应超时' }).waitFor();
  await net.getByRole('heading', { name: '暂时无法读取历史', exact: true }).waitFor();
  assert.equal(await net.getByRole('heading', { name: '这里还没有对照', exact: true }).count(), 0);
  assert.equal(reads, 1);
  await net.getByRole('button', { name: '刷新', exact: true }).click();
  await net.getByRole('heading', { name: '这里还没有对照', exact: true }).waitFor();
  assert.equal(await net.getByRole('alert').count(), 0); assert.equal(reads, 2);
  cases.push('History timeout is not presented as empty data; manual refresh recovers without automatic retry');
  await net.route('**/api/jobs', route => route.abort('internetdisconnected'));
  await net.getByRole('button', { name: '刷新', exact: true }).click();
  await net.getByRole('alert').filter({ hasText: '暂时连接不上服务' }).waitFor();
  cases.push('Disconnected network displays actionable Chinese guidance');
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(base + '/');
  await page.locator('.muscle-picker').waitFor(); await noOverflow();
  await page.screenshot({ path: new URL('desktop-1280.png', out).pathname.replace(/^\/(.:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { status: 'passed', cases, realModelRequests: 0, physicalPhoneNotRetested: true };
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
