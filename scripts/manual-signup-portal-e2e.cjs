const { chromium } = require('playwright');

(async () => {
  const baseUrl = 'http://127.0.0.1:4173';
  const testIdentity = {
    name: 'Jordan Modern',
    email: `jordan.modern.${Date.now()}@example.com`,
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

    await page.goto(`${baseUrl}/signup.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#signupForm');
    pass('Signup page loads', 'Signup form rendered successfully.');

    const initialDisabled = await page.isDisabled('#nextStepBtn');
    if (initialDisabled) {
      pass('Step 1 gating', 'Continue is disabled before valid profile details are entered.');
    } else {
      fail('Step 1 gating', 'Continue was enabled too early.');
    }

    await page.fill('#username', 'J');
    await page.fill('#email', 'bad-email');
    await page.click('#nextStepBtn', { trial: true }).catch(() => null);
    const stillStep1 = await page.locator('.form-step.active[data-step="1"]').count();
    if (stillStep1 === 1) {
      pass('Step 1 validation blocks invalid input', 'Form remains on profile step with invalid values.');
    } else {
      fail('Step 1 validation blocks invalid input', 'Form advanced unexpectedly on invalid profile data.');
    }

    await page.fill('#username', testIdentity.name);
    await page.fill('#email', testIdentity.email);
    await page.waitForFunction(() => !document.getElementById('nextStepBtn').disabled);
    pass('Valid profile enables Continue', `${testIdentity.email} accepted as valid signup email.`);

    await page.click('#nextStepBtn');
    await page.waitForSelector('.form-step.active[data-step="2"]');
    const stepMeta = await page.textContent('#stepMeta');
    if ((stepMeta || '').includes('Step 2 of 2')) {
      pass('Step transition to security', 'Step label updates to Step 2 of 2.');
    } else {
      fail('Step transition to security', `Unexpected step meta: ${stepMeta}`);
    }

    await page.fill('#password', 'weak');
    await page.fill('#confirmPassword', 'weak');
    await page.click('#createAccountBtn');
    const pwdError = (await page.textContent('#passwordError')) || '';
    if (pwdError.toLowerCase().includes('requirements')) {
      pass('Password rule enforcement', 'Weak password is rejected with a clear error message.');
    } else {
      fail('Password rule enforcement', `Expected requirements error, got: ${pwdError}`);
    }

    await page.fill('#password', testIdentity.password);
    await page.fill('#confirmPassword', testIdentity.password);
    await page.click('#createAccountBtn');

    await page.waitForURL('**/customer-portal.html', { timeout: 8000 });
    pass('Redirect to portal', 'User is redirected to customer portal after successful signup.');

    await page.waitForSelector('#welcomeName');
    const welcomeName = (await page.textContent('#welcomeName')) || '';
    const settingsEmail = await page.textContent('#settingsEmail');
    const profilePill = await page.textContent('#profilePill');

    if (welcomeName.includes('Jordan')) {
      pass('Portal personalization', `Welcome name populated: ${welcomeName.trim()}`);
    } else {
      fail('Portal personalization', `Unexpected welcome label: ${welcomeName.trim()}`);
    }

    if ((settingsEmail || '').trim().toLowerCase() === testIdentity.email.toLowerCase()) {
      pass('Portal session identity', `Settings reflects signed-up email: ${settingsEmail.trim()}`);
    } else {
      fail('Portal session identity', `Settings email mismatch: ${settingsEmail}`);
    }

    if ((profilePill || '').toLowerCase().includes('hi,')) {
      pass('Topbar identity pill', `Topbar identity shown as: ${profilePill.trim()}`);
    } else {
      fail('Topbar identity pill', `Profile pill did not render expected greeting: ${profilePill}`);
    }

    const storage = await page.evaluate(() => ({
      portalCustomer: localStorage.getItem('portalCustomer'),
      registeredAccounts: localStorage.getItem('registeredAccounts')
    }));

    const portalCustomerOk = !!storage.portalCustomer && storage.portalCustomer.includes(testIdentity.email);
    const accountSaved = !!storage.registeredAccounts && storage.registeredAccounts.includes(testIdentity.email);

    if (portalCustomerOk && accountSaved) {
      pass('Persistence checks', 'Account and active customer session are saved in localStorage.');
    } else {
      fail('Persistence checks', 'Expected localStorage customer/account entries were not both present.');
    }

    console.log('--- SIGNUP TO PORTAL MANUAL FLOW (AUTOMATED) ---');
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
