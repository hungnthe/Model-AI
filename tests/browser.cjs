const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const runtime = createRequire(path.join(process.env.PLAYWRIGHT_NODE_MODULES || path.join(process.cwd(), 'node_modules'), 'package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');

async function pixels(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let bright = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.max(data[i], data[i + 1], data[i + 2]) > 70) bright += 1;
  }
  assert(bright > 600, `Canvas is blank (${bright} bright pixels)`);
  return { data, bright };
}

(async () => {
  fs.mkdirSync('test-artifacts', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.locator('#scene canvas').waitFor();
    assert(await page.locator('#analyzeButton').isDisabled());
    await page.locator('#sampleButton').click();
    await page.waitForFunction(() => !document.querySelector('#analyzeButton').disabled);
    assert.equal(await page.locator('#fieldChoices input:checked').count(), 3);
    await page.locator('#analyzeButton').click();
    await page.waitForFunction(() => !document.querySelector('#downloadResult').disabled, { timeout: 30000 });
    assert.equal(await page.locator('#totalMetric').textContent(), '50');
    assert.equal(await page.locator('#pipeline .is-done').count(), 6);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadResult').click();
    const download = await downloadPromise;
    await download.saveAs('test-artifacts/sample-results.json');
    const result = JSON.parse(fs.readFileSync('test-artifacts/sample-results.json', 'utf8'));
    assert.equal(result.results.length, 50);
    assert.equal(result.configuration.mode, 'batch');
    assert(result.results[48].isAnomaly && result.results[49].isAnomaly);
    assert(result.results.every((row) => row.isAnomaly === (row.score >= row.threshold)));
    assert.equal(result.results[0].input.id, 'sensor-001');
    await page.locator('#onlyAnomalies').check();
    assert.equal(await page.locator('#resultRows tr').count(), result.summary.anomalies);
    await page.locator('#onlyAnomalies').uncheck();
    await page.locator('#nextPage').click();
    assert.match(await page.locator('#pageInfo').textContent(), /^9/);
    await page.locator('#prevPage').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'test-artifacts/desktop.png', fullPage: true });
    const firstPixels = await pixels(await page.locator('#scene canvas').screenshot());
    await page.waitForTimeout(400);
    const secondPixels = await pixels(await page.locator('#scene canvas').screenshot());
    let moved = 0;
    for (let i = 0; i < firstPixels.data.length; i++) {
      if (Math.abs(firstPixels.data[i] - secondPixels.data[i]) > 15) moved++;
    }
    assert(moved > 200, `Canvas does not move (${moved} changed channels)`);
    await page.locator('#pauseScene').click();
    assert.match(await page.locator('#pauseScene').getAttribute('aria-label'), /Tiếp tục/);
    await page.locator('#resetScene').click();
    for (const mode of ['stream', 'cut', 'score', 'deploy']) {
      await page.locator(`[data-mode="${mode}"]`).click();
      assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
    }
    await page.locator('#threshold').fill('1000');
    await page.locator('#threshold').blur();
    assert(await page.locator('#downloadResult').isDisabled());
    await page.locator('#analyzeButton').click();
    await page.waitForFunction(() => !document.querySelector('#downloadResult').disabled);
    assert.equal(await page.locator('#anomalyMetric').textContent(), '0');
    await page.locator('#onlyAnomalies').check();
    assert.match(await page.locator('#resultRows').textContent(), /Không có bản ghi/);

    await page.locator('#fileInput').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.waitForFunction(() => !document.querySelector('#errorMessage').hidden);
    assert(await page.locator('#analyzeButton').isDisabled());
    assert(await page.locator('#downloadResult').isDisabled());
    await page.locator('#fileInput').setInputFiles({ name: 'missing.json', mimeType: 'application/json', buffer: Buffer.from('[{"x":1},{"x":null},{"x":2}]') });
    await page.waitForFunction(() => document.querySelector('#errorMessage').textContent.includes('Bản ghi 2'));
    assert(await page.locator('#analyzeButton').isDisabled());

    await page.locator('#fileInput').setInputFiles({ name: 'matrix.json', mimeType: 'application/json', buffer: Buffer.from('[[1,1],[1,1],[1,1],[1,1]]') });
    await page.waitForFunction(() => !document.querySelector('#analyzeButton').disabled);
    await page.locator('#threshold').fill('10');
    await page.locator('#threshold').blur();
    await page.locator('#analyzeButton').click();
    await page.waitForFunction(() => !document.querySelector('#downloadResult').disabled);
    assert.equal(await page.locator('#totalMetric').textContent(), '4');
    assert.equal(await page.locator('#scoreMetric').textContent(), '0.00');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await mobile.locator('#sampleButton').click();
    await mobile.waitForFunction(() => !document.querySelector('#analyzeButton').disabled);
    await mobile.locator('#analyzeButton').click();
    await mobile.waitForFunction(() => !document.querySelector('#downloadResult').disabled);
    assert.equal(await mobile.locator('#totalMetric').textContent(), '50');
    const widths = await mobile.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(widths.scroll <= widths.width, `Mobile overflow: ${JSON.stringify(widths)}`);
    await mobile.screenshot({ path: 'test-artifacts/mobile.png', fullPage: true });
    await pixels(await mobile.locator('#scene canvas').screenshot({ path: 'test-artifacts/mobile-scene.png' }));
    await mobile.setViewportSize({ width: 320, height: 700 });
    const narrow = await mobile.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(narrow.scroll <= narrow.width, `Narrow mobile overflow: ${JSON.stringify(narrow)}`);
    await mobile.screenshot({ path: 'test-artifacts/mobile-narrow.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, total: result.summary.total, anomalies: result.summary.anomalies, maxScore: result.summary.maxScore, desktopCanvasBrightPixels: firstPixels.bright, movedChannels: moved, screenshots: ['desktop.png', 'mobile.png', 'mobile-narrow.png'] }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
