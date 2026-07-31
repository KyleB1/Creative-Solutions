const { chromium } = require('playwright');

(async () => {
  const basePort = process.env.FRONTEND_PORT ? Number(process.env.FRONTEND_PORT) : (process.env.PORT ? Number(process.env.PORT) : 3000);
  const baseUrl = `http://localhost:${basePort}`;
  const supportEmail = process.env.SUPPORT_E2E_EMAIL || 'kyle.creativesolutions@gmail.com';
  const supportPassword = process.env.SUPPORT_E2E_PASSWORD || process.env.SUPPORT_PORTAL_PASSWORD || '';

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

  await page.goto(`${baseUrl}/support-login.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#supportEmail', supportEmail);
  await page.fill('#supportPassword', supportPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  const errorText = (await page.textContent('#loginError')) || '';
  console.log('FINAL_URL', page.url());
  console.log('LOGIN_ERROR', errorText.trim());

  await browser.close();
})();
