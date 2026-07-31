const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const {
  getBaseUrl,
  getPort,
  request,
  requireSupportPassword
} = require('./tests/test-utils');

const ROOT_DIR = __dirname;
const PORT = getPort();
const BASE_URL = getBaseUrl();
const RUN_BILLING_TESTS = String(process.env.RUN_BILLING_TESTS || '').toLowerCase() === 'true';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, message) {
  failed += 1;
  failures.push({ name, message });
  console.error(`FAIL ${name}: ${message}`);
}

function assert(condition, name, message) {
  if (!condition) {
    fail(name, message);
    return false;
  }
  pass(name);
  return true;
}

async function loginSupportAdminWithRecovery(password) {
  let loginRes = await request('POST', '/api/auth/support-login', {
    email: 'admin@creativewebsolutions.com',
    password
  });

  if (loginRes.status === 200) {
    return loginRes;
  }

  if (loginRes.status !== 401) {
    return loginRes;
  }

  const resetRequest = await request('POST', '/api/auth/support-password-reset/request', {
    email: 'admin@creativewebsolutions.com'
  });

  const resetToken = resetRequest.body && resetRequest.body.resetToken;
  if (resetRequest.status !== 200 || !resetToken) {
    return loginRes;
  }

  const resetConfirm = await request('POST', '/api/auth/support-password-reset/confirm', {
    token: resetToken,
    password
  });

  if (resetConfirm.status !== 200) {
    return loginRes;
  }

  loginRes = await request('POST', '/api/auth/support-login', {
    email: 'admin@creativewebsolutions.com',
    password
  });

  return loginRes;
}

async function ensureServerHealth() {
  const name = 'Server health check';
  const res = await request('GET', '/health');
  if (!assert(res.status === 200, name, `Expected 200 from /health on ${BASE_URL}, got ${res.status}`)) {
    return;
  }

  assert(
    typeof res.body === 'object' && res.body !== null,
    'Health payload JSON shape',
    'Expected JSON object from /health'
  );

  const backend = res.body && res.body.dataBackend;
  assert(
    backend === 'postgres' || backend === 'sqlite' || backend === 'file',
    'Health data backend field',
    `Expected dataBackend to be one of postgres/sqlite/file, got ${String(backend)}`
  );
}

