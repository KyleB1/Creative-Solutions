const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });

  const page = await browser.newPage();

  page.on('console', (message) => {
    console.log('BROWSER_CONSOLE', message.type(), message.text());
  });

  page.on('pageerror', (error) => {
    console.log('PAGE_ERROR', error && error.message ? error.message : String(error));
  });

  page.on('response', async (response) => {
    if (!response.url().includes('/api/auth/support-login')) {
      return;
    }

    let body = '';
    try {
      body = await response.text();
    } catch (_error) {
      body = '<unable to read body>';
    }

    console.log('SUPPORT_LOGIN_RESPONSE', response.status(), response.url(), body);
  });

  await page.goto('http://localhost:3000/support-login.html', { waitUntil: 'domcontentloaded' });
  await page.fill('#supportEmail', 'kyle.creativesolutions@gmail.com');
  await page.fill('#supportPassword', 'N6vTyyad9y2M2sUoop%!!GBa');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  const errorText = (await page.textContent('#loginError')) || '';
  console.log('FINAL_URL', page.url());
  console.log('LOGIN_ERROR', errorText.trim());

  await browser.close();
})();
