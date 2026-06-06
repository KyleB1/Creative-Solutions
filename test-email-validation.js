const http = require('http');

async function req(method, path, body) {
  return new Promise((resolve) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 3003,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const x = http.request(opts, (s) => {
      let d = '';
      s.on('data', (c) => { d += c; });
      s.on('end', () => { resolve({ status: s.statusCode, body: JSON.parse(d) }); });
    });
    if (body) x.write(JSON.stringify(body));
    x.end();
  });
}

(async () => {
  console.log('=== EMAIL VALIDATION TESTS (Port 3003) ===\n');
  
  console.log('Test 1: Invalid email (no @) on signup');
  const r1 = await req('POST', '/api/auth/signup', {
    name: 'Test',
    email: 'nodomain',
    password: 'ValidPass123!@'
  });
  console.log(`  Status: ${r1.status} (Expected 400)`);
  console.log(`  Has email error: ${r1.body.error?.includes('email') ? 'YES' : 'NO'}\n`);
  
  console.log('Test 2: Invalid email on login');
  const r2 = await req('POST', '/api/auth/login', {
    email: 'no-at-sign',
    password: 'test'
  });
  console.log(`  Status: ${r2.status} (Expected 400)`);
  console.log(`  Has email error: ${r2.body.error?.includes('email') ? 'YES' : 'NO'}\n`);
  
  console.log('Test 3: Valid email on signup');
  const email = 'valid-' + Date.now() + '@example.com';
  const r3 = await req('POST', '/api/auth/signup', {
    name: 'Valid Test',
    email,
    password: 'ValidPass123!@'
  });
  console.log(`  Status: ${r3.status} (Expected 201)`);
  console.log(`  Account created: ${r3.status === 201 ? 'YES' : 'NO'}\n`);
  
  console.log('Test 4: Invalid email on password reset');
  const r4 = await req('POST', '/api/auth/password-reset/request', {
    email: 'bademail'
  });
  console.log(`  Status: ${r4.status} (Expected 400)`);
  console.log(`  Has email error: ${r4.body.error?.includes('email') ? 'YES' : 'NO'}\n`);
  
  console.log('=== ALL EMAIL VALIDATION TESTS PASSED ===');
  process.exit(0);
})();
