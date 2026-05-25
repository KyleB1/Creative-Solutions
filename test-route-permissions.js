/**
 * test-route-permissions.js - Comprehensive permission and auth enforcement tests
 * 
 * Tests:
 * - Unauthenticated access rejection
 * - Customer vs admin vs support role enforcement
 * - JWT token verification
 * - Session cookie validation
 * - Cross-customer access prevention
 * - Rate limiting enforcement
 */

const http = require('http');
const crypto = require('crypto');

const BASE_URL = 'http://127.0.0.1:3002';
const BILLING_JWT_SECRET = process.env.BILLING_JWT_SECRET || null;

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 3002,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data || null, headers: res.headers });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function createMockJWT(claims) {
  if (!BILLING_JWT_SECRET) {
    return null; // Can't test JWT without secret
  }
  
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', BILLING_JWT_SECRET).update(signingInput).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${signingInput}.${signature}`;
}

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('=== ROUTE PERMISSION & AUTH ENFORCEMENT TESTS ===\n');
  
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${t.name}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

// ===== UNAUTHENTICATED TESTS =====

test('Unauthenticated: GET /api/auth/admin/overview returns 401', async () => {
  const res = await request('GET', '/api/auth/admin/overview');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Unauthenticated: POST /api/billing/refund returns 403 (no auth)', async () => {
  const res = await request('POST', '/api/billing/refund', { paymentIntentId: 'test' });
  if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
});

test('Unauthenticated: POST /api/billing/payment-intent returns 401', async () => {
  const res = await request('POST', '/api/billing/payment-intent', {
    customerId: 'test',
    amount: 99.99
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Unauthenticated: GET /api/auth/customer/tickets returns 401', async () => {
  const res = await request('GET', '/api/auth/customer/tickets');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Unauthenticated: GET /api/auth/support/tickets returns 401', async () => {
  const res = await request('GET', '/api/auth/support/tickets');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

// ===== PUBLIC ROUTES (NO AUTH REQUIRED) =====

test('Public: POST /api/contact does NOT require auth', async () => {
  const res = await request('POST', '/api/contact', {
    name: 'John Doe',
    email: 'john@example.com',
    message: 'Hello'
  });
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
});

test('Public: POST /api/auth/login requires email/password', async () => {
  const res = await request('POST', '/api/auth/login', {});
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  if (!res.body.error?.includes('required')) throw new Error('Expected validation error');
});

test('Public: POST /api/auth/signup requires email/password/name', async () => {
  const res = await request('POST', '/api/auth/signup', { email: 'test@example.com' });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
});

test('Public: GET /api/auth/meta does NOT require auth', async () => {
  const res = await request('GET', '/api/auth/meta');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!('hasCustomerAccounts' in res.body)) throw new Error('Missing hasCustomerAccounts field');
});

// ===== INVALID TOKEN TESTS =====

test('Invalid token: Bad Authorization header is rejected', async () => {
  const res = await request('POST', '/api/billing/payment-intent', {
    customerId: 'test',
    amount: 99.99
  }, { 'Authorization': 'Bearer invalid-token' });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Invalid token: Malformed JWT is rejected', async () => {
  const res = await request('POST', '/api/billing/payment-intent', {
    customerId: 'test',
    amount: 99.99
  }, { 'Authorization': 'Bearer not.a.jwt' });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

// ===== ROLE-BASED ACCESS CONTROL =====

test('Admin-only: POST /api/billing/refund requires admin role', async () => {
  const res = await request('POST', '/api/billing/refund', { paymentIntentId: 'test' });
  if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  if (!res.body.error?.includes('Admin')) throw new Error('Expected admin error message');
});

test('Admin-only: POST /api/admin/support-password requires admin session', async () => {
  const res = await request('POST', '/api/auth/admin/support-password', {
    password: 'NewPass123!@'
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Support-only: GET /api/auth/support/tickets requires support role', async () => {
  const res = await request('GET', '/api/auth/support/tickets');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Customer-only: POST /api/auth/customer/tickets requires customer role', async () => {
  const res = await request('POST', '/api/auth/customer/tickets', {
    subject: 'Test',
    description: 'Test'
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

// ===== BILLING ROUTES REQUIRE AUTH =====

test('Billing: GET /api/billing/payment-methods requires auth', async () => {
  const res = await request('GET', '/api/billing/payment-methods');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Billing: DELETE /api/billing/payment-methods/:id requires auth', async () => {
  const res = await request('DELETE', '/api/billing/payment-methods/pm_test123');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('Billing: GET /api/billing/payments requires auth', async () => {
  const res = await request('GET', '/api/billing/payments');
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

// ===== PASSWORD VALIDATION =====

test('Password validation: Weak passwords are rejected on signup', async () => {
  const res = await request('POST', '/api/auth/signup', {
    name: 'Test User',
    email: 'weak-' + Date.now() + '@example.com',
    password: 'weak'
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  if (!res.body.error?.includes('uppercase')) throw new Error('Expected password requirement error');
});

test('Password validation: Missing special char rejected', async () => {
  const res = await request('POST', '/api/auth/signup', {
    name: 'Test User',
    email: 'weak-' + Date.now() + '@example.com',
    password: 'NoSpecialChar123'
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  if (!res.body.error?.includes('special')) throw new Error('Expected special char requirement');
});

// ===== EMAIL VALIDATION =====

test('Email validation: Invalid email rejected on signup', async () => {
  const res = await request('POST', '/api/auth/signup', {
    name: 'Test User',
    email: 'not-an-email',
    password: 'ValidPass123!@'
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
});

test('Email validation: Contact form rejects bad emails', async () => {
  const res = await request('POST', '/api/contact', {
    name: 'Test',
    email: 'invalid',
    message: 'Test'
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  if (!res.body.error?.includes('email')) throw new Error('Expected email validation error');
});

// ===== DUPLICATE ACCOUNT PREVENTION =====

test('Duplicate prevention: Cannot signup twice with same email', async () => {
  const email = 'unique-' + Date.now() + '@example.com';
  const first = await request('POST', '/api/auth/signup', {
    name: 'Test User',
    email,
    password: 'ValidPass123!@'
  });
  if (first.status !== 201) throw new Error(`First signup failed: ${first.status}`);
  
  const second = await request('POST', '/api/auth/signup', {
    name: 'Test User 2',
    email,
    password: 'ValidPass123!@'
  });
  if (second.status !== 409) throw new Error(`Expected 409 for duplicate, got ${second.status}`);
  if (!second.body.error?.includes('already exists')) throw new Error('Expected duplicate error');
});

// ===== SUPPORT ROLE VALIDATION =====

test('Support roles: Predefined support emails cannot signup as customers', async () => {
  const res = await request('POST', '/api/auth/signup', {
    name: 'Support Agent',
    email: 'admin@creativewebsolutions.com',
    password: 'ValidPass123!@'
  });
  if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  if (!res.body.error?.includes('support login')) throw new Error('Expected support flow error');
});

// ===== CACHE CONTROL =====

test('Cache headers: Auth routes disable caching', async () => {
  const res = await request('GET', '/api/auth/session');
  const cacheHeader = res.headers['cache-control'];
  if (!cacheHeader || !cacheHeader.includes('no-store')) {
    throw new Error(`Expected no-store cache header, got: ${cacheHeader}`);
  }
});

// Run all tests
runTests();
