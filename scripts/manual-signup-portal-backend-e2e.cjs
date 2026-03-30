const { chromium } = require('playwright');

(async () => {
  const frontendBase = 'http://127.0.0.1:4173';
  const backendBase = 'http://127.0.0.1:3100';

  const testIdentity = {
    name: 'Jordan Backend',
    email: `jordan.backend.${Date.now()}@example.com`,
    password: 'StrongPass9!'
  };

  const checkpoints = [];
  const pass = (name, detail) => checkpoints.push({ name, status: 'PASS', detail });
  const fail = (name, detail) => checkpoints.push({ name, status: 'FAIL', detail });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${frontendBase}/signup.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#signupForm');
    pass('Signup page loads', 'Signup form rendered successfully.');

    await page.fill('#username', testIdentity.name);
    await page.fill('#email', testIdentity.email);
    await page.waitForFunction(() => !document.getElementById('nextStepBtn').disabled);
    await page.click('#nextStepBtn');
    await page.waitForSelector('.form-step.active[data-step="2"]');

    await page.fill('#password', testIdentity.password);
    await page.fill('#confirmPassword', testIdentity.password);
    await page.click('#createAccountBtn');
    await page.waitForURL('**/customer-portal.html', { timeout: 12000, waitUntil: 'domcontentloaded' });
    pass('Signup redirects to portal', 'Customer portal loaded after account creation.');

    await page.waitForSelector('#welcomeName');
    const welcomeName = (await page.textContent('#welcomeName')) || '';
    if (welcomeName.includes('Jordan')) {
      pass('Portal personalization', `Welcome name populated: ${welcomeName.trim()}`);
    } else {
      fail('Portal personalization', `Unexpected welcome label: ${welcomeName.trim()}`);
    }

    const storage = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('portalCustomer') || 'null');
      } catch {
        return null;
      }
    });

    if (storage && storage.email && storage.customerId && storage.sessionToken) {
      pass('Session persisted', `portalCustomer saved for ${storage.email}.`);
    } else {
      fail('Session persisted', 'portalCustomer localStorage payload is incomplete.');
    }

    const healthResp = await context.request.get(`${backendBase}/health`);
    if (healthResp.status() === 200) {
      pass('Backend health endpoint', 'GET /health responded with 200.');
    } else {
      fail('Backend health endpoint', `GET /health responded with ${healthResp.status()}.`);
    }

    const noCustomerResp = await context.request.get(`${backendBase}/api/billing/payments`, {
      headers: {
        Authorization: `Bearer ${storage ? storage.sessionToken : ''}`
      }
    });

    if (noCustomerResp.status() === 401) {
      pass('Billing auth guard (frontend-style request)', 'GET /api/billing/payments rejects missing customerId with 401.');
    } else {
      fail('Billing auth guard (frontend-style request)', `Expected 401, got ${noCustomerResp.status()}.`);
    }

    const customerId = storage ? storage.customerId : '';
    const withCustomerResp = await context.request.get(`${backendBase}/api/billing/payments?customerId=${encodeURIComponent(customerId)}`, {
      headers: {
        Authorization: `Bearer ${storage ? storage.sessionToken : ''}`
      }
    });

    const withCustomerBody = await withCustomerResp.text();
    if (withCustomerResp.status() === 200) {
      pass('Billing payments endpoint (customer scoped)', 'GET /api/billing/payments returned 200 with customerId query.');
    } else {
      fail('Billing payments endpoint (customer scoped)', `Status ${withCustomerResp.status()} body: ${withCustomerBody.slice(0, 220)}`);
    }

    console.log('--- SIGNUP + BACKEND BILLING VERIFICATION ---');
    checkpoints.forEach((item, index) => {
      console.log(`${index + 1}. [${item.status}] ${item.name} - ${item.detail}`);
    });

    const failures = checkpoints.filter((item) => item.status === 'FAIL');
    if (failures.length > 0) {
      console.error(`RESULT: FAIL (${failures.length} checkpoint(s) failed)`);
      process.exitCode = 1;
      return;
    }

    console.log(`RESULT: PASS (${checkpoints.length} checkpoints validated)`);
  } catch (error) {
    console.error('RESULT: ERROR');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
