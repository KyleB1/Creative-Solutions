const http = require('http');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'localhost',
      port: PORT,
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
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('=== AUTHENTICATED ROUTE TESTS ===\n');
  
  // 1. Create test customer
  console.log('1. POST /api/auth/signup (create test customer)');
  const signupRes = await request('POST', '/api/auth/signup', {
    name: 'Test Customer',
    email: 'test-auth-' + Date.now() + '@example.com',
    password: 'SecurePass123!@'
  });
  console.log(`   Status: ${signupRes.status}`);
  console.log(`   Message: ${signupRes.body.message}`);
  
  if (signupRes.status !== 201) {
    console.error('Signup failed, stopping tests');
    process.exit(1);
  }
  
  const sessionCookie = signupRes.headers['set-cookie']?.[0];
  const sessionToken = signupRes.body.sessionToken;
  const customerId = signupRes.body.user?.customerId;
  console.log(`   Session Token: ${sessionToken?.slice(0, 20)}...`);
  console.log(`   Customer ID: ${customerId}`);
  
  // 2. Test /api/auth/session (authenticated)
  console.log('\n2. GET /api/auth/session (verify session)');
  const sessionRes = await request('GET', '/api/auth/session', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${sessionRes.status}`);
  console.log(`   Authenticated: ${sessionRes.body.authenticated}`);
  console.log(`   User email: ${sessionRes.body.user?.email}`);
  
  // 3. Test /api/auth/customer/tickets (authenticated customer)
  console.log('\n3. GET /api/auth/customer/tickets (customer tickets, authenticated)');
  const ticketsRes = await request('GET', '/api/auth/customer/tickets', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${ticketsRes.status}`);
  console.log(`   Tickets: ${ticketsRes.body.tickets?.length || 0}`);
  
  // 4. Test /api/billing/payment-intent (authenticated customer)
  console.log('\n4. POST /api/billing/payment-intent (authenticated)');
  const paymentIntentRes = await request('POST', '/api/billing/payment-intent', {
    customerId,
    amount: 99.99,
    currency: 'USD'
  }, { 'Cookie': sessionCookie });
  console.log(`   Status: ${paymentIntentRes.status}`);
  console.log(`   Has clientSecret: ${!!paymentIntentRes.body.clientSecret}`);
  
  // 5. Test /api/billing/payment-methods (authenticated customer)
  console.log('\n5. GET /api/billing/payment-methods (authenticated)');
  const paymentMethodsRes = await request('GET', '/api/billing/payment-methods', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${paymentMethodsRes.status}`);
  console.log(`   Methods: ${paymentMethodsRes.body.paymentMethods?.length || 0}`);
  
  // 6. Test /api/billing/payments (authenticated customer)
  console.log('\n6. GET /api/billing/payments (authenticated)');
  const paymentsRes = await request('GET', '/api/billing/payments', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${paymentsRes.status}`);
  console.log(`   Payments: ${paymentsRes.body.payments?.length || 0}`);
  
  // 7. Test POST /api/auth/customer/tickets (create ticket, authenticated)
  console.log('\n7. POST /api/auth/customer/tickets (create ticket, authenticated)');
  const createTicketRes = await request('POST', '/api/auth/customer/tickets', {
    subject: 'Test Support Ticket',
    product: 'Test Product',
    priority: 'Medium',
    description: 'This is a test ticket from an authenticated customer.'
  }, { 'Cookie': sessionCookie });
  console.log(`   Status: ${createTicketRes.status}`);
  console.log(`   Ticket ID: ${createTicketRes.body.ticket?.id}`);
  console.log(`   Subject: ${createTicketRes.body.ticket?.subject}`);
  
  // 8. Test /api/auth/customer-profile (update profile, authenticated)
  console.log('\n8. PATCH /api/auth/customer-profile (update profile)');
  const updateProfileRes = await request('PATCH', '/api/auth/customer-profile', {
    name: 'Updated Test Customer',
    email: signupRes.body.user.email,
    plan: 'Premium plan',
    notifications: true
  }, { 'Cookie': sessionCookie });
  console.log(`   Status: ${updateProfileRes.status}`);
  console.log(`   User name: ${updateProfileRes.body.user?.name}`);
  console.log(`   User plan: ${updateProfileRes.body.user?.plan}`);
  
  // 9. Test /api/auth/logout (destroy session)
  console.log('\n9. POST /api/auth/logout (destroy session)');
  const logoutRes = await request('POST', '/api/auth/logout', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${logoutRes.status}`);
  
  // 10. Verify session is destroyed
  console.log('\n10. GET /api/auth/session (verify logout)');
  const verifyLogoutRes = await request('GET', '/api/auth/session', null, { 'Cookie': sessionCookie });
  console.log(`   Status: ${verifyLogoutRes.status}`);
  console.log(`   Authenticated: ${verifyLogoutRes.body.authenticated}`);
  
  console.log('\n=== TESTS COMPLETE ===');
  process.exit(0);
})();
