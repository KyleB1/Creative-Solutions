const { chromium } = require('playwright');

(async () => {
  const baseUrl = 'http://localhost:3000';
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

    await page.fill('#username', testIdentity.name);
    await page.fill('#email', testIdentity.email);
    pass('Profile fields accepted', `${testIdentity.email} accepted as valid signup email.`);

    await page.fill('#password', 'weak');
    await page.fill('#confirmPassword', 'weak');
    await page.click('button[type="submit"]');
    const pwdError = (await page.textContent('#passwordError')) || '';
    if (pwdError.toLowerCase().includes('requirements') || pwdError.toLowerCase().includes('meet')) {
      pass('Password rule enforcement', 'Weak password is rejected with a clear error message.');
    } else {
      fail('Password rule enforcement', `Expected requirements error, got: ${pwdError}`);
    }

    await page.fill('#password', testIdentity.password);
    await page.fill('#confirmPassword', testIdentity.password);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/customer-portal.html', { timeout: 12000, waitUntil: 'domcontentloaded' });
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

    const sessionPayload = await page.evaluate(async () => {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      return response.json();
    });

    if (sessionPayload && sessionPayload.authenticated && sessionPayload.user && sessionPayload.user.email === testIdentity.email) {
      pass('Session persisted', `Authenticated session exists for ${sessionPayload.user.email}.`);
    } else {
      fail('Session persisted', `Unexpected session payload: ${JSON.stringify(sessionPayload)}`);
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