async function verifyStaticPages() {
  console.log('\n== Static pages ==');

  const entries = await fs.readdir(ROOT_DIR, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(html?|HTML?)$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  const protectedPages = new Map([
    ['legal.html', 403]
  ]);

  const rootRes = await request('GET', '/');
  assert(rootRes.status === 200, 'GET /', `Expected 200, got ${rootRes.status}`);

  for (const fileName of htmlFiles) {
    const label = `GET /${fileName}`;
    const res = await request('GET', `/${fileName}`);
    const expectedStatus = protectedPages.get(fileName) || 200;
    if (!assert(res.status === expectedStatus, label, `Expected ${expectedStatus}, got ${res.status}`)) {
      continue;
    }

    if (expectedStatus !== 200) {
      continue;
    }

    const contentType = String(res.headers['content-type'] || '');
    if (!assert(contentType.includes('text/html'), `${label} content type`, `Expected text/html, got ${contentType || 'none'}`)) {
      continue;
    }

    const body = String(res.body || '');
    assert(/<title>/i.test(body), `${label} has title`, 'Missing <title> tag');
  }
}

async function verifyCoreAssets() {
  console.log('\n== Core assets ==');

  const assets = [
    { file: 'style.css', expectedType: 'text/css' },
    { file: 'auth.js', expectedType: 'javascript' },
    { file: 'header.js', expectedType: 'javascript' },
    { file: 'footer.js', expectedType: 'javascript' },
    { file: 'theme.js', expectedType: 'javascript' },
    { file: 'site-enhancements.js', expectedType: 'javascript' },
    { file: 'login-page.js', expectedType: 'javascript' },
    { file: 'support-login-page.js', expectedType: 'javascript' }
  ];

  for (const asset of assets) {
    const label = `GET /${asset.file}`;
    const res = await request('GET', `/${asset.file}`);
    if (!assert(res.status === 200, label, `Expected 200, got ${res.status}`)) {
      continue;
    }

    const contentType = String(res.headers['content-type'] || '');
    assert(
      contentType.toLowerCase().includes(asset.expectedType),
      `${label} content type`,
      `Expected ${asset.expectedType}, got ${contentType || 'none'}`
    );
  }
}

async function verifyApiSurface() {
  console.log('\n== API surface ==');

  const meta = await request('GET', '/api/auth/meta');
  if (assert(meta.status === 200, 'GET /api/auth/meta', `Expected 200, got ${meta.status}`)) {
    assert(typeof meta.body === 'object' && meta.body !== null, 'Auth meta JSON shape', 'Expected JSON object body');
    assert(typeof meta.body.supportLoginConfigured === 'boolean', 'Auth meta support login flag', 'supportLoginConfigured should be boolean');
    assert(typeof meta.body.supportRoles === 'object' && meta.body.supportRoles !== null, 'Auth meta support roles', 'supportRoles should be object');
  }

  const unauthorizedCustomer = await request('GET', '/api/auth/customer/tickets');
  assert(
    unauthorizedCustomer.status === 401,
    'GET /api/auth/customer/tickets requires auth',
    `Expected 401, got ${unauthorizedCustomer.status}`
  );

  const contactRes = await request('POST', '/api/contact', {
    name: 'Comprehensive Test',
    email: `comprehensive-${Date.now()}@example.com`,
    message: 'Contact endpoint smoke check'
  });
  assert(contactRes.status === 201, 'POST /api/contact', `Expected 201, got ${contactRes.status}`);

  const supportPassword = requireSupportPassword('test-comprehensive.js');
  const supportLoginRes = await loginSupportAdminWithRecovery(supportPassword);

  if (assert(supportLoginRes.status === 200, 'POST /api/auth/support-login', `Expected 200, got ${supportLoginRes.status}`)) {
    const sessionToken = supportLoginRes.body && supportLoginRes.body.sessionToken;
    const legalRes = await request('GET', '/legal.html', null, {
      'X-CWS-Session': sessionToken
    });

    if (assert(legalRes.status === 200, 'GET /legal.html (authenticated support/admin)', `Expected 200, got ${legalRes.status}`)) {
      const contentType = String(legalRes.headers['content-type'] || '');
      assert(
        contentType.includes('text/html'),
        'GET /legal.html (authenticated) content type',
        `Expected text/html, got ${contentType || 'none'}`
      );
    }
  }
}

function runNodeTestScript(scriptFile, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptFile], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code, output, errorOutput });
    });
  });
}

async function runExistingSuites() {
  console.log('\n== Existing test suites ==');

  const supportPassword = requireSupportPassword('test-comprehensive.js');
  const supportLoginRes = await loginSupportAdminWithRecovery(supportPassword);
  assert(
    supportLoginRes.status === 200,
    'Preflight support password alignment',
    `Expected 200, got ${supportLoginRes.status}`
  );

  const commonEnv = {
    PORT: String(PORT),
    SUPPORT_PORTAL_PASSWORD: supportPassword,
    RUN_BILLING_TESTS: RUN_BILLING_TESTS ? 'true' : 'false'
  };

  const suites = [
    'test-site-summary.js',
    'test-route-permissions.js',
    'test-email-validation.js',
    'test-admin-setup.js',
    'test-authenticated-routes.js',
    'test-site-integration.js'
  ];

  for (const suite of suites) {
    const label = `node ${suite}`;
    const result = await runNodeTestScript(suite, commonEnv);
    if (result.code === 0) {
      pass(label);
      continue;
    }

    const combined = `${result.output}\n${result.errorOutput}`.trim();
    const tail = combined.split(/\r?\n/).slice(-20).join('\n');
    fail(label, `Exited with ${result.code}. Output tail:\n${tail}`);
  }
}

function printSummary() {
  console.log('\n== Summary ==');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const entry of failures) {
      console.log(`- ${entry.name}: ${entry.message}`);
    }
  }
}

(async function main() {
  console.log('Running comprehensive verification suite');
  console.log(`Target server: ${BASE_URL}`);
  console.log(`Billing checks: ${RUN_BILLING_TESTS ? 'enabled' : 'disabled'}`);

  await ensureServerHealth();
  await verifyStaticPages();
  await verifyCoreAssets();
  await verifyApiSurface();
  await runExistingSuites();

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
})();
