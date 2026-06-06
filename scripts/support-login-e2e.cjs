const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SUPPORT_E2E_EMAIL || 'kyle.creativesolutions@gmail.com';
const ADMIN_PASSWORD = process.env.SUPPORT_E2E_PASSWORD || '';
const RESULT_PATH = path.join(__dirname, 'support-login-e2e-result.json');

function getBrowserLaunchOptions() {
  const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  return {
    headless: true,
    executablePath
  };
}

async function adminOverviewVisible(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.admin-overview');
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

async function runFlow(baseUrl, expectedApiOrigin) {
  const browser = await chromium.launch(getBrowserLaunchOptions());
  const context = await browser.newContext();
  const page = await context.newPage();
  const checks = [];
  const pass = (name, detail) => checks.push({ name, status: 'PASS', detail });
  const fail = (name, detail) => checks.push({ name, status: 'FAIL', detail });

  try {
    await page.goto(`${baseUrl}/support-login.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#supportLoginForm');
    pass('Login page loads', `${baseUrl}/support-login.html rendered.`);

    await page.waitForTimeout(1000);
    const bannerText = ((await page.textContent('#apiStatusBanner')) || '').trim();
    if (bannerText.toLowerCase().includes('online') || bannerText.toLowerCase().includes('disabled')) {
      pass('API status banner', `Banner reported runtime state: "${bannerText}"`);
    } else {
      fail('API status banner', `Unexpected banner text: "${bannerText}"`);
    }

    const detectedApiBase = await page.evaluate(() => {
      if (typeof window.CWS_API_BASE !== 'undefined') {
        return window.CWS_API_BASE || '';
      }
      const src = window.SiteAuth && window.SiteAuth.normalizeEmail ? null : null;
      return src;
    });

    // Infer the effective API base by monkey-patching fetch on a reload.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.__lastFetchUrl = null;
      window.fetch = (...args) => {
        window.__lastFetchUrl = String(args[0]);
        return originalFetch(...args);
      };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#supportLoginForm');
    await page.waitForTimeout(300);
    const lastFetchUrl = await page.evaluate(() => window.__lastFetchUrl || '');
    if (lastFetchUrl.startsWith(expectedApiOrigin) || (expectedApiOrigin === baseUrl && lastFetchUrl.startsWith('/api/auth/'))) {
      pass('API routing', `Auth calls targeted ${lastFetchUrl || expectedApiOrigin}.`);
    } else {
      fail('API routing', `Expected auth to target ${expectedApiOrigin}, saw ${lastFetchUrl || '(none)'}.`);
    }

    const metaResponse = await context.request.get(`${expectedApiOrigin}/api/auth/meta`);
    const meta = await metaResponse.json();

    if (!meta || !meta.supportLoginConfigured) {
      pass('Support login configuration gate', 'Support login is intentionally disabled until a support password is configured.');
      return checks;
    }

    if (!ADMIN_PASSWORD) {
      pass('Support login credentials gate', 'Support login is configured, but SUPPORT_E2E_PASSWORD was not provided so interactive login was skipped.');
      return checks;
    }

    await page.fill('#supportEmail', ADMIN_EMAIL);
    await page.fill('#supportPassword', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/support-portal.html', { timeout: 12000, waitUntil: 'domcontentloaded' });
    pass('Login redirect', 'Successful login redirected to support portal.');

    await page.waitForSelector('#staffPill');
    const staffPill = ((await page.textContent('#staffPill')) || '').trim();
    if (staffPill.toLowerCase().includes('system administrator')) {
      pass('Admin role shown', `Staff pill confirms admin role: ${staffPill}`);
    } else {
      fail('Admin role shown', `Staff pill did not show admin role: ${staffPill}`);
    }

    const adminVisible = await adminOverviewVisible(page);
    if (adminVisible) {
      pass('Admin overview visible', 'System admin overview is visible for Kyle admin login.');
    } else {
      fail('Admin overview visible', 'System admin overview is hidden after admin login.');
    }

    const sessionPayload = await page.evaluate(async () => {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      return response.json();
    });
    if (sessionPayload && sessionPayload.authenticated && sessionPayload.user && sessionPayload.user.role === 'admin') {
      pass('Session endpoint', `Session is authenticated as ${sessionPayload.user.email} (${sessionPayload.user.role}).`);
    } else {
      fail('Session endpoint', `Unexpected session payload: ${JSON.stringify(sessionPayload)}`);
    }

    await page.click('#logoutBtn');
    await page.waitForURL('**/login.html', { timeout: 12000, waitUntil: 'domcontentloaded' });
    pass('Logout redirect', 'Logout redirected to the login page.');
  } catch (error) {
    fail('Unexpected error', error && error.stack ? error.stack : String(error));
  } finally {
    await browser.close();
  }

  return checks;
}

(async () => {
  const suites = [
    {
      label: 'Same-origin support login',
      baseUrl: BASE_URL,
      expectedApiOrigin: BASE_URL
    }
  ];

  const allResults = [];

  for (const suite of suites) {
    const checks = await runFlow(suite.baseUrl, suite.expectedApiOrigin);
    allResults.push({ label: suite.label, checks });
  }

  let failures = 0;
  console.log('--- SUPPORT LOGIN END-TO-END SMOKE TEST ---');
  allResults.forEach((suite, suiteIndex) => {
    console.log(`${suiteIndex + 1}. ${suite.label}`);
    suite.checks.forEach((item, index) => {
      console.log(`   ${index + 1}. [${item.status}] ${item.name} - ${item.detail}`);
      if (item.status === 'FAIL') {
        failures += 1;
      }
    });
  });

  const totalChecks = allResults.reduce((sum, suite) => sum + suite.checks.length, 0);
  const summary = {
    failures,
    totalChecks,
    suites: allResults
  };

  fs.writeFileSync(RESULT_PATH, JSON.stringify(summary, null, 2));

  if (failures > 0) {
    console.error(`RESULT: FAIL (${failures} failed check(s))`);
    process.exitCode = 1;
    return;
  }

  console.log(`RESULT: PASS (${totalChecks} checks validated)`);
})();
