const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const runtime = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || path.join(process.cwd(), 'node_modules'), 'package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const input = path.join(process.cwd(), 'public', 'sample-data.json');
const inputRows = JSON.parse(fs.readFileSync(input, 'utf8')).data.length;

async function checkPlot(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let colored = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 120 || data[i + 1] > 120 || data[i + 2] > 120) colored++;
  }
  assert(colored > 700, `Tree plot is blank (${colored} colored pixels)`);
  return colored;
}

(async () => {
  fs.mkdirSync('test-artifacts', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.model-link').count(), 2);
    await page.screenshot({ path: 'test-artifacts/home.png', fullPage: true });
    await page.getByRole('link', { name: /Isolation Forest/ }).click();
    assert.match(page.url(), /isolation-forest\.html$/);
    await page.locator('#fileInput').setInputFiles(input);
    await page.waitForFunction(() => !document.querySelector('#analyzeButton').disabled);
    assert.equal(await page.locator('#fieldChoices input:checked').count(), 3);
    await page.locator('#analyzeButton').click();
    await page.waitForFunction(() => !document.querySelector('#downloadResult').disabled, null, { timeout: 30000 });
    assert.equal(await page.locator('#totalMetric').textContent(), String(inputRows));
    assert.equal(await page.locator('#anomalyMetric').textContent(), String(Math.ceil(inputRows * 0.1)));
    assert.equal(await page.locator('#pipeline .is-done').count(), 4);
    assert.equal(await page.locator('#treePlot .plot-point').count(), inputRows);
    const cutCount = Number((await page.locator('#cutPosition').textContent()).split('/')[1].trim());
    assert(cutCount > 1);
    await page.locator('#nextCut').click();
    assert.equal(await page.locator('#cutPosition').textContent(), `2 / ${cutCount}`);
    const bright = await checkPlot(await page.locator('#treePlot').screenshot({ path: 'test-artifacts/isolation-plot.png' }));
    await page.screenshot({ path: 'test-artifacts/isolation-desktop.png', fullPage: true });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadResult').click();
    await (await downloadPromise).saveAs('test-artifacts/sample-isolation-results.json');
    const output = JSON.parse(fs.readFileSync('test-artifacts/sample-isolation-results.json', 'utf8'));
    assert.equal(output.results.length, inputRows);
    assert.equal(output.configuration.algorithm, 'Isolation Forest');
    assert.equal(output.features.length, 3);
    assert(output.results.every((row) => row.isAnomaly === (row.score > 0)));
    await page.locator('#onlyAnomalies').check();
    assert.equal(await page.locator('#resultRows tr').count(), Math.ceil(inputRows * 0.1));
    await page.getByRole('link', { name: 'Trang chủ' }).click();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.getByRole('link', { name: /Random Cut Forest/ }).click();
    assert.match(page.url(), /rcf\.html$/);
    await page.locator('#scene canvas').waitFor();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto('http://127.0.0.1:5173/isolation-forest.html', { waitUntil: 'networkidle' });
    await mobile.locator('#fileInput').setInputFiles(input);
    await mobile.waitForFunction(() => !document.querySelector('#analyzeButton').disabled);
    await mobile.locator('#analyzeButton').click();
    await mobile.waitForFunction(() => !document.querySelector('#downloadResult').disabled, null, { timeout: 30000 });
    assert.equal(await mobile.locator('#totalMetric').textContent(), String(inputRows));
    const widths = await mobile.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(widths.scroll <= widths.width, `Mobile overflow: ${JSON.stringify(widths)}`);
    await mobile.screenshot({ path: 'test-artifacts/isolation-mobile.png', fullPage: true });
    await mobile.setViewportSize({ width: 320, height: 700 });
    const narrow = await mobile.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(narrow.scroll <= narrow.width, `Narrow mobile overflow: ${JSON.stringify(narrow)}`);
    await mobile.screenshot({ path: 'test-artifacts/isolation-mobile-narrow.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, rows: output.summary.total, anomalies: output.summary.anomalies, plotBrightPixels: bright }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
