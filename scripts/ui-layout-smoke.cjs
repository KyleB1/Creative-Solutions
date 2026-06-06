const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const PAGES = [
  { path: '/index.htm', selector: '.home-shell' },
  { path: '/services.html', selector: '.services-wrap' },
  { path: '/login.html', selector: '.split-shell' },
  { path: '/signup.html', selector: '.split-shell' }
];

async function testViewport(label, viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const failures = [];

  for (const item of PAGES) {
    let pageError = null;
    const onPageError = (err) => {
      pageError = String(err && err.message ? err.message : err);
    };

    page.on('pageerror', onPageError);
    try {
      const resp = await page.goto(`${BASE}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = resp ? resp.status() : 0;
      const hasSelector = await page.locator(item.selector).count();

      if (status < 200 || status >= 400) {
        failures.push({ page: item.path, reason: `status ${status}` });
      } else if (!hasSelector) {
        failures.push({ page: item.path, reason: `missing selector ${item.selector}` });
      } else if (pageError) {
        failures.push({ page: item.path, reason: `page error ${pageError}` });
      }
    } catch (error) {
      failures.push({ page: item.path, reason: `navigation error ${error.message}` });
    } finally {
      page.off('pageerror', onPageError);
    }
  }

  await browser.close();

  return { label, viewport, failures };
}

(async () => {
  const results = [];
  results.push(await testViewport('desktop', { width: 1440, height: 900 }));
  results.push(await testViewport('mobile', { width: 390, height: 844 }));

  const outputPath = path.join(__dirname, 'ui-layout-smoke-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log('UI_LAYOUT_SMOKE_RESULTS');
  console.log(JSON.stringify(results, null, 2));

  const failCount = results.reduce((sum, r) => sum + r.failures.length, 0);
  if (failCount > 0) {
    process.exitCode = 1;
  }
})();
