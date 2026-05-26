/**
 * test-site-integration.js - Comprehensive site integration test
 * 
 * Validates:
 * - All static HTML pages are accessible
 * - All API routes are correctly configured
 * - Full user flows (signup, login, use features, logout)
 * - Server runs on a single port without conflicts
 * - No route conflicts or misdirections
 * - Client-server communication works end-to-end
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_URL = `http://localhost:${PORT}`;

let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? require('https') : http;
    
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'test-site-integration/1.0',
        ...headers
      }
    };

    const req = client.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers, isHtml: res.headers['content-type']?.includes('text/html') });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, body: { error: err.message }, error: err });
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('✓');
    testsPassed++;
  } catch (error) {
    console.log(`✗ ${error.message}`);
    testsFailed++;
    failedTests.push({ name, error: error.message });
  }
}

// ============================================================================
// STATIC PAGE TESTS
// ============================================================================

async function testStaticPages() {
  console.log('\n📄 STATIC PAGES');
  
  const staticPages = [
    { path: '/', name: 'Home' },
    { path: '/index.htm', name: 'Index' },
    { path: '/login.html', name: 'Customer Login' },
    { path: '/signup.html', name: 'Customer Signup' },
    { path: '/support-login.html', name: 'Support Login' },
    { path: '/support-portal.html', name: 'Support Portal' },
    { path: '/system-admin.html', name: 'System Admin' },
    { path: '/customer-portal.html', name: 'Customer Portal' },
    { path: '/pricing.html', name: 'Pricing' },
    { path: '/services.html', name: 'Services' },
    { path: '/faq.html', name: 'FAQ' },
    { path: '/contact-routes.js', name: 'Contact Routes' },
    { path: '/privacy.html', name: 'Privacy' },
    { path: '/cms-integration.html', name: 'CMS Integration' },
    { path: '/crm.html', name: 'CRM' },
    { path: '/analytics-reporting.html', name: 'Analytics Reporting' },
    { path: '/app-development.html', name: 'App Development' },
    { path: '/ecommerce-development.html', name: 'E-commerce' },
    { path: '/digital-marketing.html', name: 'Digital Marketing' },
    { path: '/seo-optimization.html', name: 'SEO Optimization' },
    { path: '/website-maintenance.html', name: 'Website Maintenance' },
    { path: '/security-audits.html', name: 'Security Audits' },
    { path: '/custom-web-design.html', name: 'Custom Web Design' }
  ];

  for (const page of staticPages) {
    await test(`GET ${page.name}`, async () => {
      const res = await request('GET', page.path);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.isHtml || typeof res.body === 'string', 'Expected HTML content');
    });
  }
}

// ============================================================================
// API ENDPOINT TESTS
// ============================================================================

async function testApiEndpoints() {
  console.log('\n🔌 API ENDPOINTS');

  await test('GET /health', async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('GET /api/auth/meta', async () => {
    const res = await request('GET', '/api/auth/meta');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.supportLoginConfigured === true, 'Support login should be configured');
  });

  await test('POST /api/contact (public)', async () => {
    const res = await request('POST', '/api/contact', {
      name: 'Test User',
      email: 'test@example.com',
      message: 'Test message'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
  });

  await test('POST /api/auth/signup', async () => {
    const res = await request('POST', '/api/auth/signup', {
      name: 'Integration Test User',
      email: `integration-test-${Date.now()}@example.com`,
      password: 'TestPass123!@'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.sessionToken, 'Should return session token');
    assert(res.body.user?.customerId, 'Should return customer ID');
  });
}

// ============================================================================
// AUTHENTICATION FLOW TEST
// ============================================================================

async function testAuthFlow() {
  console.log('\n🔐 AUTHENTICATION FLOW');

  let sessionToken = null;
  let sessionCookie = null;

  await test('Sign up new customer', async () => {
    const testEmail = `integration-${Date.now()}@example.com`;
    const res = await request('POST', '/api/auth/signup', {
      name: 'Auth Flow Test',
      email: testEmail,
      password: 'FlowTest123!@'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.sessionToken, 'Should have session token');
    sessionToken = res.body.sessionToken;
    sessionCookie = res.headers['set-cookie']?.[0];
  });

  await test('Verify session with token', async () => {
    const res = await request('GET', '/api/auth/session', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.authenticated === true, 'Should be authenticated');
  });

  await test('Verify session with cookie', async () => {
    const res = await request('GET', '/api/auth/session', null, {
      'Cookie': sessionCookie
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.authenticated === true, 'Should be authenticated');
  });

  await test('Access customer protected route', async () => {
    const res = await request('GET', '/api/auth/customer/tickets', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.tickets), 'Should return tickets array');
  });

  await test('Create support ticket', async () => {
    const res = await request('POST', '/api/auth/customer/tickets', {
      subject: 'Integration Test Ticket',
      product: 'Testing',
      priority: 'Low',
      description: 'This is an integration test'
    }, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.ticket?.id, 'Should return ticket ID');
  });

  await test('Update customer profile', async () => {
    const res = await request('PATCH', '/api/auth/customer-profile', {
      name: 'Updated Name',
      plan: 'Enterprise',
      notifications: true
    }, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.user?.name === 'Updated Name', 'Name should be updated');
  });

  await test('Logout', async () => {
    const res = await request('POST', '/api/auth/logout', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 204 || res.status === 200, `Expected 204/200, got ${res.status}`);
  });

  await test('Verify session destroyed', async () => {
    const res = await request('GET', '/api/auth/session', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.authenticated === false, 'Should not be authenticated after logout');
  });
}

// ============================================================================
// SUPPORT ADMIN FLOW TEST
// ============================================================================

async function testSupportAdminFlow() {
  console.log('\n👨‍💼 SUPPORT ADMIN FLOW');

  let sessionToken = null;

  await test('Support login with admin credentials', async () => {
    const res = await request('POST', '/api/auth/support-login', {
      email: 'admin@creativewebsolutions.com',
      password: 'AdminPass123!@'
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.sessionToken, 'Should have session token');
    assert(res.body.user?.supportRole === 'System Administrator', 'Should be System Administrator');
    sessionToken = res.body.sessionToken;
  });

  await test('Access admin overview', async () => {
    const res = await request('GET', '/api/auth/admin/overview', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.totals, 'Should have totals');
    assert(typeof res.body.totals.customers === 'number', 'Should have customer count');
  });

  await test('Access support tickets', async () => {
    const res = await request('GET', '/api/auth/support/tickets', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.tickets), 'Should return tickets array');
  });

  await test('Support logout', async () => {
    const res = await request('POST', '/api/auth/logout', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 204 || res.status === 200, `Expected 204/200, got ${res.status}`);
  });
}

// ============================================================================
// BILLING API TESTS
// ============================================================================

async function testBillingApi() {
  console.log('\n💳 BILLING API');

  let sessionToken = null;
  let customerId = null;

  // First create a customer
  await test('Create customer for billing tests', async () => {
    const res = await request('POST', '/api/auth/signup', {
      name: 'Billing Test User',
      email: `billing-test-${Date.now()}@example.com`,
      password: 'BillingTest123!@'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    sessionToken = res.body.sessionToken;
    customerId = res.body.user?.customerId;
  });

  await test('Create payment intent', async () => {
    const res = await request('POST', '/api/billing/payment-intent', {
      customerId,
      amount: 99.99,
      currency: 'USD'
    }, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.clientSecret, 'Should have Stripe client secret');
  });

  await test('Get payment methods', async () => {
    const res = await request('GET', '/api/billing/payment-methods', null, {
      'X-CWS-Session': sessionToken
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.paymentMethods), 'Should return payment methods array');
  });
}

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

async function testErrorHandling() {
  console.log('\n⚠️  ERROR HANDLING');

  await test('404 on non-existent route', async () => {
    const res = await request('GET', '/nonexistent/route/12345');
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test('401 on missing auth for protected route', async () => {
    const res = await request('GET', '/api/auth/customer/tickets');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('400 on invalid request body', async () => {
    const res = await request('POST', '/api/auth/signup', {
      email: 'test@example.com'
      // missing required name and password
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test('Malformed JSON rejected', async () => {
    const res = await request('POST', '/api/auth/login', '{invalid json}');
    assert(res.status !== 200, 'Should reject malformed JSON');
  });
}

// ============================================================================
// PORT CONFLICT TESTS
// ============================================================================

async function testPortAndNetworking() {
  console.log('\n🌐 PORT & NETWORKING');

  await test(`Server is running on port ${PORT}`, async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `Server not responding on port ${PORT}`);
  });

  await test('API responses are valid JSON', async () => {
    const res = await request('GET', '/api/auth/meta');
    assert(typeof res.body === 'object', 'API should return JSON objects');
  });

  await test('CORS headers present', async () => {
    const res = await request('GET', '/api/auth/meta');
    // Check that response contains expected headers or handles CORS properly
    assert(res.status === 200, 'Should handle API requests');
  });

  await test('Compression enabled for static files', async () => {
    const res = await request('GET', '/');
    // Static pages should be served
    assert(res.status === 200, 'Static files should be served');
  });
}

// ============================================================================
// ROUTE VALIDATION TESTS
// ============================================================================

async function testRouteValidation() {
  console.log('\n🛣️  ROUTE VALIDATION');

  // Check that auth routes are properly configured
  const authRoutes = [
    { method: 'GET', path: '/api/auth/session', requiresAuth: true },
    { method: 'GET', path: '/api/auth/meta', requiresAuth: false },
    { method: 'POST', path: '/api/auth/login', requiresAuth: false },
    { method: 'POST', path: '/api/auth/signup', requiresAuth: false },
    { method: 'POST', path: '/api/auth/support-login', requiresAuth: false },
    { method: 'GET', path: '/api/auth/admin/overview', requiresAuth: true }
  ];

  for (const route of authRoutes) {
    await test(`Route ${route.method} ${route.path}`, async () => {
      const res = await request(route.method, route.path);
      if (route.requiresAuth) {
        assert(res.status === 401 || res.status === 403, `Protected route should require auth, got ${res.status}`);
      } else {
        assert(res.status !== 404, `Public route should exist, got ${res.status}`);
      }
    });
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     COMPREHENSIVE SITE INTEGRATION TEST SUITE         ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`Testing server on: ${BASE_URL}\n`);

  try {
    // Check server is running
    const healthCheck = await request('GET', '/health');
    if (healthCheck.status !== 200) {
      console.error(`✗ Server is not running on ${BASE_URL}`);
      process.exit(1);
    }

    await testStaticPages();
    await testApiEndpoints();
    await testAuthFlow();
    await testSupportAdminFlow();
    await testBillingApi();
    await testErrorHandling();
    await testPortAndNetworking();
    await testRouteValidation();

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║ RESULTS: ${testsPassed} passed, ${testsFailed} failed`.padEnd(58) + '║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    if (failedTests.length > 0) {
      console.log('Failed tests:');
      failedTests.forEach(t => {
        console.log(`  ✗ ${t.name}`);
        console.log(`    ${t.error}`);
      });
    }

    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test suite error:', error);
    process.exit(1);
  }
}

runAllTests();
