const { chromium } = require('playwright');

function base64url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeUnsignedToken(payload) {
  const header = { alg: 'none', typ: 'JWT' };
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.sig`;
}

(async () => {
  const backendBase = 'http://127.0.0.1:3101';
  const frontendBase = 'http://127.0.0.1:4174';
  const testAdminToken = process.env.ADMIN_TOKEN || 'test-admin-token-smoke';

  const checks = [];
  const pass = (name, detail) => checks.push({ name, status: 'PASS', detail });
  const fail = (name, detail) => checks.push({ name, status: 'FAIL', detail });

  try {
    // -------------------------------------------------------------------
    // CHECK 1: Forged (unsigned) JWT with system_admin role must be REJECTED
    // -------------------------------------------------------------------
    const forgedAdminToken = makeUnsignedToken({ role: 'system_admin', sub: 'attacker' });
    const forgedResp = await fetch(`${backendBase}/api/billing/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${forgedAdminToken}`
      },
      body: JSON.stringify({})
    });
    if (forgedResp.status === 403) {
      pass('Backend rejects forged unsigned JWT', 'Unsigned jwt with system_admin role is correctly rejected (403).');
    } else {
      fail('Backend rejects forged unsigned JWT', `Expected 403 but got ${forgedResp.status} — unsigned JWT role claims are being trusted.`);
    }

    // -------------------------------------------------------------------
    // CHECK 2: Valid X-Admin-Token grants admin access
    // -------------------------------------------------------------------
    const adminTokenResp = await fetch(`${backendBase}/api/billing/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': testAdminToken
      },
      body: JSON.stringify({})
    });
    // 400 = reached refund handler (payment intent ID required) → admin check passed
    // 403 = admin denied → token not accepted
    if (adminTokenResp.status === 400) {
      pass('Backend admin access via X-Admin-Token', 'X-Admin-Token granted admin access and reached refund validation (400).');
    } else if (adminTokenResp.status === 403) {
      fail('Backend admin access via X-Admin-Token', `ADMIN_TOKEN env var may not match test value "${testAdminToken}". Got 403.`);
    } else {
      pass('Backend admin access via X-Admin-Token', `Got status ${adminTokenResp.status} — passed admin middleware.`);
    }

    // -------------------------------------------------------------------
    // CHECK 3: Non-admin token is blocked
    // -------------------------------------------------------------------
    const nonAdminResp = await fetch(`${backendBase}/api/billing/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeUnsignedToken({ role: 'support_agent', sub: 'agent-test' })}`
      },
      body: JSON.stringify({})
    });
    if (nonAdminResp.status === 403) {
      pass('Backend admin protection (non-admin)', 'Non-admin role is correctly blocked from refund endpoint (403).');
    } else {
      fail('Backend admin protection (non-admin)', `Expected 403, got ${nonAdminResp.status}.`);
    }

    // -------------------------------------------------------------------
    // CHECK 4 & 5: Frontend admin UI visibility
    // -------------------------------------------------------------------
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('supportStaff', JSON.stringify({
        email: 'kyle.creativesolutions@gmail.com',
        name: 'Kyle'
      }));
    });
    await page.goto(`${frontendBase}/support-portal.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body');

    const adminVisibleForKyle = await page.evaluate(() => {
      const el = document.querySelector('.admin-overview');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (adminVisibleForKyle) {
      pass('Frontend admin UI (Kyle)', 'admin overview is visible for kyle.creativesolutions@gmail.com.');
    } else {
      fail('Frontend admin UI (Kyle)', 'admin overview is not visible for Kyle account.');
    }

    const page2 = await context.newPage();
    await page2.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('supportStaff', JSON.stringify({
        email: 'support@creativewebsolutions.com',
        name: 'Support User'
      }));
    });
    await page2.goto(`${frontendBase}/support-portal.html`, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('body');

    const adminVisibleForSupportAgent = await page2.evaluate(() => {
      const el = document.querySelector('.admin-overview');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (!adminVisibleForSupportAgent) {
      pass('Frontend admin protection (support agent)', 'admin overview is hidden for non-admin support account.');
    } else {
      fail('Frontend admin protection (support agent)', 'admin overview is unexpectedly visible for support agent account.');
    }

    await browser.close();

    console.log('--- ADMIN ACCESS SMOKE TEST ---');
    checks.forEach((item, index) => {
      console.log(`${index + 1}. [${item.status}] ${item.name} - ${item.detail}`);
    });

    const failures = checks.filter((item) => item.status === 'FAIL');
    if (failures.length) {
      console.error(`RESULT: FAIL (${failures.length} check(s) failed)`);
      process.exitCode = 1;
      return;
    }

    console.log(`RESULT: PASS (${checks.length} checks validated)`);
  } catch (error) {
    console.error('RESULT: ERROR');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
})();
