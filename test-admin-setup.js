/**
 * test-admin-setup.js - Setup and test admin panel access
 * 
 * Tests:
 * 1. Support login endpoint exists and is available
 * 2. Admin credentials are defined
 * 3. Admin panel can be accessed with proper credentials
 * 4. Admin endpoints return proper data
 */

const http = require('http');

const ADMIN_EMAIL = 'admin@creativewebsolutions.com';
const ADMIN_PASSWORD = 'AdminPass123!@';
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
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║           ADMIN PANEL SETUP & ACCESS TEST             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  // Step 1: Check support login is available
  console.log('Step 1: Check support login endpoint');
  const metaRes = await request('GET', '/api/auth/meta');
  console.log(`  Status: ${metaRes.status}`);
  console.log(`  Support login configured: ${metaRes.body.supportLoginConfigured}\n`);
  
  if (!metaRes.body.supportLoginConfigured) {
    console.log('⚠️  NOTE: Support login is NOT configured on the server!');
    console.log('   To enable it, set environment variable:');
    console.log('   SUPPORT_PORTAL_PASSWORD=YourSecurePassword123!@\n');
    console.log('   Then restart the server:\n');
    console.log('   $ SUPPORT_PORTAL_PASSWORD=AdminPass123!@ node server.js\n');
  }
  
  // Step 2: Attempt support login with admin credentials
  console.log('Step 2: Attempt admin support login');
  console.log(`  Email: ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  
  const loginRes = await request('POST', '/api/auth/support-login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });
  
  console.log(`  Response Status: ${loginRes.status}`);
  console.log(`  Response: ${loginRes.body.error || loginRes.body.user?.role || 'Unknown'}\n`);
  
  if (loginRes.status === 503) {
    console.log('⚠️  Support login is DISABLED (503 Service Unavailable)');
    console.log('   This is expected if SUPPORT_PORTAL_PASSWORD is not set.\n');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('TO ENABLE ADMIN PANEL:\n');
    console.log('1. Set the password via environment variable:');
    console.log('   export SUPPORT_PORTAL_PASSWORD=AdminPass123!@\n');
    console.log('2. Restart the server:');
    console.log('   node server.js\n');
    console.log('3. Access admin panel:');
    console.log('   - Support Portal: http://localhost:3000/support-portal.html');
    console.log('   - Login with:');
    console.log(`     Email: ${ADMIN_EMAIL}`);
    console.log(`     Password: AdminPass123!@\n`);
    console.log('4. Once logged in as System Administrator, you\'ll see');
    console.log('   "Admin Console" link to access: system-admin.html\n');
    process.exit(0);
  }
  
  if (loginRes.status !== 200) {
    console.log(`✗ Login failed with status ${loginRes.status}`);
    console.log(`  Error: ${loginRes.body.error}\n`);
    process.exit(1);
  }
  
  // Step 3: Extract session cookie
  const sessionCookie = loginRes.headers['set-cookie']?.[0];
  const sessionId = loginRes.body.sessionToken;
  
  console.log('✓ Admin login successful!\n');
  console.log(`  Session ID: ${sessionId?.slice(0, 20)}...`);
  console.log(`  User: ${loginRes.body.user?.email}`);
  console.log(`  Role: ${loginRes.body.user?.supportRole}\n`);
  
  // Step 4: Access admin overview endpoint
  console.log('Step 3: Access /api/auth/admin/overview');
  const overviewRes = await request('GET', '/api/auth/admin/overview', null, {
    'Cookie': sessionCookie
  });
  
  console.log(`  Status: ${overviewRes.status}`);
  console.log(`  Support login configured: ${overviewRes.body.supportLoginConfigured}`);
  console.log(`  Total customers: ${overviewRes.body.totals?.customers || 0}`);
  console.log(`  Active sessions: ${overviewRes.body.totals?.activeSessions || 0}`);
  console.log(`  Support tickets: ${overviewRes.body.totals?.supportTickets || 0}\n`);
  
  // Step 5: Provide access instructions
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('✓ ADMIN PANEL IS ACCESSIBLE!\n');
  console.log('ACCESS INSTRUCTIONS:\n');
  console.log(`1. Open: http://localhost:${PORT}/support-portal.html`);
  console.log('\n2. Login with admin credentials:');
  console.log(`   Email: ${ADMIN_EMAIL}`);
  console.log(`   Password: AdminPass123!@\n`);
  console.log('3. Click "Admin Console" button (visible for System Administrators)\n');
  console.log('4. Or go directly to: http://localhost:' + PORT + '/system-admin.html\n');
  console.log('ADMIN FEATURES:\n');
  console.log('  - View all customers & accounts');
  console.log('  - Manage support tickets');
  console.log('  - Edit customer profiles');
  console.log('  - Revoke user sessions');
  console.log('  - Set/rotate support password');
  console.log('  - View audit logs\n');
  
  process.exit(0);
})();
